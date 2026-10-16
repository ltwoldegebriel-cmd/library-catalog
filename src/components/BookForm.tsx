import { useState } from 'react';
import { FORMATS, type Draft, type Format } from '../lib/types';
import { checkIsbn, isbnErrorText, cleanIsbn } from '../lib/isbn';
import { Button, Cover, Field, Input } from './ui';

export function BookForm({ initial, submitLabel, onSubmit, onCancel, extra }: {
  initial: Draft; submitLabel: string;
  onSubmit: (d: Draft) => void; onCancel: () => void; extra?: React.ReactNode;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [touched, setTouched] = useState(false);
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setD({ ...d, [k]: e.target.value });
  const isbnRaw = d.isbn13 || d.isbn10;
  const isbnChk = isbnRaw ? checkIsbn(isbnRaw) : null;
  const titleMissing = !d.title.trim();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (titleMissing) return;
    let out = { ...d, title: d.title.trim() };
    if (isbnChk?.ok) out = { ...out, isbn13: isbnChk.isbn13, isbn10: isbnChk.isbn10 ?? '' };
    onSubmit(out);
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="flex gap-4 items-start">
        <Cover url={d.coverUrl} title={d.title || 'Untitled'} className="w-24 h-36 shrink-0" />
        <div className="flex-1 min-w-0 space-y-4">
          <Field label="Title (required)">
            <Input value={d.title} onChange={set('title')} autoFocus={!d.title} aria-invalid={touched && titleMissing} />
          </Field>
          {touched && titleMissing && <p className="text-sm text-red-300 -mt-2">A title is needed to save.</p>}
          <Field label="Authors" hint="Separate several with a semicolon.">
            <Input value={d.authors} onChange={set('authors')} />
          </Field>
        </div>
      </div>
      <div role="radiogroup" aria-label="Format" className="grid grid-cols-3 rounded-lg border border-line overflow-hidden">
        {FORMATS.map(f => (
          <button key={f} type="button" role="radio" aria-checked={d.format === f} onClick={() => setD({ ...d, format: f as Format })}
            className={`min-h-11 text-[15px] ${d.format === f ? 'bg-accent text-ink font-semibold' : 'text-muted hover:text-fg'}`}>{f}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        {(d.format === 'Audiobook' || d.narrators || d.length) && (<>
          <div className="col-span-2"><Field label="Narrators" hint="Separate several with a semicolon."><Input value={d.narrators} onChange={set('narrators')} /></Field></div>
          <Field label="Length"><Input value={d.length} onChange={set('length')} placeholder="11h 2m" /></Field>
          <Field label="ASIN"><Input value={d.asin} onChange={set('asin')} /></Field>
        </>)}
        <div className="col-span-2">
          <Field label="ISBN" hint={isbnChk && !isbnChk.ok ? <span className="text-red-300">{isbnErrorText(isbnChk.reason)} It will be saved as typed.</span> : undefined}>
            <Input inputMode="numeric" value={d.isbn13 || d.isbn10}
              onChange={e => { const v = cleanIsbn(e.target.value); setD({ ...d, isbn13: v.length === 10 ? '' : v, isbn10: v.length === 10 ? v : '' }); }} />
          </Field>
        </div>
        <div className="col-span-2"><Field label="Publisher"><Input value={d.publisher} onChange={set('publisher')} /></Field></div>
        <Field label="Year"><Input inputMode="numeric" value={d.year} onChange={set('year')} /></Field>
        <Field label="Pages"><Input inputMode="numeric" value={d.pages} onChange={set('pages')} /></Field>
        <div className="col-span-2"><Field label="Shelf or location"><Input value={d.shelf} onChange={set('shelf')} placeholder="e.g. Study, top shelf" /></Field></div>
        <div className="col-span-2"><Field label="Cover image URL"><Input value={d.coverUrl} onChange={set('coverUrl')} /></Field></div>
        <div className="col-span-2">
          <Field label="Notes">
            <textarea value={d.notes} onChange={set('notes')} rows={3}
              className="w-full min-w-0 px-3 py-2 rounded-lg bg-white/[0.04] border border-line text-fg focus:outline-none focus:border-accent" />
          </Field>
        </div>
      </div>
      {extra}
      <div className="flex flex-wrap gap-3 pt-2">
        <Button type="submit" variant="primary" className="flex-1 min-w-36">{submitLabel}</Button>
        <Button type="button" onClick={onCancel} className="flex-1 min-w-36">Cancel</Button>
      </div>
    </form>
  );
}
