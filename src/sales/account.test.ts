import { describe, expect, it } from 'vitest';
import { buildCustomerAccount, type AccountPayment } from './account';
import type { ShopInvoice } from './types';

let n = 0;
const bill = (extra: Partial<ShopInvoice>): ShopInvoice =>
  ({
    id: `id${++n}`,
    clientId: `c${n}`,
    billType: 'sale',
    billNumber: `S-A/2026-27/${String(n).padStart(4, '0')}`,
    billDate: '2026-10-01',
    partyId: 'p1',
    partyName: 'Ramesh',
    status: 'active',
    total: 100_00,
    paidAmount: 0,
    createdAt: '2026-10-01T10:00:00Z',
    lines: [],
    syncState: 'synced',
    ...extra,
  }) as ShopInvoice;

const payment = (extra: Partial<AccountPayment>): AccountPayment => ({
  id: `pay${++n}`,
  invoiceId: null,
  direction: 'in',
  amount: 100_00,
  mode: 'cash',
  paymentDate: '2026-10-10',
  createdAt: '2026-10-10T10:00:00Z',
  ...extra,
});

describe('buildCustomerAccount', () => {
  it('adds the old balance to what is left on the bills, less what was paid towards the old balance', () => {
    const account = buildCustomerAccount({
      party: { openingBalance: 5000_00 },
      bills: [
        bill({ clientId: 'a', billDate: '2026-11-03', total: 2000_00, paidAmount: 500_00 }),
        bill({ clientId: 'b', billDate: '2026-11-10', total: 800_00 }),
        bill({ clientId: 'c', billDate: '2026-11-12', total: 300_00, paidAmount: 300_00 }),
        bill({ clientId: 'd', billDate: '2026-11-13', total: 999_00, status: 'cancelled' }),
      ],
      payments: [payment({ amount: 1000_00, paymentDate: '2026-11-12' })],
    });

    expect(account.oldBalance).toBe(5000_00);
    expect(account.paidOnAccount).toBe(1000_00);
    expect(account.oldLeft).toBe(4000_00);
    expect(account.billsDue).toBe(2300_00);
    expect(account.total).toBe(6300_00);
    expect(account.dueCount).toBe(2);
    // Every bill is listed, newest first; cancelled ones too.
    expect(account.bills.map((b) => b.clientId)).toEqual(['d', 'c', 'b', 'a']);
    // Only active bills count in the totals.
    expect(account.billsTotal).toBe(3100_00);
    expect(account.billsPaid).toBe(800_00);

    // The parts add up to the total: old balance, minus payments, plus each bill left (oldest first).
    expect(account.parts.map((p) => p.kind)).toEqual(['old', 'paidOld', 'bill', 'bill']);
    const sum = account.parts.reduce(
      (s, p) => s + (p.kind === 'old' ? p.amount : p.kind === 'paidOld' ? -p.amount : p.due),
      0
    );
    expect(sum).toBe(account.total);
    const billParts = account.parts.filter((p) => p.kind === 'bill');
    expect(billParts.map((p) => (p.kind === 'bill' ? [p.clientId, p.due] : null))).toEqual([
      ['a', 1500_00],
      ['b', 800_00],
    ]);
  });

  it('counts a bill once when it is both on the server and still in the phone list', () => {
    const account = buildCustomerAccount({
      party: { openingBalance: 0 },
      bills: [
        bill({ clientId: 'x', total: 400_00, syncState: 'pending', id: null }),
        bill({ clientId: 'x', total: 400_00, syncState: 'synced' }),
      ],
      payments: [],
    });
    expect(account.bills).toHaveLength(1);
    expect(account.bills[0].syncState).toBe('synced');
    expect(account.total).toBe(400_00);
  });

  it('shows money paid on bills in the payments, but only takes payments without a bill off the old balance', () => {
    const account = buildCustomerAccount({
      party: { openingBalance: 1000_00 },
      bills: [bill({ id: 'inv1', clientId: 'y', total: 500_00, paidAmount: 200_00 })],
      payments: [
        payment({ invoiceId: 'inv1', amount: 200_00, paymentDate: '2026-10-05' }),
        payment({ amount: 300_00, paymentDate: '2026-10-20' }),
        payment({ direction: 'out', amount: 50_00 }),
      ],
    });
    expect(account.paidOnAccount).toBe(300_00);
    expect(account.total).toBe(1000_00 - 300_00 + 300_00);
    expect(account.payments.map((p) => p.paymentDate)).toEqual(['2026-10-20', '2026-10-05']);
  });

  it('a customer with only an old balance owes just that', () => {
    const account = buildCustomerAccount({ party: { openingBalance: 2029_50 }, bills: [], payments: [] });
    expect(account.total).toBe(2029_50);
    expect(account.parts).toEqual([{ kind: 'old', amount: 2029_50 }]);
  });
});
