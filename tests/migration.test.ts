import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Dexie from 'dexie';
import { migrateRecords } from '../src/lib/migrate';

const fixture = (): Record<string, unknown>[] => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'premigration-v2.json'), 'utf8'));

beforeAll(() => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k), clear: () => store.clear(),
  };
});

describe('migrateRecords (v3, pure)', () => {
  const recs = fixture();
  const { books, removed } = migrateRecords(recs);
  const byId = new Map(books.map(b => [b.id, b]));

  it('never drops a book: every record survives or is folded into a survivor', () => {
    expect(books.length + removed.length).toBe(recs.length);
    for (const r of recs) {
      const id = r.id as string;
      const gone = removed.find(x => x.id === id);
      expect(byId.has(id) || (!!gone && byId.has(gone.into))).toBe(true);
    }
    // Every read date of every original is still somewhere.
    for (const r of recs) for (const d of (r.readDates as string[] ?? [])) {
      const id = removed.find(x => x.id === r.id)?.into ?? (r.id as string);
      expect(byId.get(id)!.readDates).toContain(d);
    }
  });

  it('merges a print and audiobook pair: union of dates (deduped), all fields kept, newer edit preferred', () => {
    const d = byId.get('dune-p')!;
    expect(byId.has('dune-a')).toBe(false);
    expect(d).toMatchObject({
      formats: ['Print', 'Audiobook'], readDates: ['2015-06-01', '2021-03-03', '2024-01-10'],
      shelf: 'Den', publisher: 'Ace', year: '1990', asin: 'B002V1OF70', narrators: 'Scott Brick; Simon Vance', length: '21h 2m',
      notes: 'Newer note', coverUrl: 'https://m.media-amazon.com/images/I/fake._SL500_.jpg',
      addedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z',
    });
  });

  it('matches across punctuation, case, accents and curly quotes', () => {
    expect(byId.get('lh-p')).toMatchObject({ formats: ['Print', 'Audiobook'], asin: 'B0FAKE0001', isbn13: '9780306406157' });
    expect(byId.has('lh-a')).toBe(false);
  });

  it('matches by ISBN-13 even when the title text differs', () => {
    expect(byId.get('cp-p')!.formats).toEqual(['Print', 'Ebook']);
    expect(byId.has('cp-e')).toBe(false);
  });

  it('folds print, ebook and audiobook of one title into one entry', () => {
    expect(byId.get('tri-p')).toMatchObject({ formats: ['Print', 'Audiobook', 'Ebook'], readDates: ['2018-01-01', '2022-02-02'], asin: 'B0GILEAD' });
  });

  it('does not merge on title alone, across different ASINs, different authors, or same-format copies', () => {
    for (const id of ['nb-p', 'nb-a', 'hp1-a', 'hp2-a', 'copy-1', 'copy-2', 'emma-p', 'emma-a']) expect(byId.has(id)).toBe(true);
    // The print Harry Potter 1 joins its own audiobook, not book 2.
    expect(byId.has('hp1-p')).toBe(false);
    expect(byId.get('hp1-a')).toMatchObject({ formats: ['Print', 'Audiobook'], shelf: 'Kids', asin: 'B1' });
    expect(byId.get('hp2-a')!.formats).toEqual(['Audiobook']);
  });

  it('keeps old v1 records, untitled records and Ge\'ez titles', () => {
    expect(byId.get('v1-old')).toMatchObject({ formats: ['Print'], narrators: '', readDates: ['2019-09-09'] });
    expect(byId.get('no-title')).toMatchObject({ title: '', notes: 'Imported row with no title' });
    expect(byId.get('geez-p')!.formats).toEqual(['Print', 'Audiobook']);
  });
});

describe('Dexie upgrades', () => {
  it('v1 records reach v3 with formats Print and empty audio fields', async () => {
    const v1 = new Dexie('home-library');
    v1.version(1).stores({ books: '&id, title, isbn13, addedAt, updatedAt' });
    await v1.table('books').add({ id: 'old', title: 'Old Book', authors: 'Someone', readDates: ['2020-01-01'] });
    v1.close();
    const { db } = await import('../src/lib/db');
    const b = await db.books.get('old');
    expect(b).toMatchObject({ title: 'Old Book', formats: ['Print'], narrators: '', length: '', asin: '', readDates: ['2020-01-01'] });
    expect(b).not.toHaveProperty('format');
    expect(await db.books.where('formats').equals('Print').count()).toBe(1);
    db.close();
    await Dexie.delete('home-library');
  });

  it('v2 to v3: snapshot first (localStorage and snapshots table), then merge, dropping nothing', async () => {
    vi.resetModules();
    localStorage.clear();
    const recs = fixture();
    const v2 = new Dexie('home-library');
    v2.version(1).stores({ books: '&id, title, isbn13, addedAt, updatedAt' });
    v2.version(2).stores({ books: '&id, title, isbn13, asin, format, addedAt, updatedAt' });
    await v2.table('books').bulkAdd(recs);
    v2.close();
    const { db, PREMIGRATION_KEY } = await import('../src/lib/db');
    const after = await db.books.toArray();
    const expected = migrateRecords(recs);
    expect(after.length).toBe(expected.books.length);
    expect(after.length).toBe(recs.length - expected.removed.length);
    const snap = JSON.parse(localStorage.getItem(PREMIGRATION_KEY)!);
    expect(snap.books).toHaveLength(recs.length);
    expect((await db.snapshots.toArray())[0].books).toHaveLength(recs.length);
    expect((await db.books.get('dune-p'))!.formats).toEqual(['Print', 'Audiobook']);
    expect(await db.books.where('formats').equals('Audiobook').count()).toBe(after.filter(b => b.formats.includes('Audiobook')).length);
    db.close();
  });
});
