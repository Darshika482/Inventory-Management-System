/**
 * What each key of the shop's own number keypad does to the typed text.
 * Kept apart from the screen so it can be tested.
 */

export type PadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '00' | '.' | 'back' | 'clear';

/** Enough for ₹9,99,99,999 or 99,999,999 pieces. */
const MAX_WHOLE_DIGITS = 8;

/** A typed value and where the cursor sits in it (0 = before the first character). */
export interface PadEdit {
  value: string;
  cursor: number;
}

/** No leading zeros in the whole part ("05" -> "5"); the cursor moves left with the dropped zeros. */
function dropLeadingZeros({ value, cursor }: PadEdit): PadEdit {
  const trimmed = value.replace(/^0+(?=\d)/, '');
  const dropped = value.length - trimmed.length;
  return { value: trimmed, cursor: Math.max(0, cursor - dropped) };
}

/**
 * The text after pressing `key` with the cursor at `cursor`: digits and the
 * point go in at the cursor, back removes the character before it.
 * `decimals`: digits allowed after the point (3 for quantity, 2 for rupees).
 * A key that cannot go in (a second point, too many digits) changes nothing.
 */
export function applyPadKeyAt(value: string, cursor: number, key: PadKey, decimals: number): PadEdit {
  const at = Math.min(Math.max(cursor, 0), value.length);
  const unchanged = { value, cursor: at };
  if (key === 'clear') return { value: '', cursor: 0 };
  if (key === 'back') {
    if (at === 0) return unchanged;
    return dropLeadingZeros({ value: value.slice(0, at - 1) + value.slice(at), cursor: at - 1 });
  }

  const before = value.slice(0, at);
  const after = value.slice(at);
  const point = value.indexOf('.');

  if (key === '.') {
    // One point only, and no more decimals after it than allowed.
    if (decimals === 0 || point !== -1 || after.length > decimals) return unchanged;
    const whole = before || '0';
    return { value: `${whole}.${after}`, cursor: whole.length + 1 };
  }

  if (point !== -1 && at > point) {
    // After the point: only as many digits as there is room for.
    const room = decimals - (value.length - point - 1);
    if (room <= 0) return unchanged;
    const typed = key.slice(0, room);
    return { value: before + typed + after, cursor: at + typed.length };
  }

  const next = dropLeadingZeros({ value: before + key + after, cursor: at + key.length });
  const wholeDigits = next.value.indexOf('.') === -1 ? next.value.length : next.value.indexOf('.');
  return wholeDigits > MAX_WHOLE_DIGITS ? unchanged : next;
}

/** The text after pressing `key` with the cursor at the end. */
export function applyPadKey(value: string, key: PadKey, decimals: number): string {
  return applyPadKeyAt(value, value.length, key, decimals).value;
}

/**
 * The characters of `groupDigits(value)` with, for each, its place in `value`
 * (null for the grouping commas), so a tap on the shown number can put the cursor there.
 */
export function groupedChars(value: string): { char: string; index: number | null }[] {
  const shown = groupDigits(value);
  let index = 0;
  return [...shown].map((char) => (char === ',' && value[index] !== ',' ? { char, index: null } : { char, index: index++ }));
}

/** "125000.5" -> "1,25,000.5", for showing big and easy to read. */
export function groupDigits(value: string): string {
  const point = value.indexOf('.');
  const whole = point === -1 ? value : value.slice(0, point);
  const rest = point === -1 ? '' : value.slice(point);
  if (!/^\d+$/.test(whole)) return value;
  // Indian grouping: last three digits, then pairs.
  const last3 = whole.slice(-3);
  const head = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${head ? `${head},` : ''}${last3}${rest}`;
}

/** A box left empty (or just ".") has no number in it. */
export function isBlank(value: string): boolean {
  return value.replace('.', '') === '';
}

/** "5." -> "5": a point with nothing after it is dropped when the box is left. */
export function tidyValue(value: string): string {
  return value.endsWith('.') ? value.slice(0, -1) : value;
}
