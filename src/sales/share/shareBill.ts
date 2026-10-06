/**
 * Sharing a bill from the phone. Uses the phone's own share menu (WhatsApp,
 * Gmail, Telegram, ...) when it can take files; otherwise saves the file so it
 * can be attached by hand.
 */
import type { ShopInvoice, ShopSettings } from '../types';
import { uploadSharedBill } from '../db';
import { billImageFile, billPdfFile, billShareText } from './billImage';

export type ShareFormat = 'image' | 'pdf';
export type ShareOutcome = 'shared' | 'saved' | 'cancelled';

function download(file: File) {
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

/** Opens the share menu with the bill file, or saves it when sharing files is not possible. */
export async function shareBillFile(bill: ShopInvoice, settings: ShopSettings, format: ShareFormat): Promise<ShareOutcome> {
  const file = await makeBillFile(bill, settings, format);
  const data: ShareData = { files: [file], title: file.name, text: billShareText(bill, settings) };
  if (typeof navigator.share === 'function' && navigator.canShare?.(data)) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return 'cancelled';
      // Some apps refuse the text with a file; try the file alone.
      try {
        await navigator.share({ files: [file] });
        return 'shared';
      } catch (again) {
        if ((again as { name?: string })?.name === 'AbortError') return 'cancelled';
      }
    }
  }
  download(file);
  return 'saved';
}

export async function saveBillFile(bill: ShopInvoice, settings: ShopSettings, format: ShareFormat): Promise<void> {
  download(await makeBillFile(bill, settings, format));
}

/** Bill pictures already online this session, so opening the share sheet again does not upload again. */
const billLinks = new Map<string, Promise<string>>();

/**
 * A link to the bill picture, for the WhatsApp message. A bill that changed
 * since (a payment received, cancelled) gets a fresh picture.
 */
export function billLink(bill: ShopInvoice, settings: ShopSettings): Promise<string> {
  const key = [bill.clientId, bill.total, bill.paidAmount, bill.status].join('|');
  let link = billLinks.get(key);
  if (!link) {
    link = billImageFile(bill, settings).then(uploadSharedBill);
    billLinks.set(key, link);
    // A failed upload (no internet) is tried again next time.
    link.catch(() => billLinks.delete(key));
  }
  return link;
}
