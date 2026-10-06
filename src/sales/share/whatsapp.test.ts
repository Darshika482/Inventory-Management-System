import { describe, expect, it } from 'vitest';
import { whatsAppChatUrl, whatsAppNumber } from './whatsapp';

describe('WhatsApp chat links', () => {
  it('finds the mobile number to open a chat with', () => {
    expect(whatsAppNumber('9826012345')).toBe('9826012345');
    expect(whatsAppNumber('+91 98260 12345')).toBe('9826012345');
    expect(whatsAppNumber('09826012345')).toBe('9826012345');
    expect(whatsAppNumber('982601234')).toBeNull();
    expect(whatsAppNumber('1234567890')).toBeNull();
    expect(whatsAppNumber('')).toBeNull();
    expect(whatsAppNumber(undefined)).toBeNull();
  });

  it('opens the customer chat with the text filled in', () => {
    expect(whatsAppChatUrl('9826012345', 'Bill KX4PM\nTotal: ₹100')).toBe(
      'https://wa.me/919826012345?text=Bill%20KX4PM%0ATotal%3A%20%E2%82%B9100'
    );
    expect(whatsAppChatUrl(null, 'Hi')).toBe('https://wa.me/?text=Hi');
  });
});
