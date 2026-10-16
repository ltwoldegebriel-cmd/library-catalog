import { useEffect, useMemo, useState } from 'react';
import { BookForm } from '../components/BookForm';
import { Button, Notice, PageTitle, SourceCredit } from '../components/ui';
import { errorText } from '../lib/quota';
import { db, findDuplicates, requestPersistence } from '../lib/db';
import { combine } from '../lib/match';
import { emptyDraft, newId, type Book, type Draft } from '../lib/types';

export function ReviewView({ draft, source, link, restored, onSaved, onCancel, onOpen }: {
  draft: Draft; source?: string; link?: string; restored?: boolean; onSaved: (id: string) => void; onCancel: () => void; onOpen: (id: string) => void;
}) {
  const [d, setD] = useState(draft);
  const [err, setErr] = useState('');
  const ctx = useMemo(() => ({ kind: 'review' as const, source, link }), [source, link]);
  const [formKey, setFormKey] = useState(0);
  const [dups, setDups] = useState<Book[]>([]);

  useEffect(() => { findDuplicates(d.isbn13, d.title, d.authors).then(setDups); }, [d.isbn13, d.title, d.authors]);

  async function save(out: Draft) {
    const now = new Date().toISOString();
    const book: Book = { ...out, id: newId(), readDates: out.readDates ?? [], addedAt: now, updatedAt: now };
    try { await db.books.add(book); } catch (e) { setErr(errorText(e)); return; }
    requestPersistence();
    onSaved(book.id);
  }

  /** One entry per title: fold this copy's formats and details into the existing entry. */
  async function addToExisting(out: Draft) {
    const ex = dups[0];
    const now = new Date().toISOString();
    const merged = combine(ex, { ...out, id: ex.id, readDates: out.readDates ?? [], addedAt: ex.addedAt, updatedAt: now }, false);
    try { await db.books.put({ ...merged, updatedAt: now }); } catch (e) { setErr(errorText(e)); return; }
    onSaved(ex.id);
  }

  function notThisBook() {
    setD({ ...emptyDraft(), isbn13: d.isbn13, isbn10: d.isbn10 });
    setFormKey(k => k + 1);
  }

  return (
    <div>
      <PageTitle sub={source ? `Found in ${source}. Check every field before saving.` : 'Fill in what you know. Only the title is required.'}>
        Review book
      </PageTitle>
      {source && <div className="-mt-4 mb-5"><SourceCredit source={source} link={link} /></div>}
      {restored && <div className="mb-5"><Notice>The app was updated. Your unsaved book was kept, so you can carry on.</Notice></div>}
      {err && <div className="mb-5"><Notice tone="error">{err}</Notice></div>}
      {dups.length > 0 && (
        <div className="mb-5">
          <Notice tone="warn">
            <p className="font-semibold">You already have this book.</p>
            <p className="text-muted text-sm mt-1">"{dups[0].title}" is in your library as {dups[0].formats.join(' and ')}. Saving adds the formats you pick below to that entry, so there is one entry per title.</p>
            <Button className="mt-3" onClick={() => onOpen(dups[0].id)}>View the existing copy</Button>
          </Notice>
        </div>
      )}
      {source && (
        <div className="mb-5 flex justify-end">
          <Button variant="quiet" onClick={notThisBook}>Not this book? Clear the fields</Button>
        </div>
      )}
      <BookForm key={formKey} initial={d} ctx={ctx} baseline={restored && formKey === 0 ? emptyDraft() : undefined} submitLabel={dups.length ? 'Save as a separate copy' : 'Save to library'} onSubmit={save} onCancel={onCancel}
        secondary={dups.length ? { label: 'Add to the existing entry', onSubmit: addToExisting } : undefined} />
    </div>
  );
}
