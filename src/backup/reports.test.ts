import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { translate } from '../sales/i18n';
import type { ShopInvoice } from '../sales/types';
import type { CollectedData, Row } from './collect';
import { BACKUP_PARTS, buildBackup, computeUdhaar, packMessages } from './reports';
import { BackupFileError, parseBackupFile } from './restore';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate('en', key, vars);

const invoice = (extra: Row): Row => ({
  id: `inv-${extra.client_id}`,
  bill_type: 'sale',
  series: 'A',
  fy: '2026-27',
  bill_date: '2026-11-01',
  party_id: null,
  party_name: '',
  party_gstin: '',
  is_gst: false,
  is_interstate: false,
  rates_include_gst: true,
  payment_mode: 'cash',
  paid_mode: null,
  subtotal: 0,
  discount: 0,
  discount_percent: null,
  cgst: 0,
  sgst: 0,
  igst: 0,
  round_off: 0,
  total: 0,
  paid_amount: 0,
  status: 'active',
  notes: '',
  created_by: 'u1',
  created_at: '2026-11-01T05:00:00Z',
  ...extra,
});

const party = (id: string, name: string, extra: Row = {}): Row => ({
  id,
  name,
  phone: '',
  address: '',
  gstin: '',
  state_code: '23',
  party_type: 'customer',
  opening_balance: 0,
  is_active: true,
  ...extra,
});

function fixture(): CollectedData {
  return {
    missing: ['workers'],
    tables: {
      shop_settings: [{ id: 1, shop_name: 'Akshay Traders' }],
      shop_parties: [
        party('p1', 'Ramesh <Kirana>', { phone: '98260 12345', opening_balance: '500.00' }),
        party('p2', 'Suresh', { opening_balance: 0 }),
        party('p3', 'Paid Up', { opening_balance: 100 }),
      ],
      shop_invoices: [
        invoice({ client_id: 'c1', bill_number: 'S-A/2026-27/0001', party_id: 'p1', party_name: 'Ramesh <Kirana>', payment_mode: 'credit', total: '1200.00', paid_amount: 0, bill_date: '2026-10-05' }),
        invoice({ client_id: 'c2', bill_number: 'S-A/2026-27/0002', party_id: 'p2', party_name: 'Suresh', payment_mode: 'partial', total: 300, paid_amount: 100 }),
        invoice({ client_id: 'c3', bill_number: 'S-A/2026-27/0003', payment_mode: 'cash', total: 50, paid_amount: 50 }),
        invoice({ client_id: 'c4', bill_number: 'S-A/2026-27/0004', party_id: 'p2', party_name: 'Suresh', payment_mode: 'credit', total: 999, status: 'cancelled' }),
      ],
      shop_invoice_items: [
        { id: 'l1', invoice_id: 'inv-c1', line_no: 1, item_name: 'Lux soap', hsn: '', unit: 'pcs', qty: 10, rate: 120, gst_rate: 0, discount_amount: 0, taxable_amount: 1200, tax_amount: 0, line_total: 1200 },
      ],
      shop_payments: [
        { id: 'pay1', party_id: 'p1', invoice_id: null, direction: 'in', amount: '200.00', mode: 'cash', payment_date: '2026-11-02', note: '', created_at: '2026-11-02T06:00:00Z' },
        { id: 'pay2', party_id: 'p3', invoice_id: null, direction: 'in', amount: 100, mode: 'upi', payment_date: '2026-11-03', note: '', created_at: '2026-11-03T06:00:00Z' },
      ],
      shop_items: [],
      shop_categories: [],
      categories: [{ id: 'g1', name: 'Cotton', unit: 'metre', floor: 'First Floor', initial_stock: 100, current_quantity: 40, created_at: '2026-01-01T00:00:00Z' }],
      withdrawal_logs: [],
      stock_additions: [],
      item_groups: [],
      purchase_bills: [{ id: 'b1', firm_name: 'Mehta', bill_no: '77', bill_date: '2026-10-10', net_amount: 1000, gross_amount: 1000, discount: 0, gst_amount: 0, items: [] }],
      bill_payments: [{ id: 'bp1', bill_id: 'b1', paid_on: '2026-10-11', amount: 400, method: 'Cash' }],
      transport_bills: [],
      transport_payments: [],
      workers: [],
      worker_goods_issues: [],
      worker_goods_returns: [],
      worker_payments: [],
      app_user_list: [{ id: 'u1', username: 'akhilesh', role: 'Admin' }],
    },
  };
}

const now = new Date('2026-11-09T10:00:00Z');

describe('computeUdhaar', () => {
  it('works out what each customer owes, like the Udhaar page', () => {
    const { list, total } = computeUdhaar(fixture(), []);
    // Ramesh: 500 old + 1200 bill − 200 paid without a bill. Suresh: 200 left on a part-paid bill.
    // Paid Up: 100 old − 100 paid = nothing. The cancelled bill does not count.
    expect(list.map((r) => [r.name, r.total])).toEqual([
      ['Ramesh <Kirana>', 1500_00],
      ['Suresh', 200_00],
    ]);
    expect(total).toBe(1700_00);
  });

  it('counts bills still waiting on this phone', () => {
    const queued = { clientId: 'q1', billType: 'sale', status: 'active', paymentMode: 'credit', partyId: 'p2', partyName: 'Suresh', billNumber: null, billDate: '2026-11-09', total: 50_00, paidAmount: 0, lines: [] } as unknown as ShopInvoice;
    const { list } = computeUdhaar(fixture(), [queued]);
    expect(list.find((r) => r.name === 'Suresh')?.total).toBe(250_00);
  });
});

describe('buildBackup', () => {
  const built = buildBackup({ data: fixture(), queuedSales: [], parts: BACKUP_PARTS, shopName: 'Akshay Traders', now, t });

  it('makes one Excel file per part and the full backup file', () => {
    expect(built.files.map((f) => f.fileName)).toEqual([
      'Udhaar 09-11-2026.xlsx',
      'Sale bills 09-11-2026.xlsx',
      'Customers and items 09-11-2026.xlsx',
      'Godown stock 09-11-2026.xlsx',
      'Party bills 09-11-2026.xlsx',
      'Transport bills 09-11-2026.xlsx',
      'Workers 09-11-2026.xlsx',
      'Full backup 09-11-2026.json',
    ]);
  });

  it('only makes the parts asked for', () => {
    const one = buildBackup({ data: fixture(), queuedSales: [], parts: ['udhaar'], shopName: 'X', now, t });
    expect(one.files.map((f) => f.part)).toEqual(['udhaar']);
    expect(one.messages.join('\n')).not.toContain('Sale bills');
  });

  it('puts the udhaar list and its total in the Udhaar workbook', () => {
    const files = unzipSync(built.files[0].bytes);
    const workbook = strFromU8(files['xl/workbook.xml']);
    expect(workbook).toContain('name="Udhaar list"');
    expect(workbook).toContain('name="Udhaar bills"');
    expect(workbook).toContain('name="Money received"');
    const list = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(list).toContain('Ramesh &lt;Kirana&gt;');
    expect(list).toContain('<v>1500</v>');
    expect(list).toContain('<v>1700</v>'); // total row
  });

  it('shows what is left to pay on party bills', () => {
    const sheet = strFromU8(unzipSync(built.files[4].bytes)['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('<v>600</v>');
  });

  it('sends a summary and the whole udhaar list as messages, HTML-safe', () => {
    const text = built.messages.join('\n');
    expect(text).toContain('Akshay Traders: backup');
    expect(text).toContain('Total udhaar: ₹1,700 · customers with udhaar: 2');
    expect(text).toContain('1. <b>Ramesh &lt;Kirana&gt;</b> — ₹1,500 · 98260 12345 · since 05-10-2026');
    expect(text).toContain('2. <b>Suresh</b> — ₹200');
    expect(text).not.toContain('<Kirana>');
  });

  it('writes a full backup that Restore can read back', () => {
    const json = new TextDecoder().decode(built.files[7].bytes);
    const parsed = parseBackupFile(json);
    expect(parsed.shopName).toBe('Akshay Traders');
    expect(parsed.createdAt).toBe(now.toISOString());
    const names = parsed.tables.map((t) => t.name);
    // In restore order, and never the user list.
    expect(names.indexOf('shop_parties')).toBeLessThan(names.indexOf('shop_invoices'));
    expect(names.indexOf('shop_invoices')).toBeLessThan(names.indexOf('shop_invoice_items'));
    expect(names).not.toContain('app_user_list');
    expect(parsed.tables.find((t) => t.name === 'shop_invoices')?.rows).toHaveLength(4);
  });
});

describe('parseBackupFile', () => {
  it('turns away files that are not backups', () => {
    const reason = (text: string) => {
      try {
        parseBackupFile(text);
        return null;
      } catch (err) {
        return (err as BackupFileError).reason;
      }
    };
    expect(reason('not json')).toBe('notJson');
    expect(reason('{"hello":1}')).toBe('notBackup');
    expect(reason(JSON.stringify({ format: 'akshay-traders-backup', version: 99, tables: {} }))).toBe('newerVersion');
    expect(reason(JSON.stringify({ format: 'akshay-traders-backup', version: 1, tables: { shop_parties: [] } }))).toBe('empty');
  });
});

describe('packMessages', () => {
  it('fits lines into as few messages as the limit allows', () => {
    expect(packMessages(['aaaa', 'bbbb', 'cccc'], 9)).toEqual(['aaaa\nbbbb', 'cccc']);
    expect(packMessages([], 10)).toEqual([]);
  });
});
