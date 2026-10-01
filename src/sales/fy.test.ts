import { describe, expect, it } from 'vitest';
import { billSequence, formatBillNumber, fyFor, istToday } from './fy';

describe('financial year and bill numbers', () => {
  it('starts the year on 1 April', () => {
    expect(fyFor('2026-03-31')).toBe('2025-26');
    expect(fyFor('2026-04-01')).toBe('2026-27');
    expect(fyFor('2026-10-01')).toBe('2026-27');
    expect(fyFor('2099-12-31')).toBe('2099-00');
  });

  it('dates bills in India time', () => {
    // 19:00 UTC on 30 Sept is 00:30 IST on 1 Oct.
    expect(istToday(new Date('2026-09-30T19:00:00Z'))).toBe('2026-10-01');
    expect(istToday(new Date('2026-09-30T18:00:00Z'))).toBe('2026-09-30');
  });

  it('formats and reads bill numbers', () => {
    expect(formatBillNumber('sale', 'A', '2026-27', 1)).toBe('S-A/2026-27/0001');
    expect(formatBillNumber('quotation', 'B', '2026-27', 12345)).toBe('Q-B/2026-27/12345');
    expect(billSequence('S-A/2026-27/0042')).toBe(42);
  });
});

import { toPhoneDigits } from './states';

describe('phone numbers', () => {
  it('keeps only the 10 digits', () => {
    expect(toPhoneDigits('98637489239003-003')).toBe('9863748923');
    expect(toPhoneDigits('+91 98260 12345')).toBe('9826012345');
    expect(toPhoneDigits('09826012345')).toBe('9826012345');
    expect(toPhoneDigits('abc98-26')).toBe('9826');
  });
});

import { toShopPhones } from './states';

describe('shop phone numbers', () => {
  it('allows two numbers', () => {
    expect(toShopPhones('9131297397, 9300106271')).toBe('9131297397, 9300106271');
    expect(toShopPhones('91312-97397 / 93001')).toBe('9131297397 93001');
  });
});
