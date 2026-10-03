import {
  BillPayment,
  Category,
  Floor,
  GoodsIssue,
  GoodsItem,
  GoodsReturn,
  ItemGroup,
  PurchaseBill,
  StockAddition,
  TransportBill,
  WithdrawalLog,
  Worker,
  WorkerPayment,
  User,
} from '../types';
import {
  DbAppUser,
  DbBillPayment,
  DbCategory,
  DbGoodsIssue,
  DbGoodsReturn,
  DbItemGroup,
  DbPurchaseBill,
  DbStockAddition,
  DbTransportBill,
  DbWithdrawalLog,
  DbWorker,
  DbWorkerPayment,
  getAppSession,
  setAppSession,
  supabase,
} from './supabase';
import { isTransientError, RequestTimeoutError } from './dbErrors';
import { noteDbWrite } from './localFirst';

export function assertSupabase() {
  if (!supabase) {
    throw new Error(
      'Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel project settings.'
    );
  }
  return supabase;
}

const DB_TIMEOUT_MS = 12_000;
const UPLOAD_TIMEOUT_MS = 30_000;
/** Two extra attempts, spaced out enough to ride over a short drop in signal. */
const RETRY_DELAYS_MS = [700, 2000];
/**
 * Retries are only worth it while somebody is still willing to wait. A dropped
 * connection fails instantly and gets all three attempts in about three
 * seconds; a stalled one burns the whole budget and gives up here instead.
 */
const RETRY_BUDGET_MS = 25_000;

interface DbResponse<T> {
  data: T | null;
  error: { message?: string; code?: string; details?: string; hint?: string } | null;
}

type DbRequest<T> = (signal: AbortSignal) => PromiseLike<DbResponse<T>>;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Without a deadline a stalled request never settles, so the form sits on
 * "Saving..." forever and the button looks dead.
 */
async function runOnce<T>(request: DbRequest<T>, timeoutMs: number): Promise<T | null> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const { data, error } = await request(controller.signal);
    if (error) throw error;
    return data;
  } catch (err) {
    throw timedOut ? new RequestTimeoutError() : err;
  } finally {
    clearTimeout(timer);
  }
}

interface RunDbOptions {
  /**
   * For inserts whose id is generated here: if a retry hits a duplicate key,
   * the attempt before it did land and only its reply was lost.
   */
  duplicateMeansSaved?: boolean;
  /** A database function that only reads (it is still sent as a POST). */
  readOnly?: boolean;
}

/** Retries the failures that are worth retrying, and only those. */
export async function runDb<T>(request: DbRequest<T>, options: RunDbOptions = {}): Promise<T | null> {
  const { duplicateMeansSaved = false, readOnly = false } = options;
  const startedAt = Date.now();
  // Inserts, updates, deletes and function calls: the query builder carries
  // the HTTP method it will use, and reads are GET (or HEAD for a count).
  let isWrite = false;
  const tracked: DbRequest<T> = (signal) => {
    const builder = request(signal);
    const method = (builder as { method?: unknown }).method;
    isWrite = !readOnly && method !== 'GET' && method !== 'HEAD';
    return builder;
  };

  try {
    return await runWithRetries(tracked, duplicateMeansSaved, startedAt);
  } finally {
    // A page showing its saved copy refetches when a save lands mid-download.
    if (isWrite) noteDbWrite();
  }
}

async function runWithRetries<T>(
  request: DbRequest<T>,
  duplicateMeansSaved: boolean,
  startedAt: number
): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await runOnce(request, DB_TIMEOUT_MS);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (attempt > 0 && duplicateMeansSaved && code === '23505') return null;

      const outOfAttempts = attempt >= RETRY_DELAYS_MS.length;
      const outOfTime = Date.now() - startedAt >= RETRY_BUDGET_MS;
      if (outOfAttempts || outOfTime || !isTransientError(err)) throw err;

      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }
}

/** Rows the server sends per request at most (Supabase's default max-rows). */
const PAGE_SIZE = 1000;

type PageResponse<Row> = {
  data: Row[] | null;
  error: DbResponse<unknown>['error'];
  count?: number | null;
};

interface PageQuery<Row> {
  range(from: number, to: number): { abortSignal(signal: AbortSignal): PromiseLike<PageResponse<Row>> };
}

/**
 * Every row of a list, however long. The server cuts each answer off at 1000
 * rows, so longer lists come in pages: the first page also says how many rows
 * there are, then all the other pages are fetched at the same time.
 *
 * `query(withCount)` builds the select with a stable order (end with a unique
 * column, e.g. id, so no row lands on two pages); pass `{ count: 'exact' }`
 * to select() when `withCount` is true.
 */
export async function fetchAllRows<Row>(query: (withCount: boolean) => PageQuery<Row>): Promise<Row[]> {
  const first = await runDb<{ rows: Row[]; count: number | null }>(
    (signal) =>
      query(true)
        .range(0, PAGE_SIZE - 1)
        .abortSignal(signal)
        .then((res) => ({
          data: res.error ? null : { rows: res.data ?? [], count: res.count ?? null },
          error: res.error,
        })),
    { readOnly: true }
  );
  const rows = first?.rows ?? [];
  const total = first?.count ?? null;
  // The server's page may be smaller than asked for, if its limit is lower.
  const step = rows.length;
  if (step === 0) return rows;

  const fetchPage = (from: number) =>
    runDb<Row[]>((signal) => query(false).range(from, from + step - 1).abortSignal(signal));

  let pages: (Row[] | null)[];
  if (total !== null) {
    if (total <= step) return rows;
    const offsets: number[] = [];
    for (let from = step; from < total; from += step) offsets.push(from);
    pages = await Promise.all(offsets.map(fetchPage));
  } else {
    // No count came back: walk the pages one by one until a short one.
    pages = [];
    for (let from = step, last = rows.length; last === step; from += step) {
      const page = await fetchPage(from);
      pages.push(page);
      last = page?.length ?? 0;
    }
  }

  // A row added while paging shifts the pages by one; drop the repeat.
  const seen = new Set<unknown>();
  const all: Row[] = [];
  for (const row of rows.concat(...pages.map((page) => page ?? []))) {
    const id = (row as { id?: unknown }).id;
    if (id !== undefined) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    all.push(row);
  }
  return all;
}

function mapCategory(row: DbCategory): Category {
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    floor: (row.floor === 'Second Floor' ? 'Second Floor' : 'First Floor') as Floor,
    initialStock: row.initial_stock,
    currentQuantity: row.current_quantity,
    createdAt: row.created_at,
  };
}

function mapLog(row: DbWithdrawalLog): WithdrawalLog {
  return {
    id: row.id,
    workerId: row.worker_id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    quantity: row.quantity,
    timestamp: row.timestamp,
    status: row.status,
  };
}

function toCategoryRow(category: Category): DbCategory {
  return {
    id: category.id,
    name: category.name,
    unit: category.unit,
    floor: category.floor,
    initial_stock: category.initialStock,
    current_quantity: category.currentQuantity,
    created_at: category.createdAt,
  };
}

function toLogRow(log: WithdrawalLog): DbWithdrawalLog {
  return {
    id: log.id,
    worker_id: log.workerId,
    category_id: log.categoryId,
    category_name: log.categoryName,
    quantity: log.quantity,
    timestamp: log.timestamp,
    status: log.status,
  };
}

export async function fetchCategories(): Promise<Category[]> {
  const rows = await fetchAllRows<DbCategory>((withCount) =>
    assertSupabase()
      .from('categories')
      .select('*', withCount ? { count: 'exact' } : undefined)
      .order('name')
      .order('id')
  );
  return rows.map(mapCategory);
}

export async function fetchWithdrawalLogs(): Promise<WithdrawalLog[]> {
  const rows = await fetchAllRows<DbWithdrawalLog>((withCount) =>
    assertSupabase()
      .from('withdrawal_logs')
      .select('*', withCount ? { count: 'exact' } : undefined)
      .order('created_at', { ascending: false })
      .order('id')
  );
  return rows.map(mapLog);
}

type AppUserListRow = Pick<DbAppUser, 'id' | 'username' | 'role'>;

export async function fetchAppUsers(): Promise<AppUserListRow[]> {
  const { data, error } = await assertSupabase()
    .from('app_user_list')
    .select('id, username, role')
    .order('username');

  if (error) throw error;
  return (data ?? []) as AppUserListRow[];
}

export async function fetchStaffUsers(): Promise<User[]> {
  const client = assertSupabase();
  const listed = await client
    .from('app_user_list')
    .select('id, username, role')
    .eq('role', 'Worker')
    .order('username');
  const { data, error } = listed.error
    ? await client
        .from('app_users')
        .select('id, username, role')
        .eq('role', 'Worker')
        .order('username')
    : listed;

  if (error) throw error;
  return (data as AppUserListRow[]).map((row) => ({
    id: row.id,
    username: row.username,
    role: row.role,
  }));
}

interface AppLoginResult {
  token: string;
  user: { id: string; username: string; role: User['role'] };
}

function isMissingDbObject(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  return (
    error.code === 'PGRST202' ||
    error.code === 'PGRST205' ||
    error.code === '42883' ||
    error.code === '42P01' ||
    /could not find the function|does not exist|schema cache/i.test(message)
  );
}

export async function authenticateUser(
  username: string,
  password: string
): Promise<User | null> {
  const client = assertSupabase();
  const { data, error } = await client.rpc('app_login', {
    p_username: username.trim(),
    p_password: password,
  });

  if (!error) {
    const result = data as AppLoginResult | null;
    if (!result?.token || !result.user) return null;
    setAppSession(result.token);
    return {
      id: result.user.id,
      username: result.user.username,
      role: result.user.role,
    };
  }

  if (!isMissingDbObject(error)) throw error;

  // File 6 has not been run yet: compare against the table the old way.
  const legacy = await client
    .from('app_users')
    .select('id, username, role, password_hash')
    .ilike('username', username.trim())
    .maybeSingle();

  if (legacy.error) throw legacy.error;
  if (!legacy.data || legacy.data.password_hash !== password) return null;
  // No real session on an older database; mark the sign-in so it is kept.
  setAppSession('legacy');

  return {
    id: legacy.data.id,
    username: legacy.data.username,
    role: legacy.data.role,
  };
}

export async function logoutUser(): Promise<void> {
  const token = getAppSession();
  try {
    if (token) {
      await assertSupabase().rpc('app_logout', { p_token: token });
    }
  } catch {
    // Local sign-out still has to happen if the network is down.
  } finally {
    setAppSession(null);
  }
}

export async function insertCategory(category: Category): Promise<void> {
  const { error } = await assertSupabase().from('categories').insert(toCategoryRow(category));
  if (error) throw error;
}

export async function updateCategoryInDb(category: Category): Promise<void> {
  const { error } = await assertSupabase()
    .from('categories')
    .update({
      name: category.name,
      unit: category.unit,
      floor: category.floor,
      initial_stock: category.initialStock,
      current_quantity: category.currentQuantity,
    })
    .eq('id', category.id);

  if (error) throw error;
}

export async function deleteCategoryFromDb(categoryId: string): Promise<void> {
  const { error } = await assertSupabase().from('categories').delete().eq('id', categoryId);
  if (error) throw error;
}

export async function updateCategoryNameInLogs(
  categoryId: string,
  categoryName: string
): Promise<void> {
  const { error } = await assertSupabase()
    .from('withdrawal_logs')
    .update({ category_name: categoryName })
    .eq('category_id', categoryId);

  if (error) throw error;
}

export async function insertWithdrawalLog(log: WithdrawalLog): Promise<void> {
  const { error } = await assertSupabase().from('withdrawal_logs').insert(toLogRow(log));
  if (error) throw error;
}

export async function updateWithdrawalLogStatus(
  logId: string,
  status: WithdrawalLog['status']
): Promise<void> {
  const { error } = await assertSupabase()
    .from('withdrawal_logs')
    .update({ status })
    .eq('id', logId);

  if (error) throw error;
}

// Stock additions

function mapStockAddition(row: DbStockAddition): StockAddition {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    quantity: row.quantity,
    floor: (row.floor === 'Second Floor' ? 'Second Floor' : 'First Floor') as Floor,
    unit: row.unit,
    type: row.type,
    timestamp: row.timestamp,
    createdAt: row.created_at,
  };
}

function toStockAdditionRow(entry: StockAddition): DbStockAddition {
  return {
    id: entry.id,
    category_id: entry.categoryId,
    category_name: entry.categoryName,
    quantity: entry.quantity,
    floor: entry.floor,
    unit: entry.unit,
    type: entry.type,
    timestamp: entry.timestamp,
    created_at: entry.createdAt,
  };
}

export async function fetchStockAdditions(): Promise<StockAddition[]> {
  try {
    const rows = await fetchAllRows<DbStockAddition>((withCount) =>
      assertSupabase()
        .from('stock_additions')
        .select('*', withCount ? { count: 'exact' } : undefined)
        .order('created_at', { ascending: false })
        .order('id')
    );
    return rows.map(mapStockAddition);
  } catch {
    // Table may not exist yet.
    return [];
  }
}

export async function insertStockAddition(entry: StockAddition): Promise<void> {
  try {
    const { error } = await assertSupabase()
      .from('stock_additions')
      .insert(toStockAdditionRow(entry));
    if (error && error.code !== '42P01') {
      console.warn('Could not log stock addition:', error.message);
    }
  } catch {
    // Table may not exist yet — silently skip
  }
}

// Firm bills (purchases) & payments

function mapPurchaseBill(row: DbPurchaseBill): PurchaseBill {
  return {
    id: row.id,
    firmName: row.firm_name,
    billNo: row.bill_no,
    billDate: row.bill_date ?? '',
    gstNumber: row.gst_number ?? '',
    lrNo: row.lr_no ?? '',
    transportName: row.transport_name ?? '',
    items: Array.isArray(row.items)
      ? row.items.map((item) => ({
          name: item.name ?? '',
          hsn: item.hsn ?? '',
          quantity: Number(item.quantity) || 0,
          unit: item.unit ?? '',
          rate: Number(item.rate) || 0,
          amount: Number(item.amount) || 0,
        }))
      : [],
    grossAmount: Number(row.gross_amount) || 0,
    discounts:
      Array.isArray(row.discounts) && row.discounts.length > 0
        ? row.discounts.map((d) => ({
            name: d.name || 'Discount',
            amount: Number(d.amount) || 0,
          }))
        : Number(row.discount) > 0
          ? [{ name: 'Discount', amount: Number(row.discount) }]
          : [],
    discount: Number(row.discount) || 0,
    gstAmount: Number(row.gst_amount) || 0,
    netAmount: Number(row.net_amount) || 0,
    photoUrl: row.photo_url,
    createdAt: row.created_at,
  };
}

function toPurchaseBillRow(bill: PurchaseBill): DbPurchaseBill {
  return {
    id: bill.id,
    firm_name: bill.firmName,
    bill_no: bill.billNo,
    bill_date: bill.billDate || null,
    gst_number: bill.gstNumber,
    lr_no: bill.lrNo,
    transport_name: bill.transportName,
    items: bill.items,
    gross_amount: bill.grossAmount,
    discounts: bill.discounts,
    discount: bill.discount,
    gst_amount: bill.gstAmount,
    net_amount: bill.netAmount,
    photo_url: bill.photoUrl,
    created_at: bill.createdAt,
  };
}

function mapBillPayment(row: DbBillPayment): BillPayment {
  return {
    id: row.id,
    billId: row.bill_id,
    paidOn: row.paid_on ?? '',
    amount: Number(row.amount) || 0,
    method: row.method,
    reference: row.reference ?? '',
    bankName: row.bank_name ?? '',
    photoUrl: row.photo_url,
    groupId: row.group_id ?? null,
    createdAt: row.created_at,
  };
}

function toBillPaymentRow(payment: BillPayment): DbBillPayment {
  const row: DbBillPayment = {
    id: payment.id,
    bill_id: payment.billId,
    paid_on: payment.paidOn || null,
    amount: payment.amount,
    method: payment.method,
    reference: payment.reference,
    bank_name: payment.bankName,
    photo_url: payment.photoUrl,
    created_at: payment.createdAt,
  };
  // Left out for ordinary payments so they keep saving on databases (and the
  // transport_payments table) that do not have the column.
  if (payment.groupId) row.group_id = payment.groupId;
  return row;
}

export async function fetchPurchaseBills(): Promise<PurchaseBill[]> {
  const rows = await fetchAllRows<DbPurchaseBill>((withCount) =>
    assertSupabase()
      .from('purchase_bills')
      .select('*', withCount ? { count: 'exact' } : undefined)
      .order('created_at', { ascending: false })
      .order('id')
  );
  return rows.map(mapPurchaseBill);
}

export async function fetchBillPayments(): Promise<BillPayment[]> {
  const rows = await fetchAllRows<DbBillPayment>((withCount) =>
    assertSupabase()
      .from('bill_payments')
      .select('*', withCount ? { count: 'exact' } : undefined)
      .order('created_at', { ascending: false })
      .order('id')
  );
  return rows.map(mapBillPayment);
}

export async function insertPurchaseBill(bill: PurchaseBill): Promise<void> {
  await runDb(
    (signal) =>
      assertSupabase().from('purchase_bills').insert(toPurchaseBillRow(bill)).abortSignal(signal),
    { duplicateMeansSaved: true }
  );
}

export async function updatePurchaseBillInDb(bill: PurchaseBill): Promise<void> {
  await runDb((signal) =>
    assertSupabase()
      .from('purchase_bills')
      .update(toPurchaseBillRow(bill))
      .eq('id', bill.id)
      .abortSignal(signal)
  );
}

export async function deletePurchaseBillFromDb(billId: string): Promise<void> {
  await runDb((signal) =>
    assertSupabase().from('purchase_bills').delete().eq('id', billId).abortSignal(signal)
  );
}

// Item groups (combined item names for the rate analysis)

function mapItemGroup(row: DbItemGroup): ItemGroup {
  return {
    id: row.id,
    name: row.name,
    members: Array.isArray(row.members) ? row.members : [],
    createdAt: row.created_at,
  };
}

export async function fetchItemGroups(): Promise<ItemGroup[]> {
  try {
    const rows = await fetchAllRows<DbItemGroup>((withCount) =>
      assertSupabase()
        .from('item_groups')
        .select('*', withCount ? { count: 'exact' } : undefined)
        .order('created_at', { ascending: false })
        .order('id')
    );
    return rows.map(mapItemGroup);
  } catch {
    // Table not created yet — the analysis simply runs without groups.
    return [];
  }
}

export async function insertItemGroup(group: ItemGroup): Promise<void> {
  await runDb(
    (signal) =>
      assertSupabase()
        .from('item_groups')
        .insert({ id: group.id, name: group.name, members: group.members })
        .abortSignal(signal),
    { duplicateMeansSaved: true }
  );
}

export async function deleteItemGroupFromDb(groupId: string): Promise<void> {
  await runDb((signal) =>
    assertSupabase().from('item_groups').delete().eq('id', groupId).abortSignal(signal)
  );
}

export async function insertBillPayment(payment: BillPayment): Promise<void> {
  await runDb(
    (signal) =>
      assertSupabase().from('bill_payments').insert(toBillPaymentRow(payment)).abortSignal(signal),
    { duplicateMeansSaved: true }
  );
}

/**
 * Saves every share of a combined payment in one request, so either all the
 * bills get marked or none do — never half a payment.
 */
export async function insertBillPayments(payments: BillPayment[]): Promise<void> {
  await runDb(
    (signal) =>
      assertSupabase()
        .from('bill_payments')
        .insert(payments.map(toBillPaymentRow))
        .abortSignal(signal),
    { duplicateMeansSaved: true }
  );
}

export async function deleteBillPaymentFromDb(paymentId: string): Promise<void> {
  await runDb((signal) =>
    assertSupabase().from('bill_payments').delete().eq('id', paymentId).abortSignal(signal)
  );
}

/** Removes every share of a combined payment at once. */
export async function deleteBillPaymentGroupFromDb(groupId: string): Promise<void> {
  await runDb((signal) =>
    assertSupabase().from('bill_payments').delete().eq('group_id', groupId).abortSignal(signal)
  );
}

// Transport bills (bilty / freight) & payments

function mapTransportBill(row: DbTransportBill): TransportBill {
  return {
    id: row.id,
    receivedDate: row.received_date ?? '',
    transportName: row.transport_name,
    item: row.item ?? '',
    weight: row.weight ?? '',
    biltyNo: row.bilty_no ?? '',
    partyName: row.party_name ?? '',
    amount: Number(row.amount) || 0,
    photoUrl: row.photo_url,
    createdAt: row.created_at,
  };
}

function toTransportBillRow(bill: TransportBill): DbTransportBill {
  return {
    id: bill.id,
    received_date: bill.receivedDate || null,
    transport_name: bill.transportName,
    item: bill.item,
    weight: bill.weight,
    bilty_no: bill.biltyNo,
    party_name: bill.partyName,
    amount: bill.amount,
    photo_url: bill.photoUrl,
    created_at: bill.createdAt,
  };
}

export async function fetchTransportBills(): Promise<TransportBill[]> {
  const rows = await fetchAllRows<DbTransportBill>((withCount) =>
    assertSupabase()
      .from('transport_bills')
      .select('*', withCount ? { count: 'exact' } : undefined)
      .order('created_at', { ascending: false })
      .order('id')
  );
  return rows.map(mapTransportBill);
}

export async function fetchTransportPayments(): Promise<BillPayment[]> {
  const rows = await fetchAllRows<DbBillPayment>((withCount) =>
    assertSupabase()
      .from('transport_payments')
      .select('*', withCount ? { count: 'exact' } : undefined)
      .order('created_at', { ascending: false })
      .order('id')
  );
  return rows.map(mapBillPayment);
}

export async function insertTransportBill(bill: TransportBill): Promise<void> {
  await runDb(
    (signal) =>
      assertSupabase().from('transport_bills').insert(toTransportBillRow(bill)).abortSignal(signal),
    { duplicateMeansSaved: true }
  );
}

export async function updateTransportBillInDb(bill: TransportBill): Promise<void> {
  await runDb((signal) =>
    assertSupabase()
      .from('transport_bills')
      .update(toTransportBillRow(bill))
      .eq('id', bill.id)
      .abortSignal(signal)
  );
}

export async function deleteTransportBillFromDb(billId: string): Promise<void> {
  await runDb((signal) =>
    assertSupabase().from('transport_bills').delete().eq('id', billId).abortSignal(signal)
  );
}

export async function insertTransportPayment(payment: BillPayment): Promise<void> {
  await runDb(
    (signal) =>
      assertSupabase()
        .from('transport_payments')
        .insert(toBillPaymentRow(payment))
        .abortSignal(signal),
    { duplicateMeansSaved: true }
  );
}

export async function deleteTransportPaymentFromDb(paymentId: string): Promise<void> {
  await runDb((signal) =>
    assertSupabase().from('transport_payments').delete().eq('id', paymentId).abortSignal(signal)
  );
}

// Workers (salary & job work)

function mapWorker(row: DbWorker): Worker {
  return {
    id: row.id,
    name: row.name,
    type: row.type === 'Job work' ? 'Job work' : 'Shop',
    phone: row.phone ?? '',
    monthlySalary: Number(row.monthly_salary) || 0,
    note: row.note ?? '',
    createdAt: row.created_at,
  };
}

function toWorkerRow(worker: Worker): DbWorker {
  return {
    id: worker.id,
    name: worker.name,
    type: worker.type,
    phone: worker.phone,
    monthly_salary: worker.monthlySalary,
    note: worker.note,
    created_at: worker.createdAt,
  };
}

/**
 * Entries saved before multi-item transactions existed have their single item
 * in flat columns instead of the `items` array — fold those into one line.
 */
function mapGoodsItems(row: {
  items?: unknown;
  item?: string | null;
  quantity?: number | null;
  unit?: string | null;
}): GoodsItem[] {
  if (Array.isArray(row.items) && row.items.length > 0) {
    return (row.items as { item?: string; quantity?: number; unit?: string }[]).map((it) => ({
      item: it.item ?? '',
      quantity: Number(it.quantity) || 0,
      unit: it.unit ?? '',
    }));
  }
  if (row.item) {
    return [{ item: row.item, quantity: Number(row.quantity) || 0, unit: row.unit ?? '' }];
  }
  return [];
}

function mapGoodsIssue(row: DbGoodsIssue): GoodsIssue {
  return {
    id: row.id,
    workerId: row.worker_id,
    issuedOn: row.issued_on ?? '',
    items: mapGoodsItems(row),
    note: row.note ?? '',
    createdAt: row.created_at,
  };
}

function toGoodsIssueRow(issue: GoodsIssue): DbGoodsIssue {
  return {
    id: issue.id,
    worker_id: issue.workerId,
    issued_on: issue.issuedOn || null,
    items: issue.items,
    note: issue.note,
    created_at: issue.createdAt,
  };
}

function mapGoodsReturn(row: DbGoodsReturn): GoodsReturn {
  return {
    id: row.id,
    workerId: row.worker_id,
    returnedOn: row.returned_on ?? '',
    items: mapGoodsItems(row),
    metersUsed: Number(row.meters_used) || 0,
    rate: Number(row.rate) || 0,
    amount: Number(row.amount) || 0,
    note: row.note ?? '',
    createdAt: row.created_at,
  };
}

function toGoodsReturnRow(entry: GoodsReturn): DbGoodsReturn {
  return {
    id: entry.id,
    worker_id: entry.workerId,
    returned_on: entry.returnedOn || null,
    items: entry.items,
    meters_used: entry.metersUsed,
    rate: entry.rate,
    amount: entry.amount,
    note: entry.note,
    created_at: entry.createdAt,
  };
}

function mapWorkerPayment(row: DbWorkerPayment): WorkerPayment {
  return {
    id: row.id,
    workerId: row.worker_id,
    paidOn: row.paid_on ?? '',
    amount: Number(row.amount) || 0,
    method: row.method,
    reference: row.reference ?? '',
    bankName: row.bank_name ?? '',
    photoUrl: row.photo_url,
    note: row.note ?? '',
    createdAt: row.created_at,
  };
}

function toWorkerPaymentRow(payment: WorkerPayment): DbWorkerPayment {
  return {
    id: payment.id,
    worker_id: payment.workerId,
    paid_on: payment.paidOn || null,
    amount: payment.amount,
    method: payment.method,
    reference: payment.reference,
    bank_name: payment.bankName,
    photo_url: payment.photoUrl,
    note: payment.note,
    created_at: payment.createdAt,
  };
}

export async function fetchWorkers(): Promise<Worker[]> {
  const rows = await fetchAllRows<DbWorker>((withCount) =>
    assertSupabase()
      .from('workers')
      .select('*', withCount ? { count: 'exact' } : undefined)
      .order('name')
      .order('id')
  );
  return rows.map(mapWorker);
}

export async function fetchGoodsIssues(): Promise<GoodsIssue[]> {
  const rows = await fetchAllRows<DbGoodsIssue>((withCount) =>
    assertSupabase()
      .from('worker_goods_issues')
      .select('*', withCount ? { count: 'exact' } : undefined)
      .order('created_at', { ascending: false })
      .order('id')
  );
  return rows.map(mapGoodsIssue);
}

export async function fetchGoodsReturns(): Promise<GoodsReturn[]> {
  const rows = await fetchAllRows<DbGoodsReturn>((withCount) =>
    assertSupabase()
      .from('worker_goods_returns')
      .select('*', withCount ? { count: 'exact' } : undefined)
      .order('created_at', { ascending: false })
      .order('id')
  );
  return rows.map(mapGoodsReturn);
}

export async function fetchWorkerPayments(): Promise<WorkerPayment[]> {
  const rows = await fetchAllRows<DbWorkerPayment>((withCount) =>
    assertSupabase()
      .from('worker_payments')
      .select('*', withCount ? { count: 'exact' } : undefined)
      .order('created_at', { ascending: false })
      .order('id')
  );
  return rows.map(mapWorkerPayment);
}

export async function insertWorker(worker: Worker): Promise<void> {
  await runDb(
    (signal) => assertSupabase().from('workers').insert(toWorkerRow(worker)).abortSignal(signal),
    { duplicateMeansSaved: true }
  );
}

export async function updateWorkerInDb(worker: Worker): Promise<void> {
  await runDb((signal) =>
    assertSupabase().from('workers').update(toWorkerRow(worker)).eq('id', worker.id).abortSignal(signal)
  );
}

export async function deleteWorkerFromDb(workerId: string): Promise<void> {
  await runDb((signal) =>
    assertSupabase().from('workers').delete().eq('id', workerId).abortSignal(signal)
  );
}

export async function insertGoodsIssue(issue: GoodsIssue): Promise<void> {
  await runDb(
    (signal) =>
      assertSupabase().from('worker_goods_issues').insert(toGoodsIssueRow(issue)).abortSignal(signal),
    { duplicateMeansSaved: true }
  );
}

export async function deleteGoodsIssueFromDb(issueId: string): Promise<void> {
  await runDb((signal) =>
    assertSupabase().from('worker_goods_issues').delete().eq('id', issueId).abortSignal(signal)
  );
}

export async function insertGoodsReturn(entry: GoodsReturn): Promise<void> {
  await runDb(
    (signal) =>
      assertSupabase().from('worker_goods_returns').insert(toGoodsReturnRow(entry)).abortSignal(signal),
    { duplicateMeansSaved: true }
  );
}

export async function deleteGoodsReturnFromDb(returnId: string): Promise<void> {
  await runDb((signal) =>
    assertSupabase().from('worker_goods_returns').delete().eq('id', returnId).abortSignal(signal)
  );
}

export async function insertWorkerPayment(payment: WorkerPayment): Promise<void> {
  await runDb(
    (signal) =>
      assertSupabase().from('worker_payments').insert(toWorkerPaymentRow(payment)).abortSignal(signal),
    { duplicateMeansSaved: true }
  );
}

export async function deleteWorkerPaymentFromDb(paymentId: string): Promise<void> {
  await runDb((signal) =>
    assertSupabase().from('worker_payments').delete().eq('id', paymentId).abortSignal(signal)
  );
}

/**
 * Uploads a bill photo / payment screenshot to the `bill-photos` bucket.
 * Returns the public URL, or null if the upload failed (the record can still
 * be saved without a photo).
 */
export async function uploadBillPhoto(
  file: File,
  folder: 'bills' | 'payments' | 'transport' | 'transport-payments' | 'worker-payments'
): Promise<string | null> {
  try {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${folder}/${Date.now()}-${Math.floor(Math.random() * 100000)}.${ext}`;

    // Storage uploads cannot be aborted, but they must still be given up on:
    // a stalled upload used to hold the whole save hostage.
    const { error } = await Promise.race([
      assertSupabase()
        .storage.from('bill-photos')
        .upload(path, file, { contentType: file.type || 'image/jpeg' }),
      wait(UPLOAD_TIMEOUT_MS).then(() => ({
        error: { message: 'The photo took too long to upload.' },
      })),
    ]);

    if (error) {
      console.warn('Could not upload photo:', error.message);
      return null;
    }

    const { data } = assertSupabase().storage.from('bill-photos').getPublicUrl(path);
    return data.publicUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether an app user with this name exists (names only, no passwords), so the
 * sign-in screen can say which part is wrong. Null when it cannot be checked.
 */
export async function usernameExists(username: string): Promise<boolean | null> {
  const { data, error } = await assertSupabase()
    .from('app_user_list')
    .select('username')
    .ilike('username', username.trim());
  if (error) return null;
  return (data ?? []).length > 0;
}
