/**
 * A small Excel (.xlsx) writer for the backup files: one workbook, one sheet
 * per list, a bold frozen header row, set column widths, money with two
 * decimals and real dates (so Excel / Google Sheets can sort and add them up).
 *
 * An .xlsx is a zip of a few XML files; fflate does the zipping.
 */
import { zipSync, strToU8 } from 'fflate';

export type CellKind = 'text' | 'number' | 'money' | 'date' | 'datetime';

export interface Column {
  header: string;
  kind?: CellKind;
  /** Width in characters. */
  width?: number;
}

export type CellValue = string | number | boolean | null | undefined;

export interface Sheet {
  name: string;
  columns: Column[];
  rows: CellValue[][];
  /** A bold last row, e.g. totals. */
  footer?: CellValue[];
}

// Style ids in styles.xml below.
const STYLE = { text: 0, header: 1, money: 2, date: 3, datetime: 4, number: 5, footerText: 6, footerMoney: 7, footerNumber: 8 } as const;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Excel's day number for "2026-11-09", or null when it is not a date. */
export function excelDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(ms) ? null : Math.round((ms - EXCEL_EPOCH_MS) / DAY_MS);
}

/** Excel's day number with the time of day, in India time, for an ISO timestamp. */
export function excelDateTime(value: string): number | null {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return (ms + IST_OFFSET_MS - EXCEL_EPOCH_MS) / DAY_MS;
}

/** 0 -> A, 25 -> Z, 26 -> AA. */
export function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

// Control characters other than tab / newline are not allowed in XML at all.
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function escapeXml(text: string): string {
  return text
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Excel sheet names: at most 31 characters, none of []:*?/\ and unique in the workbook. */
function sheetNames(sheets: Sheet[]): string[] {
  const used = new Set<string>();
  return sheets.map((sheet, i) => {
    const base = sheet.name.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || `Sheet${i + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 28)} ${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

function textCell(ref: string, text: string, style: number): string {
  if (text === '') return style ? `<c r="${ref}" s="${style}"/>` : '';
  return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

function numberCell(ref: string, value: number, style: number): string {
  return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`;
}

function cell(ref: string, value: CellValue, kind: CellKind, footer: boolean): string {
  if (value === null || value === undefined || value === '') return footer ? textCell(ref, '', STYLE.footerText) : '';
  if (typeof value === 'boolean') return textCell(ref, value ? 'Yes' : 'No', footer ? STYLE.footerText : 0);

  if (kind === 'date' || kind === 'datetime') {
    const serial = typeof value === 'string' ? (kind === 'date' ? excelDate(value) : excelDateTime(value)) : null;
    if (serial !== null) return numberCell(ref, serial, kind === 'date' ? STYLE.date : STYLE.datetime);
    return textCell(ref, String(value), footer ? STYLE.footerText : 0);
  }
  if (kind === 'money' || kind === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(n) && String(value).trim() !== '') {
      const style = kind === 'money' ? (footer ? STYLE.footerMoney : STYLE.money) : footer ? STYLE.footerNumber : STYLE.number;
      return numberCell(ref, n, style);
    }
  }
  return textCell(ref, String(value), footer ? STYLE.footerText : 0);
}

function sheetXml(sheet: Sheet): string {
  const kinds = sheet.columns.map((c) => c.kind ?? 'text');
  const lastCol = columnName(Math.max(sheet.columns.length - 1, 0));
  const rowCount = sheet.rows.length + 1 + (sheet.footer ? 1 : 0);

  const cols = sheet.columns
    .map((c, i) => {
      const fallback = c.kind === 'datetime' ? 17 : c.kind === 'date' ? 11 : c.kind === 'money' ? 12 : 10;
      // Never narrower than the header (up to a point), so headers are not cut off.
      const width = Math.max(c.width ?? fallback, Math.min(c.header.length + 2, 20));
      return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`;
    })
    .join('');

  const lines: string[] = [];
  lines.push(
    `<row r="1">${sheet.columns.map((c, i) => textCell(`${columnName(i)}1`, c.header, STYLE.header)).join('')}</row>`
  );
  sheet.rows.forEach((row, r) => {
    const n = r + 2;
    lines.push(`<row r="${n}">${row.map((v, i) => cell(`${columnName(i)}${n}`, v, kinds[i] ?? 'text', false)).join('')}</row>`);
  });
  if (sheet.footer) {
    const n = sheet.rows.length + 2;
    lines.push(
      `<row r="${n}">${sheet.footer.map((v, i) => cell(`${columnName(i)}${n}`, v, kinds[i] ?? 'text', true)).join('')}</row>`
    );
  }

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="A1:${lastCol}${rowCount}"/>` +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${lines.join('')}</sheetData>` +
    '</worksheet>'
  );
}

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="3">' +
  '<numFmt numFmtId="164" formatCode="#,##0.00"/>' +
  '<numFmt numFmtId="165" formatCode="dd-mm-yyyy"/>' +
  '<numFmt numFmtId="166" formatCode="dd-mm-yyyy hh:mm"/>' +
  '</numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFFDE68A"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="9">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="164" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/** The .xlsx file's bytes. */
export function buildXlsx(sheets: Sheet[]): Uint8Array {
  const list = sheets.length ? sheets : [{ name: 'Sheet1', columns: [], rows: [] }];
  const names = sheetNames(list);

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        list
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
          )
          .join('') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets>' +
        names.map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets></workbook>'
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        list
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
          )
          .join('') +
        `<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>'
    ),
    'xl/styles.xml': strToU8(STYLES_XML),
  };
  list.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheet));
  });

  return zipSync(files, { level: 6 });
}
