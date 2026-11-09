import { describe, expect, it } from 'vitest';
import { helperBatchLink, helperBatchList, helperLink, whatsAppNumber } from './whatsapp';

describe('WhatsApp number', () => {
  it('finds the mobile number to open a chat with', () => {
    expect(whatsAppNumber('9826012345')).toBe('9826012345');
    expect(whatsAppNumber('+91 98260 12345')).toBe('9826012345');
    expect(whatsAppNumber('09826012345')).toBe('9826012345');
    expect(whatsAppNumber('982601234')).toBeNull();
    expect(whatsAppNumber('1234567890')).toBeNull();
    expect(whatsAppNumber('')).toBeNull();
    expect(whatsAppNumber(undefined)).toBeNull();
  });
});

describe('helper link', () => {
  const file = 'https://x.supabase.co/storage/v1/object/public/bill-photos/shop-bills/ab/Bill KX4PM.pdf';

  it('opens the helper with the file and the customer number', () => {
    const link = helperLink(file, '9826012345', 'Bill KX4PM.pdf', 'application/pdf');
    expect(link.startsWith('intent://send?')).toBe(true);
    // No package: without the helper nothing opens (not the Play Store).
    expect(link.endsWith('#Intent;scheme=akshaywa;end')).toBe(true);
    const query = new URLSearchParams(link.slice('intent://send?'.length, link.indexOf('#')));
    expect(query.get('url')).toBe(file);
    expect(query.get('phone')).toBe('919826012345');
    expect(query.get('name')).toBe('Bill KX4PM.pdf');
    expect(query.get('type')).toBe('application/pdf');
    expect(link).not.toContain('+');
  });

  it('leaves the number out when there is none', () => {
    const link = helperLink(file, null, 'b.png', 'image/png');
    expect(link).not.toContain('phone=');
  });
});

describe('helper list (many customers)', () => {
  it('opens the batch screen with the list link, which an older helper does not answer', () => {
    const list = 'https://x.supabase.co/storage/v1/object/public/bill-photos/shop-bills/ab/Akshay Reminders.json';
    const link = helperBatchLink(list);
    expect(link.startsWith('intent://batch?url=')).toBe(true);
    expect(link.endsWith('#Intent;scheme=akshaywa;end')).toBe(true);
    expect(decodeURIComponent(link.slice('intent://batch?url='.length, link.indexOf('#')))).toBe(list);
    expect(link).not.toContain('intent://send');
  });

  it('writes each customer with the country code, or no number', () => {
    const json = JSON.parse(
      helperBatchList([
        { name: 'Darshika', number: '9755049483', url: 'https://a/1.png', fileName: '1.png', mimeType: 'image/png', amount: '₹3,134' },
        { name: 'Walk-in', number: null, url: 'https://a/2.png', fileName: '2.png', mimeType: 'image/png', amount: '₹10' },
      ])
    );
    expect(json.v).toBe(1);
    expect(json.items[0]).toEqual({ name: 'Darshika', phone: '919755049483', url: 'https://a/1.png', type: 'image/png', file: '1.png', amount: '₹3,134' });
    expect(json.items[1].phone).toBe('');
  });
});

