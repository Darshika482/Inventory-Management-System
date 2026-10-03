/**
 * Draws a receipt onto a canvas and turns it into black/white dots, so text
 * the printer cannot print itself (Hindi) still comes out. Browser only.
 */
import { dotsPerLine } from './escpos';
import { qrMatrix } from './qr';
import type { ReceiptLine } from './receipt';

const FONT = '"Noto Sans Devanagari", "Plus Jakarta Sans", system-ui, sans-serif';

export function renderReceiptPixels(lines: ReceiptLine[], widthMm: 58 | 80): boolean[][] {
  const width = dotsPerLine(widthMm);
  const base = widthMm === 80 ? 24 : 20; // font size in dots
  const pad = 4;

  // Generous height first; trimmed to what was drawn.
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 6000;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This phone cannot draw the bill as an image.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';

  let y = pad;
  const setFont = (size: number, isBold: boolean) => {
    ctx.font = `${isBold ? 700 : 500} ${size}px ${FONT}`;
  };
  const wrap = (text: string, maxWidth: number): string[] => {
    const words = text.split(/\s+/).filter(Boolean);
    const rows: string[] = [];
    let current = '';
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (ctx.measureText(next).width > maxWidth && current) {
        rows.push(current);
        current = word;
      } else current = next;
    }
    rows.push(current);
    return rows;
  };

  for (const line of lines) {
    if (line.kind === 'feed') {
      y += base * line.lines;
      continue;
    }
    if (line.kind === 'rule') {
      for (let x = pad; x < width - pad; x += 8) ctx.fillRect(x, y + base / 2, 5, 2);
      y += base;
      continue;
    }
    if (line.kind === 'qr') {
      const matrix = qrMatrix(line.data);
      const scale = Math.floor(Math.min(width * 0.6, 260) / matrix.length);
      const size = matrix.length * scale;
      const left = Math.floor((width - size) / 2);
      matrix.forEach((row, r) =>
        row.forEach((dark, c) => {
          if (dark) ctx.fillRect(left + c * scale, y + r * scale, scale, scale);
        })
      );
      y += size + 6;
      setFont(base - 4, false);
      for (const row of wrap(line.caption, width - pad * 2)) {
        ctx.fillText(row, (width - ctx.measureText(row).width) / 2, y);
        y += base;
      }
      continue;
    }

    const size = line.big ? Math.round(base * 1.6) : base;
    const lineHeight = Math.round(size * 1.35);
    setFont(size, Boolean(line.bold));

    if (line.kind === 'pair') {
      const rightWidth = ctx.measureText(line.right).width;
      const rows = wrap(line.left, width - pad * 2 - rightWidth - 8);
      rows.forEach((row, i) => {
        ctx.fillText(row, pad, y);
        if (i === rows.length - 1) ctx.fillText(line.right, width - pad - rightWidth, y);
        y += lineHeight;
      });
      continue;
    }

    if (line.mono) {
      // One character per column: size a monospace font so a full row fits the paper.
      const chars = widthMm === 80 ? 48 : 32;
      const monoSize = Math.floor((width - pad * 2) / (chars * 0.6));
      ctx.font = `${line.bold ? 700 : 500} ${monoSize}px "Courier New", ui-monospace, monospace`;
      ctx.fillText(line.text, pad, y);
      y += Math.round(monoSize * 1.35);
      continue;
    }

    for (const row of wrap(line.text, width - pad * 2)) {
      const w = ctx.measureText(row).width;
      const x = line.align === 'center' ? (width - w) / 2 : line.align === 'right' ? width - pad - w : pad;
      ctx.fillText(row, x, y);
      y += lineHeight;
    }
  }

  const height = Math.min(canvas.height, Math.ceil(y + pad));
  const data = ctx.getImageData(0, 0, width, height).data;
  const pixels: boolean[][] = [];
  for (let row = 0; row < height; row++) {
    const out = new Array<boolean>(width);
    for (let x = 0; x < width; x++) {
      const i = (row * width + x) * 4;
      // Dark enough counts as black (text edges are grey).
      out[x] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114 < 150;
    }
    pixels.push(out);
  }
  return pixels;
}
