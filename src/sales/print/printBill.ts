/** Builds a bill's printout with this phone's printer choices and sends it. */
import { readCache } from '../cache';
import type { ShopInvoice, ShopItem, ShopSettings } from '../types';
import { encodeImageReceipt, encodeReceipt, testPageLines } from './escpos';
import { getPrinterPrefs, printBytes, type PrintResult } from './printer';
import { renderReceiptPixels } from './raster';
import { layoutReceipt, type ReceiptLine } from './receipt';

/** item id -> Hindi name, from the items kept on this phone. */
function hindiNames(): Record<string, string> {
  const items = readCache<ShopItem[]>('items') ?? [];
  return Object.fromEntries(items.filter((i) => i.nameHi.trim()).map((i) => [i.id, i.nameHi]));
}

export function receiptLinesFor(bill: ShopInvoice, settings: ShopSettings): ReceiptLine[] {
  const prefs = getPrinterPrefs();
  return layoutReceipt(bill, settings, {
    hindi: prefs.hindi,
    hindiNames: prefs.hindi ? hindiNames() : undefined,
    showUpiQr: prefs.showUpiQr,
    widthMm: settings.printerWidthMm,
    billName: prefs.billName,
    billSubtitle: prefs.billSubtitle,
  });
}

function encode(lines: ReceiptLine[], widthMm: 58 | 80): Uint8Array {
  const prefs = getPrinterPrefs();
  const options = { widthMm, cutter: prefs.cutter, nativeQr: prefs.nativeQr };
  return prefs.hindi ? encodeImageReceipt(renderReceiptPixels(lines, widthMm), options) : encodeReceipt(lines, options);
}

export async function printBill(bill: ShopInvoice, settings: ShopSettings): Promise<PrintResult> {
  try {
    return await printBytes(encode(receiptLinesFor(bill, settings), settings.printerWidthMm));
  } catch (err) {
    return { ok: false, reason: 'failed', detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function printTestPage(settings: ShopSettings): Promise<PrintResult> {
  try {
    const lines = testPageLines(settings.shopName, settings.printerWidthMm, settings.upiId);
    return await printBytes(encode(lines, settings.printerWidthMm));
  } catch (err) {
    return { ok: false, reason: 'failed', detail: err instanceof Error ? err.message : String(err) };
  }
}
