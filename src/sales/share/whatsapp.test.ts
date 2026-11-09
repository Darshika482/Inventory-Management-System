import { describe, expect, it } from 'vitest';
import { helperLink, whatsAppNumber } from './whatsapp';

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
    expect(link.endsWith('#Intent;scheme=akshaywa;package=in.akshaytraders.whatsapp;end')).toBe(true);
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
