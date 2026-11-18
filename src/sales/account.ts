/**
 * One customer's account: every bill, the old balance (from before the app),
 * the money they paid, and what they owe now with the parts it is made of.
 * Kept apart from the screen so it can be tested.
 *
 * Owed = old balance + what is left on their bills − money received from them
 * without a bill (towards the old balance). The same sum as the Udhaar list.
 */
import type { Paise } from './money';
import type { ShopInvoice, ShopParty } from './types';

/** Money received from the customer, against a bill or without one. */
export interface AccountPayment {
  id: string;
  /** Null: received without a bill (towards the old balance). */
  invoiceId: string | null;
  direction: 'in' | 'out';
  amount: Paise;
  mode: string;
  paymentDate: string;
  createdAt: string;
}

/** One part of the udhaar total, in the order shown. */
export type UdhaarPart =
  | { kind: 'old'; amount: Paise }
  | { kind: 'paidOld'; amount: Paise; paymentDate: string; mode: string }
  | { kind: 'bill'; clientId: string; billNumber: string | null; billDate: string; total: Paise; paid: Paise; due: Paise };

export interface CustomerAccount {
  /** Owed from before the app (minus: the shop owed them). */
  oldBalance: Paise;
  /** Received without a bill, towards the old balance. */
  paidOnAccount: Paise;
  /** What is still left of the old balance. */
  oldLeft: Paise;
  /** What is left to pay on their bills. */
  billsDue: Paise;
  /** What they owe now. 0 or less: nothing owed (less: the shop owes them). */
  total: Paise;
  /** The parts that add up to `total`: old balance, payments towards it, bills with a balance (oldest first). */
  parts: UdhaarPart[];
  /** Every sale bill, newest first (cancelled ones too). */
  bills: ShopInvoice[];
  /** Bills with something left to pay. */
  dueCount: number;
  /** Sum of all their active bills, and what was paid on them. */
  billsTotal: Paise;
  billsPaid: Paise;
  /** Money received, newest first. */
  payments: AccountPayment[];
}

export function billDue(bill: ShopInvoice): Paise {
  if (bill.billType !== 'sale' || bill.status !== 'active') return 0;
  return Math.max(0, bill.total - bill.paidAmount);
}

export function buildCustomerAccount({
  party,
  bills,
  payments,
}: {
  party: Pick<ShopParty, 'openingBalance'>;
  /** Their bills: from the server and still waiting on this phone (the same bill twice is counted once). */
  bills: ShopInvoice[];
  payments: AccountPayment[];
}): CustomerAccount {
  const byClientId = new Map<string, ShopInvoice>();
  for (const bill of bills) {
    if (bill.billType !== 'sale') continue;
    // The server copy wins over the copy waiting on the phone.
    const seen = byClientId.get(bill.clientId);
    if (!seen || (seen.syncState !== 'synced' && bill.syncState === 'synced')) byClientId.set(bill.clientId, bill);
  }
  const all = [...byClientId.values()].sort(
    (a, b) => b.billDate.localeCompare(a.billDate) || b.createdAt.localeCompare(a.createdAt)
  );

  const onAccount = payments
    .filter((p) => p.invoiceId === null && p.direction === 'in')
    .sort((a, b) => a.paymentDate.localeCompare(b.paymentDate) || a.createdAt.localeCompare(b.createdAt));
  const paidOnAccount = onAccount.reduce((sum, p) => sum + p.amount, 0);

  const parts: UdhaarPart[] = [];
  if (party.openingBalance !== 0) parts.push({ kind: 'old', amount: party.openingBalance });
  for (const p of onAccount) parts.push({ kind: 'paidOld', amount: p.amount, paymentDate: p.paymentDate, mode: p.mode });

  const dueBills = all.filter((b) => billDue(b) > 0).reverse();
  for (const bill of dueBills) {
    parts.push({
      kind: 'bill',
      clientId: bill.clientId,
      billNumber: bill.billNumber,
      billDate: bill.billDate,
      total: bill.total,
      paid: bill.paidAmount,
      due: billDue(bill),
    });
  }
  const billsDue = dueBills.reduce((sum, b) => sum + billDue(b), 0);

  const active = all.filter((b) => b.status === 'active');
  return {
    oldBalance: party.openingBalance,
    paidOnAccount,
    oldLeft: Math.max(0, party.openingBalance - paidOnAccount),
    billsDue,
    total: party.openingBalance + billsDue - paidOnAccount,
    parts,
    bills: all,
    dueCount: dueBills.length,
    billsTotal: active.reduce((sum, b) => sum + b.total, 0),
    billsPaid: active.reduce((sum, b) => sum + Math.min(b.total, b.paidAmount), 0),
    payments: [...payments]
      .filter((p) => p.direction === 'in')
      .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate) || b.createdAt.localeCompare(a.createdAt)),
  };
}
