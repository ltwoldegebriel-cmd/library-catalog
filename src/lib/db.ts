import Dexie, { type Table } from 'dexie';
import type { Book } from './types';
import { migrateRecords, newCleanup, normalizeRecord, type CleanupReport } from './migrate';
import { titleAuthorKey } from './match';

export const PREMIGRATION_KEY = 'home-library-backup-before-v3';
export const CLEANUP_KEY = 'nineveh-migration-cleanup';

function noteCleanup(c: CleanupReport) {
  if (!c.droppedDates && !c.untitled && !c.droppedCovers) return;
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(CLEANUP_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}
/** Cleanup done by the last upgrade, shown once to the user. */
export function takeCleanupNotice(): CleanupReport | null {
  try {
    const v = localStorage.getItem(CLEANUP_KEY);
    if (!v) return null;
    localStorage.removeItem(CLEANUP_KEY);
    return { ...newCleanup(), ...JSON.parse(v) };
  } catch { return null; }
}

interface Snapshot { id?: number; reason: string; savedAt: string; books: unknown[] }

class LibraryDB extends Dexie {
  books!: Table<Book, string>;
  snapshots!: Table<Snapshot, number>;
  constructor() {
    super('home-library');
    this.version(1).stores({ books: '&id, title, isbn13, addedAt, updatedAt' });
    // v2: format, narrators, length, asin. Existing records become Print.
    this.version(2).stores({ books: '&id, title, isbn13, asin, format, addedAt, updatedAt' }).upgrade(tx =>
      tx.table('books').toCollection().modify((b: Record<string, unknown>) => {
        if (!b.format) b.format = 'Print';
        b.narrators ??= '';
        b.length ??= '';
        b.asin ??= '';
      }));
    // v3: owned formats set, one entry per title. Dump everything first as a safety net.
    this.version(3).stores({ books: '&id, title, isbn13, asin, *formats, addedAt, updatedAt', snapshots: '++id, savedAt' }).upgrade(async tx => {
      const books = tx.table('books');
      const all = await books.toArray();
      const snap = { reason: 'before v3 migration', savedAt: new Date().toISOString(), books: all };
      try { if (typeof localStorage !== 'undefined') localStorage.setItem(PREMIGRATION_KEY, JSON.stringify(snap)); }
      catch { /* storage full: the snapshot table below still has it */ }
      await tx.table('snapshots').add(snap);
      const { books: next, removed, cleanup } = migrateRecords(all);
      await books.bulkPut(next);
      if (removed.length) await books.bulkDelete(removed.map(r => r.id));
      noteCleanup(cleanup);
    });
    // v4: libraries already on v3 get the same cleanup (bad read dates, string read dates,
    // empty or non-text titles, unsafe cover URLs). No merging, never drops a book.
    this.version(4).stores({}).upgrade(async tx => {
      const cleanup = newCleanup();
      const books = tx.table('books');
      const all: Record<string, unknown>[] = await books.toArray();
      const changed = all.map(r => ({ r, n: normalizeRecord(r, cleanup) })).filter(({ r, n }) =>
        JSON.stringify(n) !== JSON.stringify({ ...n, ...Object.fromEntries(Object.keys(n).map(k => [k, r[k]])) }));
      if (!changed.length) return;
      await tx.table('snapshots').add({ reason: 'before v4 cleanup', savedAt: new Date().toISOString(), books: changed.map(c => c.r) });
      await books.bulkPut(changed.map(c => c.n));
      noteCleanup(cleanup);
    });
  }
}

export const db = new LibraryDB();

export async function findDuplicates(isbn13: string, title: string, authors: string, excludeId?: string): Promise<Book[]> {
  const all = await db.books.toArray();
  const key = titleAuthorKey(title, authors);
  const t = title.trim().toLowerCase();
  return all.filter(b => b.id !== excludeId && (
    (isbn13 && b.isbn13 === isbn13) || (key ? titleAuthorKey(b.title, b.authors) === key : !!t && b.title.trim().toLowerCase() === t)
  ));
}

/** Ask the browser not to evict the library under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return false; }
}

const LAST_BACKUP = 'lastBackupAt';
export const getLastBackup = () => localStorage.getItem(LAST_BACKUP);
export const setLastBackup = () => localStorage.setItem(LAST_BACKUP, new Date().toISOString());
