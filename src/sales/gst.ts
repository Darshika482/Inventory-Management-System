/**
 * The one place bill totals are worked out. The New Sale screen, the saved
 * bill, and (from Phase 2) the PDF and the printer all use computeBill(), so
 * the numbers can never disagree.
 *
 * All money is in whole paise and quantities in thousandths (see money.ts).
 *
 * How a bill is worked out:
 * 1. Line gross = qty × rate.
 * 2. A bill discount (an amount, or a % of the items total) is shared across
 *    the lines in proportion to each line's gross. Leftover paise go to the
 *    lines with the largest remainders, so the shares add up exactly. The
 *    discount lowers the taxable value, as GST requires.
 * 3. Line net = gross − its discount share.
 * 4. Rates include GST: taxable = net ÷ (1 + rate/100), tax = net − taxable.
 *    Rates exclude GST: taxable = net, tax = taxable × rate/100.
 *    Non-GST bill: taxable = net, tax = 0 (the item GST rate is ignored).
 * 5. Same state (or walk-in): CGST = half the tax (the odd paisa goes to
 *    CGST), SGST = the rest. Other state: all of it is IGST.
 * 6. Total = taxable + tax, rounded to the nearest rupee (50 paise rounds up);
 *    the difference is the round-off.
 */

import { mulDivFloor, mulDivRound, type Milli, type Paise } from './money';

export const GST_RATES = [0, 5, 12, 18, 28] as const;
export type GstRate = (typeof GST_RATES)[number];

export interface BillLineInput {
  qty: Milli;
  rate: Paise;
  /** Whole percent: 0, 5, 12, 18 or 28. */
  gstRate: number;
}

export type BillDiscount =
  | { kind: 'amount'; amount: Paise }
  /** Percent in hundredths: 5% = 500, 2.5% = 250. */
  | { kind: 'percent'; basisPoints: number };

export interface BillInput {
  lines: BillLineInput[];
  isGst: boolean;
  isInterstate: boolean;
  ratesIncludeGst: boolean;
  discount?: BillDiscount | null;
}

export interface BillLineResult {
  gross: Paise;
  discount: Paise;
  taxable: Paise;
  tax: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  /** taxable + tax */
  lineTotal: Paise;
  /** The rate actually applied (0 on a non-GST bill). */
  gstRate: number;
}

export interface TaxByRate {
  gstRate: number;
  taxable: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
}

export interface BillResult {
  lines: BillLineResult[];
  /** Sum of qty × rate, before discount. */
  itemsTotal: Paise;
  discount: Paise;
  /** Taxable value after discount (stored as `subtotal`). */
  subtotal: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  tax: Paise;
  /** subtotal + tax, before rounding. */
  beforeRoundOff: Paise;
  roundOff: Paise;
  total: Paise;
  taxByRate: TaxByRate[];
}

/** Shares `amount` across `weights` in proportion, adding up exactly. */
export function allocateProportionally(amount: Paise, weights: Paise[]): Paise[] {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (amount === 0 || totalWeight === 0) return weights.map(() => 0);

  const shares = weights.map((w) => mulDivFloor(amount, w, totalWeight));
  let left = amount - shares.reduce((sum, s) => sum + s, 0);

  // Largest remainder first; ties go to the earlier line so the result is stable.
  const order = weights
    .map((w, index) => ({ index, remainder: Number((BigInt(amount) * BigInt(w)) % BigInt(totalWeight)) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  for (const { index } of order) {
    if (left <= 0) break;
    if (weights[index] === 0) continue;
    shares[index] += 1;
    left -= 1;
  }
  return shares;
}

/** Nearest whole rupee; 50 paise and above rounds up. */
export function roundToRupee(paise: Paise): Paise {
  return mulDivRound(paise, 1, 100) * 100;
}

export function discountAmount(itemsTotal: Paise, discount?: BillDiscount | null): Paise {
  if (!discount) return 0;
  const raw =
    discount.kind === 'amount'
      ? discount.amount
      : mulDivRound(itemsTotal, discount.basisPoints, 10_000);
  return Math.min(Math.max(raw, 0), itemsTotal);
}

export function computeBill(input: BillInput): BillResult {
  const { isGst, isInterstate, ratesIncludeGst } = input;

  const grosses = input.lines.map((line) => mulDivRound(line.qty, line.rate, 1000));
  const itemsTotal = grosses.reduce((sum, g) => sum + g, 0);
  const discount = discountAmount(itemsTotal, input.discount);
  const shares = allocateProportionally(discount, grosses);

  const lines: BillLineResult[] = input.lines.map((line, i) => {
    const gross = grosses[i];
    const net = gross - shares[i];
    const gstRate = isGst ? line.gstRate : 0;

    let taxable = net;
    let tax = 0;
    if (gstRate > 0) {
      if (ratesIncludeGst) {
        taxable = mulDivRound(net, 100, 100 + gstRate);
        tax = net - taxable;
      } else {
        tax = mulDivRound(net, gstRate, 100);
      }
    }

    const igst = isInterstate ? tax : 0;
    const sgst = isInterstate ? 0 : Math.floor(tax / 2);
    const cgst = isInterstate ? 0 : tax - sgst;

    return { gross, discount: shares[i], taxable, tax, cgst, sgst, igst, lineTotal: taxable + tax, gstRate };
  });

  const sum = (pick: (l: BillLineResult) => number) => lines.reduce((s, l) => s + pick(l), 0);
  const subtotal = sum((l) => l.taxable);
  const cgst = sum((l) => l.cgst);
  const sgst = sum((l) => l.sgst);
  const igst = sum((l) => l.igst);
  const tax = cgst + sgst + igst;
  const beforeRoundOff = subtotal + tax;
  const total = roundToRupee(beforeRoundOff);

  const byRate = new Map<number, TaxByRate>();
  for (const l of lines) {
    const entry = byRate.get(l.gstRate) ?? { gstRate: l.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    entry.taxable += l.taxable;
    entry.cgst += l.cgst;
    entry.sgst += l.sgst;
    entry.igst += l.igst;
    byRate.set(l.gstRate, entry);
  }

  return {
    lines,
    itemsTotal,
    discount,
    subtotal,
    cgst,
    sgst,
    igst,
    tax,
    beforeRoundOff,
    roundOff: total - beforeRoundOff,
    total,
    taxByRate: Array.from(byRate.values()).sort((a, b) => a.gstRate - b.gstRate),
  };
}
