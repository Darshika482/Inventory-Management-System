/**
 * What goes on a printed bill, as a list of lines. The same list drives the
 * on-screen preview, the ESC/POS text printout and the image printout (for
 * Hindi), so all three always match.
 *
 * Pure: no browser APIs, so it is unit tested.
 */
import { formatQty, mulDivRound, type Paise } from '../money';
import { formatIstTime } from '../fy';
import type { ShopInvoice, ShopSettings } from '../types';
import { qrMatrix } from './qr';

export type ReceiptAlign = 'left' | 'center' | 'right';

export type ReceiptLine =
  /** `mono`: a pre-spaced table row, printed exactly as it is (no wrapping). */
  | { kind: 'text'; text: string; align?: ReceiptAlign; bold?: boolean; big?: boolean; mono?: boolean }
  /** Left text and right text on one line, e.g. "Total" ... "Rs 789.00". */
  | { kind: 'pair'; left: string; right: string; bold?: boolean; big?: boolean }
  /** A dashed rule across the paper. */
  | { kind: 'rule' }
  | { kind: 'qr'; data: string; caption: string }
  | { kind: 'feed'; lines: number };

export interface ReceiptOptions {
  /** Item names in Hindi where known (needs image printing). */
  hindi: boolean;
  /** item id -> Hindi name, used when `hindi` is on. */
  hindiNames?: Record<string, string>;
  /** Print a UPI QR code for the amount due. */
  showUpiQr: boolean;
  /** Paper width, for the item columns. Default 58. */
  widthMm?: 58 | 80;
  /** Name at the top of the printout (e.g. "Surbhi Fall"); defaults to the shop name. */
  billName?: string;
  /** Small line under the name (e.g. "wholesale"). */
  billSubtitle?: string;
}

/** Characters per line in the printer's normal font. */
export function charsPerLine(widthMm: 58 | 80): number {
  return widthMm === 80 ? 48 : 32;
}

/** "Rs 1,234.50" — the ₹ sign is not in printer character sets. */
export function receiptMoney(paise: Paise): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100).toLocaleString('en-IN');
  return `${negative ? '-' : ''}Rs ${rupees}.${String(abs % 100).padStart(2, '0')}`;
}

const BILL_TITLES: Record<ShopInvoice['billType'], string> = {
  sale: 'BILL',
  purchase: 'PURCHASE BILL',
  quotation: 'QUOTATION / ESTIMATE',
};

const PAYMENT_LABELS: Record<ShopInvoice['paymentMode'], string> = {
  cash: 'Cash',
  upi: 'UPI',
  credit: 'Udhaar (credit)',
  partial: 'Part paid',
};

/** UPI payment link for the QR code. With no amount, the payer types it. */
export function upiLink(upiId: string, shopName: string, amount?: Paise | null): string {
  const params = new URLSearchParams({ pa: upiId, pn: shopName });
  if (amount && amount > 0) params.set('am', (amount / 100).toFixed(2));
  params.set('cu', 'INR');
  return `upi://pay?${params.toString()}`;
}

/**
 * The shortest UPI link that still fills in the amount, for the printed QR:
 * fewer letters make a QR with fewer, so smaller, squares. The UPI ID keeps a
 * plain "@" and the currency is left out (UPI is always rupees). The payee
 * name is kept only when it does not make the QR any bigger.
 */
export function printedUpiLink(upiId: string, name: string, amount?: Paise | null): string {
  const base = `upi://pay?pa=${upiId.trim()}${amount && amount > 0 ? `&am=${plainAmount(amount)}` : ''}`;
  const withName = `${base}&pn=${encodeURIComponent(name.trim())}`;
  return name.trim() && qrMatrix(withName).length <= qrMatrix(base).length ? withName : base;
}

/**
 * Amount for a bill's UPI QR, filled in when the customer scans: what is still
 * due, otherwise the bill total (bills are often saved as "received" before the
 * customer pays by scanning). null only for a zero bill.
 */
export function upiQrAmount(bill: ShopInvoice): Paise | null {
  const due = bill.billType === 'quotation' ? 0 : bill.total - bill.paidAmount;
  if (due > 0) return due;
  return bill.total > 0 ? bill.total : null;
}

/** 126000 -> "1260", 1850 -> "18.50": plain numbers like a shop bill, no "Rs". */
export function plainAmount(paise: Paise): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rest = abs % 100;
  return `${negative ? '-' : ''}${Math.floor(abs / 100)}${rest ? `.${String(rest).padStart(2, '0')}` : ''}`;
}

/** '2026-10-03' -> '03/10/2026' */
function slashDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

/** Item table column widths (characters) for the paper width. */
function columns(width: number) {
  return width >= 48
    ? { no: 3, qty: 7, price: 9, amount: 10, name: width - 3 - 7 - 9 - 10 }
    : { no: 2, qty: 5, price: 6, amount: 7, name: width - 2 - 5 - 6 - 7 };
}

function fit(text: string, width: number): string {
  return text.length > width ? text.slice(0, width) : text;
}

export function layoutReceipt(bill: ShopInvoice, settings: ShopSettings, options: ReceiptOptions): ReceiptLine[] {
  const lines: ReceiptLine[] = [];
  const width = charsPerLine(options.widthMm ?? 58);
  const col = columns(width);
  const due = bill.billType === 'quotation' ? 0 : bill.total - bill.paidAmount;
  const mono = (text: string, bold = false): ReceiptLine => ({ kind: 'text', text, mono: true, bold });

  // Shop: only the name is large
  lines.push({ kind: 'text', text: options.billName?.trim() || settings.shopName, align: 'center', bold: true, big: true });
  if (options.billSubtitle?.trim()) lines.push({ kind: 'text', text: options.billSubtitle.trim(), align: 'center' });
  if (settings.address) lines.push({ kind: 'text', text: settings.address, align: 'center' });
  if (settings.phone) lines.push({ kind: 'text', text: `Ph.No.: ${settings.phone}`, align: 'center' });
  if (bill.isGst && settings.gstin) lines.push({ kind: 'text', text: `GSTIN: ${settings.gstin}`, align: 'center' });
  lines.push({ kind: 'rule' });

  // Bill details
  const title =
    bill.billType === 'quotation'
      ? 'Estimate'
      : bill.billType === 'purchase'
        ? 'Purchase'
        : bill.isGst
          ? 'Tax Invoice'
          : 'Invoice';
  lines.push({ kind: 'text', text: title, align: 'center', bold: true });
  if (bill.status === 'cancelled') lines.push({ kind: 'text', text: '*** CANCELLED ***', align: 'center', bold: true });
  lines.push({ kind: 'pair', left: bill.partyName || 'Cash Sale', right: `Date: ${slashDate(bill.billDate)}` });
  const seq = bill.billNumber ? bill.billNumber.split('/').pop() : 'pending';
  lines.push({ kind: 'pair', left: `Bill No: ${seq}`, right: formatIstTime(bill.createdAt) });
  if (bill.partyGstin) lines.push({ kind: 'text', text: `GSTIN: ${bill.partyGstin}` });
  lines.push({ kind: 'rule' });

  // Item table:  # Name   Qty  Price  Amount
  lines.push(
    mono(
      '#'.padEnd(col.no) +
        'Name'.padEnd(col.name) +
        'Qty'.padStart(col.qty) +
        'Price'.padStart(col.price) +
        'Amount'.padStart(col.amount),
      true
    )
  );
  lines.push({ kind: 'rule' });
  bill.lines.forEach((line, i) => {
    const hindiName = options.hindi && line.itemId ? options.hindiNames?.[line.itemId] : undefined;
    const name = hindiName || line.itemName;
    // Long names continue on the next lines, in the name column.
    const gross = mulDivRound(line.qty, line.rate, 1000);
    // Numbers are never cut: a big one takes room from the name column instead.
    const numbers =
      ` ${formatQty(line.qty)}`.padStart(col.qty) +
      ` ${plainAmount(line.rate)}`.padStart(col.price) +
      ` ${plainAmount(gross)}`.padStart(col.amount);
    const nameWidth = Math.max(4, width - col.no - numbers.length);
    const nameRows = wrapText(name, nameWidth);
    lines.push(mono(fit(String(i + 1), col.no - 1).padEnd(col.no) + fit(nameRows[0], nameWidth).padEnd(nameWidth) + numbers));
    // Long names continue on the next rows, under the name column.
    for (const rest of nameRows.slice(1)) lines.push(mono(' '.repeat(col.no) + fit(rest, width - col.no)));
  });
  lines.push({ kind: 'rule' });

  // Totals:   label   :   amount
  const label = width >= 48 ? 20 : 14;
  const total = (name: string, amount: string, bold = false) =>
    lines.push(mono(`  ${name.padEnd(label)}:${amount.padStart(width - 3 - label)}`, bold));

  lines.push(mono(plainAmount(bill.itemsTotal).padStart(width)));
  if (bill.discount > 0) {
    const pct = bill.discountPercent !== null ? ` ${bill.discountPercent / 100}%` : '';
    total(`Discount${pct}`, `-${plainAmount(bill.discount)}`);
  }
  if (bill.isGst) {
    // Rate-wise split, worked out the same way as the bill.
    const byRate = new Map<number, { cgst: number; sgst: number; igst: number }>();
    for (const line of bill.lines) {
      if (line.taxAmount === 0) continue;
      const entry = byRate.get(line.gstRate) ?? { cgst: 0, sgst: 0, igst: 0 };
      if (bill.isInterstate) entry.igst += line.taxAmount;
      else {
        const sgst = Math.floor(line.taxAmount / 2);
        entry.sgst += sgst;
        entry.cgst += line.taxAmount - sgst;
      }
      byRate.set(line.gstRate, entry);
    }
    total('Taxable', plainAmount(bill.subtotal));
    for (const [rate, e] of Array.from(byRate.entries()).sort((a, b) => a[0] - b[0])) {
      if (bill.isInterstate) total(`IGST ${rate}%`, plainAmount(e.igst));
      else {
        total(`CGST ${rate / 2}%`, plainAmount(e.cgst));
        total(`SGST ${rate / 2}%`, plainAmount(e.sgst));
      }
    }
  }
  if (bill.roundOff !== 0) total('Round off', `${bill.roundOff > 0 ? '+' : ''}${plainAmount(bill.roundOff)}`);
  total('Total', plainAmount(bill.total), true);
  if (bill.billType !== 'quotation') {
    total('Received', plainAmount(bill.paidAmount));
    if (due > 0) total('Balance', plainAmount(due), true);
  }
  if (bill.isGst && bill.ratesIncludeGst) lines.push({ kind: 'text', text: '(GST included in rates)', align: 'center' });

  // UPI QR on every sale bill: with the amount due (or the UPI total), else plain.
  const qrAmount = upiQrAmount(bill);
  if (options.showUpiQr && settings.upiId && bill.billType === 'sale' && bill.status !== 'cancelled') {
    lines.push({ kind: 'feed', lines: 1 });
    lines.push({
      kind: 'qr',
      data: printedUpiLink(settings.upiId, options.billName?.trim() || settings.shopName, qrAmount),
      caption: qrAmount ? `Scan to pay Rs ${plainAmount(qrAmount)}` : 'Scan this QR code to pay',
    });
  }

  if (settings.receiptFooter) {
    lines.push({ kind: 'feed', lines: 1 });
    lines.push({ kind: 'text', text: settings.receiptFooter, align: 'center' });
  }
  lines.push({ kind: 'feed', lines: 3 });
  return lines;
}

/** Splits text into pieces of at most `width` characters, breaking at spaces where possible. */
export function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let current = '';
  for (const word of words) {
    if (word.length > width) {
      if (current) out.push(current);
      for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width));
      current = out.pop() ?? '';
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > width) {
      out.push(current);
      current = word;
    } else current = next;
  }
  if (current || out.length === 0) out.push(current);
  return out;
}

/** Fits a left and right text into one line of `width` characters (wrapping the left part if needed). */
export function pairToRows(left: string, right: string, width: number): string[] {
  const room = width - right.length - 1;
  if (room < 4) return [...wrapText(left, width), right.padStart(width)];
  const leftRows = wrapText(left, room);
  const last = leftRows.pop() ?? '';
  return [...leftRows, last.padEnd(width - right.length) + right];
}

/** The receipt as plain fixed-width text rows (used by the text printout and tests). */
export function receiptToTextRows(lines: ReceiptLine[], width: number): string[] {
  const rows: string[] = [];
  for (const line of lines) {
    switch (line.kind) {
      case 'rule':
        rows.push('-'.repeat(width));
        break;
      case 'feed':
        for (let i = 0; i < line.lines; i++) rows.push('');
        break;
      case 'qr':
        rows.push('[QR]');
        rows.push(...wrapText(line.caption, width).map((r) => centre(r, width)));
        break;
      case 'pair': {
        const w = line.big ? Math.floor(width / 2) : width;
        rows.push(...pairToRows(line.left, line.right, w));
        break;
      }
      case 'text': {
        if (line.mono) {
          rows.push(line.text);
          break;
        }
        const w = line.big ? Math.floor(width / 2) : width;
        for (const r of wrapText(line.text, w)) {
          rows.push(line.align === 'center' ? centre(r, w) : line.align === 'right' ? r.padStart(w) : r);
        }
        break;
      }
    }
  }
  return rows;
}

function centre(text: string, width: number): string {
  const pad = Math.max(0, Math.floor((width - text.length) / 2));
  return ' '.repeat(pad) + text;
}
