/**
 * Money and quantity helpers for the shop sales module.
 *
 * No floating point ever touches a total: money lives in whole paise and
 * quantities in whole thousandths ("milli"), both as plain integers. Products
 * that could pass 2^53 go through BigInt.
 */

/** ₹1 = 100 paise. */
export type Paise = number;
/** 1 unit = 1000 milli, so 1.5 kg = 1500. */
export type Milli = number;

/** a × b ÷ c, rounded half up. All three must be whole numbers, c > 0. */
export function mulDivRound(a: number, b: number, c: number): number {
  const num = BigInt(a) * BigInt(b);
  const den = BigInt(c);
  const negative = num < 0n !== den < 0n;
  const absNum = num < 0n ? -num : num;
  const absDen = den < 0n ? -den : den;
  const q = (absNum * 2n + absDen) / (absDen * 2n);
  return Number(negative ? -q : q);
}

/** a × b ÷ c, rounded down (towards zero for positive numbers). */
export function mulDivFloor(a: number, b: number, c: number): number {
  return Number((BigInt(a) * BigInt(b)) / BigInt(c));
}

/**
 * Reads a typed decimal like "40", "40.5" or "1,250.75" into whole units of
 * 1/10^places. Returns null for anything that is not a plain number or has
 * more decimal places than allowed.
 */
function parseScaled(input: string, places: number): number | null {
  const text = input.replace(/[,\s₹]/g, '');
  if (!text) return null;
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) return null;
  const [, sign, whole = '', frac = ''] = match;
  if (!whole && !frac) return null;
  if (frac.length > places) return null;
  const scaled = Number(whole || '0') * 10 ** places + Number(frac.padEnd(places, '0') || '0');
  if (!Number.isSafeInteger(scaled)) return null;
  return sign ? -scaled : scaled;
}

/** "40.50" -> 4050. Null when it is not a valid amount. */
export function parsePaise(input: string): Paise | null {
  return parseScaled(input, 2);
}

/** "1.5" -> 1500. Null when it is not a valid quantity. */
export function parseMilli(input: string): Milli | null {
  return parseScaled(input, 3);
}

/**
 * Reads a numeric value that came back from the database (Postgres numeric
 * arrives as a JS number or a string) without float maths.
 */
export function decimalToScaled(value: number | string | null | undefined, places: number): number {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = parseScaled(String(value), places);
  if (parsed !== null) return parsed;
  // A value with more places than expected: round the decimal string itself.
  const n = parseScaled(Number(value).toFixed(places), places);
  return n ?? 0;
}

export const dbToPaise = (value: number | string | null | undefined): Paise => decimalToScaled(value, 2);
export const dbToMilli = (value: number | string | null | undefined): Milli => decimalToScaled(value, 3);

function scaledToString(value: number, places: number, trimZeros: boolean): string {
  const negative = value < 0;
  const abs = Math.abs(value);
  const unit = 10 ** places;
  const whole = Math.floor(abs / unit);
  let frac = String(abs % unit).padStart(places, '0');
  if (trimZeros) frac = frac.replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** 4050 -> "40.50", for sending to the database. */
export function paiseToDecimal(paise: Paise): string {
  return scaledToString(paise, 2, false);
}

/** 4050 -> "40.5", 4000 -> "40", for editable inputs. */
export function paiseToInput(paise: Paise): string {
  return scaledToString(paise, 2, true);
}

/** 1500 -> "1.500", for sending to the database. */
export function milliToDecimal(milli: Milli): string {
  return scaledToString(milli, 3, false);
}

/** 1500 -> "1.5", 2000 -> "2". */
export function formatQty(milli: Milli): string {
  return scaledToString(milli, 3, true);
}

/**
 * 123456 -> "₹1,234.56"; whole rupees drop the paise: 4000 -> "₹40".
 * Pass `alwaysPaise` to keep ".00" (bill lines and totals).
 */
export function formatRupees(paise: Paise, alwaysPaise = false): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100).toLocaleString('en-IN');
  const rest = abs % 100;
  const fraction = rest === 0 && !alwaysPaise ? '' : `.${String(rest).padStart(2, '0')}`;
  return `${negative ? '−' : ''}₹${rupees}${fraction}`;
}
