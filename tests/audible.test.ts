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
    expect(plan.add.every(b => b.format === 'Audiobook' && b.readDates.length === 0)).toBe(true);
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
    expect(titleAuthorKey("The Lighthouse Keeper's Ledger: A Novel", 'Maren Ostby; X')).toBe(titleAuthorKey('lighthouse keepers ledger', 'Maren Ostby'));
  });

  it('owning the print edition does not block the audiobook', () => {
    const print = { ...planAudibleImport([], parseAudibleJson(fx('ale-library.json')), now).add[0], format: 'Print', asin: '' } as Book;
    expect(planAudibleImport([print], parseAudibleJson(fx('ale-library.json')), now).newCount).toBe(3);
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
