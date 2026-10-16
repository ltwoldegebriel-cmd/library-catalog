/**
 * v3 migration: single `format` becomes the owned-formats set, and existing duplicate
 * entries of one title in different formats (for example a print record and an Audible
 * record) are merged into one entry. Never drops a book: a record is only removed when its
 * data has been folded into another record, and every removal is listed in `removed`.
 */
import type { Book, Format } from './types';
import { mergeDates, toFormats } from './types';
import { BookIndex, combine } from './match';

const s = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

/** Bring any older record shape up to the current Book shape without losing data. */
export function normalizeRecord(r: Record<string, unknown>): Book {
  const dates = Array.isArray(r.readDates) ? r.readDates.map(s).filter(Boolean) : [];
  return {
    id: s(r.id),
    title: s(r.title),
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
    coverUrl: s(r.coverUrl),
    shelf: s(r.shelf),
    notes: s(r.notes),
    readDates: mergeDates(dates),
    addedAt: s(r.addedAt),
    updatedAt: s(r.updatedAt),
  };
}

const disjoint = (a: Format[], b: Format[]) => !a.some(f => b.includes(f));

export interface MigrationResult { books: Book[]; removed: { id: string; into: string }[] }

export function migrateRecords(records: Record<string, unknown>[]): MigrationResult {
  const all = records.map(normalizeRecord);
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
  return { books: all.filter(b => survivors.has(b.id)).map(b => survivors.get(b.id)!), removed };
}
