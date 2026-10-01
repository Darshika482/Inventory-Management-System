/**
 * Supabase access for the shop sales module. Only `shop_*` tables are used
 * here — never the godown stock tables.
 */
import { assertSupabase, runDb } from '../lib/database';
import { dbToMilli, dbToPaise, milliToDecimal, paiseToDecimal } from './money';
import type { BillType } from './fy';
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
} from './types';

type Num = number | string;

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
  shop_invoice_items?: DbShopInvoiceLine[];
}

// --- Settings ---

function mapSettings(row: DbShopSettings): ShopSettings {
  return {
    shopName: row.shop_name,
    address: row.address,
    phone: row.phone,
    gstin: row.gstin,
    stateCode: row.state_code,
    upiId: row.upi_id,
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
  const data = await runDb<DbShopCategory[]>((signal) =>
    assertSupabase()
      .from('shop_categories')
      .select('*')
      .order('sort_order')
      .order('name')
      .abortSignal(signal)
  );
  return (data ?? []).map(mapCategory);
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
  const data = await runDb<DbShopItem[]>((signal) =>
    assertSupabase().from('shop_items').select('*').order('name').abortSignal(signal)
  );
  return (data ?? []).map(mapItem);
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
    assertSupabase().rpc('shop_item_sale_counts').abortSignal(signal)
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
  const data = await runDb<DbShopParty[]>((signal) =>
    assertSupabase().from('shop_parties').select('*').order('name').abortSignal(signal)
  );
  return (data ?? []).map(mapParty);
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
  const data = await runDb<DbShopInvoice[]>((signal) => {
    let query = assertSupabase()
      .from('shop_invoices')
      .select('*')
      .eq('bill_type', 'sale')
      .gte('bill_date', filter.from)
      .lte('bill_date', filter.to);
    if (filter.partyId) query = query.eq('party_id', filter.partyId);
    return query
      .order('bill_date', { ascending: false })
      .order('created_at', { ascending: false })
      .abortSignal(signal);
  });
  return (data ?? []).map(mapInvoice);
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
