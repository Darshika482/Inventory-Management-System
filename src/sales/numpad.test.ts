import { describe, expect, it } from 'vitest';
import { applyPadKey, groupDigits, isBlank, tidyValue } from './numpad';

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

  it('a highlighted value is replaced by a digit or point, but edited by back', () => {
    expect(applyPadKey('120', '5', 2, true)).toBe('5');
    expect(applyPadKey('120', '.', 2, true)).toBe('0.');
    expect(applyPadKey('120', '0', 2, true)).toBe('0');
    expect(applyPadKey('120', 'back', 2, true)).toBe('12');
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
