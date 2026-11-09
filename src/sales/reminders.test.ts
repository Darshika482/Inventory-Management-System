import { describe, expect, it } from 'vitest';
import { buildDueReminders } from './reminders';
import type { ShopInvoice, ShopParty } from './types';

const party = (id: string, name: string, extra: Partial<ShopParty> = {}): ShopParty => ({
  id,
  name,
  phone: '',
  address: '',
  gstin: '',
  stateCode: '23',
  partyType: 'customer',
  openingBalance: 0,
  isActive: true,
  ...extra,
});

let n = 0;
const bill = (extra: Partial<ShopInvoice>): ShopInvoice =>
  ({
    id: `id${++n}`,
    clientId: `c${n}`,
    billType: 'sale',
    billNumber: `S-A/2026-27/${String(n).padStart(4, '0')}`,
    billDate: '2026-10-01',
    partyId: null,
    partyName: '',
    status: 'active',
    total: 100_00,
    paidAmount: 0,
    lines: [],
    ...extra,
  }) as ShopInvoice;

describe('buildDueReminders', () => {
  it('adds old balance and what is left on bills, less money on account', () => {
    const [row] = buildDueReminders({
      parties: [party('p1', 'Aaditya Maching ITI', { phone: '95892 77490', openingBalance: 980_00 })],
      dueBills: [
        bill({ partyId: 'p1', partyName: 'Aaditya Maching ITI', total: 500_00, paidAmount: 200_00, billDate: '2026-10-05' }),
        bill({ partyId: 'p1', partyName: 'Aaditya Maching ITI', total: 250_00, billDate: '2026-10-02' }),
      ],
      paidOnAccount: new Map([['p1', 30_00]]),
    });
    expect(row.phone).toBe('9589277490');
    expect(row.oldBalance).toBe(980_00);
    expect(row.billsDue).toBe(550_00);
    expect(row.paidOnAccount).toBe(30_00);
    expect(row.total).toBe(1500_00);
    // Oldest bill first.
    expect(row.bills.map((b) => b.billDate)).toEqual(['2026-10-02', '2026-10-05']);
  });

  it('includes customers with only an old balance, but not those who owe nothing or are owed', () => {
    const rows = buildDueReminders({
      parties: [
        party('old', 'Old Only', { openingBalance: 2029_50 }),
        party('zero', 'Nothing Owed'),
        party('minus', 'Shop Owes Them', { openingBalance: -500_00 }),
        party('net', 'Paid More', { openingBalance: 100_00 }),
      ],
      dueBills: [bill({ partyId: 'minus', partyName: 'Shop Owes Them', total: 200_00 })],
      paidOnAccount: new Map([['net', 150_00]]),
    });
    expect(rows.map((r) => r.name)).toEqual(['Old Only']);
    expect(rows[0].total).toBe(2029_50);
  });

  it('skips paid, cancelled and walk-in bills', () => {
    const rows = buildDueReminders({
      parties: [party('p1', 'A')],
      dueBills: [
        bill({ partyId: 'p1', total: 100_00, paidAmount: 100_00 }),
        bill({ partyId: 'p1', status: 'cancelled' }),
        bill({ partyId: null, partyName: '' }),
        bill({ partyId: 'p1', billType: 'quotation' }),
      ],
      paidOnAccount: new Map(),
    });
    expect(rows).toEqual([]);
  });

  it('a hidden customer is reminded only for bills still to be paid', () => {
    const hidden = party('h', 'Hidden', { isActive: false, openingBalance: 300_00 });
    expect(buildDueReminders({ parties: [hidden], dueBills: [], paidOnAccount: new Map() })).toEqual([]);
    const [row] = buildDueReminders({
      parties: [hidden],
      dueBills: [bill({ partyId: 'h', partyName: 'Hidden', total: 50_00 })],
      paidOnAccount: new Map(),
    });
    expect(row.total).toBe(350_00);
  });

  it('a bill typed with a name goes to the saved customer of that name, else stands on its own', () => {
    const rows = buildDueReminders({
      parties: [party('p1', 'Ramesh  Kirana', { phone: '9826012345' })],
      dueBills: [
        bill({ partyName: 'ramesh kirana', total: 40_00 }),
        bill({ partyName: 'Suresh', total: 70_00 }),
        bill({ partyName: 'suresh ', total: 10_00 }),
      ],
      paidOnAccount: new Map(),
    });
    expect(rows.map((r) => [r.name, r.phone, r.total])).toEqual([
      ['Suresh', null, 80_00],
      ['Ramesh  Kirana', '9826012345', 40_00],
    ]);
    expect(rows[0].key).toBe('name:suresh');
  });

  it('puts the biggest amount first', () => {
    const rows = buildDueReminders({
      parties: [party('a', 'A', { openingBalance: 10_00 }), party('b', 'B', { openingBalance: 90_00 })],
      dueBills: [],
      paidOnAccount: new Map(),
    });
    expect(rows.map((r) => r.name)).toEqual(['B', 'A']);
  });
});
