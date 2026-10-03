/**
 * ESC/POS byte builder for 58mm and 80mm thermal printers.
 * Pure (no browser APIs) so it is snapshot tested.
 */
import { charsPerLine, pairToRows, printedUpiLink, wrapText, type ReceiptLine } from './receipt';
import { qrMatrix } from './qr';

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/**
 * How the QR is printed:
 * - blocks: drawn with the printer's own block letters, sent as plain text (works on any printer)
 * - picture: a GS v 0 image (garbles on printers that cannot keep up)
 * - native: the printer draws it itself (GS ( k; many cheap printers print this as text)
 */
export type QrStyle = 'blocks' | 'picture' | 'native';

export interface EscPosOptions {
  widthMm: 58 | 80;
  /** Cut the paper at the end (only printers with a cutter). */
  cutter: boolean;
  qrStyle: QrStyle;
  /** Small font (9x17 dots) in bold: more per line and still easy to read. */
  smallFont?: boolean;
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
/** ESC M: font A (12x24 dots) or the small font B (9x17 dots). */
const font = (small: boolean) => [ESC, 0x4d, small ? 1 : 0];
/** Line spacing in dots (ESC 3), or the printer's default (ESC 2). */
const spacing = (dots?: number) => (dots ? [ESC, 0x33, dots] : [ESC, 0x32]);
/** Double height only: makes a line stand out without taking more width. */
const tall = (on: boolean) => [GS, 0x21, on ? 0x01 : 0x00];
/** Rows of the small font sit 3 dots apart: compact but not touching. */
const SMALL_LINE = 20;
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
  // Small bands: if the Bluetooth link drops a byte, only one thin strip is
  // spoiled instead of the printer reading the rest of the picture as text.
  const band = 24;
  if (pixels.length > band) {
    const out: number[] = [];
    for (let y = 0; y < pixels.length; y += band) out.push(...rasterBand(pixels.slice(y, y + band)));
    return out;
  }
  return rasterBand(pixels);
}

function rasterBand(pixels: boolean[][]): number[] {
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
export function qrRaster(data: string, widthMm: 58 | 80, scale = 4): number[] {
  const matrix = qrMatrix(data);
  const size = matrix.length;
  const quiet = 1;
  const dots = Math.min((size + quiet * 2) * scale, dotsPerLine(widthMm));
  // Just the QR, centred by the printer (ESC a 1): about 2 KB, far less than
  // the printer holds, so it cannot overflow and turn into letters.
  const left = 0;
  const rowWidth = dots;
  const pixels: boolean[][] = [];
  for (let y = 0; y < dots; y++) {
    const row = new Array<boolean>(rowWidth).fill(false);
    const my = Math.floor(y / scale) - quiet;
    for (let x = 0; x < dots; x++) {
      const mx = Math.floor(x / scale) - quiet;
      if (my >= 0 && my < size && mx >= 0 && mx < size && matrix[my][mx]) row[left + x] = true;
    }
    pixels.push(row);
  }
  return rasterBytes(pixels);
}

/**
 * QR drawn with block letters from code page 437 (full, upper-half and
 * lower-half blocks), two QR rows per text line. It is plain text, which the
 * shop printer prints perfectly, so it works where pictures turn into strange
 * letters. On 58mm paper the small font (9x17 dots, 42 per line) is used so a
 * payment QR fits; a half block is then about 9x8.5 dots, close to square.
 * null when the QR is too big for the paper.
 */
export function blockQr(data: string, widthMm: 58 | 80): number[] | null {
  const small = widthMm === 58;
  const cols = small ? 42 : 48;
  const lineHeight = small ? 17 : 24;
  let matrix = qrMatrix(data, 'M');
  if (matrix.length + 2 > cols) matrix = qrMatrix(data, 'L');
  const size = matrix.length;
  if (size > cols) return null;
  // One white square around it is enough: centring and the blank lines above
  // and below leave more white paper around the QR anyway.
  const quiet = Math.min(1, Math.floor((cols - size) / 2));
  const total = size + quiet * 2;
  const dark = (r: number, c: number) => {
    const y = r - quiet;
    const x = c - quiet;
    return y >= 0 && y < size && x >= 0 && x < size && matrix[y][x];
  };

  // Code page 437, small font on 58mm, and line spacing equal to the letter
  // height so the rows touch with no white gaps.
  const out = [ESC, 0x74, 0, ...(small ? [ESC, 0x4d, 1] : []), ESC, 0x33, lineHeight, ...align('center')];
  for (let r = 0; r < total; r += 2) {
    for (let c = 0; c < total; c++) {
      const top = dark(r, c);
      const bottom = r + 1 < total && dark(r + 1, c);
      out.push(top && bottom ? 0xdb : top ? 0xdf : bottom ? 0xdc : 0x20);
    }
    out.push(LF);
  }
  // Back to normal spacing and font.
  out.push(ESC, 0x32, ...(small ? [ESC, 0x4d, 0] : []));
  return out;
}

/** The whole receipt as ESC/POS bytes, in text mode. */
export function encodeReceipt(lines: ReceiptLine[], options: EscPosOptions): Uint8Array {
  const small = Boolean(options.smallFont);
  const width = charsPerLine(options.widthMm, small);
  // Big lines (the shop name) always use the normal font, doubled.
  const bigWidth = Math.floor(charsPerLine(options.widthMm) / 2);
  const out = new Bytes().push(...init());
  // Small font in bold: thin small letters fade on thermal paper, bold ones stay clear.
  const body = () => (small ? [...font(true), ...bold(true), ...spacing(SMALL_LINE)] : []);
  out.push(...body());

  /** Starts a line: big lines in the normal font; in small mode bold lines are made taller. */
  const start = (line: { bold?: boolean; big?: boolean }) => {
    if (line.big) return [...font(false), ...spacing(), ...bold(Boolean(line.bold)), ...big(true)];
    if (small) return [...bold(true), ...tall(Boolean(line.bold))];
    return [...bold(Boolean(line.bold)), ...big(false)];
  };
  const end = (line: { big?: boolean }) => (line.big ? [...big(false), ...body(), ...bold(small)] : [...tall(false), ...bold(small)]);

  for (const line of lines) {
    switch (line.kind) {
      case 'rule':
        out.push(...align('left')).line('-'.repeat(width));
        break;
      case 'feed':
        out.push(...feed(line.lines));
        break;
      case 'text': {
        const w = line.big ? bigWidth : width;
        out.push(...align(line.align ?? 'left'), ...start(line));
        if (line.mono) out.line(line.text.slice(0, width));
        else for (const row of wrapText(line.text, w)) out.line(row);
        out.push(...end(line));
        break;
      }
      case 'pair': {
        const w = line.big ? bigWidth : width;
        out.push(...align('left'), ...start(line));
        for (const row of pairToRows(line.left, line.right, w)) out.line(row);
        out.push(...end(line));
        break;
      }
      case 'qr':
        out.push(...align('center'));
        if (options.qrStyle === 'native') out.push(...nativeQr(line.data, options.widthMm === 80 ? 7 : 6), LF);
        else if (options.qrStyle === 'picture') out.push(...qrRaster(line.data, options.widthMm), LF);
        else {
          const blocks = blockQr(line.data, options.widthMm);
          if (!blocks) {
            // Too long to draw: print the UPI ID so the customer can type it in.
            out.line(`UPI: ${new URLSearchParams(line.data.split('?')[1] ?? '').get('pa') ?? ''}`);
            out.push(...align('left'));
            break;
          }
          // The block QR sets its own font and spacing; put the bill's back.
          out.push(...blocks, ...body(), ...align('center'));
        }
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
  const out = new Bytes().push(...init(), ...align('left'), ...rasterBytes(pixels));
  out.push(...feed(3));
  if (options.cutter) out.push(...cut());
  return out.done();
}

/** Short test page: shop name, width check and a QR. */
export function testPageLines(shopName: string, widthMm: 58 | 80, upiId: string, smallFont = false): ReceiptLine[] {
  const width = charsPerLine(widthMm, smallFont);
  const lines: ReceiptLine[] = [
    { kind: 'text', text: shopName, align: 'center', bold: true, big: true },
    { kind: 'text', text: 'Printer test', align: 'center' },
    { kind: 'rule' },
    { kind: 'text', text: `${widthMm} mm paper, ${width} letters per line` },
    { kind: 'text', text: '1234567890'.repeat(Math.ceil(width / 10)).slice(0, width) },
    { kind: 'pair', left: 'Left', right: 'Right' },
    { kind: 'pair', left: 'TOTAL', right: 'Rs 789.00', bold: true, big: true },
  ];
  lines.push({ kind: 'text', text: 'If this looks right, printing works.', align: 'center' });
  // Last, like on a bill.
  if (upiId) lines.push({ kind: 'feed', lines: 1 }, { kind: 'qr', data: printedUpiLink(upiId, ''), caption: upiId });
  lines.push({ kind: 'feed', lines: 3 });
  return lines;
}
