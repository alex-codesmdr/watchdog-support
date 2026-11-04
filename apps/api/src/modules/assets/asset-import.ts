import ExcelJS from 'exceljs';
import { IMPORT_COLUMNS } from '@wd/contracts';

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];
export type RawRow = { row: number; values: Partial<Record<ImportColumn, string>> };

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** Header aliases people commonly type, folded to our column keys. */
const ALIASES: Record<string, ImportColumn> = {
  organization: 'organisation',
  org: 'organisation',
  customer: 'organisation',
  serial: 'serial_number',
  serialno: 'serial_number',
  serial_no: 'serial_number',
  model: 'sku',
  product: 'sku',
  location: 'site',
  mac_address: 'mac',
  version: 'software_version',
  firmware: 'software_version',
  warranty_start: 'coverage_start',
  warranty_end: 'coverage_end',
  contract: 'contract_ref',
};
const normHeader = (h: string): ImportColumn | null => {
  const k = h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  if ((IMPORT_COLUMNS as readonly string[]).includes(k)) return k as ImportColumn;
  return ALIASES[k] ?? ALIASES[k.replace(/_/g, '')] ?? null;
};

/** RFC 4180 CSV (quoted fields, doubled quotes, CRLF/LF, optional BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const cellText = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    return '';
  }
  return String(v);
};

async function xlsxRows(buf: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (r, n) => {
    const vals: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) vals.push(cellText(r.getCell(c).value));
    out[n - 1] = vals;
  });
  return Array.from(out, (r) => r ?? []);
}

export class ImportFileError extends Error {}

/** Reads a CSV or XLSX upload into keyed rows. Unknown columns are reported, not silently dropped. */
export async function readImportFile(
  buf: Buffer,
): Promise<{ rows: RawRow[]; unknownColumns: string[] }> {
  const isZip = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
  let grid: string[][];
  if (isZip) {
    try {
      grid = await xlsxRows(buf);
    } catch {
      throw new ImportFileError(
        'The Excel file could not be read. Save it as .xlsx or CSV and try again.',
      );
    }
  } else {
    const text = buf.toString('utf8');
    if (text.includes('\u0000')) throw new ImportFileError('Upload a CSV or .xlsx file.');
    grid = parseCsv(text);
  }
  const header = grid[0];
  if (!header) throw new ImportFileError('The file is empty.');
  const cols = header.map((h) => normHeader(h));
  const unknownColumns = header.filter((h, i) => h.trim() && !cols[i]);
  for (const need of ['organisation', 'serial_number', 'sku'] as const)
    if (!cols.includes(need)) throw new ImportFileError(`The column "${need}" is missing.`);
  const rows: RawRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i]!;
    if (cells.every((c) => !c.trim())) continue;
    const values: RawRow['values'] = {};
    cols.forEach((k, j) => {
      const v = (cells[j] ?? '').trim();
      if (k && v) values[k] = v;
    });
    rows.push({ row: i + 1, values });
  }
  if (rows.length > MAX_IMPORT_ROWS)
    throw new ImportFileError(
      `A file can hold at most ${MAX_IMPORT_ROWS} devices; split it and import each part.`,
    );
  return { rows, unknownColumns };
}

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const toCsv = (rows: string[][]) =>
  rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
