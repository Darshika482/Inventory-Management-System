import { describe, expect, it } from 'vitest';
import { encodeReceipt, rasterBytes, testPageLines } from './escpos';
import { charsPerLine, layoutReceipt, receiptMoney, receiptToTextRows, upiLink } from './receipt';
import type { ShopInvoice, ShopSettings } from '../types';

const settings: ShopSettings = {
  shopName: 'Akshay Traders',
  address: 'Main Bazaar, Jabalpur',
  phone: '9876543210',
  gstin: '23AAAAA0000A1Z5',
  stateCode: '23',
  upiId: 'akshaytraders@upi',
  printerWidthMm: 58,
  ratesIncludeGst: true,
  receiptFooter: 'Dhanyavaad! Phir padhariye.',
  language: 'hi',
};

// The Phase 1 acceptance sale.
const bill: ShopInvoice = {
  id: 'x',
  clientId: 'c',
  billType: 'sale',
  series: 'A',
  billNumber: 'S-A/2026-27/0001',
  fy: '2026-27',
  billDate: '2026-10-01',
  partyId: null,
  partyName: '',
  partyGstin: '',
  isGst: true,
  isInterstate: false,
  ratesIncludeGst: true,
  paymentMode: 'upi',
  paidMode: null,
  itemsTotal: 83000,
  subtotal: 67857,
  discount: 4150,
  discountPercent: 500,
  cgst: 5498,
  sgst: 5495,
  igst: 0,
  roundOff: 50,
  total: 78900,
  paidAmount: 78900,
  status: 'active',
  notes: '',
  createdBy: null,
  createdAt: '2026-10-01T15:28:00Z',
  syncState: 'synced',
  lines: [
    { itemId: 'i1', itemName: 'Lux Soap 100g', hsn: '', unit: 'pcs', qty: 3000, rate: 4000, gstRate: 18, discountAmount: 600, taxableAmount: 9661, taxAmount: 1739, lineTotal: 11400 },
    { itemId: 'i2', itemName: 'Surf Excel 1kg', hsn: '3402', unit: 'pcs', qty: 2000, rate: 14000, gstRate: 18, discountAmount: 1400, taxableAmount: 22542, taxAmount: 4058, lineTotal: 26600 },
    { itemId: 'i3', itemName: 'Rin Bar 250g', hsn: '3401', unit: 'pcs', qty: 5000, rate: 2000, gstRate: 18, discountAmount: 500, taxableAmount: 8051, taxAmount: 1449, lineTotal: 9500 },
    { itemId: 'i4', itemName: 'Classmate Notebook', hsn: '4820', unit: 'pcs', qty: 4000, rate: 6000, gstRate: 12, discountAmount: 1200, taxableAmount: 20357, taxAmount: 2443, lineTotal: 22800 },
    { itemId: 'i5', itemName: 'Reynolds Pen', hsn: '9608', unit: 'pcs', qty: 10000, rate: 900, gstRate: 18, discountAmount: 450, taxableAmount: 7246, taxAmount: 1304, lineTotal: 8550 },
  ],
};

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

describe('receipt layout', () => {
  for (const width of [58, 80] as const) {
    it(`fits ${width}mm paper and matches the snapshot`, () => {
      const lines = layoutReceipt(bill, { ...settings, printerWidthMm: width }, { hindi: false, showUpiQr: true, widthMm: width });
      const rows = receiptToTextRows(lines, charsPerLine(width));
      for (const row of rows) expect(row.length).toBeLessThanOrEqual(charsPerLine(width));
      expect(rows.join('\n')).toMatchSnapshot();
    });

    it(`encodes ESC/POS bytes for ${width}mm (snapshot)`, () => {
      const lines = layoutReceipt(bill, { ...settings, printerWidthMm: width }, { hindi: false, showUpiQr: true, widthMm: width });
      const bytes = encodeReceipt(lines, { widthMm: width, cutter: true, nativeQr: true });
      expect(Array.from(bytes.slice(0, 2))).toEqual([0x1b, 0x40]); // ESC @
      expect(toHex(bytes)).toContain('1d286b'); // native QR command
      expect(Array.from(bytes.slice(-4))).toEqual([0x1d, 0x56, 0x42, 0x00]); // cut
      expect(toHex(bytes)).toMatchSnapshot();
    });
  }

  it('shows the amounts from the bill', () => {
    const rows = receiptToTextRows(layoutReceipt(bill, settings, { hindi: false, showUpiQr: false }), 32).join('\n');
    expect(rows).toContain('Tax Invoice');
    expect(rows).toContain('Bill No: 0001');
    expect(rows).toContain('Cash Sale');
    expect(rows).toContain('Date: 01/10/2026');
    expect(rows).toMatch(/# Name\s+Qty\s+Price\s+Amount/);
    expect(rows).toMatch(/1 Lux Soap\s+3\s+40\s+120/);
    expect(rows).toMatch(/Total\s+:\s+789/);
    expect(rows).toContain('CGST 9%');
    expect(rows).toContain('CGST 6%');
    expect(rows).toContain('Discount 5%');
    expect(rows).not.toContain('Rs ');
    expect(rows).not.toContain('[QR]');
  });

  it('prints a UPI QR for the amount still due', () => {
    const credit = { ...bill, paymentMode: 'partial' as const, paidMode: 'cash' as const, paidAmount: 50000 };
    const lines = layoutReceipt(credit, settings, { hindi: false, showUpiQr: true });
    const qr = lines.find((l) => l.kind === 'qr');
    expect(qr && qr.kind === 'qr' && qr.data).toBe(upiLink('akshaytraders@upi', 'Akshay Traders', 28900));
    expect(receiptToTextRows(lines, 32).join('\n')).toMatch(/Balance\s+:\s+289/);
  });

  it('uses Hindi names when asked', () => {
    const lines = layoutReceipt(bill, settings, { hindi: true, hindiNames: { i1: 'लक्स साबुन' }, showUpiQr: false });
    expect(lines.some((l) => l.kind === 'text' && l.text.includes('लक्स'))).toBe(true);
  });

  it('can send the QR as an image instead', () => {
    const lines = layoutReceipt({ ...bill, paidAmount: 0, paymentMode: 'credit' }, settings, { hindi: false, showUpiQr: true });
    const hex = toHex(encodeReceipt(lines, { widthMm: 58, cutter: false, nativeQr: false }));
    expect(hex).not.toContain('1d286b');
    expect(hex).toContain('1d7630'); // GS v 0 raster
  });

  it('formats money without the rupee sign', () => {
    expect(receiptMoney(123456)).toBe('Rs 1,234.56');
    expect(receiptMoney(-50)).toBe('-Rs 0.50');
  });

  it('packs image rows into bytes', () => {
    expect(rasterBytes([[true, false, false, false, false, false, false, true, true]])).toEqual([
      0x1d, 0x76, 0x30, 0x00, 2, 0, 1, 0, 0b10000001, 0b10000000,
    ]);
  });

  it('builds a test page for both widths', () => {
    for (const width of [58, 80] as const) {
      const rows = receiptToTextRows(testPageLines('Akshay Traders', width, 'a@upi'), charsPerLine(width));
      expect(rows.some((r) => r.length === charsPerLine(width))).toBe(true);
    }
  });
});

describe('UPI QR on every sale bill', () => {
  it('shows a plain "Pay by UPI" QR on a paid cash bill', () => {
    const cash = { ...bill, paymentMode: 'cash' as const };
    const qr = layoutReceipt(cash, settings, { hindi: false, showUpiQr: true }).find((l) => l.kind === 'qr');
    expect(qr && qr.kind === 'qr' && qr.data).toBe('upi://pay?pa=akshaytraders%40upi&pn=Akshay+Traders&cu=INR');
    expect(qr && qr.kind === 'qr' && qr.caption).toBe('Scan this QR code to pay');
  });

  it('leaves the QR off a cancelled bill', () => {
    const lines = layoutReceipt({ ...bill, status: 'cancelled' }, settings, { hindi: false, showUpiQr: true });
    expect(lines.some((l) => l.kind === 'qr')).toBe(false);
  });
});

describe('Vyapar-style printout', () => {
  it('puts the chosen name on top and keeps every row inside the paper', () => {
    for (const width of [58, 80] as const) {
      const lines = layoutReceipt(bill, settings, { hindi: false, showUpiQr: true, widthMm: width, billName: 'Fall Wholesale' });
      const rows = receiptToTextRows(lines, charsPerLine(width));
      expect(rows[0].trim()).toBe('Fall Wholesale');
      for (const row of rows) expect(row.length).toBeLessThanOrEqual(charsPerLine(width));
    }
  });

  it('wraps a long item name onto the next row, under the name column', () => {
    const long = { ...bill, lines: [{ ...bill.lines[0], itemName: 'Cotton Aster Premium Quality Long Name' }] };
    const rows = receiptToTextRows(layoutReceipt(long, settings, { hindi: false, showUpiQr: false }), 32);
    const first = rows.findIndex((r) => r.startsWith('1 '));
    expect(rows[first]).toMatch(/120$/);
    expect(rows[first + 1].startsWith('  ')).toBe(true);
  });
});

it('never cuts digits off a big amount', () => {
  const big = { ...bill, lines: [{ ...bill.lines[1], qty: 1000_000, rate: 1234550 }] };
  const rows = receiptToTextRows(layoutReceipt(big, settings, { hindi: false, showUpiQr: false }), 32);
  const row = rows.find((r) => r.startsWith('1 '))!;
  expect(row).toContain('12345.50');
  expect(row).toContain('12345500');
  expect(row.length).toBeLessThanOrEqual(32);
});
