/**
 * Supabase access for the shop sales module. Only `shop_*` tables are used
 * here — never the godown stock tables.
 */
import { assertSupabase, fetchAllRows, runDb } from '../lib/database';
import { dbToMilli, dbToPaise, milliToDecimal, paiseToDecimal } from './money';
import type { BillType } from './fy';
import { newId } from './ids';
import type {
  Language,
  PaidMode,
  PartyType,
  PaymentMode,
  ShopCategory,
  ShopInvoice,
  ShopInvoiceLine,
  ShopItem,
  ShopParty,
  ShopSettings,
  UpiAccount,
} from './types';

type Num = number | string;

interface DbUpiAccount {
  id?: string;
  label?: string;
  upi_id: string;
  payee_name?: string;
  merchant_code?: string;
}

interface DbShopSettings {
  shop_name: string;
  address: string;
  phone: string;
  gstin: string;
  state_code: string;
  upi_id: string;
  printer_width_mm: number;
  rates_include_gst: boolean;
  receipt_footer: string;
  language: Language;
  /** Missing until supabase/shop/13-upi-accounts.sql is run. */
  upi_accounts?: DbUpiAccount[];
}

interface DbShopCategory {
  id: string;
  name: string;
  name_hi: string;
  sort_order: number;
  is_active: boolean;
}

interface DbShopItem {
  id: string;
  category_id: string | null;
  name: string;
  name_hi: string;
  unit: string;
  sale_rate: Num;
  purchase_rate: Num;
  gst_rate: Num;
  hsn: string;
  is_active: boolean;
}

interface DbShopParty {
  id: string;
  name: string;
  phone: string;
  address: string;
  gstin: string;
  state_code: string;
  party_type: PartyType;
  opening_balance: Num;
  is_active: boolean;
}

interface DbShopInvoiceLine {
  item_id: string | null;
  item_name: string;
  hsn: string;
  unit: string;
  qty: Num;
  rate: Num;
  gst_rate: Num;
  discount_amount: Num;
  taxable_amount: Num;
  tax_amount: Num;
  line_total: Num;
  line_no: number;
}

interface DbShopInvoice {
  id: string;
  client_id: string;
  bill_type: BillType;
  series: string;
  bill_number: string | null;
  fy: string;
  bill_date: string;
  party_id: string | null;
  party_name: string;
  party_gstin: string;
  is_gst: boolean;
  is_interstate: boolean;
  rates_include_gst: boolean;
  payment_mode: PaymentMode;
  paid_mode: PaidMode | null;
  subtotal: Num;
  discount: Num;
  discount_percent: Num | null;
  cgst: Num;
  sgst: Num;
  igst: Num;
  round_off: Num;
  total: Num;
  paid_amount: Num;
  status: 'active' | 'cancelled';
  notes: string;
  created_by: string | null;
  created_at: string;
  /** Missing until supabase/shop/12-edit-sale-bills.sql is run. */
  version?: number;
  edited_at?: string | null;
  edited_by?: string | null;
  shop_invoice_items?: DbShopInvoiceLine[];
}

// --- Settings ---

function mapUpiAccounts(row: DbShopSettings): UpiAccount[] | null {
  if (!Array.isArray(row.upi_accounts)) return null;
  const accounts = row.upi_accounts
    .filter((a) => a && typeof a.upi_id === 'string' && a.upi_id.trim())
    .map((a, i) => ({
      id: a.id || `upi-${i}`,
      label: a.label?.trim() || a.upi_id.trim(),
      upiId: a.upi_id.trim(),
      payeeName: a.payee_name?.trim() ?? '',
      merchantCode: a.merchant_code?.trim() ?? '',
    }));
  // A UPI ID typed in before the list existed stays on it.
  const current = row.upi_id.trim();
  if (current && !accounts.some((a) => a.upiId.toLowerCase() === current.toLowerCase())) {
    accounts.unshift({ id: 'current', label: current, upiId: current, payeeName: '', merchantCode: '' });
  }
  return accounts;
}

function mapSettings(row: DbShopSettings): ShopSettings {
  return {
    shopName: row.shop_name,
    address: row.address,
    phone: row.phone,
    gstin: row.gstin,
    stateCode: row.state_code,
    upiId: row.upi_id,
    upiAccounts: mapUpiAccounts(row),
    printerWidthMm: row.printer_width_mm === 80 ? 80 : 58,
    ratesIncludeGst: row.rates_include_gst,
    receiptFooter: row.receipt_footer,
    language: row.language === 'en' ? 'en' : 'hi',
  };
}

export async function fetchShopSettings(): Promise<ShopSettings> {
  const data = await runDb<DbShopSettings | null>((signal) =>
    assertSupabase().from('shop_settings').select('*').eq('id', 1).abortSignal(signal).maybeSingle()
  );
  if (!data) {
    throw new Error('Shop details are missing. Run supabase/shop/05-shop-seed.sql in Supabase.');
  }
  return mapSettings(data);
}

export async function updateShopSettings(settings: ShopSettings, userId: string | null): Promise<void> {
  await runDb((signal) =>
    assertSupabase()
      .from('shop_settings')
      .update({
        shop_name: settings.shopName.trim(),
        address: settings.address.trim(),
        phone: settings.phone.trim(),
        gstin: settings.gstin.trim().toUpperCase(),
        state_code: settings.stateCode,
        upi_id: settings.upiId.trim(),
        printer_width_mm: settings.printerWidthMm,
        rates_include_gst: settings.ratesIncludeGst,
        receipt_footer: settings.receiptFooter,
        language: settings.language,
        // Only once the database has the list (13-upi-accounts.sql).
        ...(settings.upiAccounts
          ? {
              upi_accounts: settings.upiAccounts.map((a) => ({
                id: a.id,
                label: a.label.trim(),
                upi_id: a.upiId.trim(),
                payee_name: a.payeeName.trim(),
                merchant_code: a.merchantCode.trim(),
              })),
            }
          : {}),
        updated_by: userId,
      })
      .eq('id', 1)
      .abortSignal(signal)
  );
}

// --- Categories ---

function mapCategory(row: DbShopCategory): ShopCategory {
  return {
    id: row.id,
    name: row.name,
    nameHi: row.name_hi,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

export async function fetchShopCategories(): Promise<ShopCategory[]> {
  const rows = await fetchAllRows<DbShopCategory>((withCount) =>
    assertSupabase()
      .from('shop_categories')
      .select('*', withCount ? { count: 'exact' } : undefined)
      .order('sort_order')
      .order('name')
      .order('id')
  );
  return rows.map(mapCategory);
}

export async function insertShopCategory(category: ShopCategory): Promise<void> {
  await runDb(
    (signal) =>
      assertSupabase()
        .from('shop_categories')
        .insert({
          id: category.id,
          name: category.name.trim(),
          name_hi: category.nameHi.trim(),
          sort_order: category.sortOrder,
          is_active: category.isActive,
        })
        .abortSignal(signal),
    { duplicateMeansSaved: true }
  );
}

export async function updateShopCategory(category: ShopCategory): Promise<void> {
  await runDb((signal) =>
    assertSupabase()
      .from('shop_categories')
      .update({
        name: category.name.trim(),
        name_hi: category.nameHi.trim(),
        sort_order: category.sortOrder,
        is_active: category.isActive,
      })
      .eq('id', category.id)
      .abortSignal(signal)
  );
}

/** Saves the new order after a category is moved up or down. */
export async function saveCategoryOrder(categories: ShopCategory[]): Promise<void> {
  await Promise.all(
    categories.map((category, index) =>
      runDb((signal) =>
        assertSupabase()
          .from('shop_categories')
          .update({ sort_order: index })
          .eq('id', category.id)
          .abortSignal(signal)
      )
    )
  );
}

// --- Items ---

function mapItem(row: DbShopItem): ShopItem {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    nameHi: row.name_hi,
    unit: row.unit,
    saleRate: dbToPaise(row.sale_rate),
    purchaseRate: dbToPaise(row.purchase_rate),
    gstRate: Number(row.gst_rate),
    hsn: row.hsn,
    isActive: row.is_active,
  };
}

function toItemRow(item: ShopItem, userId: string | null) {
  return {
    category_id: item.categoryId,
    name: item.name.trim(),
    name_hi: item.nameHi.trim(),
    unit: item.unit.trim() || 'pcs',
    sale_rate: paiseToDecimal(item.saleRate),
    purchase_rate: paiseToDecimal(item.purchaseRate),
    gst_rate: item.gstRate,
    hsn: item.hsn.trim(),
    is_active: item.isActive,
    updated_by: userId,
  };
}

export async function fetchShopItems(): Promise<ShopItem[]> {
  const rows = await fetchAllRows<DbShopItem>((withCount) =>
    assertSupabase()
      .from('shop_items')
      .select('*', withCount ? { count: 'exact' } : undefined)
      .order('name')
      .order('id')
  );
  return rows.map(mapItem);
}

export async function insertShopItem(item: ShopItem, userId: string | null): Promise<void> {
  await runDb(
    (signal) =>
      assertSupabase()
        .from('shop_items')
        .insert({ id: item.id, ...toItemRow(item, userId) })
        .abortSignal(signal),
    { duplicateMeansSaved: true }
  );
}

export async function updateShopItem(item: ShopItem, userId: string | null): Promise<void> {
  await runDb((signal) =>
    assertSupabase().from('shop_items').update(toItemRow(item, userId)).eq('id', item.id).abortSignal(signal)
  );
}

/** item id -> times sold in the last 90 days. */
export async function fetchItemSaleCounts(): Promise<Record<string, number>> {
  const data = await runDb<{ item_id: string; times_sold: number }[]>((signal) =>
    assertSupabase().rpc('shop_item_sale_counts').abortSignal(signal),
    { readOnly: true }
  );
  return Object.fromEntries((data ?? []).map((row) => [row.item_id, row.times_sold]));
}

// --- Parties ---

function mapParty(row: DbShopParty): ShopParty {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    address: row.address,
    gstin: row.gstin,
    stateCode: row.state_code,
    partyType: row.party_type,
    openingBalance: dbToPaise(row.opening_balance),
    isActive: row.is_active,
  };
}

function toPartyRow(party: ShopParty) {
  return {
    name: party.name.trim(),
    phone: party.phone.trim(),
    address: party.address.trim(),
    gstin: party.gstin.trim().toUpperCase(),
    state_code: party.stateCode,
    party_type: party.partyType,
    opening_balance: paiseToDecimal(party.openingBalance),
    is_active: party.isActive,
  };
}

export async function fetchShopParties(): Promise<ShopParty[]> {
  const rows = await fetchAllRows<DbShopParty>((withCount) =>
    assertSupabase()
      .from('shop_parties')
      .select('*', withCount ? { count: 'exact' } : undefined)
      .order('name')
      .order('id')
  );
  return rows.map(mapParty);
}

export async function insertShopParty(party: ShopParty): Promise<void> {
  await runDb(
    (signal) =>
      assertSupabase()
        .from('shop_parties')
        .insert({ id: party.id, ...toPartyRow(party) })
        .abortSignal(signal),
    { duplicateMeansSaved: true }
  );
}

export async function updateShopParty(party: ShopParty): Promise<void> {
  await runDb((signal) =>
    assertSupabase().from('shop_parties').update(toPartyRow(party)).eq('id', party.id).abortSignal(signal)
  );
}

// --- Bills ---

/** Last bill number the server knows for a series (0 when none yet). */
export async function fetchLastBillNumber(billType: BillType, fy: string, series: string): Promise<number> {
  const data = await runDb<{ last_number: number } | null>((signal) =>
    assertSupabase()
      .from('shop_counters')
      .select('last_number')
      .eq('bill_type', billType)
      .eq('fy', fy)
      .eq('series', series)
      .abortSignal(signal)
      .maybeSingle()
  );
  return data?.last_number ?? 0;
}

/** The bill as shop_save_sale() expects it: decimals as strings, never floats. */
export type SaleRpcPayload = Record<string, unknown> & { client_id: string };

export function toSaleRpcPayload(invoice: ShopInvoice, updateRateItemIds: Set<string>): SaleRpcPayload {
  return {
    client_id: invoice.clientId,
    series: invoice.series,
    fy: invoice.fy,
    bill_date: invoice.billDate,
    bill_number: invoice.billNumber,
    party_id: invoice.partyId,
    party_name: invoice.partyName,
    party_gstin: invoice.partyGstin,
    is_gst: invoice.isGst,
    is_interstate: invoice.isInterstate,
    rates_include_gst: invoice.ratesIncludeGst,
    payment_mode: invoice.paymentMode,
    paid_mode: invoice.paidMode,
    subtotal: paiseToDecimal(invoice.subtotal),
    discount: paiseToDecimal(invoice.discount),
    discount_percent:
      invoice.discountPercent === null ? null : paiseToDecimal(invoice.discountPercent),
    cgst: paiseToDecimal(invoice.cgst),
    sgst: paiseToDecimal(invoice.sgst),
    igst: paiseToDecimal(invoice.igst),
    round_off: paiseToDecimal(invoice.roundOff),
    total: paiseToDecimal(invoice.total),
    paid_amount: paiseToDecimal(invoice.paidAmount),
    notes: invoice.notes,
    created_by: invoice.createdBy,
    lines: invoice.lines.map((line) => ({
      item_id: line.itemId,
      item_name: line.itemName,
      hsn: line.hsn,
      unit: line.unit,
      qty: milliToDecimal(line.qty),
      rate: paiseToDecimal(line.rate),
      gst_rate: line.gstRate,
      discount_amount: paiseToDecimal(line.discountAmount),
      taxable_amount: paiseToDecimal(line.taxableAmount),
      tax_amount: paiseToDecimal(line.taxAmount),
      line_total: paiseToDecimal(line.lineTotal),
      update_saved_rate: Boolean(line.itemId && updateRateItemIds.has(line.itemId)),
    })),
  };
}

export interface SaveSaleResult {
  id: string;
  bill_number: string;
  already_saved: boolean;
}

export async function saveSaleRpc(payload: SaleRpcPayload): Promise<SaveSaleResult> {
  const data = await runDb<SaveSaleResult>((signal) =>
    assertSupabase().rpc('shop_save_sale', { p: payload }).abortSignal(signal)
  );
  if (!data) throw new Error('The server did not confirm the bill.');
  return data;
}

function mapLine(row: DbShopInvoiceLine): ShopInvoiceLine {
  return {
    itemId: row.item_id,
    itemName: row.item_name,
    hsn: row.hsn,
    unit: row.unit,
    qty: dbToMilli(row.qty),
    rate: dbToPaise(row.rate),
    gstRate: Number(row.gst_rate),
    discountAmount: dbToPaise(row.discount_amount),
    taxableAmount: dbToPaise(row.taxable_amount),
    taxAmount: dbToPaise(row.tax_amount),
    lineTotal: dbToPaise(row.line_total),
  };
}

function mapInvoice(row: DbShopInvoice): ShopInvoice {
  const subtotal = dbToPaise(row.subtotal);
  const discount = dbToPaise(row.discount);
  const cgst = dbToPaise(row.cgst);
  const sgst = dbToPaise(row.sgst);
  const igst = dbToPaise(row.igst);
  // Items total (qty × rate before discount) is not stored; it follows from the rest.
  const taxAddedOnTop = row.is_gst && !row.rates_include_gst;
  const itemsTotal = subtotal + discount + (taxAddedOnTop ? 0 : cgst + sgst + igst);

  return {
    id: row.id,
    clientId: row.client_id,
    billType: row.bill_type,
    series: row.series,
    billNumber: row.bill_number,
    fy: row.fy,
    billDate: row.bill_date,
    partyId: row.party_id,
    partyName: row.party_name,
    partyGstin: row.party_gstin,
    isGst: row.is_gst,
    isInterstate: row.is_interstate,
    ratesIncludeGst: row.rates_include_gst,
    paymentMode: row.payment_mode,
    paidMode: row.paid_mode,
    itemsTotal,
    subtotal,
    discount,
    discountPercent: row.discount_percent === null ? null : dbToPaise(row.discount_percent),
    cgst,
    sgst,
    igst,
    roundOff: dbToPaise(row.round_off),
    total: dbToPaise(row.total),
    paidAmount: dbToPaise(row.paid_amount),
    status: row.status,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    version: row.version ?? 1,
    editedAt: row.edited_at ?? null,
    editedBy: row.edited_by ?? null,
    lines: (row.shop_invoice_items ?? [])
      .slice()
      .sort((a, b) => a.line_no - b.line_no)
      .map(mapLine),
    syncState: 'synced',
  };
}

export interface SalesFilter {
  from: string;
  to: string;
  partyId?: string | null;
}

/** Sale bills in a date range, newest first, without their lines. */
export async function fetchSales(filter: SalesFilter): Promise<ShopInvoice[]> {
  const rows = await fetchAllRows<DbShopInvoice>((withCount) => {
    let query = assertSupabase()
      .from('shop_invoices')
      .select('*', withCount ? { count: 'exact' } : undefined)
      .eq('bill_type', 'sale')
      .gte('bill_date', filter.from)
      .lte('bill_date', filter.to);
    if (filter.partyId) query = query.eq('party_id', filter.partyId);
    return query
      .order('bill_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id');
  });
  return rows.map(mapInvoice);
}

/**
 * Sale bills with money still to come (udhaar or part paid), from any date,
 * oldest first: the ones waiting longest are at the top.
 */
export async function fetchDueSales(partyId: string | null): Promise<ShopInvoice[]> {
  const rows = await fetchAllRows<DbShopInvoice>((withCount) => {
    let query = assertSupabase()
      .from('shop_invoices')
      .select('*', withCount ? { count: 'exact' } : undefined)
      .eq('bill_type', 'sale')
      .eq('status', 'active')
      .in('payment_mode', ['credit', 'partial']);
    if (partyId) query = query.eq('party_id', partyId);
    return query.order('bill_date', { ascending: true }).order('created_at', { ascending: true }).order('id');
  });
  return rows.map(mapInvoice).filter((b) => b.total > b.paidAmount);
}

/** Money received later against one bill. */
export interface BillPayment {
  id: string;
  amount: number;
  mode: string;
  paymentDate: string;
  createdAt: string;
  createdBy: string | null;
}

/** Payments received later against a bill, oldest first. */
export async function fetchBillPayments(invoiceId: string): Promise<BillPayment[]> {
  const data = await runDb<
    { id: string; amount: Num; mode: string; payment_date: string; created_at: string; created_by: string | null }[]
  >((signal) =>
    assertSupabase()
      .from('shop_payments')
      .select('id, amount, mode, payment_date, created_at, created_by')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: true })
      .abortSignal(signal)
  );
  return (data ?? []).map((row) => ({
    id: row.id,
    amount: dbToPaise(row.amount),
    mode: row.mode,
    paymentDate: row.payment_date,
    createdAt: row.created_at,
    createdBy: row.created_by,
  }));
}

/**
 * Records money received against an udhaar bill (shop_receive_payment, from
 * supabase/shop/09-receive-payment.sql). Returns the bill's new paid amount.
 * The same `clientId` sent twice is saved once.
 */
export async function receivePaymentRpc(input: {
  clientId: string;
  invoiceId: string;
  amount: number;
  mode: PaidMode;
}): Promise<number> {
  const data = await runDb<{ paid_amount: Num }>((signal) =>
    assertSupabase()
      .rpc('shop_receive_payment', {
        p: { client_id: input.clientId, invoice_id: input.invoiceId, amount: paiseToDecimal(input.amount), mode: input.mode },
      })
      .abortSignal(signal)
  );
  if (!data) throw new Error('The server did not confirm the payment.');
  return dbToPaise(data.paid_amount);
}

export interface EditSaleResult {
  id: string;
  version: number;
  already_saved: boolean;
}

/**
 * Saves the owner's change to a bill as its next version (shop_edit_sale,
 * from supabase/shop/12-edit-sale-bills.sql). The bill keeps its number; the
 * version being replaced is kept on the server. `editId` is new for each
 * change, so a change sent twice is saved once.
 */
export async function editSaleRpc(
  payload: SaleRpcPayload,
  edit: { invoiceId: string; expectedVersion: number; editId: string }
): Promise<EditSaleResult> {
  const data = await runDb<EditSaleResult>((signal) =>
    assertSupabase()
      .rpc('shop_edit_sale', {
        p: { ...payload, invoice_id: edit.invoiceId, expected_version: edit.expectedVersion, edit_id: edit.editId },
      })
      .abortSignal(signal)
  );
  if (!data) throw new Error('The server did not confirm the change.');
  return data;
}

export interface BillVersion {
  version: number;
  /** The bill as it was in this version, with its lines. */
  bill: ShopInvoice;
  /** When this version was replaced by the next one, and by whom. */
  changedAt: string;
  changedBy: string | null;
}

/** The earlier versions of an edited bill, oldest first. */
export async function fetchBillVersions(invoiceId: string): Promise<BillVersion[]> {
  const data = await runDb<{ version: number; data: DbShopInvoice; changed_at: string; changed_by: string | null }[]>(
    (signal) =>
      assertSupabase()
        .from('shop_invoice_versions')
        .select('version, data, changed_at, changed_by')
        .eq('invoice_id', invoiceId)
        .order('version', { ascending: true })
        .abortSignal(signal)
  );
  return (data ?? []).map((row) => ({
    version: row.version,
    bill: mapInvoice(row.data),
    changedAt: row.changed_at,
    changedBy: row.changed_by,
  }));
}

/** One bill with all its lines. */
export async function fetchSaleByClientId(clientId: string): Promise<ShopInvoice | null> {
  const data = await runDb<DbShopInvoice | null>((signal) =>
    assertSupabase()
      .from('shop_invoices')
      .select('*, shop_invoice_items(*)')
      .eq('client_id', clientId)
      .abortSignal(signal)
      .maybeSingle()
  );
  return data ? mapInvoice(data) : null;
}

/** app user id -> username, to show who made a bill. Reads only id and name. */
export async function fetchUserNames(): Promise<Record<string, string>> {
  const data = await runDb<{ id: string; username: string }[]>((signal) =>
    assertSupabase().from('app_user_list').select('id, username').abortSignal(signal)
  );
  return Object.fromEntries((data ?? []).map((row) => [row.id, row.username]));
}

// --- Deleting master data ---

/** Old bills keep the item's name: their lines only lose the link. */
export async function deleteShopItem(itemId: string): Promise<void> {
  await runDb((signal) => assertSupabase().from('shop_items').delete().eq('id', itemId).abortSignal(signal));
}

/** The category's items move to "No category". */
export async function deleteShopCategory(categoryId: string): Promise<void> {
  await runDb((signal) =>
    assertSupabase().from('shop_categories').delete().eq('id', categoryId).abortSignal(signal)
  );
}

/**
 * Deletes a customer who has no bills or payments. One who has them is hidden
 * instead, so their old bills and balance stay correct.
 */
export async function deleteShopParty(partyId: string): Promise<'deleted' | 'hidden'> {
  try {
    await runDb((signal) => assertSupabase().from('shop_parties').delete().eq('id', partyId).abortSignal(signal));
    return 'deleted';
  } catch (err) {
    if ((err as { code?: string })?.code !== '23503') throw err;
    await runDb((signal) =>
      assertSupabase().from('shop_parties').update({ is_active: false }).eq('id', partyId).abortSignal(signal)
    );
    return 'hidden';
  }
}

/** The newest sale bills (staff see only these), newest first, without lines. */
export async function fetchRecentSales(limit: number): Promise<ShopInvoice[]> {
  const data = await runDb<DbShopInvoice[]>((signal) =>
    assertSupabase()
      .from('shop_invoices')
      .select('*')
      .eq('bill_type', 'sale')
      .order('created_at', { ascending: false })
      .limit(limit)
      .abortSignal(signal)
  );
  return (data ?? []).map(mapInvoice);
}

const SHARED_BILL_UPLOAD_MS = 25_000;

/**
 * Puts a bill picture online for the WhatsApp message and returns its link.
 * Each bill gets its own random folder, so one link cannot be guessed from
 * another; the file keeps its bill-number name for whoever downloads it.
 */
export async function uploadSharedBill(file: File): Promise<string> {
  const path = `shop-bills/${newId()}/${file.name}`;
  const storage = assertSupabase().storage.from('bill-photos');
  // A storage upload cannot be aborted, but the person must not wait forever.
  const { error } = await Promise.race([
    storage.upload(path, file, { contentType: file.type || 'image/png', cacheControl: '31536000' }),
    new Promise<{ error: { message: string } }>((resolve) =>
      setTimeout(() => resolve({ error: { message: 'The bill took too long to upload.' } }), SHARED_BILL_UPLOAD_MS)
    ),
  ]);
  if (error) throw new Error(error.message);
  return storage.getPublicUrl(path).data.publicUrl;
}
