/**
 * Sharing a bill from the phone. Uses the phone's own share menu (WhatsApp,
 * Gmail, Telegram, ...) when it can take files; otherwise saves the file so it
 * can be attached by hand. Only the file is sent: no message goes with it.
 */
import type { ShopInvoice, ShopSettings } from '../types';
import { uploadSharedBill } from '../db';
import { billImageFile, billPdfFile } from './billImage';

export type ShareFormat = 'image' | 'pdf';
export type ShareOutcome = 'shared' | 'saved' | 'cancelled';

export function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function makeBillFile(bill: ShopInvoice, settings: ShopSettings, format: ShareFormat): Promise<File> {
  return format === 'pdf' ? billPdfFile(bill, settings) : billImageFile(bill, settings);
}

/** Opens the share menu with only the bill file (no text), or saves it when sharing files is not possible. */
export async function shareBillFile(bill: ShopInvoice, settings: ShopSettings, format: ShareFormat): Promise<ShareOutcome> {
  return shareFile(await makeBillFile(bill, settings, format));
}

/** Opens the share menu with only this file (no text), or saves it when sharing files is not possible. */
export async function shareFile(file: File): Promise<ShareOutcome> {
  const data: ShareData = { files: [file] };
  if (typeof navigator.share === 'function' && navigator.canShare?.(data)) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return 'cancelled';
    }
  }
  downloadFile(file);
  return 'saved';
}

export async function saveBillFile(bill: ShopInvoice, settings: ShopSettings, format: ShareFormat): Promise<void> {
  downloadFile(await makeBillFile(bill, settings, format));
}

/** Bill files already online this session, so opening the share sheet again does not upload again. */
const billLinks = new Map<string, Promise<string>>();

/**
 * A link to the bill file, for the WhatsApp helper app to download. A bill
 * that changed since (a payment received, cancelled) gets a fresh file.
 */
export function billFileLink(bill: ShopInvoice, settings: ShopSettings, format: ShareFormat): Promise<string> {
  const key = [format, bill.clientId, bill.total, bill.paidAmount, bill.status].join('|');
  let link = billLinks.get(key);
  if (!link) {
    link = makeBillFile(bill, settings, format).then(uploadSharedBill);
    billLinks.set(key, link);
    // A failed upload (no internet) is tried again next time.
    link.catch(() => billLinks.delete(key));
  }
  return link;
}
