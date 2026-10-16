export const FORMATS = ['Print', 'Audiobook', 'Ebook'] as const;
export type Format = typeof FORMATS[number];
export function toFormat(v: unknown): Format {
  const s = String(v ?? '').trim().toLowerCase();
  return (FORMATS.find(f => f.toLowerCase() === s) ?? 'Print');
}

/** Parse an owned-formats value: an array, "Print; Audiobook", or an old single format. Never empty. */
export function toFormats(v: unknown): Format[] {
  const parts = Array.isArray(v) ? v.map(String) : String(v ?? '').split(/[;|,+]/);
  const set = new Set<Format>();
  for (const p of parts) {
    const s = p.trim().toLowerCase();
    const f = FORMATS.find(x => x.toLowerCase() === s || (x === 'Audiobook' && s === 'audio') || (x === 'Ebook' && s === 'e-book'));
    if (f) set.add(f);
  }
  return sortFormats(set.size ? [...set] : ['Print']);
}

export const sortFormats = (f: Iterable<Format>): Format[] => FORMATS.filter(x => [...f].includes(x));
export const unionFormats = (a: Format[], b: Format[]): Format[] => sortFormats([...a, ...b]);

export interface Book {
  id: string;
  title: string;
  authors: string;
  formats: Format[]; // owned formats, never empty
  narrators: string;
  length: string; // e.g. 11h 2m
  asin: string;
  isbn13: string;
  isbn10: string;
  publisher: string;
  year: string;
  pages: string;
  coverUrl: string;
  shelf: string;
  notes: string;
  readDates: string[]; // YYYY-MM-DD, oldest first
  addedAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

export type Draft = Omit<Book, 'id' | 'addedAt' | 'updatedAt' | 'readDates'> & { readDates?: string[] };

export const emptyDraft = (): Draft => ({
  title: '', authors: '', formats: ['Print'], narrators: '', length: '', asin: '', isbn13: '', isbn10: '', publisher: '', year: '', pages: '',
  coverUrl: '', shelf: '', notes: '',
});

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** A real calendar date in YYYY-MM-DD that is not in the future. */
export function isValidReadDate(s: string, today = todayLocal()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return false;
  return y >= 1000 && s <= today;
}

export const mergeDates = (...lists: string[][]): string[] => [...new Set(lists.flat())].sort();
