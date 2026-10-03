import { describe, expect, it } from 'vitest';
import { blockQr, encodeReceipt, rasterBytes, testPageLines } from './escpos';
import { charsPerLine, layoutReceipt, plainAmount, printedUpiLink, receiptMoney, receiptToTextRows, upiLink, type ReceiptLine } from './receipt';
import { qrMatrix } from './qr';
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

/** Every row fits its font's line: the normal font's, or the small font's (more letters). */
function expectInsidePaper(lines: ReceiptLine[], width: 58 | 80) {
  for (const line of lines) {
    // Rules are printed in small-font dashes.
    const max = charsPerLine(width, line.kind === 'rule' || ('small' in line && Boolean(line.small)));
    for (const row of receiptToTextRows([line], width)) expect(row.length).toBeLessThanOrEqual(max);
  }
}

describe('receipt layout', () => {
  for (const width of [58, 80] as const) {
    it(`fits ${width}mm paper and matches the snapshot`, () => {
      const lines = layoutReceipt(bill, { ...settings, printerWidthMm: width }, { hindi: false, showUpiQr: true, widthMm: width });
      expectInsidePaper(lines, width);
      expect(receiptToTextRows(lines, width).join('\n')).toMatchSnapshot();
    });

    it(`encodes ESC/POS bytes for ${width}mm (snapshot)`, () => {
      const lines = layoutReceipt(bill, { ...settings, printerWidthMm: width }, { hindi: false, showUpiQr: true, widthMm: width });
      const bytes = encodeReceipt(lines, { widthMm: width, cutter: true, qrStyle: 'native' });
      expect(Array.from(bytes.slice(0, 2))).toEqual([0x1b, 0x40]); // ESC @
      expect(toHex(bytes)).toContain('1d286b'); // native QR command
      expect(Array.from(bytes.slice(-4))).toEqual([0x1d, 0x56, 0x42, 0x00]); // cut
      expect(toHex(bytes)).toMatchSnapshot();
    });
  }

  it('shows the amounts from the bill', () => {
    const rows = receiptToTextRows(layoutReceipt(bill, settings, { hindi: false, showUpiQr: false }), 58).join('\n');
    expect(rows).toContain('Tax Invoice');
    expect(rows).toMatch(/Bill No: [A-HJ-NP-Z]{2}\d[A-HJ-NP-Z]{2}/);
    expect(rows).toContain('Cash Sale');
    expect(rows).toContain('Date: 01/10/2026');
    expect(rows).toMatch(/#\s+Name\s+Qty\s+Price\s+Amount/);
    expect(rows).toMatch(/1\s+Lux Soap 100g\s+3\s+40\s+120/);
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
    expect(qr && qr.kind === 'qr' && qr.data).toMatch(/^upi:\/\/pay\?pa=akshaytraders@upi&am=289(&pn=Akshay%20Traders)?$/);
    expect(qr && qr.kind === 'qr' && qr.side).toEqual([
      { label: 'Received', value: '500' },
      { label: 'Balance', value: '289', strong: true },
    ]);
  });

  it('uses Hindi names when asked', () => {
    const lines = layoutReceipt(bill, settings, { hindi: true, hindiNames: { i1: 'लक्स साबुन' }, showUpiQr: false });
    expect(lines.some((l) => l.kind === 'text' && l.text.includes('लक्स'))).toBe(true);
  });

  it('can send the QR as an image instead', () => {
    const lines = layoutReceipt({ ...bill, paidAmount: 0, paymentMode: 'credit' }, settings, { hindi: false, showUpiQr: true });
    const hex = toHex(encodeReceipt(lines, { widthMm: 58, cutter: false, qrStyle: 'picture' }));
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
      const rows = receiptToTextRows(testPageLines('Akshay Traders', width, 'a@upi'), width);
      expect(rows.some((r) => r.length === charsPerLine(width))).toBe(true);
      expect(rows.some((r) => r.length === charsPerLine(width, true))).toBe(true);
    }
  });
});

describe('UPI QR on every sale bill', () => {
  it('puts the bill total in the QR of a bill already marked received', () => {
    const cash = { ...bill, paymentMode: 'cash' as const };
    const qr = layoutReceipt(cash, settings, { hindi: false, showUpiQr: true }).find((l) => l.kind === 'qr');
    expect(qr && qr.kind === 'qr' && qr.data).toMatch(/^upi:\/\/pay\?pa=akshaytraders@upi&am=789(&pn=Akshay%20Traders)?$/);
  });

  it('prints no "Scan to pay" line under the QR', () => {
    const lines = layoutReceipt(bill, settings, { hindi: false, showUpiQr: true });
    const qr = lines.find((l) => l.kind === 'qr');
    expect(qr && qr.kind === 'qr' && qr.caption).toBeUndefined();
    const printed = new TextDecoder().decode(encodeReceipt(lines, { widthMm: 58, cutter: false, qrStyle: 'native' }));
    expect(printed).not.toContain('Scan');
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
      expect(receiptToTextRows(lines, width)[0].trim()).toBe('Fall Wholesale');
      expectInsidePaper(lines, width);
    }
  });

  it('wraps a long item name onto the next row, under the name column', () => {
    const long = { ...bill, lines: [{ ...bill.lines[0], itemName: 'Cotton Aster Premium Quality Long Name' }] };
    const rows = receiptToTextRows(layoutReceipt(long, settings, { hindi: false, showUpiQr: false }), 58);
    const first = rows.findIndex((r) => r.startsWith('1 '));
    expect(rows[first]).toMatch(/120$/);
    expect(rows[first + 1].startsWith('   ')).toBe(true);
  });
});

it('never cuts digits off a big amount', () => {
  const big = { ...bill, lines: [{ ...bill.lines[1], qty: 1000_000, rate: 1234550 }] };
  const rows = receiptToTextRows(layoutReceipt(big, settings, { hindi: false, showUpiQr: false }), 58);
  const row = rows.find((r) => r.startsWith('1 '))!;
  // Two spaces between Qty, Price and Amount even when they overflow their columns.
  expect(row).toMatch(/ 1000  12345\.5  12345500$/);
  expect(row.length).toBeLessThanOrEqual(charsPerLine(58, true));
});

it('prints amounts without a trailing zero, like Vyapar', () => {
  expect(plainAmount(1750)).toBe('17.5');
  expect(plainAmount(1825)).toBe('18.25');
  expect(plainAmount(1805)).toBe('18.05');
  expect(plainAmount(126000)).toBe('1260');
  expect(plainAmount(-4150)).toBe('-41.5');
});

describe('QR drawn with block letters', () => {
  const link = 'upi://pay?pa=9131297397%40ybl&pn=Surbhi+Fall&am=18.50&cu=INR';

  it('is plain text that fits the paper, two QR rows per line', () => {
    for (const width of [58, 80] as const) {
      const bytes = blockQr(link, width)!;
      const rows: number[][] = [[]];
      // Skip the set-up commands (they end with ESC a 1) and the reset after the last row.
      const body = bytes.slice(bytes.indexOf(0x61) + 2, bytes.lastIndexOf(0x0a) + 1);
      for (const b of body) b === 0x0a ? rows.push([]) : rows[rows.length - 1].push(b);
      rows.pop();
      const cols = width === 58 ? 42 : 48;
      for (const row of rows) {
        expect(row.length).toBeLessThanOrEqual(cols);
        for (const b of row) expect([0x20, 0xdb, 0xdf, 0xdc]).toContain(b);
      }
      expect(rows.length).toBe(Math.ceil(rows[0].length / 2));
    }
  });

  it('prints the UPI ID instead when the link is too long to draw', () => {
    const lines = [{ kind: 'qr' as const, data: `upi://pay?pa=shop%40upi&pn=${'x'.repeat(400)}`, caption: 'Scan' }];
    const text = new TextDecoder().decode(encodeReceipt(lines, { widthMm: 58, cutter: false, qrStyle: 'blocks' }));
    expect(text).toContain('UPI: shop@upi');
  });
});

describe('printed UPI QR is small', () => {
  it('needs fewer squares than the full link', () => {
    const full = qrMatrix(upiLink('9131297397@ybl', 'Surbhi Fall', 1850)).length;
    const short = qrMatrix(printedUpiLink('9131297397@ybl', 'Surbhi Fall', 1850)).length;
    expect(short).toBeLessThan(full);
    expect(short).toBeLessThanOrEqual(29);
  });
});

describe('Vyapar-like letters: wide shop name, small font everywhere else', () => {
  const lines = layoutReceipt(bill, settings, { hindi: false, showUpiQr: false, widthMm: 58 });
  const bytes = Array.from(encodeReceipt(lines, { widthMm: 58, cutter: false, qrStyle: 'picture' }));
  /** The last value set by `ESC <command>` before the given text is printed. */
  const settingBefore = (text: string, command: number) => {
    const at = new TextDecoder().decode(Uint8Array.from(bytes)).indexOf(text);
    let value: number | undefined;
    for (let i = 0; i < at; i++) if (bytes[i] === 0x1b && bytes[i + 1] === command) value = bytes[i + 2];
    return value;
  };
  /** The character size (`GS !`) in force when the given text is printed. */
  const sizeBefore = (text: string) => {
    const at = new TextDecoder().decode(Uint8Array.from(bytes)).indexOf(text);
    let value: number | undefined;
    for (let i = 0; i < at; i++) if (bytes[i] === 0x1d && bytes[i + 1] === 0x21) value = bytes[i + 2];
    return value;
  };

  it('fits 42 letters per line on 58mm, two spaces between the numbers', () => {
    const rows = receiptToTextRows(lines, 58);
    expect(charsPerLine(58, true)).toBe(42);
    const header = rows.find((r) => r.startsWith('#'))!;
    expect(header).toHaveLength(42);
    expect(header).toMatch(/Qty {3}Price {3}Amount$/);
    expect(rows.find((r) => r.startsWith('2 '))).toMatch(/ 2 {5}140 {6}280$/);
  });

  it('prints the shop name in the normal font at double width, not bold', () => {
    expect(settingBefore('Akshay Traders', 0x4d)).toBe(0); // ESC M 0: normal font
    expect(sizeBefore('Akshay Traders')).toBe(0x10); // GS ! 0x10: double width only
    expect(settingBefore('Akshay Traders', 0x45)).toBe(0); // ESC E 0: not bold
  });

  it('prints everything else in the small font, not bold, 32 dots a row', () => {
    for (const text of ['Ph.No.', 'Tax Invoice', 'Lux Soap', 'Total']) {
      expect(settingBefore(text, 0x4d)).toBe(1); // ESC M 1: small font
      expect(settingBefore(text, 0x45)).toBe(0); // ESC E 0: not bold
      expect(sizeBefore(text)).toBe(0); // normal size
      expect(settingBefore(text, 0x33)).toBe(32); // ESC 3 32: row spacing
    }
  });
});

describe('small picture QR', () => {
  it('stays around 2 KB so the printer can never overflow', () => {
    const lines = [{ kind: 'qr' as const, data: printedUpiLink('9131297397@ybl', 'Surbhi Fall', 1850), caption: 'Scan' }];
    const bytes = encodeReceipt(lines, { widthMm: 58, cutter: false, qrStyle: 'picture' });
    expect(bytes.length).toBeLessThan(2600);
  });
});

describe('Received and Balance beside the QR', () => {
  const side = [
    { label: 'Received', value: '30' },
    { label: 'Balance', value: '10', strong: true },
  ];
  const link = printedUpiLink('9131297397@ybl', 'Surbhi Fall', 1000);
  const text = (bytes: Uint8Array) => Array.from(bytes, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ' ')).join('');

  it('puts them on the block QR rows, with the QR on the left', () => {
    const bytes = encodeReceipt([{ kind: 'qr', data: link, caption: 'Scan', side }], { widthMm: 58, cutter: false, qrStyle: 'blocks' });
    const printed = text(bytes);
    expect(printed).toContain('  Received');
    expect(printed).toContain('  10');
    // Not printed again under the QR.
    expect(printed.match(/Received/g)).toHaveLength(1);
  });

  it('draws them into the QR picture when the phone can draw text', () => {
    const calls: number[] = [];
    const renderSide = (_: unknown, maxWidth: number, height: number) => {
      calls.push(maxWidth);
      return Array.from({ length: height }, () => new Array<boolean>(40).fill(true));
    };
    const bytes = encodeReceipt([{ kind: 'qr', data: link, caption: 'Scan', side }], {
      widthMm: 58,
      cutter: false,
      qrStyle: 'picture',
      renderSide,
    });
    expect(calls).toHaveLength(1);
    expect(text(bytes)).not.toContain('Received');
    expect(bytes.length).toBeLessThan(4000);
  });

  it('prints them under the QR when they cannot go beside it', () => {
    const bytes = encodeReceipt([{ kind: 'qr', data: link, caption: 'Scan', side }], { widthMm: 58, cutter: false, qrStyle: 'native' });
    expect(text(bytes)).toMatch(/Received\s+30/);
    expect(text(bytes)).toMatch(/Balance\s+10/);
  });

  it('keeps them under the total when there is no QR', () => {
    const rows = receiptToTextRows(layoutReceipt(bill, settings, { hindi: false, showUpiQr: false }), 58).join('\n');
    expect(rows).toMatch(/Received\s+:\s+789/);
    expect(rows).toMatch(/Balance\s+:\s+0/);
  });
});
