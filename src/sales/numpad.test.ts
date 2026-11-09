import { describe, expect, it } from 'vitest';
import { applyPadKey, applyPadKeyAt, groupDigits, groupedChars, isBlank, tidyValue } from './numpad';

const typeKeys = (keys: string[], decimals = 2, start = '') =>
  keys.reduce((value, key) => applyPadKey(value, key as never, decimals), start);

describe('applyPadKey', () => {
  it('types digits and a point', () => {
    expect(typeKeys(['1', '2', '.', '5'])).toBe('12.5');
  });

  it('keeps to the allowed decimals', () => {
    expect(typeKeys(['1', '.', '2', '3', '4'], 2)).toBe('1.23');
    expect(typeKeys(['1', '.', '2', '3', '4', '5'], 3)).toBe('1.234');
    expect(typeKeys(['1', '.', '2'], 0)).toBe('12');
  });

  it('fits only what room is left for 00 after the point', () => {
    expect(typeKeys(['1', '.', '5', '00'], 2)).toBe('1.50');
    expect(typeKeys(['1', '.', '00'], 2)).toBe('1.00');
  });

  it('allows one point only, and starts a bare point with 0', () => {
    expect(typeKeys(['.', '5'])).toBe('0.5');
    expect(typeKeys(['1', '.', '.', '5'])).toBe('1.5');
  });

  it('drops leading zeros', () => {
    expect(typeKeys(['0', '5'])).toBe('5');
    expect(typeKeys(['0', '0'])).toBe('0');
    expect(typeKeys(['00'])).toBe('0');
    expect(typeKeys(['0', '.', '5'])).toBe('0.5');
    expect(typeKeys(['1', '00'])).toBe('100');
  });

  it('stops at eight whole digits', () => {
    expect(typeKeys(['9', '9', '9', '9', '9', '9', '9', '9', '9'])).toBe('99999999');
    expect(typeKeys(['9', '9', '9', '9', '9', '9', '9', '00'])).toBe('9999999');
  });

  it('back removes the last character, clear empties', () => {
    expect(applyPadKey('12.5', 'back', 2)).toBe('12.');
    expect(applyPadKey('', 'back', 2)).toBe('');
    expect(applyPadKey('12.5', 'clear', 2)).toBe('');
  });

});

describe('applyPadKeyAt', () => {
  it('types at the cursor, not over the whole number', () => {
    expect(applyPadKeyAt('120', 1, '5', 2)).toEqual({ value: '1520', cursor: 2 });
    expect(applyPadKeyAt('120', 0, '9', 2)).toEqual({ value: '9120', cursor: 1 });
    expect(applyPadKeyAt('120', 3, '5', 2)).toEqual({ value: '1205', cursor: 4 });
  });

  it('back removes the character before the cursor', () => {
    expect(applyPadKeyAt('120', 2, 'back', 2)).toEqual({ value: '10', cursor: 1 });
    expect(applyPadKeyAt('120', 0, 'back', 2)).toEqual({ value: '120', cursor: 0 });
    expect(applyPadKeyAt('105', 1, 'back', 2)).toEqual({ value: '5', cursor: 0 });
  });

  it('puts a point in the middle only when the decimals fit', () => {
    expect(applyPadKeyAt('125', 2, '.', 2)).toEqual({ value: '12.5', cursor: 3 });
    expect(applyPadKeyAt('1250', 1, '.', 2)).toEqual({ value: '1250', cursor: 1 });
    expect(applyPadKeyAt('25', 0, '.', 2)).toEqual({ value: '0.25', cursor: 2 });
    expect(applyPadKeyAt('1.5', 0, '.', 2)).toEqual({ value: '1.5', cursor: 0 });
  });

  it('keeps to the decimals and whole digits allowed', () => {
    expect(applyPadKeyAt('1.25', 3, '9', 2)).toEqual({ value: '1.25', cursor: 3 });
    expect(applyPadKeyAt('1.5', 2, '9', 2)).toEqual({ value: '1.95', cursor: 3 });
    expect(applyPadKeyAt('99999999', 4, '1', 2)).toEqual({ value: '99999999', cursor: 4 });
    expect(applyPadKeyAt('1.5', 1, '7', 2)).toEqual({ value: '17.5', cursor: 2 });
  });

  it('drops a leading zero typed in front', () => {
    expect(applyPadKeyAt('5', 0, '0', 2)).toEqual({ value: '5', cursor: 0 });
    expect(applyPadKeyAt('0', 1, '7', 2)).toEqual({ value: '7', cursor: 1 });
  });
});

describe('groupedChars', () => {
  it('maps each shown character to its place in the value', () => {
    expect(groupedChars('1250.5')).toEqual([
      { char: '1', index: 0 },
      { char: ',', index: null },
      { char: '2', index: 1 },
      { char: '5', index: 2 },
      { char: '0', index: 3 },
      { char: '.', index: 4 },
      { char: '5', index: 5 },
    ]);
  });
});

describe('groupDigits', () => {
  it('groups the Indian way and keeps the typed decimals', () => {
    expect(groupDigits('5')).toBe('5');
    expect(groupDigits('1250')).toBe('1,250');
    expect(groupDigits('125000.5')).toBe('1,25,000.5');
    expect(groupDigits('12345678')).toBe('1,23,45,678');
    expect(groupDigits('100.')).toBe('100.');
    expect(groupDigits('')).toBe('');
  });
});

describe('isBlank / tidyValue', () => {
  it('treats empty and a lone point as blank', () => {
    expect(isBlank('')).toBe(true);
    expect(isBlank('.')).toBe(true);
    expect(isBlank('0')).toBe(false);
  });

  it('drops a point with nothing after it', () => {
    expect(tidyValue('5.')).toBe('5');
    expect(tidyValue('5.5')).toBe('5.5');
  });
});
