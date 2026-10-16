/**
 * Import for Audible Library Extractor (ALE) exports.
 * https://github.com/joonaspaakko/audible-library-extractor
 *
 * Formats, from the extension source:
 * - "Export raw data" JSON (content-script/_components/layout/ale-launcher-button.vue, exportRawData):
 *   chrome.storage data after glueFriesBackTogether(), so books sit in a root `library`
 *   array (and `wishlist`). Each book has `asin`, `title`, `titleShort`,
 *   `authors` and `narrators` as [{ name, url }], `length` like "11h 2m ", and `cover`
 *   as an Amazon image id (gallery-makeCoverUrl.js builds
 *   https://m.media-amazon.com/images/I/{id}._SL500_.jpg). Older or unglued data keeps
 *   chunked arrays under `audibledata.library`, which is handled too.
 * - Spreadsheet CSV (gallery/_components/snippets/save-csv.vue): headers are lodash
 *   startCase of the keys ("Title", "Title Short", "Authors", "Narrators", "Length",
 *   "Cover", ...), except ASIN/ISBN keys, which are upper-cased ("ASIN", "ISBN10",
 *   "ISBN13"). People arrays are joined with ", ". Cover is a full image URL. The
 *   "With formulas" variant wraps cells in =HYPERLINK()/=IMAGE() formulas. The
 *   Goodreads variant uses "Title", "Author", "ISBN", "ISBN13", "ASIN".
 */
import Papa from 'papaparse';
import type { Book } from './types';
import { newId } from './types';

export type AudibleItem = Pick<Book, 'title' | 'authors' | 'narrators' | 'length' | 'asin' | 'coverUrl' | 'isbn13' | 'isbn10'>;

const coverFromId = (id: string) => `https://m.media-amazon.com/images/I/${id}._SL500_.jpg`;

function names(v: unknown): string {
  if (Array.isArray(v)) return v.map(p => (typeof p === 'string' ? p : (p as { name?: string })?.name ?? '')).map(s => s.trim()).filter(Boolean).join('; ');
  if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean).join('; ');
  return '';
}

/** Undo spreadsheet formulas from the "With formulas" variant. */
function unformula(v: string): string {
  const s = v.trim();
  if (!s.startsWith('=')) return s.replace(/^'/, '');
  const text = s.match(/HYPERLINK\(\s*"[^"]*"\s*[;,]\s*"((?:[^"]|"")*)"\s*\)/i);
  if (text) return text[1].replace(/""/g, '"');
  const img = s.match(/IMAGE\(\s*"([^"]+)"/i);
  if (img) return img[1];
  const url = s.match(/HYPERLINK\(\s*"([^"]+)"/i);
  return url ? url[1] : '';
}

function cleanCover(v: string): string {
  const s = unformula(v);
  if (!s || s.startsWith('data:')) return '';
  if (/^https?:\/\//.test(s)) return s.replace(/\._SL\d+_\./, '._SL500_.');
  return /^[\w%+-]+$/.test(s) ? coverFromId(s) : '';
}

const cleanLength = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');

function fromJsonBook(b: Record<string, unknown>): AudibleItem | null {
  const title = String(b.title ?? b.titleShort ?? '').trim();
  if (!title) return null;
  const isbns = Array.isArray(b.isbns) ? (b.isbns as { type?: string; identifier?: string }[]) : [];
  return {
    title,
    authors: names(b.authors),
    narrators: names(b.narrators),
    length: cleanLength(b.length),
    asin: String(b.asin ?? '').trim(),
    coverUrl: typeof b.cover === 'string' ? cleanCover(b.cover) : '',
    isbn13: isbns.find(i => i.type === 'ISBN_13')?.identifier ?? '',
    isbn10: isbns.find(i => i.type === 'ISBN_10')?.identifier ?? '',
  };
}

export function isAudibleJson(data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  const lib = d.library ?? (d.audibledata as Record<string, unknown> | undefined)?.library;
  if (!Array.isArray(lib)) return false;
  const first = (lib.flat(2) as Record<string, unknown>[])[0];
  return !first || ('asin' in first && 'title' in first);
}

export function parseAudibleJson(text: string): AudibleItem[] {
  const d = JSON.parse(text);
  if (!isAudibleJson(d)) throw new Error('This is not an Audible Library Extractor data file.');
  const lib = (d.library ?? d.audibledata.library) as unknown[];
  return (lib.flat(2) as Record<string, unknown>[]).map(fromJsonBook).filter((b): b is AudibleItem => !!b);
}

const headerKey = (h: string) => h.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_]/g, '');

export function isAudibleHeaders(headers: string[]): boolean {
  const k = headers.map(headerKey);
  return k.includes('asin') && k.includes('title') && (k.includes('narrators') || k.includes('length') || k.includes('titleshort') || k.includes('bookshelves'));
}

export function fromAudibleRow(r: Record<string, unknown>): AudibleItem | null {
  const m: Record<string, string> = {};
  for (const [k, v] of Object.entries(r)) m[headerKey(k)] = unformula(String(v ?? ''));
  const title = (m.title || m.titleshort || '').trim();
  if (!title) return null;
  return {
    title,
    authors: names(m.authors ?? m.author ?? ''),
    narrators: names(m.narrators ?? ''),
    length: cleanLength(m.length),
    asin: (m.asin ?? '').trim(),
    coverUrl: cleanCover(m.cover ?? ''),
    isbn13: (m.isbn13 ?? '').replace(/\D/g, ''),
    isbn10: (m.isbn10 || m.isbn || '').replace(/[^\dX]/gi, ''),
  };
}

export function parseAudibleCsv(text: string): AudibleItem[] {
  const res = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: 'greedy' });
  if (!isAudibleHeaders(res.meta.fields ?? [])) throw new Error('This CSV does not have the Audible Library Extractor columns (Title, ASIN, Narrators, Length).');
  return res.data.map(fromAudibleRow).filter((b): b is AudibleItem => !!b);
}

/** Normalised "title|first author" key for fallback matching. */
export function titleAuthorKey(title: string, authors: string): string {
  const norm = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/['\u2019]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^(the|a|an) /, '');
  const t = norm(title.split(':')[0]);
  const a = norm(authors.split(/[;,]/)[0] ?? '');
  return `${t}|${a}`;
}

export interface AudiblePlan { add: Book[]; newCount: number; existingCount: number; skippedInFile: number }

/** Only new purchases are added. Matches on ASIN, then normalised title + first author. */
export function planAudibleImport(existing: Book[], items: AudibleItem[], now = new Date().toISOString()): AudiblePlan {
  const asins = new Set(existing.map(b => b.asin).filter(Boolean));
  // Title + author fallback only matches audiobooks, so owning the print edition doesn't block the audiobook.
  const keys = new Set(existing.filter(b => b.format === 'Audiobook').map(b => titleAuthorKey(b.title, b.authors)));
  const plan: AudiblePlan = { add: [], newCount: 0, existingCount: 0, skippedInFile: 0 };
  const seenAsin = new Set<string>();
  const seenKey = new Set<string>();
  for (const it of items) {
    const key = titleAuthorKey(it.title, it.authors);
    if ((it.asin && asins.has(it.asin)) || keys.has(key)) { plan.existingCount++; continue; }
    if ((it.asin && seenAsin.has(it.asin)) || seenKey.has(key)) { plan.skippedInFile++; continue; }
    if (it.asin) seenAsin.add(it.asin);
    seenKey.add(key);
    plan.add.push({
      id: newId(), ...it, format: 'Audiobook', publisher: '', year: '', pages: '', shelf: '', notes: '',
      readDates: [], addedAt: now, updatedAt: now,
    });
    plan.newCount++;
  }
  return plan;
}
