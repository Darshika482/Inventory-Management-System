/**
 * Talking to the thermal printer from the browser.
 *
 * - Bluetooth (BLE) printers: Web Bluetooth, Chrome on Android.
 * - Classic Bluetooth printers (most cheap shop printers): the free RawBT app
 *   on Android does the printing; the app hands it the ESC/POS bytes.
 *
 * Printer choices are per phone (localStorage). Printing never affects saving:
 * every function here reports failure instead of throwing at the caller.
 */
import { useStore } from '../useStore';
import type { QrStyle } from './escpos';
import type { HeadingSize } from './receipt';

export type PrintMethod = 'bluetooth' | 'rawbt' | 'none';

export interface PrinterPrefs {
  method: PrintMethod;
  deviceId: string;
  deviceName: string;
  /** Printer has an automatic paper cutter. */
  cutter: boolean;
  /** How the QR is printed; block letters work on every printer. */
  qrStyle: QrStyle;
  /** Item names in Hindi (receipt is sent as an image). */
  hindi: boolean;
  /** UPI QR for the amount due. */
  showUpiQr: boolean;
  /** Printer's small font in bold: smaller, clear letters. */
  smallFont: boolean;
  /** Size of the shop name at the top. */
  headingSize: HeadingSize;
  /** Name printed at the top of the bill. */
  billName: string;
  /** Small line under the name. */
  billSubtitle: string;
  /** Version of these choices; older saved choices are brought up to date on reading. */
  version?: number;
}

const PREFS_KEY = 'shop_printer';
const DEFAULT_PREFS: PrinterPrefs = {
  method: 'none',
  deviceId: '',
  deviceName: '',
  cutter: false,
  // The shop printer prints GS ( k as text and garbles pictures, but prints
  // plain text perfectly, so the QR is drawn with block letters.
  // A small QR picture (about 2 KB, sent slowly, printed last on the bill).
  qrStyle: 'picture',
  // The printer's normal font: the small bold one looked worse on paper.
  smallFont: false,
  headingSize: 'medium',
  hindi: false,
  showUpiQr: true,
  billName: 'Surbhi Fall',
  billSubtitle: 'wholesale',
  version: 6,
};

export function getPrinterPrefs(): PrinterPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const saved = JSON.parse(raw) as Partial<PrinterPrefs> & { nativeQr?: boolean };
    delete saved.nativeQr;
    saved.version ??= 1;
    // Version 3: heading became "Surbhi Fall" with "wholesale" underneath.
    if (saved.version < 3) {
      if (!saved.billName || saved.billName === 'Fall Wholesale') saved.billName = DEFAULT_PREFS.billName;
      saved.billSubtitle = DEFAULT_PREFS.billSubtitle;
      saved.version = 3;
    }
    // Version 4: QR as a picture still garbled on the shop printer; use block letters.
    if (saved.version < 4) {
      saved.qrStyle = 'blocks';
      saved.version = 4;
    }
    // Version 5: the picture QR is now small enough to print safely; small clear letters.
    if (saved.version < 5) {
      saved.qrStyle = 'picture';
      saved.smallFont = true;
      saved.version = 5;
    }
    // Version 6: back to the normal font, smaller shop name.
    if (saved.version < 6) {
      saved.smallFont = false;
      saved.headingSize = 'medium';
      saved.version = 6;
    }
    return { ...DEFAULT_PREFS, ...saved };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrinterPrefs(prefs: PrinterPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage blocked: choices last until the page reloads.
  }
  const state: PrinterState =
    prefs.method === 'none'
      ? 'not_set_up'
      : prefs.method === 'rawbt'
        ? 'connected'
        : channel
          ? 'connected'
          : 'disconnected';
  status = { method: prefs.method, deviceName: prefs.deviceName, state };
  emit();
}

export function bluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.bluetooth);
}

// --- Status for the little printer dot ---

export type PrinterState = 'not_set_up' | 'disconnected' | 'connecting' | 'connected' | 'printing';

interface PrinterStatus {
  method: PrintMethod;
  state: PrinterState;
  deviceName: string;
}

let status: PrinterStatus = (() => {
  const prefs = getPrinterPrefs();
  return {
    method: prefs.method,
    deviceName: prefs.deviceName,
    // RawBT is always "ready": the RawBT app keeps the connection.
    state: prefs.method === 'none' ? 'not_set_up' : prefs.method === 'rawbt' ? 'connected' : 'disconnected',
  };
})();
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function setState(state: PrinterState) {
  status = { ...status, state };
  emit();
}

export function usePrinterStatus(): PrinterStatus {
  return useStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status
  );
}

// --- Bluetooth ---

/** Service / characteristic pairs used by common ESC/POS BLE printers. */
const KNOWN = [
  { service: '000018f0-0000-1000-8000-00805f9b34fb', characteristic: '00002af1-0000-1000-8000-00805f9b34fb' },
  { service: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', characteristic: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f' },
  { service: '49535343-fe7d-4ae5-8fa9-9fafd205e455', characteristic: '49535343-8841-43f4-a8d4-ecbe34729bb3' },
  { service: '0000ff00-0000-1000-8000-00805f9b34fb', characteristic: '0000ff02-0000-1000-8000-00805f9b34fb' },
  { service: '0000ae30-0000-1000-8000-00805f9b34fb', characteristic: '0000ae01-0000-1000-8000-00805f9b34fb' },
];

let device: BluetoothDevice | null = null;
let channel: BluetoothRemoteGATTCharacteristic | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

async function findWritable(server: BluetoothRemoteGATTServer): Promise<BluetoothRemoteGATTCharacteristic> {
  for (const known of KNOWN) {
    try {
      const service = await server.getPrimaryService(known.service);
      try {
        return await service.getCharacteristic(known.characteristic);
      } catch {
        const chars = await service.getCharacteristics();
        const writable = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
        if (writable) return writable;
      }
    } catch {
      // Not this printer's service; try the next.
    }
  }
  throw new Error('This Bluetooth device does not look like a receipt printer.');
}

async function connect(target: BluetoothDevice): Promise<void> {
  if (!target.gatt) throw new Error('This device cannot be connected.');
  setState('connecting');
  const server = await target.gatt.connect();
  channel = await findWritable(server);
  device = target;
  setState('connected');
}

/** True while this app lets go of the printer on purpose (not "printer off"). */
let releasing = false;

function onDisconnected() {
  channel = null;
  if (releasing) return;
  if (status.method === 'bluetooth') setState('disconnected');
}

/** Opens the phone's Bluetooth chooser (needs a tap) and remembers the printer. */
export async function pairBluetoothPrinter(): Promise<{ ok: boolean; message: string }> {
  if (!navigator.bluetooth) {
    return { ok: false, message: 'bluetooth_unsupported' };
  }
  try {
    const picked = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: KNOWN.map((k) => k.service),
    });
    picked.addEventListener('gattserverdisconnected', onDisconnected);
    await connect(picked);
    savePrinterPrefs({ ...getPrinterPrefs(), method: 'bluetooth', deviceId: picked.id, deviceName: picked.name ?? 'Printer' });
    return { ok: true, message: picked.name ?? 'Printer' };
  } catch (err) {
    setState(status.method === 'bluetooth' ? 'disconnected' : status.state);
    const message = err instanceof Error ? err.message : String(err);
    // Closing the chooser is not an error worth showing.
    return { ok: false, message: /cancel/i.test(message) ? 'cancelled' : message };
  }
}

/**
 * Connected already, or reconnects to the saved printer within `ms`.
 * 'unknown': Chrome no longer knows the printer (it forgets it when the app
 * is reopened), so it has to be picked from the list again.
 */
async function ensureConnected(ms: number): Promise<'connected' | 'unknown' | 'failed'> {
  if (channel && device?.gatt?.connected) return 'connected';
  let target = device;
  try {
    if (!target && navigator.bluetooth?.getDevices) {
      const known = await navigator.bluetooth.getDevices();
      target = known.find((d) => d.id === getPrinterPrefs().deviceId) ?? null;
      target?.addEventListener('gattserverdisconnected', onDisconnected);
    }
  } catch {
    target = null;
  }
  if (!target) return 'unknown';
  try {
    await withTimeout(connect(target), ms);
    return 'connected';
  } catch {
    setState('disconnected');
    return 'failed';
  }
}

/**
 * Chrome keeps the chosen printer after the app reloads only when its
 * "remember Bluetooth devices" settings (flags) are on; then getDevices() exists.
 */
export function printerRemembered(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.bluetooth?.getDevices);
}

/**
 * When the app opens again (refresh, update): finds the saved printer if
 * Chrome still allows it, and shows it as ready. Each print connects for
 * itself, so nothing is held open. Never throws.
 */
export async function restorePrinter(): Promise<void> {
  const prefs = getPrinterPrefs();
  if (prefs.method !== 'bluetooth' || !prefs.deviceId || device || !printerRemembered()) return;
  try {
    const known = await navigator.bluetooth!.getDevices!();
    const saved = known.find((d) => d.id === prefs.deviceId);
    if (!saved || device) return;
    saved.addEventListener('gattserverdisconnected', onDisconnected);
    device = saved;
    if (status.state === 'disconnected') setState('connected');
  } catch {
    // Not allowed: the first print opens the printer list instead.
  }
}

/** Tries to reconnect in the background (e.g. when the bill screen opens). */
export function warmUpPrinter(): void {
  // Deliberately does nothing now: holding the link open blocks the other
  // phones in the shop, so each print connects only for as long as it prints.
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sends in small pieces at a pace the printer can keep up with. Sending too
 * fast loses bytes, and a lost byte in a picture makes the printer print the
 * rest as endless strange letters.
 */
async function writeBluetooth(bytes: Uint8Array): Promise<void> {
  if (!channel) throw new Error('not connected');
  // Cheap printers hold only ~4 KB and print pictures slowly; a bill that
  // printed fine for its first ~3 KB then turned to letters showed the buffer
  // overflowing. Capping the speed keeps the buffer from ever filling up.
  const bytesPerSecond = 2000;
  const chunk = 100;
  const fast = channel.properties.writeWithoutResponse && channel.writeValueWithoutResponse;
  const start = Date.now();
  for (let i = 0; i < bytes.length; i += chunk) {
    const part = bytes.slice(i, i + chunk);
    if (fast) await channel.writeValueWithoutResponse!(part);
    else await channel.writeValue(part);
    const due = start + ((i + part.length) / bytesPerSecond) * 1000;
    const wait = due - Date.now();
    if (wait > 0) await pause(wait);
  }
  // Let the printer finish its buffer before the link is let go.
  await pause(1500);
}

/** Lets go of the printer so other phones in the shop can print too. */
function releasePrinter() {
  releasing = true;
  setTimeout(() => (releasing = false), 2000);
  try {
    device?.gatt?.disconnect();
  } catch {
    // Already gone.
  }
  channel = null;
}

/**
 * Blank bytes before each print. If an earlier print was cut off in the middle
 * of a picture strip, the printer is still waiting for the rest of it and would
 * print this bill's bytes as letters; these zeros fill that strip with white
 * (at most a few mm of blank paper), and printers ignore them otherwise.
 */
function withFlush(bytes: Uint8Array): Uint8Array {
  const flush = 24 * 72 + 16; // one full picture strip on 80mm paper
  const out = new Uint8Array(flush + bytes.length);
  out.set(bytes, flush);
  return out;
}

// --- RawBT ---

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function sendToRawBt(bytes: Uint8Array) {
  window.location.href = `intent:base64,${toBase64(bytes)}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
}

// --- Printing ---

export type PrintResult =
  | { ok: true }
  | { ok: false; reason: 'not_set_up' | 'not_connected' | 'failed'; detail?: string };

/**
 * Gets the printer ready. If Chrome has forgotten the Bluetooth printer, this
 * opens the printer list, which Chrome only allows within a few seconds of a
 * tap: call it straight from the Print tap, before anything slow. Never throws.
 */
export async function connectPrinter(): Promise<PrintResult> {
  const method = getPrinterPrefs().method;
  if (method === 'none') return { ok: false, reason: 'not_set_up' };
  if (method === 'rawbt') return { ok: true };

  const link = await ensureConnected(5000);
  if (link === 'connected') return { ok: true };
  // Known but switched off or out of range: the list would not help.
  if (link === 'failed') return { ok: false, reason: 'not_connected' };

  const picked = await pairBluetoothPrinter();
  if (picked.ok) return { ok: true };
  // Closed the list, or the tap was too long ago to open it: no detail needed.
  const quiet = ['cancelled', 'bluetooth_unsupported'].includes(picked.message) || /gesture/i.test(picked.message);
  return { ok: false, reason: 'not_connected', detail: quiet ? undefined : picked.message };
}

/** Sends bytes to the printer. Never throws. */
export async function printBytes(bytes: Uint8Array): Promise<PrintResult> {
  const ready = await connectPrinter();
  if (!ready.ok) return ready;

  if (getPrinterPrefs().method === 'rawbt') {
    try {
      sendToRawBt(bytes);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: 'failed', detail: err instanceof Error ? err.message : String(err) };
    }
  }

  setState('printing');
  try {
    await writeBluetooth(withFlush(bytes));
    releasePrinter();
    // Still "ready": the next print connects again in a moment.
    setState('connected');
    return { ok: true };
  } catch (err) {
    setState(device?.gatt?.connected ? 'connected' : 'disconnected');
    return { ok: false, reason: 'failed', detail: err instanceof Error ? err.message : String(err) };
  }
}

export function forgetPrinter(): void {
  try {
    device?.gatt?.disconnect();
  } catch {
    // Already gone.
  }
  device = null;
  channel = null;
  savePrinterPrefs({ ...getPrinterPrefs(), method: 'none', deviceId: '', deviceName: '' });
  setState('not_set_up');
}
