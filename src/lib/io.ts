import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { Book } from './types';
import { isValidReadDate, mergeDates, newId, toFormats } from './types';
import { checkIsbn, cleanIsbn } from './isbn';
import { BookIndex, combine, sameBook } from './match';

export const COLUMNS: (keyof Book)[] = [
  'id', 'title', 'authors', 'formats', 'narrators', 'length', 'asin', 'isbn13', 'isbn10', 'publisher', 'year', 'pages',
  'shelf', 'notes', 'readDates', 'coverUrl', 'addedAt', 'updatedAt',
];

/** What was cleaned up while reading a file, for the import summary. */
export interface ParseReport { droppedDates: number; invalidIsbns: number; skippedRows: number }
export const newReport = (): ParseReport => ({ droppedDates: 0, invalidIsbns: 0, skippedRows: 0 });

export class ImportError extends Error {}

type Row = Record<string, string>;

function toRow(b: Book): Row {
  const r: Row = {};
  for (const c of COLUMNS) {
    const v = b[c];
    r[c] = Array.isArray(v) ? v.join('; ') : String(v ?? '');
  }
  return r;
}

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));

/** Spreadsheet formula injection guard (CSV only). */
const FORMULA_START = /^[=+\-@\t\r]/;
export const escapeCell = (v: string) => (FORMULA_START.test(v) ? "'" + v : v);
export const unescapeCell = (v: string) => (/^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v);

/** Accepts loose headers too (e.g. "Title", "Author", "ISBN") from other apps, and old single "format" files. */
function fromRow(r: Record<string, unknown>, rep: ParseReport = newReport()): Book | null {
  const lower: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) lower[k.trim().toLowerCase().replace(/[\s_-]/g, '')] = v;
  const g = (...keys: string[]) => keys.map(k => str(lower[k.toLowerCase()]).trim()).find(v => v !== '') ?? '';
  const title = g('title');
  if (!title) { rep.skippedRows++; return null; }

  // ISBNs: validate and fill both forms; keep invalid ones as typed and count them.
  let isbn13 = '', isbn10 = '';
  const raw = [g('isbn13', 'ean'), g('isbn'), g('isbn10')].map(cleanIsbn).filter(Boolean);
  if (raw.length) {
    const ok = raw.map(checkIsbn).find(c => c.ok);
    if (ok && ok.ok) { isbn13 = ok.isbn13; isbn10 = ok.isbn10 ?? ''; }
    else {
      rep.invalidIsbns++;
      isbn13 = raw.find(x => x.length === 13) ?? '';
      isbn10 = raw.find(x => x.length === 10) ?? (isbn13 ? '' : raw[0]);
    }
  }

  const dateVal = lower['readdates'];
  const dates = (Array.isArray(dateVal) ? dateVal.map(str) : str(dateVal).split(/[;|]/)).map(s => s.trim()).filter(Boolean);
  const readDates = mergeDates(dates.filter(d => isValidReadDate(d)));
  rep.droppedDates += new Set(dates).size - readDates.length;

  const fv = lower['formats'] ?? lower['format'];
  return {
    id: g('id') || newId(),
    title,
    authors: g('authors', 'author', 'creators'),
    formats: toFormats(Array.isArray(fv) ? fv : str(fv)),
    narrators: g('narrators', 'narrator'),
    length: g('length'),
    asin: g('asin'),
    isbn13,
    isbn10,
    publisher: g('publisher'),
    year: g('year', 'publishyear', 'published'),
    pages: g('pages', 'pagecount'),
    shelf: g('shelf', 'location'),
    notes: str(lower['notes']),
    readDates,
    coverUrl: g('coverurl', 'cover'),
    addedAt: g('addedat'),
    updatedAt: g('updatedat'), // '' means the file did not say; treated as older than in-app edits
  };
}

export function booksToCsv(books: Book[]): string {
  const rows = books.map(toRow).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, escapeCell(v)])));
  return Papa.unparse(rows, { columns: COLUMNS as string[], newline: '\r\n' });
}

export function csvToBooks(text: string, rep: ParseReport = newReport()): Book[] {
  const res = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ''), {
    header: true, skipEmptyLines: 'greedy', dynamicTyping: false, transform: unescapeCell,
  });
  const bad = res.errors.find(e => e.type === 'Quotes');
  if (bad) throw new ImportError(`Row ${(bad.row ?? 0) + 1} could not be read (a quote is not closed). Nothing was imported.`);
  return res.data.map(r => fromRow(r, rep)).filter((b): b is Book => !!b);
}

export function booksToJson(books: Book[]): string {
  return JSON.stringify({ app: 'home-library', version: 2, exportedAt: new Date().toISOString(), books }, null, 2);
}

const NOT_BACKUP = 'This is not a Home Library backup file.';

export function jsonToBooks(text: string, rep: ParseReport = newReport()): Book[] {
  let j: unknown;
  try { j = JSON.parse(text); } catch { throw new ImportError(NOT_BACKUP + ' The JSON is incomplete or damaged.'); }
  const arr = Array.isArray(j) ? j : (j && typeof j === 'object' && Array.isArray((j as { books?: unknown }).books)) ? (j as { books: unknown[] }).books : null;
  if (!arr) throw new ImportError(NOT_BACKUP);
  return arr.filter(o => o && typeof o === 'object').map(o => fromRow(o as Record<string, unknown>, rep)).filter((b): b is Book => !!b);
}

export const XLSX_CELL_MAX = 32767;
const TRUNC = ' [cut: too long for Excel]';

/** Number of cells that will be shortened to fit Excel's 32,767 character limit. */
export const xlsxTruncatedCells = (books: Book[]) =>
  books.reduce((n, b) => n + Object.values(toRow(b)).filter(v => v.length > XLSX_CELL_MAX).length, 0);

export function booksToXlsx(books: Book[]): ArrayBuffer {
  const rows = books.map(toRow).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) =>
    [k, v.length > XLSX_CELL_MAX ? v.slice(0, XLSX_CELL_MAX - TRUNC.length) + TRUNC : v])));
  const ws = XLSX.utils.json_to_sheet(rows, { header: COLUMNS as string[] });
  // Keep ISBNs and every cell as text so leading zeros survive and nothing runs as a formula.
  for (const key of Object.keys(ws)) if (!key.startsWith('!')) ws[key].t = 's';
  ws['!cols'] = COLUMNS.map(c => ({ wch: c === 'title' ? 40 : c === 'notes' ? 30 : 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Books');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

export function xlsxToBooks(data: ArrayBuffer, rep: ParseReport = newReport()): Book[] {
  let rows: Record<string, unknown>[];
  try {
    const wb = XLSX.read(data, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { raw: false, defval: '' });
  } catch { throw new ImportError('This is not a readable Excel file.'); }
  return rows.map(r => fromRow(r, rep)).filter((b): b is Book => !!b);
}

export interface MergePlan { put: Book[]; added: number; updated: number; unchanged: number; mergedInFile: number }
export interface MergeOptions {
  /** Let a file row replace in-app values, only when the row has its own newer updatedAt. Default false. */
  preferNewerImport?: boolean;
  now?: string;
}

/**
 * Merge imported books into the library. Matching follows match.ts (id, ASIN, ISBN-13,
 * title + first author). Formats and read dates are always unioned and empty fields are
 * filled. In-app values win unless `preferNewerImport` is on and the row is newer.
 * Rows repeated inside the file are folded together.
 */
export function mergeBooks(existing: Book[], incoming: Book[], opts: MergeOptions = {}): MergePlan {
  const now = opts.now ?? new Date().toISOString();
  const idx = new BookIndex<Book>(existing);
  const original = new Map(existing.map(b => [b.id, b]));
  const current = new Map(existing.map(b => [b.id, b]));
  const plan: MergePlan = { put: [], added: 0, updated: 0, unchanged: 0, mergedInFile: 0 };

  for (const inc of incoming) {
    const m = idx.find(inc);
    if (!m) {
      const b = { ...inc, id: current.has(inc.id) ? newId() : inc.id, addedAt: inc.addedAt || now, updatedAt: inc.updatedAt || now };
      idx.add(b); current.set(b.id, b); plan.added++;
      continue;
    }
    const isNewInFile = !original.has(m.id);
    const preferB = !isNewInFile && !!opts.preferNewerImport && !!inc.updatedAt && inc.updatedAt > m.updatedAt;
    let c = combine(m, { ...inc, updatedAt: inc.updatedAt || '' }, preferB);
    if (!preferB && !sameBook({ ...c, updatedAt: m.updatedAt }, m)) c = { ...c, updatedAt: [now, c.updatedAt].sort().pop()! };
    if (!preferB && sameBook({ ...c, updatedAt: m.updatedAt }, m)) c = m;
    if (isNewInFile) plan.mergedInFile++;
    else if (c === m || sameBook(c, m)) plan.unchanged++;
    else plan.updated++;
    if (c !== m) { idx.replace(m, c); current.set(c.id, c); }
  }
  for (const [id, b] of current) {
    const o = original.get(id);
    if (!o || !sameBook(o, b)) plan.put.push(b);
  }
  return plan;
}
