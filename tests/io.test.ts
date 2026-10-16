import { describe, it, expect } from 'vitest';
import { booksToCsv, csvToBooks, booksToJson, jsonToBooks, booksToXlsx, xlsxToBooks, mergeBooks, newReport, ImportError, XLSX_CELL_MAX, escapeCell, unescapeCell } from '../src/lib/io';
import { isAudibleHeaders } from '../src/lib/audible';
import type { Book } from '../src/lib/types';

export const books: Book[] = [
  {
    id: 'a1', title: 'The Odyssey', authors: 'Homer; Robert Fagles', formats: ['Print'], narrators: '', length: '', asin: '',
    isbn13: '9780140449136', isbn10: '0140449132',
    publisher: 'Penguin Classics', year: '1997', pages: '541', shelf: 'Study, top', notes: 'Line one\nLine "two", with comma',
    readDates: ['2019-05-01', '2024-08-15'], coverUrl: 'https://covers.openlibrary.org/b/id/1-M.jpg',
    addedAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-02T10:00:00.000Z',
  },
  {
    id: 'b2', title: 'Café, Crème; "Brûlée"', authors: '', formats: ['Ebook'], narrators: '', length: '', asin: '',
    isbn13: '9780804429573', isbn10: '080442957X',
    publisher: '', year: '', pages: '', shelf: '', notes: '', readDates: [], coverUrl: '',
    addedAt: '2026-10-03T10:00:00.000Z', updatedAt: '2026-10-03T10:00:00.000Z',
  },
  {
    id: 'c3', title: '007', authors: 'Ian Fleming', formats: ['Print', 'Audiobook'], narrators: 'Simon Vance; Toby Stephens', length: '6h 5m', asin: 'B0FAKE007X',
    isbn13: '9780000000002', isbn10: '0000000000',
    publisher: '0042', year: '1953', pages: '00', shelf: '', notes: '=SUM(A1)', readDates: ['2020-01-01'], coverUrl: '',
    addedAt: '2026-10-04T10:00:00.000Z', updatedAt: '2026-10-04T10:00:00.000Z',
  },
  {
    id: 'd4', title: '-minus @at +plus', authors: 'Ge\u2019ez ፍቕሪ', formats: ['Print', 'Audiobook', 'Ebook'], narrators: '', length: '', asin: '',
    isbn13: '', isbn10: '', publisher: '', year: '', pages: '', shelf: '', notes: '', readDates: [], coverUrl: '',
    addedAt: '2026-10-05T10:00:00.000Z', updatedAt: '2026-10-05T10:00:00.000Z',
  },
];

describe('CSV round-trip', () => {
  it('returns identical books, including the formats set', () => {
    expect(csvToBooks(booksToCsv(books))).toEqual(books);
  });
  it('survives a UTF-8 BOM and double round-trip', () => {
    const once = csvToBooks('\uFEFF' + booksToCsv(books));
    expect(csvToBooks(booksToCsv(once))).toEqual(books);
  });
  it('accepts loose headers from other apps and skips untitled rows', () => {
    const rep = newReport();
    const r = csvToBooks('Title,Author,ISBN\nDune,Frank Herbert,978-0441013593\n,,\n', rep);
    expect(r).toHaveLength(1);
    expect(r[0].formats).toEqual(['Print']);
    expect(r[0]).toMatchObject({ title: 'Dune', authors: 'Frank Herbert', isbn13: '9780441013593', isbn10: '0441013597', readDates: [], updatedAt: '' });
  });
  it('reads old files with a single "format" column (backward compatible)', () => {
    const r = csvToBooks('id,title,authors,format,readDates\n1,Dune,Frank Herbert,Audiobook,2020-01-01\n2,Emma,Jane Austen,,\n');
    expect(r.map(b => b.formats)).toEqual([['Audiobook'], ['Print']]);
    expect(jsonToBooks(JSON.stringify({ books: [{ id: 'x', title: 'T', format: 'Ebook' }] }))[0].formats).toEqual(['Ebook']);
  });
});

describe('JSON and XLSX round-trip', () => {
  it('JSON', () => expect(jsonToBooks(booksToJson(books))).toEqual(books));
  it('XLSX keeps text such as leading zeros', () => expect(xlsxToBooks(booksToXlsx(books))).toEqual(books));
});

describe('B1: our own export is never an Audible file', () => {
  it('CSV header of our export is rejected by the Audible detector', () => {
    const header = booksToCsv(books).split('\r\n')[0].split(',');
    expect(isAudibleHeaders(header)).toBe(false);
    expect(isAudibleHeaders(['id', 'title', 'authors', 'format', 'narrators', 'length', 'asin', 'readDates'])).toBe(false); // old v2 export
  });
  it('re-importing our CSV into an empty library keeps read dates, shelf and notes', () => {
    const plan = mergeBooks([], csvToBooks(booksToCsv(books)));
    expect(plan.added).toBe(4);
    expect(plan.put.find(b => b.id === 'a1')).toMatchObject({ formats: ['Print'], shelf: 'Study, top', readDates: ['2019-05-01', '2024-08-15'] });
  });
  it('re-importing our CSV into the same library changes nothing', () => {
    expect(mergeBooks(books, csvToBooks(booksToCsv(books)))).toMatchObject({ added: 0, updated: 0, unchanged: 4, put: [] });
  });
});

const dune: Book = { ...books[0], id: 'p', title: 'Dune', authors: 'Frank Herbert', isbn13: '', isbn10: '', shelf: 'Den', readDates: ['2020-01-01'], formats: ['Print'] };

describe('H2: one entry per title, nothing lost', () => {
  it('an audiobook row for an owned print title adds Audiobook to the same entry', () => {
    const audio = { ...dune, id: 'zz', formats: ['Audiobook'] as Book['formats'], asin: 'B002V1OF70', shelf: '', readDates: ['2023-03-03'], updatedAt: '2026-12-01T00:00:00.000Z' };
    const plan = mergeBooks([dune], [audio]);
    expect(plan).toMatchObject({ added: 0, updated: 1 });
    expect(plan.put[0]).toMatchObject({ id: 'p', formats: ['Print', 'Audiobook'], asin: 'B002V1OF70', shelf: 'Den', readDates: ['2020-01-01', '2023-03-03'] });
  });
  it('never matches on title alone', () => {
    const plan = mergeBooks([{ ...dune, authors: '' }], [{ ...dune, id: 'q', authors: '' }]);
    expect(plan.added).toBe(1);
  });
  it('different ASINs are different books even with the same title and author', () => {
    const a = { ...dune, id: 'a', asin: 'B1', formats: ['Audiobook'] as Book['formats'] };
    expect(mergeBooks([a], [{ ...a, id: 'b', asin: 'B2' }]).added).toBe(1);
  });
});

describe('H3: in-app edits win over re-imported files', () => {
  const file = 'title,author,shelf\nDune,Frank Herbert,Hall\n';
  it('a row without updatedAt never overwrites in-app values, only fills empty fields', () => {
    const edited = { ...dune, shelf: 'Den', publisher: '' };
    const plan = mergeBooks([edited], csvToBooks('title,author,shelf,publisher\nDune,Frank Herbert,Hall,Ace\n'));
    expect(plan.put[0]).toMatchObject({ shelf: 'Den', publisher: 'Ace', readDates: ['2020-01-01'] });
    expect(mergeBooks([edited], csvToBooks(file))).toMatchObject({ updated: 0, unchanged: 1 });
  });
  it('a newer row replaces values only when the user opted in, and read dates are merged', () => {
    const row = { ...dune, id: 'p', shelf: 'Hall', readDates: [], updatedAt: '2030-01-01T00:00:00.000Z' };
    expect(mergeBooks([dune], [row]).put).toEqual([]);
    const plan = mergeBooks([dune], [row], { preferNewerImport: true });
    expect(plan.put[0]).toMatchObject({ shelf: 'Hall', readDates: ['2020-01-01'] });
  });
  it('an older row never wins, even when opted in', () => {
    const row = { ...dune, shelf: 'Hall', updatedAt: '2000-01-01T00:00:00.000Z' };
    expect(mergeBooks([dune], [row], { preferNewerImport: true }).put).toEqual([]);
  });
});

describe('M2-M5, L1, L5: import hygiene', () => {
  it('M2: drops invalid or future read dates and reports them', () => {
    const rep = newReport();
    const r = csvToBooks('id,title,readDates\n1,A,"2099-01-01; not-a-date; 2020-13-45; 2020-02-29; 2020-02-29"\n', rep);
    expect(r[0].readDates).toEqual(['2020-02-29']);
    expect(rep.droppedDates).toBe(3);
  });
  it('M3: repeats inside one file are folded together', () => {
    const plan = mergeBooks([], csvToBooks('title,author,isbn13\nA,X,9780306406157\nA copy,Y,9780306406157\nDune,Frank Herbert,\nDune,Frank Herbert,\n'));
    expect(plan).toMatchObject({ added: 2, mergedInFile: 2 });
  });
  it('M4: normalises ISBN-10 with dashes and counts bad check digits', () => {
    const rep = newReport();
    const r = csvToBooks('Title,ISBN10\nA,0-306-40615-2\nBad,9780306406158\n', rep);
    expect(r[0]).toMatchObject({ isbn13: '9780306406157', isbn10: '0306406152' });
    expect(r[1].isbn13).toBe('9780306406158');
    expect(rep.invalidIsbns).toBe(1);
  });
  it('M5: an unterminated quote stops the import with the row number', () => {
    expect(() => csvToBooks('Title,Author\n"unterminated,a\nGood,A\n')).toThrow(/Row 2 could not be read/);
  });
  it('M6: Excel export shortens cells over 32,767 characters instead of failing', () => {
    const long = { ...books[0], notes: 'x'.repeat(40000) };
    const back = xlsxToBooks(booksToXlsx([long]))[0];
    expect(back.notes.length).toBe(XLSX_CELL_MAX);
    expect(back.notes.endsWith('[cut: too long for Excel]')).toBe(true);
  });
  it('L1: odd JSON gives a friendly message', () => {
    for (const t of ['null', '42', '{"foo":1}', '{"books":null}', '{"books":', '']) expect(() => jsonToBooks(t)).toThrow(ImportError);
    expect(() => jsonToBooks('null')).toThrow('This is not a Nineveh backup file.');
  });
  it('L5: CSV export neutralises formulas and import restores the text', () => {
    const csv = booksToCsv([{ ...books[0], title: '=HYPERLINK("http://evil","x")' }]);
    expect(csv.split('\r\n')[1]).toContain(`"'=HYPERLINK(`);
    expect(csvToBooks(csv)[0].title).toBe('=HYPERLINK("http://evil","x")');
    expect(unescapeCell(escapeCell('+1'))).toBe('+1');
    expect(escapeCell('plain')).toBe('plain');
  });
});
