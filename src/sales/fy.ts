/**
 * Dates and bill numbers for the shop. Bills are dated in India time, so a
 * bill made at 12:30 am is on the new day even though UTC is still behind.
 */

export type BillType = 'sale' | 'purchase' | 'quotation';

const IST_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's date in India as YYYY-MM-DD. */
export function istToday(now: Date = new Date()): string {
  return IST_DATE.format(now);
}

/** Financial year (1 April – 31 March) for a YYYY-MM-DD date: '2026-10-01' -> '2026-27'. */
export function fyFor(isoDate: string): string {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

const PREFIX: Record<BillType, string> = { sale: 'S', purchase: 'P', quotation: 'Q' };

/** formatBillNumber('sale', 'A', '2026-27', 1) -> 'S-A/2026-27/0001' */
export function formatBillNumber(type: BillType, series: string, fy: string, n: number): string {
  return `${PREFIX[type]}-${series}/${fy}/${String(n).padStart(4, '0')}`;
}

// --- Bill codes: how a bill number is shown and printed ---
//
// The stored number stays 'S-A/2026-27/0042' (in order, unique, used for
// saving and syncing). Customers see a 5-character code instead, four letters
// with one digit in the middle, e.g. 'KX4PM', that does not give away how
// many bills the shop has made. The code is a shuffle of the number, so two
// bills never share a code within a year and the app can turn it back.

/** No I or O: they look like 1 and 0 on paper. */
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
/** Base of each place, left to right: letter, letter, digit, letter, letter. */
const PLACES = [24, 24, 10, 24, 24];
const CODE_SPACE = 24 ** 4 * 10;
/** Shares no factor with CODE_SPACE (2, 3, 5), so multiplying by it can be undone. */
const MIX = 1_234_567;
/** Bills per series per year that fit in a code. */
const PER_SERIES = 100_000;

function toPlaces(value: number): number[] {
  const out: number[] = [];
  for (let i = PLACES.length - 1; i >= 0; i--) {
    out[i] = value % PLACES[i];
    value = Math.floor(value / PLACES[i]);
  }
  return out;
}

function fromPlaces(places: number[]): number {
  return places.reduce((value, digit, i) => value * PLACES[i] + digit, 0);
}

/** Reads the places backwards; PLACES is the same both ways, so this is its own undo. */
const flip = (value: number) => fromPlaces(toPlaces(value).reverse());
const mod = (value: number) => ((value % CODE_SPACE) + CODE_SPACE) % CODE_SPACE;

function inverseOf(a: number, m: number): number {
  let [oldR, r, oldS, s] = [a, m, 1, 0];
  while (r !== 0) {
    const q = Math.floor(oldR / r);
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  return ((oldS % m) + m) % m;
}
const UNMIX = inverseOf(MIX, CODE_SPACE);

/** Different shuffle each year and bill type, so codes do not repeat year to year. */
function saltFor(prefix: string, fy: string): number {
  return mod(Number(fy.slice(0, 4)) * 104_729 + prefix.charCodeAt(0) * 7_919);
}

const BILL_NUMBER = /^([SPQ])-([A-Z])\/(\d{4}-\d{2})\/(\d+)$/;

/** 'S-A/2026-27/0042' -> a code like 'KX4PM'; null if the number is not in that form. */
export function billCode(billNumber: string | null | undefined): string | null {
  const match = billNumber ? BILL_NUMBER.exec(billNumber) : null;
  if (!match) return null;
  const [, prefix, series, fy, n] = match;
  const count = Number(n);
  if (count >= PER_SERIES) return null;
  const salt = saltFor(prefix, fy);
  const value = (series.charCodeAt(0) - 65) * PER_SERIES + count;
  const mixed = mod(flip(mod(value * MIX + salt)) * MIX + salt * 7);
  return toPlaces(mixed)
    .map((digit, i) => (PLACES[i] === 10 ? String(digit) : CODE_LETTERS[digit]))
    .join('');
}

/** Back from a code to the bill number, for the given bill type and year. */
export function billNumberFromCode(code: string, type: BillType, fy: string): string | null {
  const clean = code.trim().toUpperCase();
  if (clean.length !== PLACES.length) return null;
  const places: number[] = [];
  for (let i = 0; i < PLACES.length; i++) {
    const digit = PLACES[i] === 10 ? '0123456789'.indexOf(clean[i]) : CODE_LETTERS.indexOf(clean[i]);
    if (digit < 0) return null;
    places.push(digit);
  }
  const salt = saltFor(PREFIX[type], fy);
  const value = mod(flip(mod((fromPlaces(places) - salt * 7) * UNMIX)) - salt) * UNMIX % CODE_SPACE;
  const series = Math.floor(value / PER_SERIES);
  if (series > 25) return null;
  return formatBillNumber(type, String.fromCharCode(65 + series), fy, value % PER_SERIES);
}

/** What to show for a bill number: its code, or the number itself if it has no code. */
export function billLabel(billNumber: string | null | undefined): string | null {
  return billCode(billNumber) ?? billNumber ?? null;
}

/** A bill's code with its version once edited: 'KB7PP', then 'KB7PP (v2)'. Null before it has a number. */
export function billTitle(bill: { billNumber: string | null; version?: number }): string | null {
  const label = billLabel(bill.billNumber);
  if (!label) return null;
  return (bill.version ?? 1) > 1 ? `${label} (v${bill.version})` : label;
}

/** The running number at the end of a bill number: 'S-A/2026-27/0042' -> 42. */
export function billSequence(billNumber: string): number | null {
  const match = /\/(\d+)$/.exec(billNumber);
  return match ? Number(match[1]) : null;
}

/** '2026-10-01' -> '1 Oct 2026' */
export function formatBillDate(isoDate: string): string {
  if (!isoDate) return '—';
  const date = new Date(`${isoDate}T00:00:00`);
  if (isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Time of day in India for a saved timestamp, e.g. '4:05 pm'. */
export function formatIstTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
}
