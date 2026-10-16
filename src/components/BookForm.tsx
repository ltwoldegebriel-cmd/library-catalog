import { useState } from 'react';
import { FORMATS, sortFormats, type Draft, type Format } from '../lib/types';
import { checkIsbn, isbnErrorText, cleanIsbn } from '../lib/isbn';
import { Button, Cover, Field, Input } from './ui';

export function BookForm({ initial, submitLabel, onSubmit, onCancel, extra, secondary }: {
  initial: Draft; submitLabel: string; secondary?: { label: string; onSubmit: (d: Draft) => void };
  onSubmit: (d: Draft) => void; onCancel: () => void; extra?: React.ReactNode;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [touched, setTouched] = useState(false);
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setD({ ...d, [k]: e.target.value });
  const isbnRaw = d.isbn13 || d.isbn10;
  const isbnChk = isbnRaw ? checkIsbn(isbnRaw) : null;
  const titleMissing = !d.title.trim();

  function finish(cb: (d: Draft) => void) {
    setTouched(true);
    if (titleMissing) return;
    let out = { ...d, title: d.title.trim() };
    if (isbnChk?.ok) out = { ...out, isbn13: isbnChk.isbn13, isbn10: isbnChk.isbn10 ?? '' };
    cb(out);
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    finish(secondary ? secondary.onSubmit : onSubmit);
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
      <div>
        <span className="block text-xs uppercase tracking-wider text-muted mb-1.5">Formats you own</span>
        <div role="group" aria-label="Formats you own" className="grid grid-cols-3 rounded-lg border border-line overflow-hidden">
          {FORMATS.map(f => {
            const on = d.formats.includes(f);
            const toggle = () => {
              const next = on ? d.formats.filter(x => x !== f) : sortFormats([...d.formats, f as Format]);
              if (next.length) setD({ ...d, formats: next });
            };
            return (
              <button key={f} type="button" aria-pressed={on} onClick={toggle}
                className={`min-h-11 text-[15px] inline-flex items-center justify-center gap-1.5 ${on ? 'bg-accent text-ink font-semibold' : 'text-muted hover:text-fg'}`}>
                {on && <span aria-hidden>&#10003;</span>}{f}
              </button>
            );
          })}
        </div>
        <span className="block text-xs text-muted mt-1">Pick every format you have. At least one.</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {(d.formats.includes('Audiobook') || d.narrators || d.length) && (<>
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
        {secondary && <Button type="submit" variant="primary" className="w-full">{secondary.label}</Button>}
        <Button type={secondary ? 'button' : 'submit'} variant={secondary ? 'ghost' : 'primary'} onClick={secondary ? () => finish(onSubmit) : undefined} className="flex-1 min-w-36">{submitLabel}</Button>
        <Button type="button" onClick={onCancel} className="flex-1 min-w-36">Cancel</Button>
      </div>
    </form>
  );
}
