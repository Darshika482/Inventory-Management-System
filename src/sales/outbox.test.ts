import { describe, expect, it } from 'vitest';
import { repairEntry, type OutboxEntry } from './outbox';
import type { ShopInvoice } from './types';

const entry = (payload: Record<string, unknown>, invoice: Partial<ShopInvoice> = {}): OutboxEntry => ({
  clientId: 'c1',
  payload: { client_id: 'c1', ...payload },
  invoice: { clientId: 'c1', billNumber: 'S-A/2026-27/0005', partyId: 'p1', lines: [], ...invoice } as ShopInvoice,
  state: 'failed',
  queuedAt: '2026-11-17T10:00:00Z',
});

const numberTaken = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "shop_invoices_bill_number_uniq"',
  details: 'Key (bill_type, fy, bill_number)=(sale, 2026-27, S-A/2026-27/0005) already exists.',
};

describe('repairEntry', () => {
  it('sends a bill whose number another phone already used again without the number', () => {
    const fixed = repairEntry(entry({ bill_number: 'S-A/2026-27/0005' }), numberTaken);
    expect(fixed?.payload.bill_number).toBeNull();
    expect(fixed?.invoice.billNumber).toBeNull();
  });

  it('gives up when the server-given number is taken too', () => {
    expect(repairEntry(entry({ bill_number: null }), numberTaken)).toBeNull();
  });

  it('drops the link to an item that was deleted meanwhile, keeping the line', () => {
    const fixed = repairEntry(
      entry({ lines: [{ item_id: 'gone', item_name: 'Pipe', update_saved_rate: true }] }, {
        lines: [{ itemId: 'gone', itemName: 'Pipe' } as ShopInvoice['lines'][number]],
      }),
      {
        code: '23503',
        message: 'insert or update on table "shop_invoice_items" violates foreign key constraint "shop_invoice_items_item_id_fkey"',
      }
    );
    expect(fixed?.payload.lines).toEqual([{ item_id: null, item_name: 'Pipe', update_saved_rate: false }]);
    expect(fixed?.invoice.lines[0].itemId).toBeNull();
  });

  it('keeps the customer of an udhaar bill: that cannot be put right on the phone', () => {
    const fk = { code: '23503', message: 'violates foreign key constraint "shop_invoices_party_id_fkey"' };
    expect(repairEntry(entry({ party_id: 'p1', payment_mode: 'credit' }), fk)).toBeNull();
    expect(repairEntry(entry({ party_id: 'p1', payment_mode: 'cash' }), fk)?.payload.party_id).toBeNull();
  });

  it('leaves other refusals alone', () => {
    expect(repairEntry(entry({}), { code: 'P0001', message: 'The bill total does not add up.' })).toBeNull();
  });
});
