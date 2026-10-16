import Dexie, { type Table } from 'dexie';
import type { Book } from './types';

class LibraryDB extends Dexie {
  books!: Table<Book, string>;
  constructor() {
    super('home-library');
    this.version(1).stores({ books: '&id, title, isbn13, addedAt, updatedAt' });
    // v2: format, narrators, length, asin. Existing records become Print.
    this.version(2).stores({ books: '&id, title, isbn13, asin, format, addedAt, updatedAt' }).upgrade(tx =>
      tx.table('books').toCollection().modify((b: Partial<Book>) => {
        if (!b.format) b.format = 'Print';
        b.narrators ??= '';
        b.length ??= '';
        b.asin ??= '';
      }));
  }
}

export const db = new LibraryDB();

export async function findDuplicates(isbn13: string, title: string, excludeId?: string): Promise<Book[]> {
  const all = await db.books.toArray();
  const t = title.trim().toLowerCase();
  return all.filter(b => b.id !== excludeId && (
    (isbn13 && b.isbn13 === isbn13) || (!isbn13 && t && b.title.trim().toLowerCase() === t)
  ));
}

const LAST_BACKUP = 'lastBackupAt';
export const getLastBackup = () => localStorage.getItem(LAST_BACKUP);
export const setLastBackup = () => localStorage.setItem(LAST_BACKUP, new Date().toISOString());
