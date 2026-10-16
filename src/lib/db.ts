import Dexie, { type Table } from 'dexie';
import type { Book } from './types';
import { migrateRecords } from './migrate';
import { titleAuthorKey } from './match';

export const PREMIGRATION_KEY = 'home-library-backup-before-v3';

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
      const { books: next, removed } = migrateRecords(all);
      await books.bulkPut(next);
      if (removed.length) await books.bulkDelete(removed.map(r => r.id));
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
