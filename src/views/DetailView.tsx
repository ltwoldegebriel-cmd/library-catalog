import { Fragment, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { BookForm } from '../components/BookForm';
import { Button, Cover, Input, Modal } from '../components/ui';
import { formatDate, todayLocal, type Draft } from '../lib/types';

export function DetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const book = useLiveQuery(() => db.books.get(id), [id]);
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [readDate, setReadDate] = useState(todayLocal());
  const [removeDate, setRemoveDate] = useState<number | null>(null);

  if (book === undefined) return null;
  if (!book) return <p className="text-muted">This book is no longer in your library.</p>;

  const touch = () => ({ updatedAt: new Date().toISOString() });

  async function markRead() {
    if (!readDate) return;
    const dates = [...book!.readDates, readDate].sort();
    await db.books.update(id, { readDates: dates, ...touch() });
    setReadDate(todayLocal());
  }
  async function dropDate(i: number) {
    await db.books.update(id, { readDates: book!.readDates.filter((_, j) => j !== i), ...touch() });
    setRemoveDate(null);
  }
  async function saveEdit(d: Draft) {
    await db.books.update(id, { ...d, ...touch() });
    setEditing(false);
  }

  if (editing) {
    return (
      <div>
        <h1 className="font-serif text-3xl mb-6">Edit book</h1>
        <BookForm initial={book} submitLabel="Save changes" onSubmit={saveEdit} onCancel={() => setEditing(false)} />
      </div>
    );
  }

  const meta: [string, string][] = ([
    ['Format', book.format], ['Narrators', book.narrators.replace(/;\s*/g, ', ')], ['Length', book.length],
    ['Publisher', book.publisher], ['Year', book.year], ['Pages', book.pages],
    ['ISBN-13', book.isbn13], ['ISBN-10', book.isbn10], ['ASIN', book.asin], ['Shelf', book.shelf],
    ['Added', formatDate(book.addedAt.slice(0, 10))],
  ] as [string, string][]).filter(([, v]) => v);

  return (
    <div>
      <Button variant="quiet" className="-ml-4 mb-2" onClick={onBack}>&larr; Library</Button>
      <div className="flex flex-col sm:flex-row gap-6">
        <Cover url={book.coverUrl} title={book.title} className="w-32 h-48 sm:w-44 sm:h-66 shrink-0" />
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-[28px] leading-tight tracking-tight break-words">{book.title}</h1>
          <p className="text-lg text-muted mt-1 break-words">{book.authors.replace(/;\s*/g, ', ') || 'Unknown author'}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 mt-5 text-[15px]">
            {meta.map(([k, v]) => (<Fragment key={k}><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{v}</dd></Fragment>))}
          </dl>
          {book.notes && <p className="mt-5 whitespace-pre-wrap leading-relaxed text-[15px] border-l-2 border-line pl-4">{book.notes}</p>}
        </div>
      </div>

      <section className="mt-8 border-t border-line pt-6">
        <h2 className="text-xs uppercase tracking-wider text-muted mb-3">Reading</h2>
        {book.readDates.length === 0
          ? <p className="text-muted mb-4">Not read yet.</p>
          : (
            <ul className="mb-4 divide-y divide-line border-y border-line">
              {book.readDates.map((d, i) => (
                <li key={i} className="flex items-center justify-between gap-3 min-h-11">
                  <span><span className="text-accent mr-2">&#10003;</span>{formatDate(d)}{i > 0 && <span className="text-xs text-muted ml-2">re-read</span>}</span>
                  <Button variant="quiet" aria-label={`Remove read date ${d}`} onClick={() => setRemoveDate(i)}>Remove</Button>
                </li>
              ))}
            </ul>
          )}
        <div className="flex flex-wrap gap-2 items-end">
          <label className="flex-1 min-w-40">
            <span className="block text-xs uppercase tracking-wider text-muted mb-1.5">Date finished</span>
            <Input type="date" value={readDate} max={todayLocal()} onChange={e => setReadDate(e.target.value)} />
          </label>
          <Button variant="primary" onClick={markRead} disabled={!readDate} className="flex-1 min-w-40">
            {book.readDates.length ? 'Mark as read again' : 'Mark as read'}
          </Button>
        </div>
      </section>

      <div className="mt-8 border-t border-line pt-6 flex flex-wrap gap-3">
        <Button onClick={() => setEditing(true)} className="flex-1 min-w-32">Edit details</Button>
        <Button variant="danger" onClick={() => setConfirmDel(true)} className="flex-1 min-w-32">Delete</Button>
      </div>

      <Modal open={confirmDel}>
        <h2 className="font-serif text-xl">Delete this book?</h2>
        <p className="text-muted mt-2 text-[15px]">"{book.title}" and its read dates will be removed. This can't be undone unless you have a backup.</p>
        <div className="flex gap-3 mt-5">
          <Button variant="danger" className="flex-1" onClick={async () => { await db.books.delete(id); onBack(); }}>Delete</Button>
          <Button className="flex-1" onClick={() => setConfirmDel(false)}>Keep it</Button>
        </div>
      </Modal>
      <Modal open={removeDate !== null}>
        <h2 className="font-serif text-xl">Remove this read date?</h2>
        <p className="text-muted mt-2 text-[15px]">{removeDate !== null && formatDate(book.readDates[removeDate])}</p>
        <div className="flex gap-3 mt-5">
          <Button variant="danger" className="flex-1" onClick={() => dropDate(removeDate!)}>Remove</Button>
          <Button className="flex-1" onClick={() => setRemoveDate(null)}>Cancel</Button>
        </div>
      </Modal>
    </div>
  );
}
