import { describe, expect, it } from 'vitest';
import {
  dbToMilli,
  dbToPaise,
  formatQty,
  formatRupees,
  milliToDecimal,
  mulDivRound,
  paiseToDecimal,
  paiseToInput,
  parseMilli,
  parsePaise,
} from './money';

describe('money helpers', () => {
  it('reads typed amounts into paise', () => {
    expect(parsePaise('40')).toBe(4000);
    expect(parsePaise('40.5')).toBe(4050);
    expect(parsePaise('1,250.75')).toBe(125075);
    expect(parsePaise('.5')).toBe(50);
    expect(parsePaise('0.1')).toBe(10);
    expect(parsePaise('1.234')).toBeNull();
    expect(parsePaise('abc')).toBeNull();
    expect(parsePaise('')).toBeNull();
  });

  it('reads typed quantities into thousandths', () => {
    expect(parseMilli('1.5')).toBe(1500);
    expect(parseMilli('2')).toBe(2000);
    expect(parseMilli('0.125')).toBe(125);
    expect(parseMilli('0.1234')).toBeNull();
  });

  it('reads database numbers without float drift', () => {
    expect(dbToPaise(0.1 + 0.2)).toBe(30);
    expect(dbToPaise(123.45)).toBe(12345);
    expect(dbToPaise('99999.99')).toBe(9999999);
    expect(dbToMilli('1.500')).toBe(1500);
    expect(dbToPaise(null)).toBe(0);
  });

  it('writes decimals for the database', () => {
    expect(paiseToDecimal(4050)).toBe('40.50');
    expect(paiseToDecimal(5)).toBe('0.05');
    expect(paiseToDecimal(-49)).toBe('-0.49');
    expect(milliToDecimal(1500)).toBe('1.500');
    expect(paiseToInput(4000)).toBe('40');
    expect(paiseToInput(4050)).toBe('40.5');
    expect(formatQty(1500)).toBe('1.5');
  });

  it('formats rupees the Indian way', () => {
    expect(formatRupees(12345678)).toBe('₹1,23,456.78');
    expect(formatRupees(4000)).toBe('₹40');
    expect(formatRupees(4000, true)).toBe('₹40.00');
    expect(formatRupees(-50)).toBe('−₹0.50');
  });

  it('multiplies and divides big numbers exactly', () => {
    expect(mulDivRound(9_000_000_000, 9_000_000_000, 1_000_000_000)).toBe(81_000_000_000);
    expect(mulDivRound(5, 1, 10)).toBe(1);
    expect(mulDivRound(-5, 1, 10)).toBe(-1);
  });
});
