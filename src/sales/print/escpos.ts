/**
 * ESC/POS byte builder for 58mm and 80mm thermal printers.
 * Pure (no browser APIs) so it is snapshot tested.
 */
import { charsPerLine, pairToRows, wrapText, type ReceiptLine } from './receipt';
import { qrMatrix } from './qr';

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export interface EscPosOptions {
  widthMm: 58 | 80;
  /** Cut the paper at the end (only printers with a cutter). */
  cutter: boolean;
  /** true: printer draws the QR (GS ( k). false: send the QR as an image. */
  nativeQr: boolean;
}

/** Printable dots across the paper. */
export function dotsPerLine(widthMm: 58 | 80): number {
  return widthMm === 80 ? 576 : 384;
}

class Bytes {
  private parts: number[] = [];
  push(...values: number[]) {
    this.parts.push(...values);
    return this;
  }
  text(value: string) {
    // Printer code pages are single-byte; anything outside ASCII becomes '?'.
    for (const ch of value) {
      const code = ch.codePointAt(0) ?? 63;
      this.parts.push(code >= 32 && code < 127 ? code : 63);
    }
    return this;
  }
  line(value = '') {
    return this.text(value).push(LF);
  }
  done(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

const init = () => [ESC, 0x40];
const align = (a: 'left' | 'center' | 'right') => [ESC, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0];
const bold = (on: boolean) => [ESC, 0x45, on ? 1 : 0];
/** Double width and height when on. */
const big = (on: boolean) => [GS, 0x21, on ? 0x11 : 0x00];
const feed = (n: number) => [ESC, 0x64, Math.max(0, Math.min(255, n))];
const cut = () => [GS, 0x56, 0x42, 0x00];

/** Native QR: model 2, module size, error level M, store, print. */
function nativeQr(data: string, moduleSize: number): number[] {
  const bytes = Array.from(new TextEncoder().encode(data));
  const len = bytes.length + 3;
  return [
    GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00, // model 2
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, moduleSize, // module size
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31, // error correction M
    GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30, ...bytes, // store
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30, // print
  ];
}

/**
 * A 1-bit image as GS v 0. `pixels[y][x]` is true for black.
 * Width is padded to whole bytes.
 */
export function rasterBytes(pixels: boolean[][]): number[] {
  const height = pixels.length;
  const width = height ? pixels[0].length : 0;
  const bytesPerRow = Math.ceil(width / 8);
  const out: number[] = [GS, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff];
  for (let y = 0; y < height; y++) {
    for (let b = 0; b < bytesPerRow; b++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = b * 8 + bit;
        if (x < width && pixels[y][x]) byte |= 0x80 >> bit;
      }
      out.push(byte);
    }
  }
  return out;
}

/** QR code as an image, `scale` dots per module, centred on the paper. */
export function qrRaster(data: string, widthMm: 58 | 80, scale = 6): number[] {
  const matrix = qrMatrix(data);
  const size = matrix.length;
  const quiet = 2;
  const dots = (size + quiet * 2) * scale;
  const total = dotsPerLine(widthMm);
  const left = Math.max(0, Math.floor((total - dots) / 2));
  const pixels: boolean[][] = [];
  for (let y = 0; y < dots; y++) {
    const row = new Array<boolean>(total).fill(false);
    const my = Math.floor(y / scale) - quiet;
    for (let x = 0; x < dots; x++) {
      const mx = Math.floor(x / scale) - quiet;
      if (my >= 0 && my < size && mx >= 0 && mx < size && matrix[my][mx]) row[left + x] = true;
    }
    pixels.push(row);
  }
  return rasterBytes(pixels);
}

/** The whole receipt as ESC/POS bytes, in text mode. */
export function encodeReceipt(lines: ReceiptLine[], options: EscPosOptions): Uint8Array {
  const width = charsPerLine(options.widthMm);
  const out = new Bytes().push(...init());

  for (const line of lines) {
    switch (line.kind) {
      case 'rule':
        out.push(...align('left')).line('-'.repeat(width));
        break;
      case 'feed':
        out.push(...feed(line.lines));
        break;
      case 'text': {
        const w = line.big ? Math.floor(width / 2) : width;
        out.push(...align(line.align ?? 'left'), ...bold(Boolean(line.bold)), ...big(Boolean(line.big)));
        if (line.mono) out.line(line.text.slice(0, width));
        else for (const row of wrapText(line.text, w)) out.line(row);
        out.push(...bold(false), ...big(false));
        break;
      }
      case 'pair': {
        const w = line.big ? Math.floor(width / 2) : width;
        out.push(...align('left'), ...bold(Boolean(line.bold)), ...big(Boolean(line.big)));
        for (const row of pairToRows(line.left, line.right, w)) out.line(row);
        out.push(...bold(false), ...big(false));
        break;
      }
      case 'qr':
        out.push(...align('center'));
        if (options.nativeQr) out.push(...nativeQr(line.data, options.widthMm === 80 ? 7 : 6), LF);
        else out.push(...qrRaster(line.data, options.widthMm), LF);
        for (const row of wrapText(line.caption, width)) out.line(row);
        out.push(...align('left'));
        break;
    }
  }

  if (options.cutter) out.push(...feed(2), ...cut());
  return out.done();
}

/** A full receipt drawn as one image (used for Hindi text), followed by feed and cut. */
export function encodeImageReceipt(pixels: boolean[][], options: EscPosOptions): Uint8Array {
  // Send in bands so cheap printers with small buffers keep up.
  const band = 255;
  const out = new Bytes().push(...init(), ...align('left'));
  for (let y = 0; y < pixels.length; y += band) out.push(...rasterBytes(pixels.slice(y, y + band)));
  out.push(...feed(3));
  if (options.cutter) out.push(...cut());
  return out.done();
}

/** Short test page: shop name, width check and a QR. */
export function testPageLines(shopName: string, widthMm: 58 | 80, upiId: string): ReceiptLine[] {
  const width = charsPerLine(widthMm);
  const lines: ReceiptLine[] = [
    { kind: 'text', text: shopName, align: 'center', bold: true, big: true },
    { kind: 'text', text: 'Printer test', align: 'center' },
    { kind: 'rule' },
    { kind: 'text', text: `${widthMm} mm paper, ${width} letters per line` },
    { kind: 'text', text: '1234567890'.repeat(Math.ceil(width / 10)).slice(0, width) },
    { kind: 'pair', left: 'Left', right: 'Right' },
    { kind: 'pair', left: 'TOTAL', right: 'Rs 789.00', bold: true, big: true },
  ];
  if (upiId) lines.push({ kind: 'qr', data: `upi://pay?pa=${encodeURIComponent(upiId)}&cu=INR`, caption: upiId });
  lines.push({ kind: 'text', text: 'If this looks right, printing works.', align: 'center' }, { kind: 'feed', lines: 3 });
  return lines;
}
