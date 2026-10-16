/**
 * Cover image URLs are only kept when they are https and point at a known cover host.
 * Anything else (http, javascript:, data:, trackers) is dropped, so a shared file or an API
 * answer cannot make the browser load an image from an arbitrary server.
 */
const ALLOWED = [
  (h: string) => h === 'covers.openlibrary.org',
  (h: string) => /^books\.google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(h),
  (h: string) => h.endsWith('.googleusercontent.com'),
  (h: string) => h === 'm.media-amazon.com', // Audible covers from Audible Library Extractor exports
];

export function safeCoverUrl(v: unknown): string {
  let s = typeof v === 'string' ? v.trim() : '';
  if (!s) return '';
  // Google Books still hands out http:// thumbnails; upgrade only those.
  if (/^http:\/\/books\.google\./i.test(s)) s = 'https://' + s.slice(7);
  let u: URL;
  try { u = new URL(s); } catch { return ''; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return '';
  const host = u.hostname.toLowerCase();
  if (!ALLOWED.some(ok => ok(host))) return '';
  // One Google Books host, so the Content Security Policy can list it exactly.
  if (host.startsWith('books.google.')) u.hostname = 'books.google.com';
  return u.href;
}
