import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import Dexie from 'dexie';

beforeAll(() => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
});

describe('M6 v4 cleanup for libraries already on v3', () => {
  it('cleans bad dates, string dates and bad titles, snapshots first, tells the user once', async () => {
    const old = new Dexie('home-library');
    old.version(3).stores({ books: '&id, title, isbn13, asin, *formats, addedAt, updatedAt', snapshots: '++id, savedAt' });
    await old.table('books').bulkPut([
      { id: 'a', title: 'A', authors: 'X', formats: ['Print'], readDates: ['2020-01-01', '2099-01-01', 'junk'], addedAt: '1', updatedAt: '1' },
      { id: 'b', title: 'B', authors: 'Y', formats: ['Print'], readDates: '2021-05-05', addedAt: '2', updatedAt: '2' },
      { id: 'c', title: null, authors: 'Z', formats: ['Print'], readDates: [], addedAt: '3', updatedAt: '3' },
      { id: 'd', title: 'Clean', authors: 'Q', formats: ['Print'], narrators: '', length: '', asin: '', isbn13: '', isbn10: '', publisher: '', year: '', pages: '', coverUrl: '', shelf: '', notes: '', readDates: ['2020-02-02'], addedAt: '4', updatedAt: '4' },
    ]);
    old.close();
    const { db, takeCleanupNotice } = await import('../src/lib/db');
    const all = await db.books.toArray();
    const by = new Map(all.map(b => [b.id, b]));
    expect(all).toHaveLength(4);
    expect(by.get('a')!.readDates).toEqual(['2020-01-01']);
    expect(by.get('b')!.readDates).toEqual(['2021-05-05']);
    expect(by.get('c')!.title).toBe('Untitled (from old data)');
    const snaps = await db.snapshots.toArray();
    expect(snaps.at(-1)!.reason).toBe('before v4 cleanup');
    expect(snaps.at(-1)!.books).toHaveLength(3);
    expect(takeCleanupNotice()).toEqual({ droppedDates: 2, untitled: 1, droppedCovers: 0 });
    expect(takeCleanupNotice()).toBeNull();
  });

  it('M2: two imports of the same file at once do not create duplicates', async () => {
    const { db } = await import('../src/lib/db');
    const { applyImport } = await import('../src/lib/importer');
    const { csvToBooks } = await import('../src/lib/io');
    await db.books.clear();
    const csv = 'title,authors\n' + Array.from({ length: 3000 }, (_, i) => `Book ${i},Author ${i}`).join('\n');
    await Promise.all([applyImport(csvToBooks(csv), {}), applyImport(csvToBooks(csv), {})]);
    expect(await db.books.count()).toBe(3000);
  });
});
