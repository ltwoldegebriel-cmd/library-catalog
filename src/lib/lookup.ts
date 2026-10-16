import type { Draft } from './types';
import { emptyDraft } from './types';
import { isbn13To10 } from './isbn';

export type LookupResult =
  | { status: 'found'; draft: Draft; source: 'Open Library' | 'Google Books' }
  | { status: 'notfound' }
  | { status: 'offline' }
  | { status: 'error'; message: string };

/** Shared deadline so a hanging service can't stall a lookup for long. */
let deadline: AbortSignal | undefined;

async function getJson(url: string, ms = 9000): Promise<any | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  const onDeadline = () => ctrl.abort();
  deadline?.addEventListener('abort', onDeadline);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
    deadline?.removeEventListener('abort', onDeadline);
  }
}

const yearOf = (s?: string) => (s?.match(/\d{4}/)?.[0] ?? '');

async function openLibrary(isbn13: string): Promise<Draft | null> {
  const ed = await getJson(`https://openlibrary.org/isbn/${isbn13}.json`);
  if (!ed || !ed.title) return null;
  let authors: string[] = [];
  const keys: string[] = (ed.authors ?? []).map((a: any) => a.key).filter(Boolean);
  if (keys.length) {
    const res = await Promise.all(keys.map(k => getJson(`https://openlibrary.org${k}.json`).catch(() => null)));
    authors = res.map(a => a?.name).filter(Boolean);
  }
  if (!authors.length && ed.works?.[0]?.key) {
    const w = await getJson(`https://openlibrary.org${ed.works[0].key}.json`).catch(() => null);
    const wk: string[] = (w?.authors ?? []).map((a: any) => a.author?.key).filter(Boolean);
    const res = await Promise.all(wk.map(k => getJson(`https://openlibrary.org${k}.json`).catch(() => null)));
    authors = res.map(a => a?.name).filter(Boolean);
  }
  const coverId = ed.covers?.find((c: number) => c > 0);
  return {
    ...emptyDraft(),
    title: ed.subtitle ? `${ed.title}: ${ed.subtitle}` : ed.title,
    authors: authors.join('; '),
    isbn13,
    isbn10: isbn13To10(isbn13) ?? '',
    publisher: ed.publishers?.[0] ?? '',
    year: yearOf(ed.publish_date),
    pages: ed.number_of_pages ? String(ed.number_of_pages) : '',
    coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : '',
  };
}

function fromGoogle(v: any, isbn13 = ''): Draft {
  const info = v.volumeInfo ?? {};
  const ids: any[] = info.industryIdentifiers ?? [];
  const i13 = isbn13 || ids.find(i => i.type === 'ISBN_13')?.identifier || '';
  const img: string = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? '';
  return {
    ...emptyDraft(),
    title: info.subtitle ? `${info.title}: ${info.subtitle}` : info.title ?? '',
    authors: (info.authors ?? []).join('; '),
    isbn13: i13,
    isbn10: ids.find(i => i.type === 'ISBN_10')?.identifier || (i13 ? isbn13To10(i13) ?? '' : ''),
    publisher: info.publisher ?? '',
    year: yearOf(info.publishedDate),
    pages: info.pageCount ? String(info.pageCount) : '',
    coverUrl: img.replace(/^http:/, 'https:'),
  };
}

async function googleBooks(isbn13: string): Promise<Draft | null> {
  const j = await getJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn13}`);
  const v = j?.items?.[0];
  return v ? fromGoogle(v, isbn13) : null;
}

export const LOOKUP_BUDGET_MS = 10000;

/**
 * Open Library and Google Books are queried in parallel under one 10 s budget; Open
 * Library's answer is preferred. Only the ISBN is sent. If nothing matched and any
 * service failed, the result is an error ("try again"), not "not found".
 */
export async function lookupIsbn(isbn13: string, budgetMs = LOOKUP_BUDGET_MS): Promise<LookupResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { status: 'offline' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), budgetMs);
  deadline = ctrl.signal;
  const settle = <T,>(p: Promise<T>) => p.then(v => ({ ok: true as const, v }), () => ({ ok: false as const, v: null }));
  try {
    const ol = settle(openLibrary(isbn13));
    const gb = settle(googleBooks(isbn13));
    const o = await ol;
    if (o.ok && o.v) return { status: 'found', draft: o.v, source: 'Open Library' };
    const g = await gb;
    if (g.ok && g.v) return { status: 'found', draft: g.v, source: 'Google Books' };
    if (!o.ok || !g.ok) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return { status: 'offline' };
      const both = !o.ok && !g.ok;
      return { status: 'error', message: ctrl.signal.aborted
        ? 'The lookup took too long. Check your connection and try again, or enter the details by hand.'
        : both ? 'Both lookup services failed to respond.' : 'A lookup service had a problem and the other found no match. Try again in a moment.' };
    }
    return { status: 'notfound' };
  } finally {
    clearTimeout(timer);
    deadline = undefined;
  }
}

/** Title or author search via the Open Library search API, Google Books fallback. */
export async function searchBooks(q: string): Promise<Draft[] | 'offline' | 'error'> {
  if (navigator.onLine === false) return 'offline';
  try {
    const fields = 'title,subtitle,author_name,first_publish_year,isbn,cover_i,number_of_pages_median,publisher';
    const j = await getJson(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=12&fields=${fields}`);
    const docs: any[] = j?.docs ?? [];
    if (docs.length) {
      return docs.map(d => {
        const i13 = (d.isbn ?? []).find((x: string) => x.length === 13 && /^97[89]/.test(x)) ?? '';
        return {
          ...emptyDraft(),
          title: d.subtitle ? `${d.title}: ${d.subtitle}` : d.title,
          authors: (d.author_name ?? []).join('; '),
          isbn13: i13,
          isbn10: i13 ? isbn13To10(i13) ?? '' : '',
          publisher: d.publisher?.[0] ?? '',
          year: d.first_publish_year ? String(d.first_publish_year) : '',
          pages: d.number_of_pages_median ? String(d.number_of_pages_median) : '',
          coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '',
        };
      });
    }
  } catch { /* fall through */ }
  try {
    const g = await getJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=12`);
    return (g?.items ?? []).map((v: any) => fromGoogle(v));
  } catch {
    return !navigator.onLine ? 'offline' : 'error';
  }
}
