import { describe, expect, it } from 'vitest';
import { whatsAppNumber } from './whatsapp';

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
