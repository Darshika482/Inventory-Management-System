/** Builds a bill's printout with this phone's printer choices and sends it. */
import { readCache } from '../cache';
import type { ShopInvoice, ShopItem, ShopSettings } from '../types';
import { encodeImageReceipt, encodeReceipt, testPageLines } from './escpos';
import { getPrinterPrefs, printBytes, type PrintResult } from './printer';
import { loadBillFont, renderReceiptPixels, renderSideText } from './raster';
import { layoutReceipt, type ReceiptLine } from './receipt';

// Fetch the bill font now, so the first print does not wait for it.
if (getPrinterPrefs().billFont === 'roboto-mono') void loadBillFont();

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

async function encode(lines: ReceiptLine[], widthMm: 58 | 80): Promise<Uint8Array> {
  const prefs = getPrinterPrefs();
  const options = {
    widthMm,
    cutter: prefs.cutter,
    qrStyle: prefs.qrStyle,
    renderSide: renderSideText,
  };
  // The printer only has its own two fonts: Hindi and Roboto Mono go as a picture.
  const robotoMono = prefs.billFont === 'roboto-mono';
  if (!prefs.hindi && !robotoMono) return encodeReceipt(lines, options);
  if (robotoMono) await loadBillFont();
  return encodeImageReceipt(renderReceiptPixels(lines, widthMm, robotoMono), options);
}

export async function printBill(bill: ShopInvoice, settings: ShopSettings): Promise<PrintResult> {
  try {
    return await printBytes(await encode(receiptLinesFor(bill, settings), settings.printerWidthMm));
  } catch (err) {
    return { ok: false, reason: 'failed', detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function printTestPage(settings: ShopSettings): Promise<PrintResult> {
  try {
    const lines = testPageLines(settings.shopName, settings.printerWidthMm, settings.upiId);
    return await printBytes(await encode(lines, settings.printerWidthMm));
  } catch (err) {
    return { ok: false, reason: 'failed', detail: err instanceof Error ? err.message : String(err) };
  }
}
