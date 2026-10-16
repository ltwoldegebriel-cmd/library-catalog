import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getLastBackup } from '../lib/db';
import { Button, Cover, Input, Notice } from '../components/ui';
import { FORMATS, formatDate, type Book } from '../lib/types';

type ReadFilter = 'all' | 'unread' | 'read';
type Sort = 'title' | 'author' | 'added';

const lastRead = (b: Book) => b.readDates[b.readDates.length - 1];
const firstAuthor = (b: Book) => b.authors.split(';')[0]?.trim() ?? '';

export function LibraryView({ onOpen, onAdd, onExport }: { onOpen: (id: string) => void; onAdd: () => void; onExport: () => void }) {
  const books = useLiveQuery(() => db.books.toArray(), []);
  const [q, setQ] = useState('');
  const [rf, setRf] = useState<ReadFilter>('all');
  const [author, setAuthor] = useState('');
  const [fmt, setFmt] = useState('');
  const [sort, setSort] = useState<Sort>(() => (localStorage.getItem('sort') as Sort) || 'added');
  const [view, setView] = useState<'list' | 'grid'>(() => (localStorage.getItem('view') as 'list' | 'grid') || 'list');

  const authors = useMemo(() => {
    const s = new Set<string>();
    books?.forEach(b => b.authors.split(';').map(a => a.trim()).filter(Boolean).forEach(a => s.add(a)));
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [books]);

  const shown = useMemo(() => {
    if (!books) return [];
    const t = q.trim().toLowerCase();
    return books
      .filter(b => rf === 'all' || (rf === 'read' ? b.readDates.length > 0 : b.readDates.length === 0))
      .filter(b => !fmt || b.format === fmt)
      .filter(b => !author || b.authors.split(';').map(a => a.trim()).includes(author))
      .filter(b => !t || [b.title, b.authors, b.narrators, b.asin, b.isbn13, b.isbn10, b.shelf, b.notes, b.publisher].some(f => f.toLowerCase().includes(t)))
      .sort((a, b) => sort === 'added' ? b.addedAt.localeCompare(a.addedAt)
        : sort === 'author' ? firstAuthor(a).localeCompare(firstAuthor(b)) || a.title.localeCompare(b.title)
        : a.title.localeCompare(b.title));
  }, [books, q, rf, author, sort, fmt]);

  if (!books) return null;
  const readCount = books.filter(b => b.readDates.length).length;
  const last = getLastBackup();
  const needsBackup = books.length > 0 && (!last || Date.now() - Date.parse(last) > 30 * 864e5);

  if (books.length === 0) {
    return (
      <div className="pt-12 text-center max-w-sm mx-auto">
        <h1 className="font-serif text-3xl">Your library is empty</h1>
        <p className="text-muted mt-3">Scan the barcode on a book, or type its ISBN, to add your first one.</p>
        <Button variant="primary" className="mt-6" onClick={onAdd}>Add a book</Button>
      </div>
    );
  }


  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-5">
        <h1 className="font-serif text-3xl tracking-tight">Library</h1>
        <span className="text-sm text-muted whitespace-nowrap">{books.length} books · {readCount} read</span>
      </div>

      {needsBackup && (
        <div className="mb-5">
          <Notice tone="warn">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{last ? 'No backup in over 30 days.' : 'You have not made a backup yet.'}</span>
              <Button onClick={onExport}>Back up now</Button>
            </div>
          </Notice>
        </div>
      )}

      <Input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search title, author, ISBN, shelf" aria-label="Search" />

      <div className="flex flex-wrap gap-2 mt-3">
        <div className="flex rounded-lg border border-line overflow-hidden" role="group" aria-label="Read filter">
          {(['all', 'unread', 'read'] as ReadFilter[]).map(f => (
            <button key={f} onClick={() => setRf(f)} aria-pressed={rf === f}
              className={`min-h-11 px-3.5 text-sm capitalize ${rf === f ? 'bg-accent text-ink font-semibold' : 'text-muted hover:text-fg'}`}>{f}</button>
          ))}
        </div>
        <div className="flex rounded-lg border border-line overflow-hidden ml-auto" role="group" aria-label="Layout">
          {(['list', 'grid'] as const).map(v => (
            <button key={v} onClick={() => { localStorage.setItem('view', v); setView(v); }} aria-pressed={view === v} aria-label={`${v} view`}
              className={`min-h-11 w-11 flex items-center justify-center ${view === v ? 'bg-white/10 text-fg' : 'text-muted'}`}>
              {v === 'list'
                ? <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor"><rect y="3" width="18" height="2" rx="1"/><rect y="8" width="18" height="2" rx="1"/><rect y="13" width="18" height="2" rx="1"/></svg>
                : <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor"><rect width="8" height="8" rx="1.5"/><rect x="10" width="8" height="8" rx="1.5"/><rect y="10" width="8" height="8" rx="1.5"/><rect x="10" y="10" width="8" height="8" rx="1.5"/></svg>}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
        <select value={author} onChange={e => setAuthor(e.target.value)} aria-label="Filter by author"
          className="col-span-2 sm:col-span-1 min-h-11 min-w-0 pl-2.5 rounded-lg bg-panel border border-line text-sm text-fg truncate">
          <option value="">All authors</option>
          {authors.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={fmt} onChange={e => setFmt(e.target.value)} aria-label="Filter by format"
          className="min-h-11 min-w-0 pl-2.5 rounded-lg bg-panel border border-line text-sm text-fg truncate">
          <option value="">All formats</option>
          {FORMATS.map(f => <option key={f} value={f}>{f === 'Print' ? 'Print' : f + 's'}</option>)}
        </select>
        <select value={sort} onChange={e => { localStorage.setItem('sort', e.target.value); setSort(e.target.value as Sort); }} aria-label="Sort"
          className="min-h-11 min-w-0 pl-2.5 rounded-lg bg-panel border border-line text-sm text-fg truncate">
          <option value="added">Newest added</option>
          <option value="title">Title A to Z</option>
          <option value="author">Author A to Z</option>
        </select>
      </div>

      {shown.length === 0 && <p className="text-muted mt-10 text-center">No books match these filters.</p>}

      {view === 'list' ? (
        <ul className="mt-5 divide-y divide-line border-y border-line">
          {shown.map(b => (
            <li key={b.id}>
              <button onClick={() => onOpen(b.id)} className="w-full flex gap-4 py-3 text-left hover:bg-white/[0.03] min-h-11">
                <Cover url={b.coverUrl} title={b.title} className="w-12 h-[72px] shrink-0" compact />
                <span className="min-w-0 flex-1 self-center">
                  <span className="block font-serif text-[17px] leading-snug line-clamp-2 break-words">{b.title}</span>
                  {b.format !== 'Print' && <FormatBadge format={b.format} className="mt-1" />}
                  <span className="block text-sm text-muted truncate mt-0.5">{b.authors.replace(/;\s*/g, ', ') || 'Unknown author'}</span>
                  {b.readDates.length > 0 && (
                    <span className="block text-xs text-accent mt-1">Read {formatDate(lastRead(b))}{b.readDates.length > 1 ? ` · ${b.readDates.length} times` : ''}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-5 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-6">
          {shown.map(b => (
            <li key={b.id} className="min-w-0">
              <button onClick={() => onOpen(b.id)} className="w-full text-left group">
                <div className="relative">
                  <Cover url={b.coverUrl} title={b.title} className="w-full aspect-[2/3]" />
                  {b.format !== 'Print' && <FormatBadge format={b.format} className="absolute top-2 left-2 bg-bg/85" />}
                  {b.readDates.length > 0 && (
                    <span className="absolute top-2 right-2 rounded-full bg-accent text-ink text-[11px] font-semibold px-2 py-0.5">Read</span>
                  )}
                </div>
                <span className="block font-serif text-[15px] leading-snug mt-2 line-clamp-2 break-words">{b.title}</span>
                <span className="block text-xs text-muted truncate">{firstAuthor(b) || 'Unknown author'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FormatBadge({ format, className = '' }: { format: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] leading-none text-fg/90 ${className}`}>
      {format === 'Audiobook'
        ? <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M2 10V8a6 6 0 0 1 12 0v2"/><rect x="1.5" y="9.5" width="3.5" height="5" rx="1"/><rect x="11" y="9.5" width="3.5" height="5" rx="1"/></svg>
        : <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="3" y="1.5" width="10" height="13" rx="1.5"/><path d="M7 12h2"/></svg>}
      {format}
    </span>
  );
}
