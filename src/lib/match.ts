/**
 * Book identity and merging rules, shared by import, Audible import and the migration.
 * One entry per title: print, audiobook and ebook copies of a title live on one record.
 *
 * Two records are the same title when:
 *  1. same id, or
 *  2. same ASIN, or
 *  3. same ISBN-13, or
 *  4. same normalised full title (subtitle kept) AND same normalised first author.
 * Never on title alone. Rules 3 and 4 are blocked when both records carry different ASINs
 * (different Audible products, e.g. books in a series).
 */
import type { Book } from './types';
import { mergeDates, unionFormats } from './types';

const FOLD: Record<string, string> = { 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ß': 'ss', 'đ': 'd', 'ł': 'l', 'þ': 'th', 'ı': 'i' };
const norm = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[øæœßđłþı]/g, c => FOLD[c])
  .replace(/&/g, ' and ').replace(/['\u2019]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function normTitle(title: string): string {
  return norm(title).replace(/^(the|a|an) /, '');
}

export function firstAuthor(authors: string): string {
  return norm(authors.split(/[;,]/)[0] ?? '');
}

/** Title + first author key, or '' when there is no author (title alone never matches). */
export function titleAuthorKey(title: string, authors: string): string {
  const t = normTitle(title);
  const a = firstAuthor(authors);
  return t && a ? `${t}|${a}` : '';
}

type Ident = Pick<Book, 'title' | 'authors' | 'asin' | 'isbn13'> & { id?: string };

const asinConflict = (a: Ident, b: Ident) => !!a.asin && !!b.asin && a.asin !== b.asin;

/** Index for finding the existing record that matches an incoming one. */
export class BookIndex<T extends Ident> {
  private byId = new Map<string, T>();
  private byAsin = new Map<string, T>();
  private byIsbn = new Map<string, T[]>();
  private byKey = new Map<string, T[]>();

  constructor(items: T[] = []) { items.forEach(i => this.add(i)); }

  add(b: T) {
    if (b.id) this.byId.set(b.id, b);
    if (b.asin) this.byAsin.set(b.asin, b);
    if (b.isbn13) this.byIsbn.set(b.isbn13, [...(this.byIsbn.get(b.isbn13) ?? []), b]);
    const k = titleAuthorKey(b.title, b.authors);
    if (k) this.byKey.set(k, [...(this.byKey.get(k) ?? []), b]);
  }

  remove(b: T) {
    if (b.id && this.byId.get(b.id) === b) this.byId.delete(b.id);
    if (b.asin && this.byAsin.get(b.asin) === b) this.byAsin.delete(b.asin);
    const drop = (m: Map<string, T[]>, k: string) => { const l = m.get(k)?.filter(x => x !== b); if (l?.length) m.set(k, l); else m.delete(k); };
    if (b.isbn13) drop(this.byIsbn, b.isbn13);
    const k = titleAuthorKey(b.title, b.authors);
    if (k) drop(this.byKey, k);
  }

  /** Re-index after a record's identifying fields changed. */
  replace(oldB: T, newB: T) { this.remove(oldB); this.add(newB); }

  find(b: Ident, opts: { useId?: boolean; accept?: (candidate: T) => boolean } = {}): T | undefined {
    const ok = (x: T | undefined) => !!x && (!opts.accept || opts.accept(x));
    if (opts.useId !== false && b.id) { const m = this.byId.get(b.id); if (ok(m)) return m; }
    if (b.asin) { const m = this.byAsin.get(b.asin); if (ok(m)) return m; }
    if (b.isbn13) { const m = this.byIsbn.get(b.isbn13)?.find(x => !asinConflict(x, b) && ok(x)); if (m) return m; }
    const k = titleAuthorKey(b.title, b.authors);
    if (k) { const m = this.byKey.get(k)?.find(x => !asinConflict(x, b) && ok(x)); if (m) return m; }
    return undefined;
  }
}

const SCALARS = ['title', 'authors', 'narrators', 'length', 'asin', 'isbn13', 'isbn10', 'publisher', 'year', 'pages', 'coverUrl', 'shelf', 'notes'] as const;

/**
 * Combine two records of the same title. Formats and read dates are unioned. For other
 * fields, non-empty values are kept; when both have a value, `preferB` decides.
 */
export function combine(a: Book, b: Book, preferB: boolean): Book {
  const out: Book = { ...a };
  for (const f of SCALARS) {
    const av = (a[f] ?? '').trim(), bv = (b[f] ?? '').trim();
    out[f] = preferB ? (bv || av) : (av || bv);
  }
  out.formats = unionFormats(a.formats, b.formats);
  out.readDates = mergeDates(a.readDates, b.readDates);
  out.addedAt = [a.addedAt, b.addedAt].filter(Boolean).sort()[0] ?? a.addedAt;
  out.updatedAt = [a.updatedAt, b.updatedAt].filter(Boolean).sort().pop() ?? a.updatedAt;
  out.id = a.id;
  return out;
}

export function sameBook(a: Book, b: Book): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
