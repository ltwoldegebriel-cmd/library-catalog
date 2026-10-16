import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { safeCoverUrl } from '../src/lib/cover';
import { csvToBooks, booksToCsv, jsonToBooks, newReport, xlsxToBooks, XLSX_MAX_COLS } from '../src/lib/io';
import { migrateRecords, normalizeRecord, newCleanup, UNTITLED } from '../src/lib/migrate';
import { lookupIsbn, searchBooks, clearLookupCache, openLibraryPolicy } from '../src/lib/lookup';
import { isQuotaError, errorText, QUOTA_TEXT } from '../src/lib/quota';
import { parseInput } from '../src/lib/fileparse';
import type { Book } from '../src/lib/types';

const mk = (o: Partial<Book> = {}): Book => ({ id: 'x', title: 'T', authors: 'A', formats: ['Print'], narrators: '', length: '', asin: '', isbn13: '', isbn10: '', publisher: '', year: '', pages: '', coverUrl: '', shelf: '', notes: '', readDates: [], addedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...o });

describe('M3 cover URL allowlist', () => {
  it('keeps https covers from known hosts only', () => {
    expect(safeCoverUrl('https://covers.openlibrary.org/b/id/1-M.jpg')).toBe('https://covers.openlibrary.org/b/id/1-M.jpg');
    expect(safeCoverUrl('http://books.google.com/books/content?id=a&img=1')).toBe('https://books.google.com/books/content?id=a&img=1');
    expect(safeCoverUrl('https://books.google.co.uk/books/content?id=a')).toBe('https://books.google.com/books/content?id=a');
    expect(safeCoverUrl('https://lh3.googleusercontent.com/x')).toBe('https://lh3.googleusercontent.com/x');
    expect(safeCoverUrl('https://m.media-amazon.com/images/I/a._SL500_.jpg')).toContain('m.media-amazon.com');
    for (const bad of ['http://tracker.example/p.gif', 'https://tracker.example/p.gif', 'javascript:alert(1)', 'data:image/png;base64,AA',
      'https://covers.openlibrary.org.evil.com/x', 'https://user@covers.openlibrary.org/x', 'https://covers.openlibrary.org:8443/x', 'https://books.google.evil/x', '//covers.openlibrary.org/x'])
      expect(safeCoverUrl(bad), bad).toBe('');
  });
  it('import drops unsafe cover URLs and counts them', () => {
    const rep = newReport();
    const b = csvToBooks('title,coverUrl\nA,http://tracker.example/p.gif\nB,https://covers.openlibrary.org/b/id/2-M.jpg\n', rep);
    expect(b.map(x => x.coverUrl)).toEqual(['', 'https://covers.openlibrary.org/b/id/2-M.jpg']);
    expect(rep.droppedCovers).toBe(1);
    expect(jsonToBooks(JSON.stringify([{ title: 'J', coverUrl: 'javascript:alert(1)' }]))[0].coverUrl).toBe('');
  });
});

describe('M1 crafted spreadsheet', () => {
  it('a sheet that declares A1:XFD1048576 parses fast', () => {
    const f = '/workspace/lc-e2e/data/hugeref.xlsx';
    let data: ArrayBuffer;
    if (existsSync(f)) { const b = readFileSync(f); data = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
    else {
      const ws = XLSX.utils.aoa_to_sheet([['title'], ['Dune']]); ws['!ref'] = 'A1:XFD1048576';
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'S'); data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    }
    const t = Date.now();
    xlsxToBooks(data);
    expect(Date.now() - t).toBeLessThan(5000);
  });
  it('columns beyond the cap are ignored, real cells kept', () => {
    const ws = XLSX.utils.aoa_to_sheet([['title', 'authors'], ['Dune', 'Frank Herbert']]);
    ws[XLSX.utils.encode_cell({ r: 5, c: XLSX_MAX_COLS + 500 })] = { t: 's', v: 'far away' };
    ws['!ref'] = 'A1:ZZZ9';
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'S');
    const books = xlsxToBooks(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    expect(books.map(b => [b.title, b.authors])).toEqual([['Dune', 'Frank Herbert']]);
  });
});

describe('M6 migration cleanup', () => {
  it('validates read dates, accepts a single string, placeholders bad titles, reports it', () => {
    const { books, cleanup } = migrateRecords([
      { id: 'a', title: 'A', authors: 'X', readDates: ['2020-01-01', '2099-01-01', 'junk'], addedAt: '1' },
      { id: 'b', title: 'B', authors: 'Y', readDates: '2020-01-01', addedAt: '2' },
      { id: 'c', title: 'C', authors: 'Z', readDates: '2019-02-02; 2021-03-03|bad', addedAt: '3' },
      { id: 'd', title: null, authors: 'W', addedAt: '4' },
      { id: 'e', title: { x: 1 }, authors: 'V', addedAt: '5' },
      { id: 'f', title: 'F', authors: 'U', coverUrl: 'http://tracker.example/p.gif', addedAt: '6' },
    ]);
    const by = new Map(books.map(b => [b.id, b]));
    expect(by.get('a')!.readDates).toEqual(['2020-01-01']);
    expect(by.get('b')!.readDates).toEqual(['2020-01-01']);
    expect(by.get('c')!.readDates).toEqual(['2019-02-02', '2021-03-03']);
    expect(by.get('d')!.title).toBe(UNTITLED);
    expect(by.get('e')!.title).toBe(UNTITLED);
    expect(by.get('f')!.coverUrl).toBe('');
    expect(books).toHaveLength(6);
    expect(cleanup).toEqual({ droppedDates: 3, untitled: 2, droppedCovers: 1 });
  });
  it('a clean v3 record is unchanged by normalizeRecord', () => {
    const b = mk({ readDates: ['2020-01-01'], coverUrl: 'https://covers.openlibrary.org/b/id/1-M.jpg' });
    const c = newCleanup();
    expect(normalizeRecord(b as unknown as Record<string, unknown>, c)).toEqual(b);
    expect(c).toEqual(newCleanup());
  });
});

describe('L2 CSV round trip', () => {
  it('own export round-trips leading = - tab and apostrophes exactly', () => {
    const titles = ['=abc', "'=abc", '-5 Ways', '@home', '+1', "'quoted"];
    const out = csvToBooks(booksToCsv(titles.map((t, i) => mk({ id: 'i' + i, title: t }))));
    expect(out.map(b => b.title)).toEqual(titles);
  });
  it("other apps' CSVs are taken as is (no apostrophe stripping)", () => {
    expect(csvToBooks("title,author\n'=abc,X\n")[0].title).toBe("'=abc");
  });
});

describe('L1 quota message', () => {
  it('recognises QuotaExceededError, including Dexie-wrapped', () => {
    expect(isQuotaError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError({ name: 'AbortError', inner: { name: 'QuotaExceededError' } })).toBe(true);
    expect(errorText({ name: 'QuotaExceededError' })).toBe(QUOTA_TEXT);
    expect(errorText(new Error('other'))).toBe('other');
  });
});

describe('Audible auto-detect in the shared parser', () => {
  it('own CSV is not Audible; Audible headers are', () => {
    expect(parseInput({ name: 'x.csv', text: booksToCsv([mk()]) }).kind).toBe('books');
    expect(parseInput({ name: 'a.csv', text: 'Title,ASIN,Narrators,Length\nX,B0001,N,1h\n' }).kind).toBe('audible');
  });
});

describe('H2 Open Library policy', () => {
  const g = globalThis as any;
  let orig: any; let calls: { url: string; at: number }[];
  beforeEach(() => {
    clearLookupCache(); openLibraryPolicy.gapMs = 300; orig = g.fetch; calls = [];
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  });
  afterEach(() => { g.fetch = orig; openLibraryPolicy.gapMs = 1000; });
  const ed = (isbn: string) => ({ [`ISBN:${isbn}`]: { title: 'Dune', url: 'https://openlibrary.org/books/OL1M/Dune', authors: [{ name: 'Frank Herbert' }], publishers: [{ name: 'Ace' }], publish_date: '1990', number_of_pages: 535, cover: { medium: 'https://covers.openlibrary.org/b/id/1-M.jpg' } } });

  it('one ISBN lookup is one Open Library request, with link and authors', async () => {
    g.fetch = async (u: string) => { calls.push({ url: u, at: Date.now() }); return u.includes('openlibrary') ? new Response(JSON.stringify(ed('9780441172719'))) : new Response('{}'); };
    const r = await lookupIsbn('9780441172719');
    expect(r).toMatchObject({ status: 'found', source: 'Open Library', link: 'https://openlibrary.org/books/OL1M/Dune', draft: { authors: 'Frank Herbert', publisher: 'Ace', pages: '535' } });
    expect(calls.filter(c => c.url.includes('openlibrary.org')).length).toBe(1);
  });
  it('Open Library requests are serial and spaced; repeats come from the cache', async () => {
    let inFlight = 0, maxInFlight = 0;
    g.fetch = async (u: string) => {
      if (!u.includes('openlibrary')) return new Response('{}');
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); calls.push({ url: u, at: Date.now() });
      await new Promise(r => setTimeout(r, 50)); inFlight--;
      const isbn = u.match(/ISBN:(\d+)/)![1]; return new Response(JSON.stringify(ed(isbn)));
    };
    await Promise.all(['9780441172719', '9780306406157', '9780140449136'].map(i => lookupIsbn(i)));
    expect(maxInFlight).toBe(1);
    const gaps = calls.slice(1).map((c, i) => c.at - calls[i].at);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(290);
    const n = calls.length;
    await lookupIsbn('9780441172719');
    expect(calls.length).toBe(n);
  });
  it('L3: a 429 says "too many lookups" and cools down', async () => {
    g.fetch = async () => new Response('slow down', { status: 429 });
    const r = await lookupIsbn('9780441172719');
    expect(r).toMatchObject({ status: 'error', rateLimited: true });
    expect((r as any).message).toMatch(/Too many lookups/);
    let n = 0; g.fetch = async () => { n++; return new Response('{}'); };
    await lookupIsbn('9780306406157');
    expect(n).toBe(0);
  });
  it('L3: a hanging service hits the overall budget and says it took too long', async () => {
    g.fetch = (_u: string, o: { signal: AbortSignal }) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
    const r = await lookupIsbn('9780441172719', 300);
    expect((r as any).message).toMatch(/took too long/);
  });
  it('Google results carry a link back to Google Books and an https cover', async () => {
    g.fetch = async (u: string) => u.includes('openlibrary') ? new Response('{}') : new Response(JSON.stringify({ items: [{ id: 'abc', volumeInfo: { title: 'GB', infoLink: 'http://books.google.com/books?id=abc', imageLinks: { thumbnail: 'http://books.google.com/books/content?id=abc' } } }] }));
    const r = await lookupIsbn('9780441172719');
    expect(r).toMatchObject({ status: 'found', source: 'Google Books', link: 'https://books.google.com/books?id=abc', draft: { coverUrl: 'https://books.google.com/books/content?id=abc' } });
    const s = await searchBooks('dune');
    expect(Array.isArray(s) && s[0]).toMatchObject({ source: 'Google Books', link: 'https://books.google.com/books?id=abc' });
  });
});
