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
