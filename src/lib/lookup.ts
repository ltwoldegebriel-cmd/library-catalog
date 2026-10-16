import type { Draft } from './types';
import { emptyDraft } from './types';
import { isbn13To10 } from './isbn';
import { safeCoverUrl } from './cover';

export type Source = 'Open Library' | 'Google Books';
export type LookupResult =
  | { status: 'found'; draft: Draft; source: Source; link: string }
  | { status: 'notfound' }
  | { status: 'offline' }
  | { status: 'error'; message: string; rateLimited?: boolean };

export interface SearchItem { draft: Draft; source: Source; link: string }

class RateLimited extends Error {}

/**
 * Open Library asks clients to stay at about 1 request per second and to identify
 * themselves. Browsers cannot set a User-Agent, so the app is identified by its public
 * address (Referer/Origin, sent by the browser) and requests are kept serial and spaced.
 */
export const openLibraryPolicy = { gapMs: 1000, cooldownMs: 60_000 };
let olChain: Promise<unknown> = Promise.resolve();
let olLastStart = 0;
let olBlockedUntil = 0;
let gbBlockedUntil = 0;

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  if (ms <= 0) return res();
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('aborted', 'AbortError')); }, { once: true });
});

async function getJson(url: string, signal: AbortSignal): Promise<any | null> {
  const r = await fetch(url, { signal, referrerPolicy: 'strict-origin-when-cross-origin' });
  if (r.status === 404) return null;
  if (r.status === 429) throw new RateLimited('HTTP 429');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
}

/** One Open Library request at a time, at least gapMs apart. */
function olGet(url: string, signal: AbortSignal): Promise<any | null> {
  const run = olChain.then(async () => {
    if (Date.now() < olBlockedUntil) throw new RateLimited('cooling down');
    await sleep(olLastStart + openLibraryPolicy.gapMs - Date.now(), signal);
    olLastStart = Date.now();
    try { return await getJson(url, signal); }
    catch (e) { if (e instanceof RateLimited) olBlockedUntil = Date.now() + openLibraryPolicy.cooldownMs; throw e; }
  });
  olChain = run.catch(() => undefined);
  return run;
}

async function gbGet(url: string, signal: AbortSignal): Promise<any | null> {
  if (Date.now() < gbBlockedUntil) throw new RateLimited('cooling down');
  try { return await getJson(url, signal); }
  catch (e) { if (e instanceof RateLimited) gbBlockedUntil = Date.now() + openLibraryPolicy.cooldownMs; throw e; }
}

const yearOf = (s?: string) => (s?.match(/\d{4}/)?.[0] ?? '');

/** One request: the Books API returns author names and cover links together. */
async function openLibrary(isbn13: string, signal: AbortSignal): Promise<{ draft: Draft; link: string } | null> {
  const j = await olGet(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn13}&format=json&jscmd=data`, signal);
  const ed = j?.[`ISBN:${isbn13}`];
  if (!ed || typeof ed.title !== 'string' || !ed.title) return null;
  const names = (v: unknown) => (Array.isArray(v) ? v.map((a: any) => (typeof a?.name === 'string' ? a.name : '')).filter(Boolean) : []);
  return {
    link: typeof ed.url === 'string' && ed.url.startsWith('https://openlibrary.org/') ? ed.url : `https://openlibrary.org/isbn/${isbn13}`,
    draft: {
      ...emptyDraft(),
      title: ed.subtitle ? `${ed.title}: ${ed.subtitle}` : ed.title,
      authors: names(ed.authors).join('; '),
      isbn13,
      isbn10: isbn13To10(isbn13) ?? '',
      publisher: names(ed.publishers)[0] ?? '',
      year: yearOf(ed.publish_date),
      pages: ed.number_of_pages ? String(ed.number_of_pages) : '',
      coverUrl: safeCoverUrl(ed.cover?.medium ?? ed.cover?.large ?? ''),
    },
  };
}

function fromGoogle(v: any, isbn13 = ''): SearchItem {
  const info = v?.volumeInfo ?? {};
  const ids: any[] = Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers : [];
  const i13 = isbn13 || ids.find(i => i.type === 'ISBN_13')?.identifier || '';
  const img: string = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? '';
  const link = [info.canonicalVolumeLink, info.infoLink].find((u: unknown) => typeof u === 'string' && /^https?:\/\/books\.google\./.test(u))
    ?? (v?.id ? `https://books.google.com/books?id=${encodeURIComponent(v.id)}` : 'https://books.google.com/');
  return {
    source: 'Google Books',
    link: String(link).replace(/^http:/, 'https:'),
    draft: {
      ...emptyDraft(),
      title: String(info.subtitle ? `${info.title}: ${info.subtitle}` : info.title ?? ''),
      authors: (Array.isArray(info.authors) ? info.authors : []).join('; '),
      isbn13: i13,
      isbn10: ids.find(i => i.type === 'ISBN_10')?.identifier || (i13 ? isbn13To10(i13) ?? '' : ''),
      publisher: String(info.publisher ?? ''),
      year: yearOf(info.publishedDate),
      pages: info.pageCount ? String(info.pageCount) : '',
      coverUrl: safeCoverUrl(img),
    },
  };
}

async function googleBooks(isbn13: string, signal: AbortSignal): Promise<SearchItem | null> {
  const j = await gbGet(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn13}`, signal);
  const v = j?.items?.[0];
  return v ? fromGoogle(v, isbn13) : null;
}

/** Found lookups are cached for a day, so re-scanning a book does not ask again. */
const CACHE_MS = 24 * 3600_000;
const CACHE_KEY = 'nineveh-lookup-cache';
const cache = new Map<string, { at: number; r: Extract<LookupResult, { status: 'found' }> }>();
function loadCache() {
  if (cache.size || typeof localStorage === 'undefined') return;
  try { for (const [k, v] of JSON.parse(localStorage.getItem(CACHE_KEY) ?? '[]')) cache.set(k, v); } catch { /* ignore */ }
}
function saveCache() {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify([...cache].slice(-200))); } catch { /* storage full: memory cache still works */ }
}
export function clearLookupCache() { cache.clear(); olBlockedUntil = 0; gbBlockedUntil = 0; olLastStart = 0; if (typeof localStorage !== 'undefined') try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ } }

export const LOOKUP_BUDGET_MS = 10000;
const RATE_TEXT = 'Too many lookups in a short time. Wait a minute and try again, or enter the details by hand.';

/**
 * Open Library (serial, 1 per second) and Google Books are queried in parallel under one
 * 10 s budget; Open Library's answer is preferred. Only the ISBN is sent. If nothing
 * matched and any service failed, the result is an error ("try again"), not "not found".
 */
export async function lookupIsbn(isbn13: string, budgetMs = LOOKUP_BUDGET_MS): Promise<LookupResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { status: 'offline' };
  loadCache();
  const hit = cache.get(isbn13);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.r;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), budgetMs);
  type S<T> = { ok: true; v: T } | { ok: false; v: null; rate: boolean };
  const settle = <T,>(p: Promise<T>): Promise<S<T>> => p.then(v => ({ ok: true as const, v }), e => ({ ok: false as const, v: null, rate: e instanceof RateLimited }));
  try {
    const ol = settle(openLibrary(isbn13, ctrl.signal));
    const gb = settle(googleBooks(isbn13, ctrl.signal));
    const o = await ol;
    let found: Extract<LookupResult, { status: 'found' }> | null = null;
    if (o.ok && o.v) found = { status: 'found', draft: o.v.draft, source: 'Open Library', link: o.v.link };
    else {
      const g = await gb;
      if (g.ok && g.v) found = { status: 'found', ...g.v };
      else if (!o.ok || !g.ok) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return { status: 'offline' };
        const rate = (!o.ok && o.rate) || (!g.ok && g.rate);
        if (rate) return { status: 'error', message: RATE_TEXT, rateLimited: true };
        return { status: 'error', message: ctrl.signal.aborted
          ? 'The lookup took too long. Check your connection and try again, or enter the details by hand.'
          : !o.ok && !g.ok ? 'Both lookup services failed to respond.' : 'A lookup service had a problem and the other found no match. Try again in a moment.' };
      }
    }
    if (!found) return { status: 'notfound' };
    cache.set(isbn13, { at: Date.now(), r: found });
    saveCache();
    return found;
  } finally {
    clearTimeout(timer);
  }
}

/** Title or author search via the Open Library search API, Google Books fallback. */
export async function searchBooks(q: string, budgetMs = LOOKUP_BUDGET_MS): Promise<SearchItem[] | 'offline' | 'error' | 'ratelimited'> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), budgetMs);
  let rate = false;
  try {
    try {
      const fields = 'key,title,subtitle,author_name,first_publish_year,isbn,cover_i,number_of_pages_median,publisher';
      const j = await olGet(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=12&fields=${fields}`, ctrl.signal);
      const docs: any[] = Array.isArray(j?.docs) ? j.docs : [];
      if (docs.length) {
        return docs.filter(d => typeof d?.title === 'string').map(d => {
          const i13 = (Array.isArray(d.isbn) ? d.isbn : []).find((x: string) => x.length === 13 && /^97[89]/.test(x)) ?? '';
          return {
            source: 'Open Library' as const,
            link: typeof d.key === 'string' && /^\/works\/\w+$/.test(d.key) ? `https://openlibrary.org${d.key}` : 'https://openlibrary.org/',
            draft: {
              ...emptyDraft(),
              title: d.subtitle ? `${d.title}: ${d.subtitle}` : d.title,
              authors: (Array.isArray(d.author_name) ? d.author_name : []).join('; '),
              isbn13: i13,
              isbn10: i13 ? isbn13To10(i13) ?? '' : '',
              publisher: d.publisher?.[0] ?? '',
              year: d.first_publish_year ? String(d.first_publish_year) : '',
              pages: d.number_of_pages_median ? String(d.number_of_pages_median) : '',
              coverUrl: Number.isInteger(d.cover_i) && d.cover_i > 0 ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '',
            },
          };
        });
      }
    } catch (e) { rate = e instanceof RateLimited; }
    try {
      const g = await gbGet(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=12`, ctrl.signal);
      return (Array.isArray(g?.items) ? g.items : []).map((v: any) => fromGoogle(v));
    } catch (e) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
      return rate || e instanceof RateLimited ? 'ratelimited' : 'error';
    }
  } finally {
    clearTimeout(timer);
  }
}
