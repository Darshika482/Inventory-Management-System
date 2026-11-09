import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildXlsx, columnName, escapeXml, excelDate, excelDateTime } from './xlsx';

describe('xlsx helpers', () => {
  it('names columns like Excel', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  });

  it('turns dates into Excel day numbers', () => {
    expect(excelDate('1900-01-01')).toBe(2);
    expect(excelDate('2026-11-09')).toBe(46335);
    expect(excelDate('not a date')).toBeNull();
    // 18:30 UTC is midnight of the next day in India.
    expect(excelDateTime('2026-11-08T18:30:00Z')).toBe(46334 + 1);
  });

  it('escapes XML and drops characters XML cannot hold', () => {
    expect(escapeXml('A & B <C> "D"\u0001')).toBe('A &amp; B &lt;C&gt; &quot;D&quot;');
  });
});

describe('buildXlsx', () => {
  const file = buildXlsx([
    {
      name: 'Udhaar list',
      columns: [
        { header: 'Customer' },
        { header: 'Total', kind: 'money' },
        { header: 'Since', kind: 'date' },
        { header: 'Active' },
      ],
      rows: [
        ['Ramesh & Sons', 1250.5, '2026-10-01', true],
        ['रमेश', '99', '', false],
      ],
      footer: ['Total', 1349.5, '', ''],
    },
    { name: 'Bad/name?', columns: [{ header: 'A' }], rows: [] },
    { name: 'Udhaar LIST', columns: [{ header: 'A' }], rows: [] },
  ]);
  const files = unzipSync(file);
  const text = (name: string) => strFromU8(files[name]);

  it('is a zip with the parts Excel needs', () => {
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
      'xl/worksheets/sheet3.xml',
    ]);
  });

  it('gives every sheet a valid, unique name', () => {
    const workbook = text('xl/workbook.xml');
    expect(workbook).toContain('name="Udhaar list"');
    expect(workbook).toContain('name="Bad name"');
    expect(workbook).toContain('name="Udhaar LIST 2"');
  });

  it('writes text, money, dates and the footer', () => {
    const sheet = text('xl/worksheets/sheet1.xml');
    expect(sheet).toContain('<t xml:space="preserve">Ramesh &amp; Sons</t>');
    expect(sheet).toContain('<t xml:space="preserve">रमेश</t>');
    expect(sheet).toContain('<c r="B2" s="2"><v>1250.5</v></c>');
    expect(sheet).toContain('<c r="B3" s="2"><v>99</v></c>');
    expect(sheet).toContain(`<c r="C2" s="3"><v>${excelDate('2026-10-01')}</v></c>`);
    expect(sheet).toContain('<t xml:space="preserve">Yes</t>');
    expect(sheet).toContain('<c r="B4" s="7"><v>1349.5</v></c>');
    expect(sheet).toContain('<dimension ref="A1:D4"/>');
    expect(sheet).toContain('state="frozen"');
  });
});
