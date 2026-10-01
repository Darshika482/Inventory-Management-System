/**
 * Saving a bill must never depend on the network. A new bill is written to
 * this phone first (IndexedDB) and uploaded afterwards; until then it waits
 * in the outbox and shows as "waiting to upload".
 *
 * Bill numbers: every phone has its own series letter (A, B, ...) and keeps
 * its own counter, started from the server's count. The number is taken and
 * the bill is queued in one IndexedDB transaction, so a number is never
 * used twice and never skipped. If the phone has never been online for this
 * financial year, the bill is queued without a number and the server gives it
 * one on upload.
 *
 * Uploads use the bill's client_id, so sending the same bill twice is harmless.
 */
import { useStore } from './useStore';
import { describeDbError, isTransientError } from '../lib/dbErrors';
import { fetchLastBillNumber, saveSaleRpc, type SaleRpcPayload } from './db';
import { formatBillNumber, type BillType } from './fy';
import type { ShopInvoice } from './types';

const DB_NAME = 'akshay-shop';
const DB_VERSION = 1;
const OUTBOX = 'outbox';
const COUNTERS = 'counters';
const SERIES_KEY = 'shop_device_series';

interface OutboxEntry {
  clientId: string;
  payload: SaleRpcPayload;
  invoice: ShopInvoice;
  state: 'pending' | 'failed';
  error?: string;
  queuedAt: string;
}

interface CounterEntry {
  key: string;
  lastNumber: number;
}

// --- IndexedDB basics ---

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser cannot store bills on the phone.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'clientId' });
      if (!db.objectStoreNames.contains(COUNTERS)) db.createObjectStore(COUNTERS, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open phone storage.'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Phone storage write was cancelled.'));
  });
}

const counterKey = (type: BillType, fy: string, series: string) => `${type}:${fy}:${series}`;

// --- This phone's series letter ---

export function getDeviceSeries(): string {
  try {
    const stored = localStorage.getItem(SERIES_KEY);
    return stored && /^[A-Z]$/.test(stored) ? stored : 'A';
  } catch {
    return 'A';
  }
}

export function setDeviceSeries(series: string): void {
  if (!/^[A-Z]$/.test(series)) return;
  try {
    localStorage.setItem(SERIES_KEY, series);
  } catch {
    // Storage blocked: the phone keeps using series A.
  }
}

// --- Counters ---

/** Moves this phone's counter up to the server's count (never down). */
export async function seedCounter(type: BillType, fy: string, series: string, serverLast: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(COUNTERS, 'readwrite');
  const store = tx.objectStore(COUNTERS);
  const key = counterKey(type, fy, series);
  const current = (await promisify(store.get(key))) as CounterEntry | undefined;
  if (!current || current.lastNumber < serverLast) store.put({ key, lastNumber: serverLast } satisfies CounterEntry);
  await txDone(tx);
}

/** Asks the server for the count when online. Fails quietly when offline. */
export async function refreshCounter(type: BillType, fy: string, series: string): Promise<void> {
  try {
    const last = await fetchLastBillNumber(type, fy, series);
    await seedCounter(type, fy, series, last);
  } catch {
    // Offline: the phone keeps its own count.
  }
}

// --- Queueing a bill ---

/**
 * Gives the bill its number and stores it on the phone, in one step.
 * `buildPayload` receives the numbered bill and returns what the server needs.
 */
export async function queueSale(
  invoice: ShopInvoice,
  buildPayload: (numbered: ShopInvoice) => SaleRpcPayload
): Promise<ShopInvoice> {
  const db = await openDb();
  const tx = db.transaction([COUNTERS, OUTBOX], 'readwrite');
  const counters = tx.objectStore(COUNTERS);
  const outbox = tx.objectStore(OUTBOX);
  const key = counterKey(invoice.billType, invoice.fy, invoice.series);

  const counter = (await promisify(counters.get(key))) as CounterEntry | undefined;
  let numbered: ShopInvoice = { ...invoice, syncState: 'pending' };
  if (counter) {
    const next = counter.lastNumber + 1;
    counters.put({ key, lastNumber: next } satisfies CounterEntry);
    numbered = { ...numbered, billNumber: formatBillNumber(invoice.billType, invoice.series, invoice.fy, next) };
  }

  const entry: OutboxEntry = {
    clientId: invoice.clientId,
    payload: buildPayload(numbered),
    invoice: numbered,
    state: 'pending',
    queuedAt: new Date().toISOString(),
  };
  outbox.put(entry);
  await txDone(tx);
  notify();
  return numbered;
}

// --- Reading the outbox ---

async function readAll(): Promise<OutboxEntry[]> {
  const db = await openDb();
  const tx = db.transaction(OUTBOX, 'readonly');
  const entries = (await promisify(tx.objectStore(OUTBOX).getAll())) as OutboxEntry[];
  return entries.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

/** Bills on this phone that the server does not have yet. */
export async function listQueuedSales(): Promise<ShopInvoice[]> {
  try {
    const entries = await readAll();
    return entries.map((e) => ({
      ...e.invoice,
      syncState: e.state,
      syncError: e.error,
    }));
  } catch {
    return [];
  }
}

async function removeEntry(clientId: string) {
  const db = await openDb();
  const tx = db.transaction(OUTBOX, 'readwrite');
  tx.objectStore(OUTBOX).delete(clientId);
  await txDone(tx);
}

async function putEntry(entry: OutboxEntry) {
  const db = await openDb();
  const tx = db.transaction(OUTBOX, 'readwrite');
  tx.objectStore(OUTBOX).put(entry);
  await txDone(tx);
}

// --- Uploading ---

function refusalReason(err: unknown, entry: OutboxEntry): string {
  const { code = '', message = '' } = (err ?? {}) as { code?: string; message?: string };
  // Raised by shop_save_sale() itself, already in plain words.
  if (code === 'P0001' && message) return message;
  if (code === '23505' && message.includes('bill_number')) {
    return `Bill number ${entry.invoice.billNumber} is already used by another phone. Give this phone its own series letter in Shop settings.`;
  }
  const reason = describeDbError(err, 'The server did not accept this bill');
  return [reason.message, reason.detail].filter(Boolean).join(' ');
}

export interface SyncedBill {
  clientId: string;
  billNumber: string;
}

let syncing: Promise<SyncedBill[]> | null = null;
const syncedListeners = new Set<(bills: SyncedBill[]) => void>();

/** Called with every batch of bills that reached the server. */
export function onBillsSynced(listener: (bills: SyncedBill[]) => void): () => void {
  syncedListeners.add(listener);
  return () => syncedListeners.delete(listener);
}

/**
 * Uploads waiting bills, oldest first. Stops at the first network problem
 * (the rest wait for the next try). A bill the server refuses is marked
 * failed with the reason and does not block the others.
 * Pass `retryFailed` to give refused bills another go.
 */
export function syncOutbox(retryFailed = false): Promise<SyncedBill[]> {
  if (syncing) return syncing;
  syncing = (async () => {
    const done: SyncedBill[] = [];
    let entries: OutboxEntry[];
    try {
      entries = await readAll();
    } catch {
      return done;
    }

    for (const entry of entries) {
      if (entry.state === 'failed' && !retryFailed) continue;
      try {
        const result = await saveSaleRpc(entry.payload);
        await removeEntry(entry.clientId);
        // A bill numbered by the server: keep this phone's count in step.
        const seq = Number(result.bill_number.split('/').pop());
        if (Number.isFinite(seq)) {
          await seedCounter(entry.invoice.billType, entry.invoice.fy, entry.invoice.series, seq).catch(() => {});
        }
        done.push({ clientId: entry.clientId, billNumber: result.bill_number });
      } catch (err) {
        if (isTransientError(err)) break;
        await putEntry({ ...entry, state: 'failed', error: refusalReason(err, entry) }).catch(() => {});
      }
    }

    notify();
    if (done.length) syncedListeners.forEach((listener) => listener(done));
    return done;
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

// --- "x bills waiting" count for the badge ---

interface OutboxCounts {
  pending: number;
  failed: number;
}

let counts: OutboxCounts = { pending: 0, failed: 0 };
const countListeners = new Set<() => void>();

function notify() {
  readAll()
    .then((entries) => {
      const next = {
        pending: entries.filter((e) => e.state === 'pending').length,
        failed: entries.filter((e) => e.state === 'failed').length,
      };
      if (next.pending !== counts.pending || next.failed !== counts.failed) {
        counts = next;
        countListeners.forEach((listener) => listener());
      }
    })
    .catch(() => {});
}

export function useOutboxCounts(): OutboxCounts {
  return useStore(
    (listener) => {
      countListeners.add(listener);
      notify();
      return () => countListeners.delete(listener);
    },
    () => counts
  );
}

let started = false;

/**
 * Starts background uploading: now, whenever the phone comes back online,
 * and every 30 seconds while bills are waiting. Safe to call more than once.
 */
export function startOutboxSync(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const run = () => {
    void syncOutbox();
  };
  window.addEventListener('online', run);
  window.setInterval(() => {
    if (counts.pending > 0) run();
  }, 30_000);
  run();
}
