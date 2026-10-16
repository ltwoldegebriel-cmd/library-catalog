export const FORMATS = ['Print', 'Audiobook', 'Ebook'] as const;
export type Format = typeof FORMATS[number];
export function toFormat(v: unknown): Format {
  const s = String(v ?? '').trim().toLowerCase();
  return (FORMATS.find(f => f.toLowerCase() === s) ?? 'Print');
}

export interface Book {
  id: string;
  title: string;
  authors: string;
  format: Format;
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
  title: '', authors: '', format: 'Print', narrators: '', length: '', asin: '', isbn13: '', isbn10: '', publisher: '', year: '', pages: '',
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
