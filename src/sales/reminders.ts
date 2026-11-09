/**
 * Udhaar reminders: what each customer owes right now, for the reminder
 * picture sent on WhatsApp. Kept apart from the screen so it can be tested.
 *
 * Owed = old balance (from before the app) + what is left on their udhaar /
 * part-paid bills − money received from them without a bill (on account).
 */
import type { Paise } from './money';
import { whatsAppNumber } from './share/whatsapp';
import type { ShopInvoice, ShopParty } from './types';

export interface ReminderBill {
  clientId: string;
  billNumber: string | null;
  billDate: string;
  /** What is still to be paid on this bill. */
  due: Paise;
}

export interface DueReminder {
  /** The customer's id, or "name:<name>" for bills typed without a saved customer. */
  key: string;
  partyId: string | null;
  name: string;
  /** 10-digit WhatsApp number, or null when there is none. */
  phone: string | null;
  /** Owed from before the app (minus: the shop owed them). */
  oldBalance: Paise;
  /** Udhaar / part-paid bills with something left to pay, oldest first. */
  bills: ReminderBill[];
  billsDue: Paise;
  /** Money received from them without a bill. */
  paidOnAccount: Paise;
  /** What they owe now; always more than 0. */
  total: Paise;
}

const normalName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

export function buildDueReminders({
  parties,
  dueBills,
  paidOnAccount,
}: {
  parties: ShopParty[];
  /** Sale bills; only active ones with something left to pay are counted. */
  dueBills: ShopInvoice[];
  /** Money received without a bill, by customer id. */
  paidOnAccount: Map<string, Paise>;
}): DueReminder[] {
  const byId = new Map(parties.map((p) => [p.id, p]));
  // A bill typed with a name but no saved customer goes to the saved customer
  // of that exact name, when there is only one.
  const byName = new Map<string, ShopParty | null>();
  for (const party of parties) {
    const key = normalName(party.name);
    byName.set(key, byName.has(key) ? null : party);
  }

  const rows = new Map<string, DueReminder>();
  const rowForParty = (party: ShopParty): DueReminder => {
    let row = rows.get(party.id);
    if (!row) {
      row = {
        key: party.id,
        partyId: party.id,
        name: party.name.trim(),
        phone: whatsAppNumber(party.phone),
        oldBalance: party.openingBalance,
        bills: [],
        billsDue: 0,
        paidOnAccount: paidOnAccount.get(party.id) ?? 0,
        total: 0,
      };
      rows.set(party.id, row);
    }
    return row;
  };

  // Old balance or money on account: a reminder even without a bill here.
  // A hidden customer only when they still have a bill left to pay (below).
  for (const party of parties) {
    if (!party.isActive) continue;
    if (party.openingBalance !== 0 || paidOnAccount.has(party.id)) rowForParty(party);
  }

  for (const bill of dueBills) {
    if (bill.billType !== 'sale' || bill.status !== 'active') continue;
    const due = bill.total - bill.paidAmount;
    if (due <= 0) continue;

    let row: DueReminder | undefined;
    const party = bill.partyId ? byId.get(bill.partyId) : byName.get(normalName(bill.partyName)) ?? undefined;
    if (party) {
      row = rowForParty(party);
    } else {
      const name = bill.partyName.trim();
      if (!name) continue; // A walk-in bill: nobody to remind.
      const key = bill.partyId ?? `name:${normalName(name)}`;
      row = rows.get(key);
      if (!row) {
        row = { key, partyId: bill.partyId, name, phone: null, oldBalance: 0, bills: [], billsDue: 0, paidOnAccount: 0, total: 0 };
        rows.set(key, row);
      }
    }
    row.bills.push({ clientId: bill.clientId, billNumber: bill.billNumber, billDate: bill.billDate, due });
    row.billsDue += due;
  }

  const owing: DueReminder[] = [];
  for (const row of rows.values()) {
    row.total = row.oldBalance + row.billsDue - row.paidOnAccount;
    if (row.total <= 0) continue;
    row.bills.sort((a, b) => a.billDate.localeCompare(b.billDate));
    owing.push(row);
  }
  return owing.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}
