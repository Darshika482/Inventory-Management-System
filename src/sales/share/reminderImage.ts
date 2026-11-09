/**
 * The udhaar reminder picture sent to a customer on WhatsApp: what they owe,
 * the bills behind it, and a UPI QR for that amount. Same look as the bill
 * picture (billImage.ts). Browser only.
 */
import { billLabel, formatBillDate } from '../fy';
import { formatRupees } from '../money';
import { qrMatrix } from '../print/qr';
import { upiLink, upiPayee } from '../print/receipt';
import type { DueReminder } from '../reminders';
import type { ShopSettings } from '../types';

const NAVY = '#0F172A';
const AMBER = '#F59E0B';
const SLATE_500 = '#64748B';
const SLATE_200 = '#E2E8F0';
const SLATE_100 = '#F1F5F9';
const RED = '#B91C1C';
const GREEN = '#047857';
const FONT = '"Plus Jakarta Sans", "Noto Sans Devanagari", system-ui, sans-serif';

const W = 1080;
const PAD = 64;
/** More bills than this are summed up on one line, so the picture stays readable. */
const MAX_BILL_ROWS = 8;

export async function drawReminderCanvas(
  reminder: DueReminder,
  settings: ShopSettings,
  today: string
): Promise<HTMLCanvasElement> {
  try {
    await document.fonts?.ready;
  } catch {
    // Draw with whatever font is there.
  }

  const draft = document.createElement('canvas');
  draft.width = W;
  draft.height = 4000;
  const ctx = draft.getContext('2d');
  if (!ctx) throw new Error('This phone cannot draw the reminder.');

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
  /** Splits a sentence into lines that fit `maxWidth` (in the current font). */
  const wrap = (value: string, maxWidth: number) => {
    const lines: string[] = [];
    let line = '';
    for (const word of value.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  };
  const roundRect = (x: number, y: number, w: number, h: number, r: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  };

  const shopName = settings.shopName || 'Akshay Traders';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, draft.height);

  // --- Header band: logo mark, shop name, contact (as on the bill) ---
  const headerH = 220;
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, W, headerH);
  roundRect(PAD, 52, 116, 116, 26, AMBER);
  font(50, 800);
  text('AT', PAD + 58, 128, 'center', NAVY);
  const nameX = PAD + 150;
  font(54, 800);
  text(fit(shopName, W - nameX - PAD), nameX, 100, 'left', '#FFFFFF');
  font(26, 500);
  const contact = [settings.address, settings.phone ? `Ph: ${settings.phone}` : ''].filter(Boolean).join('  •  ');
  if (contact) text(fit(contact, W - nameX - PAD), nameX, 146, 'left', '#CBD5E1');
  ctx.fillStyle = AMBER;
  ctx.fillRect(0, headerH, W, 10);

  // --- Title, date, greeting ---
  let y = headerH + 96;
  font(40, 800);
  text('PAYMENT REMINDER', PAD, y);
  font(26, 500);
  text(formatBillDate(today), W - PAD, y, 'right', SLATE_500);

  y += 76;
  font(36, 700);
  text(fit(`Dear ${reminder.name},`, W - PAD * 2), PAD, y);
  y += 54;
  font(28, 500);
  for (const line of wrap(`This is a reminder of the amount pending with ${shopName}. Please pay it at the earliest.`, W - PAD * 2)) {
    text(line, PAD, y, 'left', SLATE_500);
    y += 40;
  }

  // --- Amount due, big ---
  y += 24;
  roundRect(PAD, y, W - PAD * 2, 200, 28, '#FEF2F2');
  ctx.fillStyle = RED;
  ctx.fillRect(PAD, y + 28, 8, 144);
  font(26, 700);
  text('AMOUNT DUE', PAD + 44, y + 66, 'left', RED);
  font(88, 800);
  text(formatRupees(reminder.total, true), PAD + 44, y + 162, 'left', RED);
  y += 200 + 64;

  // --- What it is made of ---
  const labelX = PAD + 20;
  const valueX = W - PAD - 20;
  const row = (label: string, value: string, color = NAVY) => {
    font(28, 500);
    text(fit(label, valueX - labelX - 260), labelX, y, 'left', NAVY);
    font(28, 700);
    text(value, valueX, y, 'right', color);
    ctx.fillStyle = SLATE_200;
    ctx.fillRect(PAD, y + 24, W - PAD * 2, 1);
    y += 66;
  };

  if (reminder.oldBalance !== 0) row('Old balance', formatRupees(reminder.oldBalance, true));
  const shown = reminder.bills.length > MAX_BILL_ROWS ? reminder.bills.slice(0, MAX_BILL_ROWS - 1) : reminder.bills;
  for (const bill of shown) {
    const label = billLabel(bill.billNumber);
    row(`Bill${label ? ` ${label}` : ''}  •  ${formatBillDate(bill.billDate)}`, formatRupees(bill.due, true));
  }
  const rest = reminder.bills.slice(shown.length);
  if (rest.length > 0) {
    row(`${rest.length} more bills`, formatRupees(rest.reduce((sum, b) => sum + b.due, 0), true));
  }
  if (reminder.paidOnAccount > 0) row('Paid on account', `− ${formatRupees(reminder.paidOnAccount, true)}`, GREEN);

  y += 4;
  roundRect(PAD, y, W - PAD * 2, 92, 18, NAVY);
  font(30, 700);
  text('TOTAL DUE', PAD + 32, y + 58, 'left', '#FCD34D');
  font(42, 800);
  text(formatRupees(reminder.total, true), W - PAD - 32, y + 61, 'right', '#FFFFFF');
  y += 92 + 56;

  // --- UPI QR for exactly this amount ---
  const payee = upiPayee(settings);
  if (payee) {
    const matrix = qrMatrix(upiLink(payee.upiId, payee.name, reminder.total, payee.merchantCode));
    const scale = Math.floor(320 / matrix.length);
    const size = matrix.length * scale;
    const qx = (W - size) / 2;
    roundRect(qx - 28, y, size + 56, size + 150, 24, SLATE_100);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(qx, y + 28, size, size);
    ctx.fillStyle = '#000000';
    matrix.forEach((r, ri) => r.forEach((dark, ci) => dark && ctx.fillRect(qx + ci * scale, y + 28 + ri * scale, scale, scale)));
    font(28, 700);
    text(`Scan to pay ${formatRupees(reminder.total)}`, W / 2, y + size + 80, 'center');
    font(22, 500);
    text(fit(settings.upiId, size + 20), W / 2, y + size + 116, 'center', SLATE_500);
    y += size + 150 + 56;
  }

  // --- Thank you, in Hindi and English ---
  font(32, 700);
  text('कृपया जल्द से जल्द भुगतान करें। धन्यवाद!', W / 2, y, 'center');
  y += 46;
  font(26, 500);
  text('Kindly pay at the earliest. Thank you!', W / 2, y, 'center', SLATE_500);
  y += 40;

  // --- Footer ---
  y += 30;
  ctx.fillStyle = AMBER;
  ctx.fillRect(PAD, y, W - PAD * 2, 4);
  y += 48;
  font(22, 500);
  text(`${shopName}${settings.phone ? `  •  ${settings.phone}` : ''}`, W / 2, y, 'center', SLATE_500);
  y += 56;

  // Crop to what was drawn.
  const out = document.createElement('canvas');
  out.width = W;
  out.height = Math.ceil(y);
  out.getContext('2d')!.drawImage(draft, 0, 0);
  return out;
}

/** "Akshay-Traders-Reminder-Aaditya-Maching-ITI.png" */
export function reminderFileName(reminder: DueReminder): string {
  const name = reminder.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'Customer';
  return `Akshay-Traders-Reminder-${name}.png`;
}

export async function reminderImageFile(reminder: DueReminder, settings: ShopSettings, today: string): Promise<File> {
  const canvas = await drawReminderCanvas(reminder, settings, today);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The reminder picture could not be made.');
  return new File([blob], reminderFileName(reminder), { type: 'image/png' });
}
