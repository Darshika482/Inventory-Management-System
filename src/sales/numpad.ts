/**
 * What each key of the shop's own number keypad does to the typed text.
 * Kept apart from the screen so it can be tested.
 */

export type PadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '00' | '.' | 'back' | 'clear';

/** Enough for ₹9,99,99,999 or 99,999,999 pieces. */
const MAX_WHOLE_DIGITS = 8;

/**
 * The text after pressing `key`.
 * `replace`: the old value is still highlighted, so a digit or point starts a
 * new number (like typing over selected text). Back still edits the old value.
 * `decimals`: digits allowed after the point (3 for quantity, 2 for rupees).
 */
export function applyPadKey(value: string, key: PadKey, decimals: number, replace = false): string {
  if (key === 'clear') return '';
  if (key === 'back') return value.slice(0, -1);

  const base = replace ? '' : value;
  const point = base.indexOf('.');

  if (key === '.') {
    if (decimals === 0 || point !== -1) return base;
    return `${base || '0'}.`;
  }

  if (point !== -1) {
    const room = decimals - (base.length - point - 1);
    return room > 0 ? base + key.slice(0, room) : base;
  }

  // No leading zeros: "0" then "5" is "5", and "00" on nothing is "0".
  const whole = `${base}${key}`.replace(/^0+(?=\d)/, '');
  return whole.length > MAX_WHOLE_DIGITS ? base : whole;
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
