/**
 * Turns everything read for a backup into what goes to Telegram:
 *  - a short summary message, then the whole udhaar list as plain text (it can
 *    be read and searched in Telegram without opening any file);
 *  - one Excel file per part of the business, each list on its own sheet;
 *  - the full backup (.json), the file Restore puts records back from.
 *
 * Pure functions, kept apart from the screen and from Telegram so they can be tested.
 */
import type { TranslationKey } from '../sales/i18n';
import { dbToPaise, formatRupees, type Paise } from '../sales/money';
import { buildDueReminders, type DueReminder } from '../sales/reminders';
import { mapInvoice, mapParty } from '../sales/db';
import type { ShopInvoice } from '../sales/types';
import type { CollectedData, Row } from './collect';
import type { BackupPartId } from './parts';
import { buildXlsx, type Sheet } from './xlsx';

export { BACKUP_PARTS, type BackupPartId } from './parts';

export const BACKUP_FORMAT = 'akshay-traders-backup';
export const BACKUP_VERSION = 1;

export type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

export interface BackupFile {
  part: BackupPartId;
  fileName: string;
  mime: string;
  bytes: Uint8Array;
}

export interface BackupInput {
  data: CollectedData;
  /** Bills made on this phone and not uploaded yet: they count in the udhaar list. */
  queuedSales: ShopInvoice[];
  parts: BackupPartId[];
  shopName: string;
  now: Date;
  t: Translate;
}

export interface BuiltBackup {
  files: BackupFile[];
  /** Telegram messages (HTML), sent before the files. */
  messages: string[];
  udhaarTotal: Paise;
  udhaarCustomers: number;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// --- Small readers for raw database rows ---

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
/** Rupees as a plain number for Excel (numeric columns come back as numbers or strings). */
const rupees = (v: unknown): number => dbToPaise(v as number | string | null | undefined) / 100;
const paise = (v: unknown): Paise => dbToPaise(v as number | string | null | undefined);
const sumBy = <T>(list: T[], value: (item: T) => number) => list.reduce((s, item) => s + value(item), 0);

function groupBy(rows: Row[], key: string): Map<string, Row[]> {
  const map = new Map<string, Row[]>();
  for (const row of rows) {
    const k = str(row[key]);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

/** Goods lines saved as [{ item, quantity, unit }], or the old single-item columns. */
function goodsText(row: Row): string {
  const items = Array.isArray(row.items) ? (row.items as Row[]) : [];
  const list = items.length ? items : row.item ? [{ item: row.item, quantity: row.quantity, unit: row.unit }] : [];
  return list
    .map((g) => [str(g.item), str(g.quantity), str(g.unit)].filter(Boolean).join(' '))
    .join(', ');
}

const IST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
const IST_WHEN = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** "2026-11-09" for today in India. */
export const istDate = (now: Date) => IST_DATE.format(now);
/** "9 Nov 2026, 3:45 pm" in India time. */
export const istWhen = (now: Date) => IST_WHEN.format(now);
/** "09-11-2026", for file names. */
const fileDate = (now: Date) => istDate(now).split('-').reverse().join('-');

const daysBetween = (from: string, to: string) =>
  Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- Udhaar ---

export interface UdhaarResult {
  list: DueReminder[];
  total: Paise;
}

/** Who owes what, worked out exactly as the app's Udhaar page does. */
export function computeUdhaar(data: CollectedData, queuedSales: ShopInvoice[]): UdhaarResult {
  const parties = (data.tables.shop_parties ?? []).map((r) => mapParty(r as never));
  const bills = (data.tables.shop_invoices ?? []).map((r) => mapInvoice(r as never));
  const onServer = new Set(bills.map((b) => b.clientId));
  const dueBills = [...bills, ...queuedSales.filter((b) => !onServer.has(b.clientId))].filter(
    (b) => b.billType === 'sale' && b.status === 'active' && (b.paymentMode === 'credit' || b.paymentMode === 'partial')
  );
  const paidOnAccount = new Map<string, Paise>();
  for (const p of data.tables.shop_payments ?? []) {
    if (p.invoice_id || p.direction !== 'in') continue;
    const id = str(p.party_id);
    paidOnAccount.set(id, (paidOnAccount.get(id) ?? 0) + paise(p.amount));
  }
  const list = buildDueReminders({ parties, dueBills, paidOnAccount });
  return { list, total: sumBy(list, (r) => r.total) };
}

/** The customer's phone as saved (any format), else the WhatsApp number found for them. */
function phoneOf(data: CollectedData, r: DueReminder): string {
  const party = r.partyId ? (data.tables.shop_parties ?? []).find((p) => str(p.id) === r.partyId) : undefined;
  return str(party?.phone).trim() || r.phone || '';
}

function udhaarSheets(data: CollectedData, udhaar: UdhaarResult, queuedSales: ShopInvoice[], today: string): Sheet[] {
  const bills = new Map<string, ShopInvoice>();
  for (const row of data.tables.shop_invoices ?? []) {
    const bill = mapInvoice(row as never);
    bills.set(bill.clientId, bill);
  }
  for (const bill of queuedSales) if (!bills.has(bill.clientId)) bills.set(bill.clientId, bill);

  const list: Sheet = {
    name: 'Udhaar list',
    columns: [
      { header: '#', kind: 'number', width: 5 },
      { header: 'Customer', width: 28 },
      { header: 'Phone', width: 13 },
      { header: 'Old balance', kind: 'money' },
      { header: 'Bills left to pay', kind: 'number', width: 9 },
      { header: 'Due on bills', kind: 'money' },
      { header: 'Paid without bill', kind: 'money' },
      { header: 'Total udhaar', kind: 'money', width: 14 },
      { header: 'Oldest bill', kind: 'date' },
      { header: 'Days', kind: 'number', width: 7 },
    ],
    rows: udhaar.list.map((r, i) => {
      const oldest = r.bills[0]?.billDate ?? '';
      return [
        i + 1,
        r.name,
        phoneOf(data, r),
        r.oldBalance / 100,
        r.bills.length,
        r.billsDue / 100,
        r.paidOnAccount / 100,
        r.total / 100,
        oldest,
        oldest ? daysBetween(oldest, today) : '',
      ];
    }),
    footer: [
      '',
      `Total (${udhaar.list.length})`,
      '',
      sumBy(udhaar.list, (r) => r.oldBalance) / 100,
      sumBy(udhaar.list, (r) => r.bills.length),
      sumBy(udhaar.list, (r) => r.billsDue) / 100,
      sumBy(udhaar.list, (r) => r.paidOnAccount) / 100,
      udhaar.total / 100,
      '',
      '',
    ],
  };

  const billRows = udhaar.list.flatMap((r) =>
    r.bills.map((b) => {
      const bill = bills.get(b.clientId);
      return [
        r.name,
        b.billNumber ?? 'Not uploaded yet',
        b.billDate,
        daysBetween(b.billDate, today),
        bill ? bill.total / 100 : '',
        bill ? bill.paidAmount / 100 : '',
        b.due / 100,
      ];
    })
  );
  const billSheet: Sheet = {
    name: 'Udhaar bills',
    columns: [
      { header: 'Customer', width: 28 },
      { header: 'Bill no', width: 18 },
      { header: 'Bill date', kind: 'date' },
      { header: 'Days', kind: 'number', width: 7 },
      { header: 'Bill total', kind: 'money' },
      { header: 'Paid', kind: 'money' },
      { header: 'Due', kind: 'money' },
    ],
    rows: billRows,
    footer: ['Total', '', '', '', '', '', sumBy(udhaar.list, (r) => r.billsDue) / 100],
  };

  const partyName = new Map((data.tables.shop_parties ?? []).map((p) => [str(p.id), str(p.name)]));
  const billNumber = new Map((data.tables.shop_invoices ?? []).map((b) => [str(b.id), str(b.bill_number)]));
  const received = (data.tables.shop_payments ?? [])
    .filter((p) => p.direction === 'in')
    .slice()
    .sort((a, b) => str(b.payment_date).localeCompare(str(a.payment_date)) || str(b.created_at).localeCompare(str(a.created_at)));
  const receivedSheet: Sheet = {
    name: 'Money received',
    columns: [
      { header: 'Date', kind: 'date' },
      { header: 'Customer', width: 28 },
      { header: 'Against', width: 20 },
      { header: 'Amount', kind: 'money' },
      { header: 'Mode', width: 8 },
      { header: 'Note', width: 24 },
      { header: 'Entered at', kind: 'datetime' },
    ],
    rows: received.map((p) => [
      str(p.payment_date),
      partyName.get(str(p.party_id)) ?? '',
      p.invoice_id ? billNumber.get(str(p.invoice_id)) || 'Bill' : 'Old balance',
      rupees(p.amount),
      str(p.mode),
      str(p.note),
      str(p.created_at),
    ]),
    footer: ['Total', '', '', sumBy(received, (p) => rupees(p.amount)), '', '', ''],
  };

  return [list, billSheet, receivedSheet];
}

// --- Sales bills ---

function salesSheets(data: CollectedData): Sheet[] {
  const userName = new Map((data.tables.app_user_list ?? []).map((u) => [str(u.id), str(u.username)]));
  const invoices = (data.tables.shop_invoices ?? [])
    .slice()
    .sort((a, b) => str(a.bill_date).localeCompare(str(b.bill_date)) || str(a.created_at).localeCompare(str(b.created_at)));
  const byId = new Map(invoices.map((b) => [str(b.id), b]));

  const due = (b: Row) =>
    b.status === 'active' && b.bill_type === 'sale' ? Math.max(0, rupees(b.total) - rupees(b.paid_amount)) : 0;

  const bills: Sheet = {
    name: 'Bills',
    columns: [
      { header: 'Bill no', width: 18 },
      { header: 'Date', kind: 'date' },
      { header: 'Type', width: 9 },
      { header: 'Customer', width: 26 },
      { header: 'Customer GSTIN', width: 17 },
      { header: 'GST bill' , width: 8 },
      { header: 'Payment', width: 9 },
      { header: 'Discount', kind: 'money' },
      { header: 'Taxable value', kind: 'money' },
      { header: 'CGST', kind: 'money' },
      { header: 'SGST', kind: 'money' },
      { header: 'IGST', kind: 'money' },
      { header: 'Round off', kind: 'money', width: 9 },
      { header: 'Total', kind: 'money' },
      { header: 'Paid', kind: 'money' },
      { header: 'Udhaar left', kind: 'money' },
      { header: 'Status', width: 10 },
      { header: 'Notes', width: 24 },
      { header: 'Made by', width: 12 },
      { header: 'Made at', kind: 'datetime' },
    ],
    rows: invoices.map((b) => [
      str(b.bill_number),
      str(b.bill_date),
      str(b.bill_type),
      str(b.party_name) || 'Walk-in',
      str(b.party_gstin),
      b.is_gst === true,
      str(b.payment_mode),
      rupees(b.discount),
      rupees(b.subtotal),
      rupees(b.cgst),
      rupees(b.sgst),
      rupees(b.igst),
      rupees(b.round_off),
      rupees(b.total),
      rupees(b.paid_amount),
      due(b),
      str(b.status),
      str(b.notes),
      userName.get(str(b.created_by)) ?? '',
      str(b.created_at),
    ]),
  };
  const active = invoices.filter((b) => b.status === 'active' && b.bill_type === 'sale');
  bills.footer = [
    `Total (${active.length} active sale bills)`,
    '', '', '', '', '', '',
    sumBy(active, (b) => rupees(b.discount)),
    sumBy(active, (b) => rupees(b.subtotal)),
    sumBy(active, (b) => rupees(b.cgst)),
    sumBy(active, (b) => rupees(b.sgst)),
    sumBy(active, (b) => rupees(b.igst)),
    sumBy(active, (b) => rupees(b.round_off)),
    sumBy(active, (b) => rupees(b.total)),
    sumBy(active, (b) => rupees(b.paid_amount)),
    sumBy(active, due),
    '', '', '', '',
  ];

  const lines = (data.tables.shop_invoice_items ?? [])
    .map((line) => ({ line, bill: byId.get(str(line.invoice_id)) }))
    .sort(
      (a, b) =>
        str(a.bill?.bill_date).localeCompare(str(b.bill?.bill_date)) ||
        str(a.bill?.created_at).localeCompare(str(b.bill?.created_at)) ||
        Number(a.line.line_no ?? 0) - Number(b.line.line_no ?? 0)
    );
  const items: Sheet = {
    name: 'Bill items',
    columns: [
      { header: 'Bill no', width: 18 },
      { header: 'Date', kind: 'date' },
      { header: 'Customer', width: 24 },
      { header: 'Item', width: 26 },
      { header: 'HSN', width: 9 },
      { header: 'Qty', kind: 'number', width: 8 },
      { header: 'Unit', width: 7 },
      { header: 'Rate', kind: 'money' },
      { header: 'GST %', kind: 'number', width: 7 },
      { header: 'Discount', kind: 'money' },
      { header: 'Taxable', kind: 'money' },
      { header: 'Tax', kind: 'money' },
      { header: 'Line total', kind: 'money' },
      { header: 'Bill status', width: 10 },
    ],
    rows: lines.map(({ line, bill }) => [
      str(bill?.bill_number),
      str(bill?.bill_date),
      str(bill?.party_name) || (bill ? 'Walk-in' : ''),
      str(line.item_name),
      str(line.hsn),
      Number(line.qty),
      str(line.unit),
      rupees(line.rate),
      Number(line.gst_rate),
      rupees(line.discount_amount),
      rupees(line.taxable_amount),
      rupees(line.tax_amount),
      rupees(line.line_total),
      str(bill?.status),
    ]),
  };
  return [bills, items];
}

// --- Customers and items ---

function partiesSheets(data: CollectedData, udhaar: UdhaarResult): Sheet[] {
  const owed = new Map(udhaar.list.filter((r) => r.partyId).map((r) => [r.partyId as string, r.total]));
  const categoryName = new Map((data.tables.shop_categories ?? []).map((c) => [str(c.id), str(c.name)]));
  const byName = (a: Row, b: Row) => str(a.name).localeCompare(str(b.name));

  const customers: Sheet = {
    name: 'Customers',
    columns: [
      { header: 'Name', width: 28 },
      { header: 'Phone', width: 13 },
      { header: 'Address', width: 28 },
      { header: 'GSTIN', width: 17 },
      { header: 'State code', width: 7 },
      { header: 'Type', width: 10 },
      { header: 'Old balance', kind: 'money' },
      { header: 'Udhaar now', kind: 'money' },
      { header: 'Active', width: 7 },
    ],
    rows: (data.tables.shop_parties ?? [])
      .slice()
      .sort(byName)
      .map((p) => [
        str(p.name),
        str(p.phone),
        str(p.address),
        str(p.gstin),
        str(p.state_code),
        str(p.party_type),
        rupees(p.opening_balance),
        (owed.get(str(p.id)) ?? 0) / 100,
        p.is_active !== false,
      ]),
  };

  const items: Sheet = {
    name: 'Items and rates',
    columns: [
      { header: 'Item', width: 28 },
      { header: 'Hindi name', width: 20 },
      { header: 'Category', width: 16 },
      { header: 'Unit', width: 7 },
      { header: 'Sale rate', kind: 'money' },
      { header: 'Purchase rate', kind: 'money' },
      { header: 'GST %', kind: 'number', width: 7 },
      { header: 'HSN', width: 9 },
      { header: 'Active', width: 7 },
    ],
    rows: (data.tables.shop_items ?? [])
      .slice()
      .sort(byName)
      .map((i) => [
        str(i.name),
        str(i.name_hi),
        categoryName.get(str(i.category_id)) ?? '',
        str(i.unit),
        rupees(i.sale_rate),
        rupees(i.purchase_rate),
        Number(i.gst_rate),
        str(i.hsn),
        i.is_active !== false,
      ]),
  };

  const categories: Sheet = {
    name: 'Categories',
    columns: [
      { header: 'Category', width: 24 },
      { header: 'Hindi name', width: 20 },
      { header: 'Order', kind: 'number', width: 7 },
      { header: 'Active', width: 7 },
    ],
    rows: (data.tables.shop_categories ?? [])
      .slice()
      .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
      .map((c) => [str(c.name), str(c.name_hi), Number(c.sort_order ?? 0), c.is_active !== false]),
  };
  return [customers, items, categories];
}

// --- Godown stock ---

function godownSheets(data: CollectedData): Sheet[] {
  const categories = data.tables.categories ?? [];
  const unitOf = new Map(categories.map((c) => [str(c.id), str(c.unit)]));
  const newestFirst = (a: Row, b: Row) => str(b.created_at).localeCompare(str(a.created_at));

  const stock: Sheet = {
    name: 'All stock',
    columns: [
      { header: 'Item', width: 28 },
      { header: 'Floor', width: 13 },
      { header: 'Unit', width: 9 },
      { header: 'Total added', kind: 'number', width: 11 },
      { header: 'In stock now', kind: 'number', width: 12 },
      { header: 'Added on', kind: 'datetime' },
    ],
    rows: categories
      .slice()
      .sort((a, b) => str(a.floor).localeCompare(str(b.floor)) || str(a.name).localeCompare(str(b.name)))
      .map((c) => [str(c.name), str(c.floor), str(c.unit), Number(c.initial_stock), Number(c.current_quantity), str(c.created_at)]),
  };

  const taken: Sheet = {
    name: 'Taken items',
    columns: [
      { header: 'When', width: 22 },
      { header: 'Taken by', width: 14 },
      { header: 'Item', width: 28 },
      { header: 'Qty', kind: 'number', width: 8 },
      { header: 'Unit', width: 9 },
      { header: 'Status', width: 10 },
    ],
    rows: (data.tables.withdrawal_logs ?? [])
      .slice()
      .sort(newestFirst)
      .map((l) => [str(l.timestamp), str(l.worker_id), str(l.category_name), Number(l.quantity), unitOf.get(str(l.category_id)) ?? '', str(l.status)]),
  };

  const added: Sheet = {
    name: 'Stock added',
    columns: [
      { header: 'When', width: 22 },
      { header: 'Item', width: 28 },
      { header: 'Floor', width: 13 },
      { header: 'Qty', kind: 'number', width: 8 },
      { header: 'Unit', width: 9 },
      { header: 'Type', width: 10 },
    ],
    rows: (data.tables.stock_additions ?? [])
      .slice()
      .sort(newestFirst)
      .map((s) => [
        str(s.timestamp),
        str(s.category_name),
        str(s.floor),
        Number(s.quantity),
        str(s.unit),
        s.type === 'new' ? 'New item' : 'Restock',
      ]),
  };

  const groups: Sheet = {
    name: 'Item groups',
    columns: [
      { header: 'Group', width: 24 },
      { header: 'Items', width: 60 },
    ],
    rows: (data.tables.item_groups ?? []).map((g) => [
      str(g.name),
      Array.isArray(g.members) ? (g.members as unknown[]).map(str).join(', ') : str(g.members),
    ]),
  };
  return [stock, taken, added, groups];
}

// --- Party (purchase) bills ---

function partyBillSheets(data: CollectedData): Sheet[] {
  const bills = (data.tables.purchase_bills ?? [])
    .slice()
    .sort((a, b) => str(a.bill_date).localeCompare(str(b.bill_date)) || str(a.created_at).localeCompare(str(b.created_at)));
  const byId = new Map(bills.map((b) => [str(b.id), b]));
  const payments = data.tables.bill_payments ?? [];
  const paidBy = groupBy(payments, 'bill_id');
  const paidOf = (b: Row) => sumBy(paidBy.get(str(b.id)) ?? [], (p) => rupees(p.amount));

  const list: Sheet = {
    name: 'Party bills',
    columns: [
      { header: 'Firm', width: 26 },
      { header: 'Bill no', width: 12 },
      { header: 'Bill date', kind: 'date' },
      { header: 'GST no', width: 17 },
      { header: 'LR no', width: 10 },
      { header: 'Transport', width: 16 },
      { header: 'Gross', kind: 'money' },
      { header: 'Discount', kind: 'money' },
      { header: 'GST', kind: 'money' },
      { header: 'Net amount', kind: 'money' },
      { header: 'Paid', kind: 'money' },
      { header: 'Left to pay', kind: 'money' },
      { header: 'Photo', width: 30 },
    ],
    rows: bills.map((b) => {
      const paid = paidOf(b);
      return [
        str(b.firm_name),
        str(b.bill_no),
        str(b.bill_date),
        str(b.gst_number),
        str(b.lr_no),
        str(b.transport_name),
        rupees(b.gross_amount),
        rupees(b.discount),
        rupees(b.gst_amount),
        rupees(b.net_amount),
        paid,
        Math.max(0, rupees(b.net_amount) - paid),
      str(b.photo_url),
      ];
    }),
    footer: [
      `Total (${bills.length})`,
      '', '', '', '', '',
      sumBy(bills, (b) => rupees(b.gross_amount)),
      sumBy(bills, (b) => rupees(b.discount)),
      sumBy(bills, (b) => rupees(b.gst_amount)),
      sumBy(bills, (b) => rupees(b.net_amount)),
      sumBy(bills, paidOf),
      sumBy(bills, (b) => Math.max(0, rupees(b.net_amount) - paidOf(b))),
      '',
    ],
  };

  const items: Sheet = {
    name: 'Bill items',
    columns: [
      { header: 'Firm', width: 26 },
      { header: 'Bill no', width: 12 },
      { header: 'Bill date', kind: 'date' },
      { header: 'Item', width: 26 },
      { header: 'HSN', width: 9 },
      { header: 'Qty', kind: 'number', width: 8 },
      { header: 'Unit', width: 7 },
      { header: 'Rate', kind: 'money' },
      { header: 'Amount', kind: 'money' },
    ],
    rows: bills.flatMap((b) =>
      (Array.isArray(b.items) ? (b.items as Row[]) : []).map((i) => [
        str(b.firm_name),
        str(b.bill_no),
        str(b.bill_date),
        str(i.name),
        str(i.hsn),
        Number(i.quantity),
        str(i.unit),
        rupees(i.rate),
        rupees(i.amount),
      ])
    ),
  };

  const paymentSheet: Sheet = {
    name: 'Payments',
    columns: [
      { header: 'Paid on', kind: 'date' },
      { header: 'Firm', width: 26 },
      { header: 'Bill no', width: 12 },
      { header: 'Amount', kind: 'money' },
      { header: 'Method', width: 13 },
      { header: 'Reference', width: 16 },
      { header: 'Bank', width: 14 },
      { header: 'Photo', width: 30 },
    ],
    rows: payments
      .slice()
      .sort((a, b) => str(a.paid_on).localeCompare(str(b.paid_on)))
      .map((p) => {
        const bill = byId.get(str(p.bill_id));
        return [str(p.paid_on), str(bill?.firm_name), str(bill?.bill_no), rupees(p.amount), str(p.method), str(p.reference), str(p.bank_name), str(p.photo_url)];
      }),
    footer: ['Total', '', '', sumBy(payments, (p) => rupees(p.amount)), '', '', '', ''],
  };
  return [list, items, paymentSheet];
}

// --- Transport bills ---

function transportSheets(data: CollectedData): Sheet[] {
  const bills = (data.tables.transport_bills ?? [])
    .slice()
    .sort((a, b) => str(a.received_date).localeCompare(str(b.received_date)) || str(a.created_at).localeCompare(str(b.created_at)));
  const byId = new Map(bills.map((b) => [str(b.id), b]));
  const payments = data.tables.transport_payments ?? [];
  const paidBy = groupBy(payments, 'bill_id');
  const paidOf = (b: Row) => sumBy(paidBy.get(str(b.id)) ?? [], (p) => rupees(p.amount));

  const list: Sheet = {
    name: 'Transport bills',
    columns: [
      { header: 'Received', kind: 'date' },
      { header: 'Transport', width: 18 },
      { header: 'Item', width: 18 },
      { header: 'Weight', width: 9 },
      { header: 'Bilty no', width: 11 },
      { header: 'Party', width: 22 },
      { header: 'Amount', kind: 'money' },
      { header: 'Paid', kind: 'money' },
      { header: 'Left to pay', kind: 'money' },
      { header: 'Photo', width: 30 },
    ],
    rows: bills.map((b) => {
      const paid = paidOf(b);
      return [
        str(b.received_date),
        str(b.transport_name),
        str(b.item),
        str(b.weight),
        str(b.bilty_no),
        str(b.party_name),
        rupees(b.amount),
        paid,
        Math.max(0, rupees(b.amount) - paid),
        str(b.photo_url),
      ];
    }),
    footer: [
      `Total (${bills.length})`,
      '', '', '', '', '',
      sumBy(bills, (b) => rupees(b.amount)),
      sumBy(bills, paidOf),
      sumBy(bills, (b) => Math.max(0, rupees(b.amount) - paidOf(b))),
      '',
    ],
  };

  const paymentSheet: Sheet = {
    name: 'Payments',
    columns: [
      { header: 'Paid on', kind: 'date' },
      { header: 'Transport', width: 18 },
      { header: 'Bilty no', width: 11 },
      { header: 'Amount', kind: 'money' },
      { header: 'Method', width: 13 },
      { header: 'Reference', width: 16 },
      { header: 'Bank', width: 14 },
      { header: 'Photo', width: 30 },
    ],
    rows: payments
      .slice()
      .sort((a, b) => str(a.paid_on).localeCompare(str(b.paid_on)))
      .map((p) => {
        const bill = byId.get(str(p.bill_id));
        return [str(p.paid_on), str(bill?.transport_name), str(bill?.bilty_no), rupees(p.amount), str(p.method), str(p.reference), str(p.bank_name), str(p.photo_url)];
      }),
    footer: ['Total', '', '', sumBy(payments, (p) => rupees(p.amount)), '', '', '', ''],
  };
  return [list, paymentSheet];
}

// --- Workers ---

function workerSheets(data: CollectedData): Sheet[] {
  const workers = (data.tables.workers ?? []).slice().sort((a, b) => str(a.name).localeCompare(str(b.name)));
  const nameOf = new Map(workers.map((w) => [str(w.id), str(w.name)]));
  const byDate = (key: string) => (a: Row, b: Row) => str(a[key]).localeCompare(str(b[key])) || str(a.created_at).localeCompare(str(b.created_at));
  const returns = (data.tables.worker_goods_returns ?? []).slice().sort(byDate('returned_on'));
  const payments = (data.tables.worker_payments ?? []).slice().sort(byDate('paid_on'));

  const list: Sheet = {
    name: 'Workers',
    columns: [
      { header: 'Name', width: 22 },
      { header: 'Type', width: 10 },
      { header: 'Phone', width: 13 },
      { header: 'Monthly salary', kind: 'money', width: 14 },
      { header: 'Job work earned', kind: 'money', width: 15 },
      { header: 'Paid', kind: 'money' },
      { header: 'Note', width: 24 },
      { header: 'Added on', kind: 'datetime' },
    ],
    rows: workers.map((w) => {
      const id = str(w.id);
      return [
        str(w.name),
        str(w.type),
        str(w.phone),
        rupees(w.monthly_salary),
        sumBy(returns.filter((r) => str(r.worker_id) === id), (r) => rupees(r.amount)),
        sumBy(payments.filter((p) => str(p.worker_id) === id), (p) => rupees(p.amount)),
        str(w.note),
        str(w.created_at),
      ];
    }),
  };

  const given: Sheet = {
    name: 'Goods given',
    columns: [
      { header: 'Date', kind: 'date' },
      { header: 'Worker', width: 22 },
      { header: 'Goods', width: 50 },
      { header: 'Note', width: 24 },
    ],
    rows: (data.tables.worker_goods_issues ?? [])
      .slice()
      .sort(byDate('issued_on'))
      .map((g) => [str(g.issued_on), nameOf.get(str(g.worker_id)) ?? '', goodsText(g), str(g.note)]),
  };

  const returned: Sheet = {
    name: 'Goods returned',
    columns: [
      { header: 'Date', kind: 'date' },
      { header: 'Worker', width: 22 },
      { header: 'Goods', width: 44 },
      { header: 'Metres used', kind: 'number', width: 11 },
      { header: 'Rate', kind: 'money' },
      { header: 'Amount', kind: 'money' },
      { header: 'Note', width: 24 },
    ],
    rows: returns.map((r) => [
      str(r.returned_on),
      nameOf.get(str(r.worker_id)) ?? '',
      goodsText(r),
      Number(r.meters_used ?? 0),
      rupees(r.rate),
      rupees(r.amount),
      str(r.note),
    ]),
    footer: ['Total', '', '', '', '', sumBy(returns, (r) => rupees(r.amount)), ''],
  };

  const paid: Sheet = {
    name: 'Payments',
    columns: [
      { header: 'Paid on', kind: 'date' },
      { header: 'Worker', width: 22 },
      { header: 'Amount', kind: 'money' },
      { header: 'Method', width: 13 },
      { header: 'Reference', width: 16 },
      { header: 'Bank', width: 14 },
      { header: 'Note', width: 24 },
      { header: 'Photo', width: 30 },
    ],
    rows: payments.map((p) => [
      str(p.paid_on),
      nameOf.get(str(p.worker_id)) ?? '',
      rupees(p.amount),
      str(p.method),
      str(p.reference),
      str(p.bank_name),
      str(p.note),
      str(p.photo_url),
    ]),
    footer: ['Total', '', sumBy(payments, (p) => rupees(p.amount)), '', '', '', '', ''],
  };
  return [list, given, returned, paid];
}

// --- Full backup (for Restore) ---

export interface BackupJson {
  format: typeof BACKUP_FORMAT;
  version: number;
  created_at: string;
  shop_name: string;
  row_counts: Record<string, number>;
  missing_tables: string[];
  tables: Record<string, Row[]>;
}

export function fullBackupJson(data: CollectedData, shopName: string, now: Date): BackupJson {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    created_at: now.toISOString(),
    shop_name: shopName,
    row_counts: Object.fromEntries(Object.entries(data.tables).map(([name, rows]) => [name, rows.length])),
    missing_tables: data.missing,
    tables: data.tables,
  };
}

// --- Messages ---

/** Telegram allows 4096 characters in a message; stay well under it. */
const MESSAGE_LIMIT = 3800;

/** Lines joined into as few messages as fit. */
export function packMessages(lines: string[], limit = MESSAGE_LIMIT): string[] {
  const messages: string[] = [];
  let current = '';
  for (const line of lines) {
    const piece = line.length > limit ? line.slice(0, limit) : line;
    if (current && current.length + 1 + piece.length > limit) {
      messages.push(current);
      current = piece;
    } else {
      current = current ? `${current}\n${piece}` : piece;
    }
  }
  if (current) messages.push(current);
  return messages;
}

function summaryLines(input: BackupInput, udhaar: UdhaarResult): string[] {
  const { data, parts, t, now, shopName, queuedSales } = input;
  const has = (part: BackupPartId) => parts.includes(part);
  const lines = [
    `<b>${escapeHtml(t('bkMsgTitle', { shop: shopName }))}</b>`,
    escapeHtml(t('bkMsgWhen', { when: istWhen(now) })),
    '',
  ];

  if (has('udhaar')) {
    lines.push(
      udhaar.list.length
        ? `<b>${escapeHtml(t('bkMsgUdhaar', { amount: formatRupees(udhaar.total), n: udhaar.list.length }))}</b>`
        : escapeHtml(t('bkMsgNoUdhaar'))
    );
  }
  if (has('sales')) {
    const month = istDate(now).slice(0, 7);
    const sales = (data.tables.shop_invoices ?? []).filter((b) => b.bill_type === 'sale' && b.status === 'active');
    const thisMonth = sales.filter((b) => str(b.bill_date).startsWith(month));
    lines.push(
      escapeHtml(
        t('bkMsgSales', {
          n: sales.length,
          month: thisMonth.length,
          amount: formatRupees(sumBy(thisMonth, (b) => paise(b.total))),
        })
      )
    );
  }
  if (has('parties')) {
    lines.push(
      escapeHtml(t('bkMsgParties', { customers: (data.tables.shop_parties ?? []).length, items: (data.tables.shop_items ?? []).length }))
    );
  }
  if (has('godown')) {
    lines.push(escapeHtml(t('bkMsgGodown', { n: (data.tables.categories ?? []).length })));
  }
  if (has('partyBills')) {
    const bills = data.tables.purchase_bills ?? [];
    const paidBy = groupBy(data.tables.bill_payments ?? [], 'bill_id');
    const left = sumBy(bills, (b) => Math.max(0, paise(b.net_amount) - sumBy(paidBy.get(str(b.id)) ?? [], (p) => paise(p.amount))));
    lines.push(escapeHtml(t('bkMsgPartyBills', { n: bills.length, amount: formatRupees(left) })));
  }
  if (has('transport')) {
    lines.push(escapeHtml(t('bkMsgTransport', { n: (data.tables.transport_bills ?? []).length })));
  }
  if (has('workers')) {
    lines.push(escapeHtml(t('bkMsgWorkers', { n: (data.tables.workers ?? []).length })));
  }

  const waiting = queuedSales.length;
  if (waiting > 0) lines.push('', escapeHtml(t('bkMsgWaiting', { n: waiting })));
  lines.push('', escapeHtml(has('full') ? t('bkMsgFilesFull') : t('bkMsgFiles')));
  return lines;
}

function udhaarListLines(data: CollectedData, udhaar: UdhaarResult, t: Translate): string[] {
  if (!udhaar.list.length) return [];
  const lines = [`<b>${escapeHtml(t('bkMsgUdhaarList', { n: udhaar.list.length, amount: formatRupees(udhaar.total) }))}</b>`];
  udhaar.list.forEach((r, i) => {
    const number = phoneOf(data, r);
    const phone = number ? ` · ${number}` : '';
    const oldest = r.bills[0]?.billDate;
    const since = oldest ? ` · ${escapeHtml(t('bkMsgSince', { date: oldest.split('-').reverse().join('-') }))}` : '';
    lines.push(`${i + 1}. <b>${escapeHtml(r.name)}</b> — ${formatRupees(r.total)}${escapeHtml(phone)}${since}`);
  });
  return lines;
}

// --- Everything ---

export function buildBackup(input: BackupInput): BuiltBackup {
  const { data, parts, now, shopName, t, queuedSales } = input;
  const date = fileDate(now);
  const today = istDate(now);
  const udhaar = computeUdhaar(data, queuedSales);
  const has = (part: BackupPartId) => parts.includes(part);
  const files: BackupFile[] = [];
  const xlsx = (part: BackupPartId, name: string, sheets: Sheet[]) =>
    files.push({ part, fileName: `${name} ${date}.xlsx`, mime: XLSX_MIME, bytes: buildXlsx(sheets) });

  if (has('udhaar')) xlsx('udhaar', 'Udhaar', udhaarSheets(data, udhaar, queuedSales, today));
  if (has('sales')) xlsx('sales', 'Sale bills', salesSheets(data));
  if (has('parties')) xlsx('parties', 'Customers and items', partiesSheets(data, udhaar));
  if (has('godown')) xlsx('godown', 'Godown stock', godownSheets(data));
  if (has('partyBills')) xlsx('partyBills', 'Party bills', partyBillSheets(data));
  if (has('transport')) xlsx('transport', 'Transport bills', transportSheets(data));
  if (has('workers')) xlsx('workers', 'Workers', workerSheets(data));
  if (has('full')) {
    const json = JSON.stringify(fullBackupJson(data, shopName, now));
    files.push({ part: 'full', fileName: `Full backup ${date}.json`, mime: 'application/json', bytes: new TextEncoder().encode(json) });
  }

  const messages = [
    ...packMessages(summaryLines(input, udhaar)),
    ...(has('udhaar') ? packMessages(udhaarListLines(data, udhaar, t)) : []),
  ];
  return { files, messages, udhaarTotal: udhaar.total, udhaarCustomers: udhaar.list.length };
}


