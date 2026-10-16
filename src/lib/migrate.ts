/**
 * v3 migration: single `format` becomes the owned-formats set, and existing duplicate
 * entries of one title in different formats (for example a print record and an Audible
 * record) are merged into one entry. Never drops a book: a record is only removed when its
 * data has been folded into another record, and every removal is listed in `removed`.
 */
import type { Book, Format } from './types';
import { isValidReadDate, mergeDates, toFormats } from './types';
import { safeCoverUrl } from './cover';
import { BookIndex, combine } from './match';

const s = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');

const text = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
export const UNTITLED = 'Untitled (from old data)';

/** What the migration had to clean up, so the app can tell the user. */
export interface CleanupReport { droppedDates: number; untitled: number; droppedCovers: number }
export const newCleanup = (): CleanupReport => ({ droppedDates: 0, untitled: 0, droppedCovers: 0 });

/** Read dates from an array, or one string like "2020-01-01" or "2020-01-01; 2021-05-02". */
function readDatesOf(v: unknown, rep: CleanupReport): string[] {
  const raw = (Array.isArray(v) ? v.map(s) : typeof v === 'string' ? v.split(/[;|,]/) : []).map(x => x.trim()).filter(Boolean);
  const ok = mergeDates(raw.filter(d => isValidReadDate(d)));
  rep.droppedDates += new Set(raw).size - ok.length;
  return ok;
}

/** Bring any older record shape up to the current Book shape. Never drops a book. */
export function normalizeRecord(r: Record<string, unknown>, rep: CleanupReport = newCleanup()): Book {
  const dates = readDatesOf(r.readDates, rep);
  let title = text(r.title).trim();
  if (!title) { title = UNTITLED; rep.untitled++; }
  const cover = safeCoverUrl(r.coverUrl);
  if (s(r.coverUrl) && !cover) rep.droppedCovers++;
  return {
    id: s(r.id),
    title,
    authors: s(r.authors),
    formats: toFormats(Array.isArray(r.formats) ? r.formats : s(r.format)),
    narrators: s(r.narrators),
    length: s(r.length),
    asin: s(r.asin),
    isbn13: s(r.isbn13),
    isbn10: s(r.isbn10),
    publisher: s(r.publisher),
    year: s(r.year),
    pages: s(r.pages),
    coverUrl: cover,
    shelf: s(r.shelf),
    notes: s(r.notes),
    readDates: mergeDates(dates),
    addedAt: s(r.addedAt),
    updatedAt: s(r.updatedAt),
  };
}

const disjoint = (a: Format[], b: Format[]) => !a.some(f => b.includes(f));

export interface MigrationResult { books: Book[]; removed: { id: string; into: string }[]; cleanup: CleanupReport }

export function migrateRecords(records: Record<string, unknown>[]): MigrationResult {
  const cleanup = newCleanup();
  const all = records.map(r => normalizeRecord(r, cleanup));
  // Oldest first, so the surviving id is the one added first.
  const order = [...all].sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || ''));
  const idx = new BookIndex<Book>();
  const survivors = new Map<string, Book>();
  const removed: MigrationResult['removed'] = [];
  for (const b of order) {
    // Only fold records that own different formats: two print copies stay two entries.
    const m = idx.find(b, { useId: false, accept: c => disjoint(c.formats, b.formats) });
    if (!m) { idx.add(b); survivors.set(b.id, b); continue; }
    const merged = combine(m, b, (b.updatedAt || '') > (m.updatedAt || ''));
    idx.replace(m, merged);
    survivors.set(m.id, merged);
    removed.push({ id: b.id, into: m.id });
  }
  // Keep the original list order for the survivors.
  return { books: all.filter(b => survivors.has(b.id)).map(b => survivors.get(b.id)!), removed, cleanup };
}
