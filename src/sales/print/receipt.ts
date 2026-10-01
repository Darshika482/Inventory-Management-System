/**
 * What goes on a printed bill, as a list of lines. The same list drives the
 * on-screen preview, the ESC/POS text printout and the image printout (for
 * Hindi), so all three always match.
 *
 * Pure: no browser APIs, so it is unit tested.
 */
import { formatQty, mulDivRound, type Paise } from '../money';
import { formatBillDate, formatIstTime } from '../fy';
import type { ShopInvoice, ShopSettings } from '../types';

export type ReceiptAlign = 'left' | 'center' | 'right';

export type ReceiptLine =
  | { kind: 'text'; text: string; align?: ReceiptAlign; bold?: boolean; big?: boolean }
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
 * Amount for a bill's UPI QR: what is still due, the total on a UPI bill, or
 * null (a plain "pay by UPI" QR) when the bill is already settled.
 */
export function upiQrAmount(bill: ShopInvoice): Paise | null {
  const due = bill.billType === 'quotation' ? 0 : bill.total - bill.paidAmount;
  if (due > 0) return due;
  if (bill.paymentMode === 'upi' && bill.total > 0) return bill.total;
  return null;
}

export function layoutReceipt(bill: ShopInvoice, settings: ShopSettings, options: ReceiptOptions): ReceiptLine[] {
  const lines: ReceiptLine[] = [];
  const due = bill.billType === 'quotation' ? 0 : bill.total - bill.paidAmount;

  // Shop
  lines.push({ kind: 'text', text: settings.shopName, align: 'center', bold: true, big: true });
  if (settings.address) lines.push({ kind: 'text', text: settings.address, align: 'center' });
  if (settings.phone) lines.push({ kind: 'text', text: `Ph: ${settings.phone}`, align: 'center' });
  if (bill.isGst && settings.gstin) lines.push({ kind: 'text', text: `GSTIN: ${settings.gstin}`, align: 'center' });
  lines.push({ kind: 'rule' });

  // Bill
  const title = bill.billType === 'sale' && bill.isGst ? 'TAX INVOICE' : BILL_TITLES[bill.billType];
  lines.push({ kind: 'text', text: title, align: 'center', bold: true });
  if (bill.status === 'cancelled') lines.push({ kind: 'text', text: '*** CANCELLED ***', align: 'center', bold: true });
  lines.push({ kind: 'text', text: `Bill No: ${bill.billNumber ?? 'given on upload'}` });
  lines.push({ kind: 'pair', left: `Date: ${formatBillDate(bill.billDate)}`, right: formatIstTime(bill.createdAt) });
  lines.push({
    kind: 'text',
    text: `${bill.billType === 'purchase' ? 'Supplier' : 'Customer'}: ${bill.partyName || 'Cash Sale'}`,
    bold: true,
  });
  if (bill.partyGstin) lines.push({ kind: 'text', text: `GSTIN: ${bill.partyGstin}` });
  lines.push({ kind: 'rule' });

  // Items: name on one line, "qty x rate" and amount under it
  bill.lines.forEach((line, i) => {
    const hindiName = options.hindi && line.itemId ? options.hindiNames?.[line.itemId] : undefined;
    lines.push({ kind: 'text', text: `${i + 1}. ${hindiName || line.itemName}` });
    const gross = mulDivRound(line.qty, line.rate, 1000);
    const gst = bill.isGst ? `  ${line.gstRate}%` : '';
    lines.push({
      kind: 'pair',
      left: `${formatQty(line.qty)} ${line.unit} x ${receiptMoney(line.rate).replace('Rs ', '')}${gst}`,
      right: receiptMoney(gross),
    });
  });
  lines.push({ kind: 'rule' });

  // Totals
  lines.push({ kind: 'pair', left: 'Subtotal', right: receiptMoney(bill.itemsTotal) });
  if (bill.discount > 0) {
    const pct = bill.discountPercent !== null ? ` (${bill.discountPercent / 100}%)` : '';
    lines.push({ kind: 'pair', left: `Discount${pct}`, right: `-${receiptMoney(bill.discount)}` });
  }
  if (bill.isGst) {
    lines.push({ kind: 'pair', left: 'Taxable value', right: receiptMoney(bill.subtotal) });
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
    for (const [rate, e] of Array.from(byRate.entries()).sort((a, b) => a[0] - b[0])) {
      if (bill.isInterstate) {
        lines.push({ kind: 'pair', left: `IGST @${rate}%`, right: receiptMoney(e.igst) });
      } else {
        lines.push({ kind: 'pair', left: `CGST @${rate / 2}%`, right: receiptMoney(e.cgst) });
        lines.push({ kind: 'pair', left: `SGST @${rate / 2}%`, right: receiptMoney(e.sgst) });
      }
    }
    if (bill.ratesIncludeGst) lines.push({ kind: 'text', text: '(GST included in rates)', align: 'right' });
  }
  if (bill.roundOff !== 0) {
    lines.push({ kind: 'pair', left: 'Round off', right: `${bill.roundOff > 0 ? '+' : ''}${receiptMoney(bill.roundOff)}` });
  }
  lines.push({ kind: 'rule' });
  lines.push({ kind: 'pair', left: 'TOTAL', right: receiptMoney(bill.total), bold: true, big: true });

  if (bill.billType !== 'quotation') {
    lines.push({ kind: 'pair', left: `Paid (${PAYMENT_LABELS[bill.paymentMode]})`, right: receiptMoney(bill.paidAmount) });
    if (due > 0) lines.push({ kind: 'pair', left: 'Balance due', right: receiptMoney(due), bold: true });
  }

  // UPI QR on every sale bill: with the amount due (or the UPI total), else plain.
  const qrAmount = upiQrAmount(bill);
  if (options.showUpiQr && settings.upiId && bill.billType === 'sale' && bill.status !== 'cancelled') {
    lines.push({ kind: 'feed', lines: 1 });
    lines.push({
      kind: 'qr',
      data: upiLink(settings.upiId, settings.shopName, qrAmount),
      caption: qrAmount
        ? `Scan to pay ${receiptMoney(qrAmount)} - ${settings.upiId}`
        : `Pay by UPI - ${settings.upiId}`,
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
