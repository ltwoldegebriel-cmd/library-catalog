import { useEffect, useState } from 'react';
import { BookForm } from '../components/BookForm';
import { Button, Notice, PageTitle } from '../components/ui';
import { db, findDuplicates } from '../lib/db';
import { emptyDraft, newId, type Book, type Draft } from '../lib/types';

export function ReviewView({ draft, source, onSaved, onCancel, onOpen }: {
  draft: Draft; source?: string; onSaved: (id: string) => void; onCancel: () => void; onOpen: (id: string) => void;
}) {
  const [d, setD] = useState(draft);
  const [formKey, setFormKey] = useState(0);
  const [dups, setDups] = useState<Book[]>([]);

  useEffect(() => { findDuplicates(d.isbn13, d.title).then(setDups); }, [d.isbn13, d.title]);

  async function save(out: Draft) {
    const now = new Date().toISOString();
    const book: Book = { ...out, id: newId(), readDates: out.readDates ?? [], addedAt: now, updatedAt: now };
    await db.books.add(book);
    onSaved(book.id);
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
      {dups.length > 0 && (
        <div className="mb-5">
          <Notice tone="warn">
            <p className="font-semibold">You already have this book.</p>
            <p className="text-muted text-sm mt-1">"{dups[0].title}" is in your library{dups.length > 1 ? ` (${dups.length} copies)` : ''}. Saving adds another copy.</p>
            <Button className="mt-3" onClick={() => onOpen(dups[0].id)}>View the existing copy</Button>
          </Notice>
        </div>
      )}
      {source && (
        <div className="mb-5 flex justify-end">
          <Button variant="quiet" onClick={notThisBook}>Not this book? Clear the fields</Button>
        </div>
      )}
      <BookForm key={formKey} initial={d} submitLabel={dups.length ? 'Save another copy' : 'Save to library'} onSubmit={save} onCancel={onCancel} />
    </div>
  );
}
