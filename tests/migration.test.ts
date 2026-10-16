import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import Dexie from 'dexie';

describe('Dexie v1 to v2 migration', () => {
  it('existing records get format Print and empty audio fields', async () => {
    const v1 = new Dexie('home-library');
    v1.version(1).stores({ books: '&id, title, isbn13, addedAt, updatedAt' });
    await v1.table('books').add({ id: 'old', title: 'Old Book', authors: 'Someone', readDates: ['2020-01-01'] });
    v1.close();
    const { db } = await import('../src/lib/db');
    const b = await db.books.get('old');
    expect(b).toMatchObject({ title: 'Old Book', format: 'Print', narrators: '', length: '', asin: '', readDates: ['2020-01-01'] });
    expect(await db.books.where('format').equals('Print').count()).toBe(1);
  });
});
