import { describe, expect, it } from 'vitest';
import { parseNumber, parseDate, parseValue, applyCleaners, inferType, formatNumber } from '../src';

describe('numbers and currency', () => {
  it.each([
    ['1,234.56', 1234.56, 2],
    ['$1,234.56', 1234.56, 2],
    ['$ 424.18', 424.18, 2],
    ['A$12.00', 12, 2],
    ['AUD 7.5', 7.5, 1],
    ['-12.40', -12.4, 2],
    ['12.40-', -12.4, 2],
    ['(1,234.56)', -1234.56, 2],
    ['12.40 CR', -12.4, 2],
    ['12.40CR', -12.4, 2],
    ['12.40 DR', 12.4, 2],
    ['-$5.00', -5, 2],
    ['52.10', 52.1, 2],
    ['7', 7, 0],
    ['.5', 0.5, 1],
  ])('%s → %d', (s, v, d) => {
    expect(parseNumber(s)).toEqual({ value: v, decimals: d });
  });
  it('rejects non-numbers', () => {
    for (const s of ['', 'abc', '1.2.3', '12a', '$', 'ST-48213']) expect(parseNumber(s)).toBeNull();
  });
  it('CR is positive when creditMeansNegative is false', () => {
    expect(parseNumber('12.40 CR', { creditMeansNegative: false })?.value).toBe(12.4);
  });
  it('integer rejects decimals', () => {
    expect(parseNumber('3', { integer: true })?.value).toBe(3);
    expect(parseNumber('3.5', { integer: true })).toBeNull();
  });
  it('supports decimal comma', () => {
    expect(parseNumber('1.234,56', { decimal: ',' })).toEqual({ value: 1234.56, decimals: 2 });
  });
  it('keeps document decimals for CSV', () => {
    expect(parseValue('52.10', 'number')?.csv).toBe('52.10');
    expect(parseValue('12.40 CR', 'currency')?.csv).toBe('-12.40');
    expect(formatNumber(5, 0)).toBe('5');
  });
});

describe('dates', () => {
  it.each([
    ['30/09/2026', 'DD/MM/YYYY', '2026-09-30'],
    ['3/9/2026', 'D/M/YYYY', '2026-09-03'],
    ['03-09-26', 'DD-MM-YY', '2026-09-03'],
    ['03-09-85', 'DD-MM-YY', '1985-09-03'],
    ['3 Sep 2026', 'D MMM YYYY', '2026-09-03'],
    ['3 Sept 2026', 'D MMM YYYY', '2026-09-03'],
    ['3 September 2026', 'D MMMM YYYY', '2026-09-03'],
    ['2026-09-03', 'YYYY-MM-DD', '2026-09-03'],
    ['09/30/2026', 'MM/DD/YYYY', '2026-09-30'],
  ])('%s with %s', (s, f, iso) => {
    expect(parseDate(s, [f])).toBe(iso);
  });
  it('never guesses between day-first and month-first', () => {
    expect(parseDate('09/30/2026', ['DD/MM/YYYY'])).toBeNull();
    expect(parseDate('04/05/2026', ['DD/MM/YYYY'])).toBe('2026-05-04');
  });
  it('rejects impossible dates', () => {
    expect(parseDate('31/02/2026', ['DD/MM/YYYY'])).toBeNull();
    expect(parseDate('29/02/2028', ['DD/MM/YYYY'])).toBe('2028-02-29');
  });
  it('tries formats in order', () => {
    expect(parseDate('3 Sep 2026', ['DD/MM/YYYY', 'D MMM YYYY'])).toBe('2026-09-03');
  });
  it('year below 70 is 20xx', () => {
    expect(parseDate('01/01/69', ['DD/MM/YY'])).toBe('2069-01-01');
    expect(parseDate('01/01/70', ['DD/MM/YY'])).toBe('1970-01-01');
  });
});

describe('cleaners', () => {
  it('applies in order', () => {
    expect(applyCleaners('  ab  cd ', ['trim', 'collapseSpaces', 'upper'])).toBe('AB CD');
    expect(applyCleaners('AB-12 34', ['removeSpaces', 'removeDashes', 'lower'])).toBe('ab1234');
    expect(applyCleaners('$1,000', ['removeChars:$,'])).toBe('1000');
    expect(applyCleaners('000123', ['stripLeadingZeros'])).toBe('123');
    expect(applyCleaners('000', ['stripLeadingZeros'])).toBe('0');
    expect(applyCleaners('Ref: 12-34', ['digitsOnly'])).toBe('1234');
    expect(applyCleaners('INV 0042', [{ replace: { pattern: 'INV\\s*', with: '' } }])).toBe('0042');
    expect(applyCleaners('Order PO-123 x', [{ keep: { pattern: 'PO-(\\d+)', group: 1 } }])).toBe(
      '123',
    );
  });
  it('ocrDigits fixes letters only inside otherwise numeric tokens', () => {
    expect(applyCleaners('1O.5O', ['ocrDigits'])).toBe('10.50');
    expect(applyCleaners('$4S.l2', ['ocrDigits'])).toBe('$45.12');
    expect(applyCleaners('B8', ['ocrDigits'])).toBe('88');
    expect(applyCleaners('ST-48213 Sold 1O', ['ocrDigits'])).toBe('ST-48213 Sold 10');
    expect(applyCleaners('Oslo', ['ocrDigits'])).toBe('Oslo');
  });
  it('throws on unknown cleaners', () => {
    expect(() => applyCleaners('x', ['nope'])).toThrow();
  });
});

describe('type inference', () => {
  it('guesses dates, currency, numbers and text', () => {
    expect(inferType('30/09/2026')).toBe('date');
    expect(inferType('$424.18')).toBe('currency');
    expect(inferType('98.45')).toBe('currency');
    expect(inferType('52')).toBe('number');
    expect(inferType('ST-48213')).toBe('text');
  });
});
