/**
 * Sharing a bill from the phone. Uses the phone's own share menu (WhatsApp,
 * Gmail, Telegram, ...) when it can take files; otherwise saves the file so it
 * can be attached by hand. Only the file is sent: no message goes with it.
 */
import type { ShopInvoice, ShopSettings } from '../types';
import { billImageFile, billPdfFile } from './billImage';

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

/** Opens the share menu with only the bill file (no text), or saves it when sharing files is not possible. */
export async function shareBillFile(bill: ShopInvoice, settings: ShopSettings, format: ShareFormat): Promise<ShareOutcome> {
  const file = await makeBillFile(bill, settings, format);
  const data: ShareData = { files: [file] };
  if (typeof navigator.share === 'function' && navigator.canShare?.(data)) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return 'cancelled';
    }
  }
  download(file);
  return 'saved';
}

export async function saveBillFile(bill: ShopInvoice, settings: ShopSettings, format: ShareFormat): Promise<void> {
  download(await makeBillFile(bill, settings, format));
}
