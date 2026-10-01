/**
 * A branded Akshay Traders bill, drawn on a canvas so it can be shared as an
 * image or wrapped into a PDF. Browser only.
 */
import { jsPDF } from 'jspdf';
import { formatBillDate, formatIstTime } from '../fy';
import { formatQty, formatRupees, mulDivRound } from '../money';
import { qrMatrix } from '../print/qr';
import { upiLink, upiQrAmount } from '../print/receipt';
import type { ShopInvoice, ShopSettings } from '../types';

const NAVY = '#0F172A';
const AMBER = '#F59E0B';
const SLATE_500 = '#64748B';
const SLATE_200 = '#E2E8F0';
const SLATE_100 = '#F1F5F9';
const RED = '#B91C1C';
const FONT = '"Plus Jakarta Sans", "Noto Sans Devanagari", system-ui, sans-serif';

const W = 1080;
const PAD = 64;

const TITLES: Record<ShopInvoice['billType'], string> = {
  sale: 'BILL',
  purchase: 'PURCHASE BILL',
  quotation: 'QUOTATION',
};

function gstByRate(bill: ShopInvoice) {
  const byRate = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>();
  for (const line of bill.lines) {
    if (line.taxAmount === 0) continue;
    const entry = byRate.get(line.gstRate) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    entry.taxable += line.taxableAmount;
    if (bill.isInterstate) entry.igst += line.taxAmount;
    else {
      const sgst = Math.floor(line.taxAmount / 2);
      entry.sgst += sgst;
      entry.cgst += line.taxAmount - sgst;
    }
    byRate.set(line.gstRate, entry);
  }
  return Array.from(byRate.entries()).sort((a, b) => a[0] - b[0]);
}

export async function drawBillCanvas(bill: ShopInvoice, settings: ShopSettings): Promise<HTMLCanvasElement> {
  try {
    await document.fonts?.ready;
  } catch {
    // Draw with whatever font is there.
  }

  const draft = document.createElement('canvas');
  draft.width = W;
  draft.height = 6000;
  const ctx = draft.getContext('2d');
  if (!ctx) throw new Error('This phone cannot draw the bill.');

  const font = (size: number, weight = 500) => {
    ctx.font = `${weight} ${size}px ${FONT}`;
  };
  const text = (value: string, x: number, y: number, align: CanvasTextAlign = 'left', color = NAVY) => {
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(value, x, y);
  };
  const fit = (value: string, maxWidth: number) => {
    if (ctx.measureText(value).width <= maxWidth) return value;
    let cut = value;
    while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
    return `${cut}…`;
  };
  const roundRect = (x: number, y: number, w: number, h: number, r: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  };

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, draft.height);

  // --- Header band: logo mark, shop name, contact ---
  const headerH = settings.gstin && bill.isGst ? 250 : 220;
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, W, headerH);
  roundRect(PAD, 52, 116, 116, 26, AMBER);
  font(50, 800);
  text('AT', PAD + 58, 128, 'center', NAVY);

  const nameX = PAD + 150;
  font(54, 800);
  text(fit(settings.shopName || 'Akshay Traders', W - nameX - PAD), nameX, 100, 'left', '#FFFFFF');
  font(26, 500);
  const contact = [settings.address, settings.phone ? `Ph: ${settings.phone}` : ''].filter(Boolean).join('  •  ');
  if (contact) text(fit(contact, W - nameX - PAD), nameX, 146, 'left', '#CBD5E1');
  if (settings.gstin && bill.isGst) {
    font(26, 600);
    text(`GSTIN: ${settings.gstin}`, nameX, 186, 'left', '#FCD34D');
  }
  ctx.fillStyle = AMBER;
  ctx.fillRect(0, headerH, W, 10);

  // --- Title and bill details ---
  let y = headerH + 90;
  const title = bill.billType === 'sale' && bill.isGst ? 'TAX INVOICE' : TITLES[bill.billType];
  font(40, 800);
  text(title, PAD, y);
  if (bill.status === 'cancelled') {
    font(28, 800);
    text('CANCELLED', PAD + ctx.measureText(title).width + 30, y, 'left', RED);
  }
  font(26, 600);
  text(`Bill No: ${bill.billNumber ?? 'given on upload'}`, W - PAD, y - 14, 'right');
  font(24, 500);
  text(`${formatBillDate(bill.billDate)}  •  ${formatIstTime(bill.createdAt)}`, W - PAD, y + 22, 'right', SLATE_500);

  // --- Bill to ---
  y += 60;
  roundRect(PAD, y, W - PAD * 2, bill.partyGstin ? 124 : 96, 18, SLATE_100);
  font(22, 600);
  text(bill.billType === 'purchase' ? 'SUPPLIER' : 'BILL TO', PAD + 28, y + 38, 'left', SLATE_500);
  font(32, 700);
  text(fit(bill.partyName || 'Cash Sale', W - PAD * 2 - 56), PAD + 28, y + 78);
  if (bill.partyGstin) {
    font(24, 500);
    text(`GSTIN: ${bill.partyGstin}`, PAD + 28, y + 110, 'left', SLATE_500);
  }
  y += (bill.partyGstin ? 124 : 96) + 44;

  // --- Items table ---
  const col = { no: PAD + 20, item: PAD + 70, qty: 640, rate: 820, amount: W - PAD - 20 };
  roundRect(PAD, y, W - PAD * 2, 60, 12, NAVY);
  font(22, 700);
  text('#', col.no, y + 39, 'left', '#FFFFFF');
  text('ITEM', col.item, y + 39, 'left', '#FFFFFF');
  text('QTY', col.qty, y + 39, 'right', '#FFFFFF');
  text('RATE', col.rate, y + 39, 'right', '#FFFFFF');
  text('AMOUNT', col.amount, y + 39, 'right', '#FFFFFF');
  y += 60;

  bill.lines.forEach((line, i) => {
    const rowH = bill.isGst || line.hsn ? 88 : 70;
    if (i % 2 === 1) {
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(PAD, y, W - PAD * 2, rowH);
    }
    font(26, 500);
    text(String(i + 1), col.no, y + 44, 'left', SLATE_500);
    font(28, 600);
    text(fit(line.itemName, col.qty - col.item - 130), col.item, y + 44);
    if (bill.isGst || line.hsn) {
      font(20, 500);
      const sub = [bill.isGst ? `GST ${line.gstRate}%` : '', line.hsn ? `HSN ${line.hsn}` : ''].filter(Boolean).join('  •  ');
      text(sub, col.item, y + 74, 'left', SLATE_500);
    }
    font(26, 500);
    text(`${formatQty(line.qty)} ${line.unit}`, col.qty, y + 44, 'right');
    text(formatRupees(line.rate, true), col.rate, y + 44, 'right');
    font(26, 700);
    text(formatRupees(mulDivRound(line.qty, line.rate, 1000), true), col.amount, y + 44, 'right');
    y += rowH;
    ctx.fillStyle = SLATE_200;
    ctx.fillRect(PAD, y - 1, W - PAD * 2, 1);
  });

  // --- Totals (right) and UPI QR (left) ---
  y += 36;
  const totalsTop = y;
  const labelX = 600;
  const valueX = W - PAD - 20;
  const row = (label: string, value: string, color = NAVY, weight = 500) => {
    font(26, weight);
    text(label, labelX, y, 'left', SLATE_500);
    font(26, weight === 500 ? 600 : weight);
    text(value, valueX, y, 'right', color);
    y += 46;
  };
  row('Subtotal', formatRupees(bill.itemsTotal, true));
  if (bill.discount > 0) {
    const pct = bill.discountPercent !== null ? ` (${bill.discountPercent / 100}%)` : '';
    row(`Discount${pct}`, `− ${formatRupees(bill.discount, true)}`, '#047857');
  }
  if (bill.isGst) {
    row('Taxable value', formatRupees(bill.subtotal, true));
    for (const [rate, e] of gstByRate(bill)) {
      if (bill.isInterstate) row(`IGST @${rate}%`, formatRupees(e.igst, true));
      else {
        row(`CGST @${rate / 2}%`, formatRupees(e.cgst, true));
        row(`SGST @${rate / 2}%`, formatRupees(e.sgst, true));
      }
    }
  }
  if (bill.roundOff !== 0) {
    row('Round off', `${bill.roundOff > 0 ? '+' : '−'} ${formatRupees(Math.abs(bill.roundOff), true)}`);
  }

  y += 6;
  roundRect(labelX - 24, y, valueX - labelX + 44, 86, 16, NAVY);
  font(28, 700);
  text('TOTAL', labelX, y + 55, 'left', '#FCD34D');
  font(40, 800);
  text(formatRupees(bill.total, true), valueX, y + 58, 'right', '#FFFFFF');
  y += 86 + 44;

  const due = bill.billType === 'quotation' ? 0 : bill.total - bill.paidAmount;
  if (bill.billType !== 'quotation') {
    const paidLabel = { cash: 'Cash', upi: 'UPI', credit: 'Udhaar', partial: 'Part paid' }[bill.paymentMode];
    row(`Paid (${paidLabel})`, formatRupees(bill.paidAmount, true), '#047857');
    if (due > 0) row('Balance due', formatRupees(due, true), RED, 700);
  }
  if (bill.isGst && bill.ratesIncludeGst) {
    font(20, 500);
    text('GST is included in the rates', valueX, y, 'right', SLATE_500);
    y += 30;
  }

  const qrAmount = upiQrAmount(bill);
  if (settings.upiId && bill.billType === 'sale' && bill.status !== 'cancelled') {
    const matrix = qrMatrix(upiLink(settings.upiId, settings.shopName, qrAmount));
    const scale = Math.floor(250 / matrix.length);
    const size = matrix.length * scale;
    const qx = PAD + 10;
    const qy = totalsTop + 6;
    roundRect(qx - 16, qy - 16, size + 32, size + 110, 18, SLATE_100);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(qx, qy, size, size);
    ctx.fillStyle = '#000000';
    matrix.forEach((r, ri) => r.forEach((dark, ci) => dark && ctx.fillRect(qx + ci * scale, qy + ri * scale, scale, scale)));
    font(24, 700);
    text(qrAmount ? `Scan to pay ${formatRupees(qrAmount)}` : 'Pay by UPI', qx + size / 2, qy + size + 40, 'center');
    font(20, 500);
    text(fit(settings.upiId, size + 20), qx + size / 2, qy + size + 72, 'center', SLATE_500);
    y = Math.max(y, qy + size + 120);
  }

  // --- Footer ---
  y += 40;
  ctx.fillStyle = AMBER;
  ctx.fillRect(PAD, y, W - PAD * 2, 4);
  y += 56;
  font(30, 700);
  text(settings.receiptFooter || 'Thank you for shopping with us!', W / 2, y, 'center');
  y += 42;
  font(22, 500);
  text(`${settings.shopName || 'Akshay Traders'}${settings.phone ? `  •  ${settings.phone}` : ''}`, W / 2, y, 'center', SLATE_500);
  y += 56;

  // Crop to what was drawn.
  const out = document.createElement('canvas');
  out.width = W;
  out.height = Math.ceil(y);
  out.getContext('2d')!.drawImage(draft, 0, 0);
  return out;
}

export function billFileName(bill: ShopInvoice, ext: 'png' | 'pdf'): string {
  const number = (bill.billNumber ?? 'bill').replace(/[\\/]+/g, '-');
  return `Akshay-Traders-${number}.${ext}`;
}

export async function billImageFile(bill: ShopInvoice, settings: ShopSettings): Promise<File> {
  const canvas = await drawBillCanvas(bill, settings);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The bill picture could not be made.');
  return new File([blob], billFileName(bill, 'png'), { type: 'image/png' });
}

export async function billPdfFile(bill: ShopInvoice, settings: ShopSettings): Promise<File> {
  const canvas = await drawBillCanvas(bill, settings);
  // A4 width; the page is as long as the bill.
  const pageW = 595;
  const pageH = Math.round((canvas.height * pageW) / canvas.width);
  const pdf = new jsPDF({ unit: 'pt', format: [pageW, pageH], orientation: 'portrait', compress: true });
  pdf.setProperties({ title: `${settings.shopName || 'Akshay Traders'} ${bill.billNumber ?? ''}`.trim(), author: settings.shopName });
  // JPEG keeps the file small enough to send on WhatsApp (a PNG page is several MB).
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, pageW, pageH, undefined, 'FAST');
  const blob = pdf.output('blob');
  return new File([blob], billFileName(bill, 'pdf'), { type: 'application/pdf' });
}

/** Short message to go with the file, or on its own in WhatsApp. */
export function billShareText(bill: ShopInvoice, settings: ShopSettings): string {
  const due = bill.billType === 'quotation' ? 0 : bill.total - bill.paidAmount;
  const lines = [
    `*${settings.shopName || 'Akshay Traders'}*`,
    `${bill.billType === 'quotation' ? 'Quotation' : 'Bill'} ${bill.billNumber ?? ''} • ${formatBillDate(bill.billDate)}`.trim(),
    `Total: ${formatRupees(bill.total, true)}`,
  ];
  if (due > 0) {
    lines.push(`Balance due: ${formatRupees(due, true)}`);
    if (settings.upiId) lines.push(`Pay by UPI: ${settings.upiId}`);
  }
  lines.push(settings.receiptFooter || 'Thank you!');
  return lines.join('\n');
}
