import { describe, it, expect } from 'vitest';
import { booksToCsv, csvToBooks, booksToJson, jsonToBooks, booksToXlsx, xlsxToBooks, mergeBooks } from '../src/lib/io';
import type { Book } from '../src/lib/types';

const books: Book[] = [
  {
    id: 'a1', title: 'The Odyssey', authors: 'Homer; Robert Fagles', format: 'Print', narrators: '', length: '', asin: '', isbn13: '9780140449136', isbn10: '0140449132',
    publisher: 'Penguin Classics', year: '1997', pages: '541', shelf: 'Study, top', notes: 'Line one\nLine "two", with comma',
    readDates: ['2019-05-01', '2024-08-15'], coverUrl: 'https://covers.openlibrary.org/b/id/1-M.jpg',
    addedAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-02T10:00:00.000Z',
  },
  {
    id: 'b2', title: 'Café, Crème; "Brûlée"', authors: '', format: 'Ebook', narrators: '', length: '', asin: '', isbn13: '', isbn10: '080442957X',
    publisher: '', year: '', pages: '', shelf: '', notes: '', readDates: [], coverUrl: '',
    addedAt: '2026-10-03T10:00:00.000Z', updatedAt: '2026-10-03T10:00:00.000Z',
  },
  {
    id: 'c3', title: '007', authors: 'Ian Fleming', format: 'Audiobook', narrators: 'Simon Vance; Toby Stephens', length: '6h 5m', asin: 'B0FAKE007X', isbn13: '9780000000002', isbn10: '0000000000',
    publisher: '0042', year: '1953', pages: '00', shelf: '', notes: '=SUM(A1)', readDates: ['2020-01-01'], coverUrl: '',
    addedAt: '2026-10-04T10:00:00.000Z', updatedAt: '2026-10-04T10:00:00.000Z',
  },
];

describe('CSV round-trip', () => {
  it('returns identical books', () => {
    expect(csvToBooks(booksToCsv(books))).toEqual(books);
  });
  it('survives a UTF-8 BOM and double round-trip', () => {
    const once = csvToBooks('\uFEFF' + booksToCsv(books));
    expect(csvToBooks(booksToCsv(once))).toEqual(books);
  });
  it('accepts loose headers from other apps and skips untitled rows', () => {
    const r = csvToBooks('Title,Author,ISBN\nDune,Frank Herbert,978-0441013593\n,,\n');
    expect(r).toHaveLength(1);
    expect(r[0].format).toBe('Print');
    expect(r[0]).toMatchObject({ title: 'Dune', authors: 'Frank Herbert', isbn13: '9780441013593', readDates: [] });
  });
});

describe('JSON and XLSX round-trip', () => {
  it('JSON', () => expect(jsonToBooks(booksToJson(books))).toEqual(books));
  it('XLSX keeps text such as leading zeros', () => {
    const out = xlsxToBooks(booksToXlsx(books));
    expect(out).toEqual(books);
  });
});

describe('merge', () => {
  it('adds new, updates newer, keeps older', () => {
    const existing = [books[0]];
    const newer = { ...books[0], id: 'other', notes: 'changed', updatedAt: '2026-10-10T00:00:00.000Z' };
    const plan = mergeBooks(existing, [newer, books[1]]);
    expect(plan.added).toBe(1);
    expect(plan.updated).toBe(1);
    expect(plan.put.find(b => b.notes === 'changed')!.id).toBe('a1');
    expect(mergeBooks(existing, [{ ...books[0], updatedAt: '2000-01-01T00:00:00.000Z' }]).unchanged).toBe(1);
  });
});
