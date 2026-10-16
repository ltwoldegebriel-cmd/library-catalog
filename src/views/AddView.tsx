import { useState } from 'react';
import { Scanner } from '../components/Scanner';
import { Button, Cover, Input, Notice, PageTitle } from '../components/ui';
import { checkIsbn, isbnErrorText, looksLikeIsbn, isbn13To10 } from '../lib/isbn';
import { lookupIsbn, searchBooks } from '../lib/lookup';
import { emptyDraft, type Draft } from '../lib/types';

type State =
  | { s: 'idle' }
  | { s: 'busy'; label: string }
  | { s: 'invalid'; msg: string }
  | { s: 'notfound'; isbn13: string }
  | { s: 'offline'; isbn13?: string }
  | { s: 'error'; msg: string; isbn13?: string }
  | { s: 'results'; items: Draft[]; q: string };

export function AddView({ onReview }: { onReview: (d: Draft, source?: string) => void }) {
  const [q, setQ] = useState('');
  const [st, setSt] = useState<State>({ s: 'idle' });

  const manualFor = (isbn13?: string) =>
    onReview({ ...emptyDraft(), isbn13: isbn13 ?? '', isbn10: isbn13 ? isbn13To10(isbn13) ?? '' : '' });

  async function runIsbn(isbn13: string) {
    setSt({ s: 'busy', label: `Looking up ${isbn13}` });
    const r = await lookupIsbn(isbn13);
    if (r.status === 'found') { setSt({ s: 'idle' }); onReview(r.draft, r.source); }
    else if (r.status === 'notfound') setSt({ s: 'notfound', isbn13 });
    else if (r.status === 'offline') setSt({ s: 'offline', isbn13 });
    else setSt({ s: 'error', msg: r.message, isbn13 });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    if (looksLikeIsbn(v)) {
      const c = checkIsbn(v);
      if (c.ok) return runIsbn(c.isbn13);
      // Not 10 or 13 digits: probably a numeric title like "2001", so search instead.
      if (c.reason !== 'length') { setSt({ s: 'invalid', msg: isbnErrorText(c.reason) }); return; }
    }
    setSt({ s: 'busy', label: `Searching for "${v}"` });
    const r = await searchBooks(v);
    if (r === 'offline') setSt({ s: 'offline' });
    else if (r === 'error') setSt({ s: 'error', msg: 'The search service did not respond.' });
    else setSt({ s: 'results', items: r, q: v });
  }

  return (
    <div>
      <PageTitle sub="Scan the barcode, or type an ISBN, title or author.">Add a book</PageTitle>
      <Scanner onDetected={isbn => { setQ(isbn); runIsbn(isbn); }} />

      <form onSubmit={submit} className="mt-8">
        <label htmlFor="manual" className="block text-xs uppercase tracking-wider text-muted mb-1.5">ISBN, title or author</label>
        <div className="flex gap-2">
          <Input id="manual" value={q} onChange={e => setQ(e.target.value)} placeholder="9780140449136" enterKeyHint="search" autoComplete="off" />
          <Button type="submit" variant="primary" disabled={st.s === 'busy'}>Find</Button>
        </div>
      </form>

      <div className="mt-5 space-y-3" aria-live="polite">
        {st.s === 'busy' && <Notice><span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse mr-2" />{st.label}</Notice>}
        {st.s === 'invalid' && <Notice tone="error">{st.msg}</Notice>}
        {st.s === 'notfound' && (
          <Notice tone="warn">
            <p>No match for ISBN {st.isbn13} in Open Library or Google Books.</p>
            <Button variant="primary" className="mt-3" onClick={() => manualFor(st.isbn13)}>Enter details by hand</Button>
          </Notice>
        )}
        {st.s === 'offline' && (
          <Notice tone="warn">
            <p>You are offline, so the book can't be looked up. You can still add it by hand now.</p>
            <Button variant="primary" className="mt-3" onClick={() => manualFor(st.isbn13)}>Enter details by hand</Button>
          </Notice>
        )}
        {st.s === 'error' && (
          <Notice tone="error">
            <p>{st.msg}</p>
            <div className="flex flex-wrap gap-2 mt-3">
              {st.isbn13 && <Button onClick={() => runIsbn(st.isbn13!)}>Try again</Button>}
              <Button variant="primary" onClick={() => manualFor(st.isbn13)}>Enter by hand</Button>
            </div>
          </Notice>
        )}
        {st.s === 'results' && (
          <div>
            <p className="text-sm text-muted mb-2">{st.items.length ? `Matches for "${st.q}". Pick one to review.` : `Nothing found for "${st.q}".`}</p>
            <ul className="divide-y divide-line border-y border-line">
              {st.items.map((d, i) => (
                <li key={i}>
                  <button onClick={() => onReview(d, 'Open Library search')} className="w-full flex gap-3 py-3 text-left min-h-11 hover:bg-white/[0.03]">
                    <Cover url={d.coverUrl} title={d.title} className="w-10 h-15 shrink-0" compact />
                    <span className="min-w-0">
                      <span className="block font-serif text-[17px] leading-snug break-words">{d.title}</span>
                      <span className="block text-sm text-muted truncate">{[d.authors, d.year].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-8 border-t border-line pt-5">
        <Button variant="quiet" className="-ml-4" onClick={() => manualFor()}>Add without a lookup</Button>
      </div>
    </div>
  );
}
