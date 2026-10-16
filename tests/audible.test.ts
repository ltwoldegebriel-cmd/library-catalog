import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAudibleCsv, parseAudibleJson, planAudibleImport, titleAuthorKey, fromAudibleRow, isAudibleJson } from '../src/lib/audible';
import { booksToCsv, csvToBooks, mergeBooks } from '../src/lib/io';
import type { Book } from '../src/lib/types';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', n), 'utf8');

describe('Audible mapping', () => {
  it('maps the raw data JSON export (root library array, wishlist ignored)', () => {
    const items = parseAudibleJson(fx('ale-library.json'));
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({
      title: "The Lighthouse Keeper's Ledger: A Novel", authors: 'Maren Ostby', narrators: 'Paul Adeyemi',
      length: '11h 2m', asin: 'B0FAKE0001', coverUrl: 'https://m.media-amazon.com/images/I/51FAKEcoverA1._SL500_.jpg',
      isbn13: '', isbn10: '',
    });
    expect(items[1].authors).toBe('Ines Varga; Tomas Reed');
    expect(items[1].narrators).toBe('Ruth Okafor; Dev Mehta');
    expect(items[2].coverUrl).toBe(''); // no cover in the data
  });

  it('maps the older chunked audibledata.library shape', () => {
    const raw = JSON.parse(fx('ale-library.json'));
    const chunked = { audibledata: { library: [raw.library.slice(0, 2), raw.library.slice(2)] } };
    expect(isAudibleJson(chunked)).toBe(true);
    expect(parseAudibleJson(JSON.stringify(chunked)).map(b => b.asin)).toEqual(['B0FAKE0001', 'B0FAKE0002', 'B0FAKE0003']);
  });

  it('maps the spreadsheet CSV export', () => {
    const items = parseAudibleCsv(fx('ale-library.csv'));
    expect(items).toHaveLength(4);
    expect(items[1]).toMatchObject({ title: 'Salt and Cedar', authors: 'Ines Varga; Tomas Reed', narrators: 'Ruth Okafor; Dev Mehta', length: '7h 45m', asin: 'B0FAKE0002' });
    expect(items[0].coverUrl).toBe('https://m.media-amazon.com/images/I/51FAKEcoverA1._SL500_.jpg');
    expect(items[2].coverUrl).toBe(''); // placeholder data: URI is dropped
    expect(items[3].title).toBe('Café Society, Revisited');
  });

  it('strips "With formulas" spreadsheet cells', () => {
    const r = fromAudibleRow({
      Title: '=HYPERLINK("https://www.audible.com/pd/B0FAKE0009";"Quoted ""Title""")',
      Authors: 'A. Writer', ASIN: 'B0FAKE0009',
      Cover: '=HYPERLINK("https://www.audible.com/pd/B0FAKE0009"; IMAGE("https://m.media-amazon.com/images/I/11abc._SL75_.jpg"; 4; 75; 75))',
    });
    expect(r).toMatchObject({ title: 'Quoted "Title"', coverUrl: 'https://m.media-amazon.com/images/I/11abc._SL500_.jpg' });
  });

  it('rejects files that are not extractor exports', () => {
    expect(() => parseAudibleCsv('Title,Author\nDune,Frank Herbert')).toThrow();
    expect(() => parseAudibleJson('{"books":[]}')).toThrow();
  });
});

describe('Audible dedupe and re-import', () => {
  const now = '2026-10-16T12:00:00.000Z';

  it('marks everything as Audiobook on first import', () => {
    const plan = planAudibleImport([], parseAudibleJson(fx('ale-library.json')), now);
    expect(plan.newCount).toBe(3);
    expect(plan.existingCount).toBe(0);
    expect(plan.add.every(b => b.formats.join() === 'Audiobook' && b.readDates.length === 0)).toBe(true);
  });

  it('re-import only adds new purchases', () => {
    const first = planAudibleImport([], parseAudibleJson(fx('ale-library.json')), now).add;
    const again = planAudibleImport(first, parseAudibleJson(fx('ale-library.json')), now);
    expect(again).toMatchObject({ newCount: 0, existingCount: 3 });
    const later = planAudibleImport(first, parseAudibleJson(fx('ale-library-later.json')), now);
    expect(later.newCount).toBe(2);
    expect(later.existingCount).toBe(3);
    expect(later.add.map(b => b.title).sort()).toEqual(['Field Notes from Nowhere', 'The Glass Orchard']);
  });

  it('CSV and JSON exports of the same library dedupe against each other', () => {
    const fromJson = planAudibleImport([], parseAudibleJson(fx('ale-library.json')), now).add;
    const csv = planAudibleImport(fromJson, parseAudibleCsv(fx('ale-library.csv')), now);
    expect(csv).toMatchObject({ newCount: 1, existingCount: 3 });
  });

  it('falls back to normalised title + first author when ASIN is missing', () => {
    const existing = planAudibleImport([], parseAudibleJson(fx('ale-library.json')), now).add.map(b => ({ ...b, asin: '' }));
    const items = parseAudibleJson(fx('ale-library.json')).map(i => ({ ...i, title: i.title.toUpperCase() + '!', asin: '' }));
    expect(planAudibleImport(existing, items, now)).toMatchObject({ newCount: 0, existingCount: 3 });
    expect(titleAuthorKey("The Lighthouse Keeper's Ledger: A Novel", 'Maren Ostby; X')).toBe(titleAuthorKey('lighthouse keepers ledger: a novel', 'Maren Ostby'));
    expect(titleAuthorKey('Untitled', '')).toBe(''); // never title alone
  });

  it('a print book of the same title gains Audiobook instead of a second entry', () => {
    const print = { ...planAudibleImport([], parseAudibleJson(fx('ale-library.json')), now).add[0], id: 'print1', formats: ['Print'], asin: '', narrators: '', length: '', shelf: 'Study', readDates: ['2020-02-02'] } as Book;
    const plan = planAudibleImport([print], parseAudibleJson(fx('ale-library.json')), now);
    expect(plan).toMatchObject({ newCount: 2, mergedCount: 1, existingCount: 0 });
    expect(plan.update[0]).toMatchObject({ id: 'print1', formats: ['Print', 'Audiobook'], asin: 'B0FAKE0001', narrators: 'Paul Adeyemi', length: '11h 2m', shelf: 'Study', readDates: ['2020-02-02'] });
    // Re-importing after the merge adds nothing.
    const again = planAudibleImport([plan.update[0], ...plan.add], parseAudibleJson(fx('ale-library.json')), now);
    expect(again).toMatchObject({ newCount: 0, mergedCount: 0, existingCount: 3, update: [] });
  });

  it('matches a print book by ISBN-13 too', () => {
    const print = { id: 'p', title: 'Different Title Text', authors: 'Someone', formats: ['Print'], isbn13: '9780306406157' } as Book;
    const it0 = { ...parseAudibleJson(fx('ale-library.json'))[0], isbn13: '9780306406157' };
    expect(planAudibleImport([{ ...print, narrators: '', length: '', asin: '', isbn10: '', publisher: '', year: '', pages: '', coverUrl: '', shelf: '', notes: '', readDates: [], addedAt: '', updatedAt: '' }], [it0], now).mergedCount).toBe(1);
  });

  it('H1: series books with the same base title are all imported (ASIN first)', () => {
    const mkA = (t: string, a: string) => ({ title: t, authors: 'J.K. Rowling', narrators: '', length: '', asin: a, coverUrl: '', isbn13: '', isbn10: '' });
    const p = planAudibleImport([], [mkA('Harry Potter: Book 1', 'B1'), mkA('Harry Potter: Book 2', 'B2')], now);
    expect(p).toMatchObject({ newCount: 2, skippedInFile: 0 });
    const p2 = planAudibleImport(p.add, [mkA('Harry Potter: Book 3', 'B3'), mkA('Harry Potter: Book 1', 'B1')], now);
    expect(p2).toMatchObject({ newCount: 1, existingCount: 1 });
    // Same title and author but a different ASIN than the owned audiobook: a different product.
    expect(planAudibleImport(p.add, [mkA('Harry Potter: Book 1', 'B9')], now).newCount).toBe(1);
  });

  it('skips repeats inside one file', () => {
    const items = parseAudibleJson(fx('ale-library.json'));
    expect(planAudibleImport([], [...items, items[0]], now)).toMatchObject({ newCount: 3, skippedInFile: 1 });
  });

  it('imported audiobooks round-trip through our own CSV with format, narrators, length and ASIN', () => {
    const books = planAudibleImport([], parseAudibleJson(fx('ale-library.json')), now).add;
    const back = csvToBooks(booksToCsv(books));
    expect(back).toEqual(books);
    expect(mergeBooks(books, back.map(b => ({ ...b, id: 'x' + b.id }))).added).toBe(0); // matched by ISBN/ASIN
  });
});
