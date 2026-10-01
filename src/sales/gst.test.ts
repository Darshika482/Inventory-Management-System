import { describe, expect, it } from 'vitest';
import { allocateProportionally, computeBill, roundToRupee, type BillInput } from './gst';

const rs = (rupees: number) => Math.round(rupees * 100); // test-only shorthand, inputs are exact
const qty = (units: number) => Math.round(units * 1000);

const base: Omit<BillInput, 'lines'> = {
  isGst: true,
  isInterstate: false,
  ratesIncludeGst: true,
  discount: null,
};

describe('computeBill', () => {
  it('takes GST out of a rate that includes it', () => {
    const bill = computeBill({ ...base, lines: [{ qty: qty(1), rate: rs(118), gstRate: 18 }] });
    expect(bill.subtotal).toBe(10000);
    expect(bill.cgst).toBe(900);
    expect(bill.sgst).toBe(900);
    expect(bill.igst).toBe(0);
    expect(bill.total).toBe(11800);
    expect(bill.roundOff).toBe(0);
  });

  it('adds GST on top of a rate that excludes it', () => {
    const bill = computeBill({
      ...base,
      ratesIncludeGst: false,
      lines: [{ qty: qty(2), rate: rs(50), gstRate: 12 }],
    });
    expect(bill.itemsTotal).toBe(10000);
    expect(bill.subtotal).toBe(10000);
    expect(bill.tax).toBe(1200);
    expect(bill.cgst).toBe(600);
    expect(bill.sgst).toBe(600);
    expect(bill.total).toBe(11200);
  });

  it('handles mixed GST rates on one bill', () => {
    const bill = computeBill({
      ...base,
      lines: [
        { qty: qty(1), rate: rs(105), gstRate: 5 },
        { qty: qty(2), rate: rs(59), gstRate: 18 },
        { qty: qty(1), rate: rs(10), gstRate: 0 },
      ],
    });
    expect(bill.lines.map((l) => [l.taxable, l.tax])).toEqual([
      [10000, 500],
      [10000, 1800],
      [1000, 0],
    ]);
    expect(bill.subtotal).toBe(21000);
    expect(bill.cgst).toBe(1150);
    expect(bill.sgst).toBe(1150);
    expect(bill.total).toBe(23300);
    expect(bill.taxByRate).toEqual([
      { gstRate: 0, taxable: 1000, cgst: 0, sgst: 0, igst: 0 },
      { gstRate: 5, taxable: 10000, cgst: 250, sgst: 250, igst: 0 },
      { gstRate: 18, taxable: 10000, cgst: 900, sgst: 900, igst: 0 },
    ]);
  });

  it('puts all tax in IGST for an inter-state bill', () => {
    const bill = computeBill({
      ...base,
      isInterstate: true,
      ratesIncludeGst: false,
      lines: [{ qty: qty(1), rate: rs(100), gstRate: 28 }],
    });
    expect(bill.igst).toBe(2800);
    expect(bill.cgst).toBe(0);
    expect(bill.sgst).toBe(0);
    expect(bill.total).toBe(12800);
  });

  it('ignores item GST rates on a non-GST bill', () => {
    const bill = computeBill({
      ...base,
      isGst: false,
      lines: [{ qty: qty(3), rate: rs(33.33), gstRate: 18 }],
    });
    expect(bill.tax).toBe(0);
    expect(bill.subtotal).toBe(9999);
    expect(bill.lines[0].gstRate).toBe(0);
    expect(bill.total).toBe(10000);
    expect(bill.roundOff).toBe(1);
  });

  it('shares an amount discount across lines so it adds up exactly', () => {
    const bill = computeBill({
      ...base,
      isGst: false,
      discount: { kind: 'amount', amount: rs(100) },
      lines: [
        { qty: qty(1), rate: rs(100), gstRate: 0 },
        { qty: qty(1), rate: rs(200), gstRate: 0 },
        { qty: qty(1), rate: rs(300), gstRate: 0 },
      ],
    });
    expect(bill.lines.map((l) => l.discount)).toEqual([1667, 3333, 5000]);
    expect(bill.discount).toBe(10000);
    expect(bill.subtotal).toBe(50000);
    expect(bill.total).toBe(50000);
  });

  it('takes a percent discount before GST', () => {
    const bill = computeBill({
      ...base,
      ratesIncludeGst: false,
      discount: { kind: 'percent', basisPoints: 1000 },
      lines: [{ qty: qty(1), rate: rs(200), gstRate: 18 }],
    });
    expect(bill.discount).toBe(2000);
    expect(bill.subtotal).toBe(18000);
    expect(bill.tax).toBe(3240);
    expect(bill.total).toBe(21200); // 212.40 rounds down
    expect(bill.roundOff).toBe(-40);
  });

  it('never lets the discount go above the items total', () => {
    const bill = computeBill({
      ...base,
      discount: { kind: 'amount', amount: rs(999) },
      lines: [{ qty: qty(1), rate: rs(10), gstRate: 18 }],
    });
    expect(bill.discount).toBe(1000);
    expect(bill.total).toBe(0);
  });

  it('rounds the total down below 50 paise', () => {
    const bill = computeBill({ ...base, isGst: false, lines: [{ qty: qty(1), rate: rs(100.49), gstRate: 0 }] });
    expect(bill.total).toBe(10000);
    expect(bill.roundOff).toBe(-49);
  });

  it('rounds the total up from 50 paise', () => {
    const bill = computeBill({ ...base, isGst: false, lines: [{ qty: qty(1), rate: rs(100.5), gstRate: 0 }] });
    expect(bill.total).toBe(10100);
    expect(bill.roundOff).toBe(50);
  });

  it('gives the odd paisa of tax to CGST', () => {
    const bill = computeBill({
      ...base,
      ratesIncludeGst: false,
      lines: [{ qty: qty(1), rate: rs(1.3), gstRate: 5 }],
    });
    expect(bill.tax).toBe(7); // 6.5 paise rounds up
    expect(bill.cgst).toBe(4);
    expect(bill.sgst).toBe(3);
  });

  it('works with part quantities', () => {
    const bill = computeBill({ ...base, isGst: false, lines: [{ qty: qty(1.5), rate: rs(40), gstRate: 0 }] });
    expect(bill.itemsTotal).toBe(6000);
  });

  it('returns zeros for an empty bill', () => {
    const bill = computeBill({ ...base, lines: [] });
    expect(bill.total).toBe(0);
    expect(bill.lines).toEqual([]);
  });

  // The Phase 1 acceptance sale, worked out by hand in the Phase 1 report.
  it('matches the hand calculation for the acceptance sale', () => {
    const bill = computeBill({
      ...base,
      discount: { kind: 'percent', basisPoints: 500 },
      lines: [
        { qty: qty(3), rate: rs(40), gstRate: 18 }, // Lux Soap
        { qty: qty(2), rate: rs(140), gstRate: 18 }, // Surf Excel
        { qty: qty(5), rate: rs(20), gstRate: 18 }, // Rin Bar
        { qty: qty(4), rate: rs(60), gstRate: 12 }, // Classmate Notebook
        { qty: qty(10), rate: rs(9), gstRate: 18 }, // Reynolds Pen, edited from ₹10
      ],
    });
    expect(bill.itemsTotal).toBe(83000);
    expect(bill.discount).toBe(4150);
    expect(bill.lines.map((l) => l.discount)).toEqual([600, 1400, 500, 1200, 450]);
    expect(bill.lines.map((l) => l.taxable)).toEqual([9661, 22542, 8051, 20357, 7246]);
    expect(bill.lines.map((l) => l.tax)).toEqual([1739, 4058, 1449, 2443, 1304]);
    expect(bill.subtotal).toBe(67857);
    expect(bill.cgst).toBe(5498);
    expect(bill.sgst).toBe(5495);
    expect(bill.beforeRoundOff).toBe(78850);
    expect(bill.roundOff).toBe(50);
    expect(bill.total).toBe(78900);
  });
});

describe('allocateProportionally', () => {
  it('always adds up to the amount', () => {
    const weights = [333, 333, 334, 1, 0];
    const shares = allocateProportionally(1000, weights);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(shares[4]).toBe(0);
  });
});

describe('roundToRupee', () => {
  it('rounds half up', () => {
    expect(roundToRupee(149)).toBe(100);
    expect(roundToRupee(150)).toBe(200);
    expect(roundToRupee(0)).toBe(0);
  });
});
