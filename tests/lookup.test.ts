import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { lookupIsbn } from '../src/lib/lookup';

const g = globalThis as any;
let orig: any;
beforeEach(() => { orig = g.fetch; Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true }); });
afterEach(() => { g.fetch = orig; });

const isbn = '9780306406157';
describe('lookup (L2, L3)', () => {
  it('L2: one service failing and the other finding nothing is an error, not "not found"', async () => {
    g.fetch = async (u: string) => u.includes('openlibrary') ? new Response('x', { status: 503 }) : new Response('{"totalItems":0}', { status: 200 });
    expect((await lookupIsbn(isbn)).status).toBe('error');
    g.fetch = async (u: string) => u.includes('openlibrary') ? new Response('x', { status: 404 }) : new Response('rate', { status: 429 });
    expect((await lookupIsbn(isbn)).status).toBe('error');
  });
  it('both answer "no match" is not found', async () => {
    g.fetch = async (u: string) => u.includes('openlibrary') ? new Response('x', { status: 404 }) : new Response('{"totalItems":0}', { status: 200 });
    expect((await lookupIsbn(isbn)).status).toBe('notfound');
  });
  it('falls back to Google Books when Open Library is down', async () => {
    g.fetch = async (u: string) => u.includes('openlibrary') ? new Response('x', { status: 503 }) : new Response(JSON.stringify({ items: [{ volumeInfo: { title: 'GB' } }] }), { status: 200 });
    expect(await lookupIsbn(isbn)).toMatchObject({ status: 'found', source: 'Google Books' });
  });
  it('L3: a hanging service is cut off by the overall budget', async () => {
    g.fetch = (_u: string, o: { signal: AbortSignal }) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
    const t = Date.now();
    const r = await lookupIsbn(isbn, 300);
    expect(r.status).toBe('error');
    expect(Date.now() - t).toBeLessThan(2000);
  });
});
