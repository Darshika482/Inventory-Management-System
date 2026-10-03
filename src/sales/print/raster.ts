/**
 * Draws a receipt onto a canvas and turns it into black/white dots, so text
 * the printer cannot print itself (Hindi, the Roboto Mono font) still comes
 * out. Browser only.
 */
import { dotsPerLine } from './escpos';
import { qrMatrix } from './qr';
import { charsPerLine, type ReceiptLine, type SideItem } from './receipt';

const SANS = '"Noto Sans Devanagari", "Plus Jakarta Sans", system-ui, sans-serif';
/** Bill letters; Hindi names fall back to the Devanagari font. */
const ROBOTO_MONO = '"Roboto Mono", "Noto Sans Devanagari", ui-monospace, monospace';

/**
 * Waits (briefly) for Roboto Mono to arrive, so the canvas does not draw the
 * bill in the phone's own font. Prints anyway if it never comes (offline).
 */
export async function loadBillFont(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2000));
  const load = Promise.all([document.fonts.load('500 20px "Roboto Mono"'), document.fonts.load('700 20px "Roboto Mono"')]).then(
    () => undefined,
    () => undefined
  );
  await Promise.race([load, timeout]);
}

/** Grey text edges count as black when darker than this. */
const INK = 150;

function toDots(ctx: CanvasRenderingContext2D, width: number, height: number): boolean[][] {
  const data = ctx.getImageData(0, 0, width, height).data;
  const pixels: boolean[][] = [];
  for (let row = 0; row < height; row++) {
    const out = new Array<boolean>(width);
    for (let x = 0; x < width; x++) {
      const i = (row * width + x) * 4;
      out[x] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114 < INK;
    }
    pixels.push(out);
  }
  return pixels;
}

/**
 * Received / Balance drawn for beside the QR: the label small, the amount in
 * bold at the printer's normal letter height, centred top to bottom in
 * `height` dots. Only as wide as the text.
 */
export function renderSideText(side: SideItem[], maxWidth: number, height: number, robotoMono = false): boolean[][] {
  const labelSize = 18;
  const valueSize = 24;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This phone cannot draw the bill as an image.');
  const family = robotoMono ? ROBOTO_MONO : SANS;
  const labelFont = `${robotoMono ? 500 : 600} ${labelSize}px ${family}`;
  const valueWeight = (strong?: boolean) => (robotoMono ? (strong ? 700 : 500) : strong ? 800 : 700);
  const valueFont = (strong?: boolean) => `${valueWeight(strong)} ${valueSize}px ${family}`;

  let width = 0;
  for (const item of side) {
    ctx.font = labelFont;
    width = Math.max(width, ctx.measureText(item.label).width);
    ctx.font = valueFont(item.strong);
    width = Math.max(width, ctx.measureText(item.value).width);
  }
  width = Math.min(maxWidth, Math.ceil(width) + 4);

  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';

  const itemHeight = labelSize + 4 + valueSize;
  const gap = 12;
  let y = Math.max(0, Math.floor((height - (side.length * itemHeight + (side.length - 1) * gap)) / 2));
  for (const item of side) {
    ctx.font = labelFont;
    ctx.fillText(item.label, 0, y);
    ctx.font = valueFont(item.strong);
    ctx.fillText(item.value, 0, y + labelSize + 4);
    y += itemHeight + gap;
  }
  return toDots(ctx, canvas.width, canvas.height);
}

export function renderReceiptPixels(lines: ReceiptLine[], widthMm: 58 | 80, robotoMono = false): boolean[][] {
  const width = dotsPerLine(widthMm);
  const pad = 4;
  const family = robotoMono ? ROBOTO_MONO : SANS;
  // Roboto Mono uses the full paper width like the printer's own fonts
  // (12 or 9 dots per letter), so the layout's columns land the same.
  const edge = robotoMono ? 0 : pad;

  // Generous height first; trimmed to what was drawn.
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 6000;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This phone cannot draw the bill as an image.');

  /** Letter size whose full row of `chars` letters fits the paper. */
  const gridSize = (chars: number, fontFamily: string) => {
    let size = width / chars / 0.6; // Roboto Mono letters are 0.6 of their size wide
    // Phones may round each letter's width up to a whole dot; shrink until the row fits.
    for (let i = 0; i < 4; i++) {
      ctx.font = `700 ${size}px ${fontFamily}`;
      const rowWidth = ctx.measureText('0'.repeat(chars)).width;
      if (rowWidth <= width) break;
      size *= (width / rowWidth) * 0.99;
    }
    return Math.floor(size * 10) / 10;
  };
  const base = robotoMono ? gridSize(charsPerLine(widthMm), ROBOTO_MONO) : widthMm === 80 ? 24 : 20; // font size in dots
  const smallSize = robotoMono ? gridSize(charsPerLine(widthMm, true), ROBOTO_MONO) : Math.round(base * 0.8);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';

  let y = pad;
  const setFont = (size: number, isBold: boolean) => {
    ctx.font = `${isBold ? 700 : 500} ${size}px ${family}`;
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
    if (line.kind === 'gap') {
      y += line.dots;
      continue;
    }
    if (line.kind === 'rule') {
      for (let x = edge; x < width - edge; x += 8) ctx.fillRect(x, y + base / 2, 5, 2);
      y += base;
      continue;
    }
    if (line.kind === 'qr') {
      const matrix = qrMatrix(line.data);
      // Roboto Mono bills: the same small QR (4 dots a square) as the normal printout.
      const scale = robotoMono ? 4 : Math.floor(Math.min(width * 0.6, 260) / matrix.length);
      const size = matrix.length * scale;
      const side = line.side ?? [];
      // With Received/Balance beside it, the QR moves left to make room.
      const left = side.length ? pad + 8 : Math.floor((width - size) / 2);
      matrix.forEach((row, r) =>
        row.forEach((dark, c) => {
          if (dark) ctx.fillRect(left + c * scale, y + r * scale, scale, scale);
        })
      );
      if (side.length) {
        const text = renderSideText(side, width - left - size - 16 - pad, size, robotoMono);
        text.forEach((row, ty) =>
          row.forEach((dark, tx) => {
            if (dark) ctx.fillRect(left + size + 16 + tx, y + ty, 1, 1);
          })
        );
      }
      y += size + 6;
      setFont(base - 4, false);
      for (const row of line.caption ? wrap(line.caption, width - pad * 2) : []) {
        ctx.fillText(row, (width - ctx.measureText(row).width) / 2, y);
        y += base;
      }
      continue;
    }

    // The picture has no double-width letters: a wide line is drawn bigger instead.
    const size = line.big
      ? Math.round(base * 1.6)
      : line.kind === 'text' && line.wide
        ? Math.round(base * 1.5)
        : line.kind === 'text' && line.tall
          ? Math.round(base * 1.3)
          : line.small
            ? smallSize
            : base;
    const lineHeight = Math.round(size * 1.35);
    setFont(size, Boolean(line.bold));

    if (line.kind === 'pair') {
      const rightWidth = ctx.measureText(line.right).width;
      const rows = wrap(line.left, width - edge * 2 - rightWidth - 8);
      rows.forEach((row, i) => {
        ctx.fillText(row, edge, y);
        if (i === rows.length - 1) ctx.fillText(line.right, width - edge - rightWidth, y);
        y += lineHeight;
      });
      continue;
    }

    if (line.mono) {
      // One character per column: size a monospace font so a full row fits the paper.
      const chars = charsPerLine(widthMm, line.small);
      const monoFamily = robotoMono ? ROBOTO_MONO : '"Courier New", ui-monospace, monospace';
      const monoSize = robotoMono ? (line.small ? smallSize : base) : gridSize(chars, monoFamily);
      ctx.font = `${line.bold ? 700 : 500} ${monoSize}px ${monoFamily}`;
      if (/^[ -~]*$/.test(line.text)) {
        // Each letter in its own column, so the numbers line up exactly.
        const cell = width / chars;
        [...line.text].forEach((ch, i) => {
          if (ch !== ' ') ctx.fillText(ch, i * cell, y);
        });
      } else ctx.fillText(line.text, 0, y); // Hindi letters join up: drawn as one piece
      y += Math.round(monoSize * 1.35);
      continue;
    }

    for (const row of wrap(line.text, width - edge * 2)) {
      const w = ctx.measureText(row).width;
      const x = line.align === 'center' ? (width - w) / 2 : line.align === 'right' ? width - edge - w : edge;
      ctx.fillText(row, x, y);
      y += lineHeight;
    }
  }

  const height = Math.min(canvas.height, Math.ceil(y + pad));
  return toDots(ctx, width, height);
}
