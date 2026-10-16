import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { Book } from './types';
import { newId, toFormat } from './types';

export const COLUMNS: (keyof Book)[] = [
  'id', 'title', 'authors', 'format', 'narrators', 'length', 'asin', 'isbn13', 'isbn10', 'publisher', 'year', 'pages',
  'shelf', 'notes', 'readDates', 'coverUrl', 'addedAt', 'updatedAt',
];

type Row = Record<string, string>;

function toRow(b: Book): Row {
  const r: Row = {};
  for (const c of COLUMNS) r[c] = c === 'readDates' ? b.readDates.join('; ') : String(b[c] ?? '');
  return r;
}

function str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v);
}

/** Accepts loose headers too (e.g. "Title", "Author", "ISBN") from other apps. */
function fromRow(r: Record<string, unknown>): Book | null {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(r)) lower[k.trim().toLowerCase().replace(/[\s_]/g, '')] = str(v);
  const g = (...keys: string[]) => keys.map(k => lower[k.toLowerCase()]).find(v => v !== undefined && v !== '') ?? '';
  const title = g('title').trim();
  if (!title) return null;
  const now = new Date().toISOString();
  const isbn = g('isbn13', 'isbn', 'ean').replace(/[^0-9X]/gi, '');
  return {
    id: g('id') || newId(),
    title,
    authors: g('authors', 'author', 'creators'),
    format: toFormat(g('format')),
    narrators: g('narrators', 'narrator'),
    length: g('length'),
    asin: g('asin'),
    isbn13: isbn.length === 13 ? isbn : '',
    isbn10: g('isbn10') || (isbn.length === 10 ? isbn : ''),
    publisher: g('publisher'),
    year: g('year', 'publishyear', 'published'),
    pages: g('pages', 'pagecount'),
    shelf: g('shelf', 'location'),
    notes: g('notes'),
    readDates: g('readdates').split(/[;|]/).map(s => s.trim()).filter(Boolean),
    coverUrl: g('coverurl', 'cover'),
    addedAt: g('addedat') || now,
    updatedAt: g('updatedat') || now,
  };
}

export function booksToCsv(books: Book[]): string {
  return Papa.unparse(books.map(toRow), { columns: COLUMNS as string[], newline: '\r\n' });
}

export function csvToBooks(text: string): Book[] {
  const res = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ''), {
    header: true, skipEmptyLines: 'greedy', dynamicTyping: false,
  });
  return res.data.map(fromRow).filter((b): b is Book => !!b);
}

export function booksToJson(books: Book[]): string {
  return JSON.stringify({ app: 'home-library', version: 1, exportedAt: new Date().toISOString(), books }, null, 2);
}

export function jsonToBooks(text: string): Book[] {
  const j = JSON.parse(text);
  const arr: unknown[] = Array.isArray(j) ? j : j.books ?? [];
  return arr.map(o => {
    const b = o as Record<string, unknown>;
    const book = fromRow({ ...b, readDates: '' });
    if (book && Array.isArray(b.readDates)) book.readDates = b.readDates.map(String);
    return book;
  }).filter((b): b is Book => !!b);
}

export function booksToXlsx(books: Book[]): ArrayBuffer {
  const ws = XLSX.utils.json_to_sheet(books.map(toRow), { header: COLUMNS as string[] });
  // Keep ISBNs and every cell as text so leading zeros survive.
  for (const key of Object.keys(ws)) if (!key.startsWith('!')) ws[key].t = 's';
  ws['!cols'] = COLUMNS.map(c => ({ wch: c === 'title' ? 40 : c === 'notes' ? 30 : 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Books');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

export function xlsxToBooks(data: ArrayBuffer): Book[] {
  const wb = XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { raw: false, defval: '' });
  return rows.map(fromRow).filter((b): b is Book => !!b);
}

export interface MergePlan { put: Book[]; added: number; updated: number; unchanged: number }

/** Merge by id, then ISBN-13, then exact title + authors. Newest updatedAt wins per book. */
export function mergeBooks(existing: Book[], incoming: Book[]): MergePlan {
  const byId = new Map(existing.map(b => [b.id, b]));
  const byIsbn = new Map(existing.filter(b => b.isbn13).map(b => [b.isbn13, b]));
  const byAsin = new Map(existing.filter(b => b.asin).map(b => [b.asin, b]));
  const key = (b: Book) => `${b.title.trim().toLowerCase()}|${b.authors.trim().toLowerCase()}`;
  const byKey = new Map(existing.map(b => [key(b), b]));
  const plan: MergePlan = { put: [], added: 0, updated: 0, unchanged: 0 };
  for (const inc of incoming) {
    const match = byId.get(inc.id) ?? (inc.isbn13 ? byIsbn.get(inc.isbn13) : undefined) ?? (inc.asin ? byAsin.get(inc.asin) : undefined) ?? byKey.get(key(inc));
    if (!match) { plan.put.push(inc); plan.added++; continue; }
    if (inc.updatedAt > match.updatedAt) {
      plan.put.push({ ...inc, id: match.id, addedAt: match.addedAt < inc.addedAt ? match.addedAt : inc.addedAt });
      plan.updated++;
    } else plan.unchanged++;
  }
  return plan;
}
