import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getLastBackup, setLastBackup } from '../lib/db';
import { newReport, type ParseReport } from '../lib/io';
import { Button, Notice, PageTitle } from '../components/ui';
import { WAIT_TEXT, applyAudible, applyImport, makeExport, readImportFile, withImportLock } from '../lib/importer';
import type { AudibleItem } from '../lib/audible';
import { errorText } from '../lib/quota';
import { todayLocal, type Book } from '../lib/types';

function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function reportText(rep: ParseReport): string {
  const parts: string[] = [];
  if (rep.droppedDates) parts.push(`${rep.droppedDates} read date${rep.droppedDates > 1 ? 's' : ''} skipped (invalid or in the future)`);
  if (rep.invalidIsbns) parts.push(`${rep.invalidIsbns} ISBN${rep.invalidIsbns > 1 ? 's' : ''} failed the check digit and were kept as typed`);
  if (rep.skippedRows) parts.push(`${rep.skippedRows} row${rep.skippedRows > 1 ? 's' : ''} without a title skipped`);
  if (rep.droppedCovers) parts.push(`${rep.droppedCovers} cover link${rep.droppedCovers > 1 ? 's' : ''} from an unknown site removed`);
  return parts.length ? ' ' + parts.join('; ') + '.' : '';
}

const hasFsAccess = typeof window !== 'undefined' && 'showSaveFilePicker' in window;
const BIG = 20000;

export function ExportView() {
  const books = useLiveQuery(() => db.books.toArray(), []);
  const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [last, setLast] = useState(getLastBackup());
  const fileRef = useRef<HTMLInputElement>(null);
  const audibleRef = useRef<HTMLInputElement>(null);
  const [audible, setAudible] = useState<{ file: string; newCount: number; existing: number; merged: number; dupes: number; titles: string[]; mergedTitles: { title: string; formats: string }[] } | null>(null);
  const [preferFile, setPreferFile] = useState(false);
  const handleRef = useRef<any>(null);
  const stamp = todayLocal();
  const n = books?.length ?? 0;

  const done = (text: string) => { setLastBackup(); setLast(getLastBackup()); setMsg({ tone: 'info', text }); };

  /** Run one job at a time on this page, with a visible "working" state. */
  async function job(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label); setMsg(null);
    try { await fn(); } finally { setBusy(''); }
  }

  function exportAs(kind: 'csv' | 'xlsx' | 'json') {
    if (!books) return;
    setAudible(null);
    const list = books;
    return job(`Preparing ${kind === 'xlsx' ? 'Excel' : kind.toUpperCase()} file for ${list.length} books`, async () => {
      try {
        const { data, cut } = await makeExport(kind, list);
        const type = kind === 'csv' ? 'text/csv;charset=utf-8' : kind === 'json' ? 'application/json' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        download(data, `home-library-${stamp}.${kind}`, type);
        const note = cut ? ` ${cut} very long field${cut > 1 ? 's were' : ' was'} shortened to fit Excel's limit; use JSON for a full backup.` : '';
        done(`Exported ${list.length} books as ${kind.toUpperCase()}.${note}`);
      } catch (err) {
        setMsg({ tone: 'error', text: `The ${kind.toUpperCase()} export failed: ${errorText(err)} Try JSON instead.` });
      }
    });
  }

  async function importBooks(incoming: Book[], label: string, rep: ParseReport = newReport(), preferNewerImport = preferFile) {
    const plan = await withImportLock(() => applyImport(incoming, { preferNewerImport }), () => setBusy(WAIT_TEXT));
    const inFile = plan.mergedInFile ? ` ${plan.mergedInFile} repeated in the file and combined.` : '';
    setMsg({ tone: 'info', text: `${label}: ${plan.added} added, ${plan.updated} updated, ${plan.unchanged} already up to date.${inFile}${reportText(rep)}` });
  }

  async function importAudible(fileName: string, items: AudibleItem[]) {
    const plan = await withImportLock(() => applyAudible(items), () => setBusy(WAIT_TEXT));
    setAudible({
      file: fileName, newCount: plan.newCount, existing: plan.existingCount + plan.mergedCount, merged: plan.mergedCount, dupes: plan.skippedInFile,
      titles: plan.add.slice(0, 5).map(b => b.title),
      mergedTitles: plan.update.filter(b => b.formats.length > 1).slice(0, 5).map(b => ({ title: b.title, formats: b.formats.join(' and ') })),
    });
  }

  async function importFile(f: File, audibleOnly: boolean, sync = false) {
    await job(`Reading ${f.name}`, async () => {
      try {
        setAudible(null);
        const parsed = await readImportFile(f, audibleOnly);
        if (parsed.kind === 'audible') { await importAudible(f.name, parsed.items); return; }
        if (!parsed.books.length) { setMsg({ tone: 'error', text: `No books found in ${f.name}. Each row needs at least a title.` }); return; }
        setBusy(`Saving ${parsed.books.length} books`);
        await importBooks(parsed.books, sync ? `Synced from ${f.name}` : `Imported ${f.name}`, parsed.rep, sync ? true : preferFile);
      } catch (err) {
        setAudible(null);
        setMsg({ tone: 'error', text: `Could not ${audibleOnly ? 'import' : 'read'} ${f.name}: ${errorText(err)}` });
      }
    });
  }

  function onAudibleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) importFile(f, true);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) importFile(f, false);
  }

  function backupToFile() {
    if (!books) return;
    const list = books;
    return job(`Preparing backup of ${list.length} books`, async () => {
      try {
        const { data } = await makeExport('json', list);
        if (!hasFsAccess) {
          download(data, 'home-library-backup.json', 'application/json');
          done('Backup downloaded. Move it to your sync folder (iCloud Drive, Google Drive or Dropbox), or AirDrop or email it to your computer.');
          return;
        }
        if (!handleRef.current) {
          handleRef.current = await (window as any).showSaveFilePicker({
            suggestedName: 'home-library-backup.json',
            types: [{ description: 'Library backup', accept: { 'application/json': ['.json'] } }],
          });
        }
        const w = await handleRef.current.createWritable();
        await w.write(data); await w.close();
        done(`Backed up ${list.length} books to ${handleRef.current.name}.`);
      } catch (err) {
        if ((err as DOMException).name !== 'AbortError') setMsg({ tone: 'error', text: `Backup failed: ${errorText(err)}` });
      }
    });
  }

  async function loadFromBackup() {
    if (!hasFsAccess || !('showOpenFilePicker' in window)) { fileRef.current?.click(); return; }
    try {
      const [h] = await (window as any).showOpenFilePicker({ types: [{ description: 'Library backup', accept: { 'application/json': ['.json'] } }] });
      const f: File = await h.getFile();
      await importFile(f, false, true);
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') setMsg({ tone: 'error', text: `Could not load: ${errorText(err)}` });
    }
  }

  const lastText = last ? new Date(last).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never';

  return (
    <div>
      <PageTitle sub={`${n} books. Your list stays on this device until you export it.`}>Export and backup</PageTitle>
      <div aria-live="polite">
        {busy && <div className="mb-6"><Notice><span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse mr-2" />{busy}. You can keep using the app; please keep this tab open.</Notice></div>}
        {msg && <div className="mb-6"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      </div>
      {audible && (
        <div className="mb-6">
          <Notice>
            <p className="text-xs uppercase tracking-wider text-muted">Audible import</p>
            <p className="font-serif text-2xl mt-1">{audible.newCount} new, {audible.existing} already in library</p>
            {audible.merged > 0 && <p className="text-sm text-muted mt-1">{audible.merged} of those you already owned in print or ebook. Audiobook was added to {audible.merged > 1 ? 'those entries' : 'that entry'}, with narrator, length and ASIN.</p>}
            {audible.dupes > 0 && <p className="text-sm text-muted mt-1">{audible.dupes} repeated in the file and skipped.</p>}
            {(audible.titles.length > 0 || audible.mergedTitles.length > 0) && (
              <ul className="mt-3 text-[15px] space-y-1">
                {audible.titles.map((t, i) => <li key={'n' + i} className="break-words pl-5 -indent-5"><span className="text-accent mr-2">+</span>{t}</li>)}
                {audible.newCount > audible.titles.length && <li className="text-muted text-sm">and {audible.newCount - audible.titles.length} more new</li>}
                {audible.mergedTitles.map((t, i) => <li key={'m' + i} className="break-words pl-5 -indent-5"><span className="text-accent mr-2">&amp;</span>{t.title} <span className="text-muted text-sm">now {t.formats}</span></li>)}
              </ul>
            )}
            <p className="text-xs text-muted mt-3 break-words">From {audible.file}. New titles are added as Audiobook.</p>
          </Notice>
        </div>
      )}

      <section>
        <h2 className="text-xs uppercase tracking-wider text-muted mb-3">Export</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {([['csv', 'CSV', 'Opens anywhere'], ['xlsx', 'Excel', '.xlsx workbook'], ['json', 'JSON', 'Full backup']] as const).map(([k, label, sub]) => (
            <button key={k} disabled={!n || !!busy} onClick={() => exportAs(k)}
              className="min-h-14 px-4 py-3 rounded-lg border border-line text-left hover:bg-white/5 disabled:opacity-40 flex items-center justify-between gap-3">
              <span className="font-semibold">{label}</span><span className="text-sm text-muted">{sub}</span>
            </button>
          ))}
        </div>
        {n > BIG && <p className="text-sm text-muted mt-3">With {n} books, CSV and JSON are much faster than Excel.</p>}
      </section>

      <section className="mt-8 border-t border-line pt-6">
        <h2 className="text-xs uppercase tracking-wider text-muted mb-1">Sync with your computer</h2>
        <p className="text-[15px] text-muted mb-4 leading-relaxed">
          Save one backup file into a synced folder (iCloud Drive, Google Drive or Dropbox). On the other device, open this app and load that file. Books are matched by ISBN and the newest edit wins. Edit times come from each device's clock, so keep the date and time set automatically on both.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" disabled={!n || !!busy} onClick={backupToFile} className="flex-1 min-w-40">Backup to file</Button>
          <Button onClick={loadFromBackup} disabled={!!busy} className="flex-1 min-w-40">Load from backup</Button>
        </div>
        <p className="text-sm text-muted mt-3">Last backup: {lastText}</p>
      </section>

      <section className="mt-8 border-t border-line pt-6">
        <h2 className="text-xs uppercase tracking-wider text-muted mb-1">Import</h2>
        <p className="text-[15px] text-muted mb-4 leading-relaxed">CSV, Excel or JSON, up to 50 MB. Existing books are kept and merged, never wiped.</p>
        <label className="flex items-start gap-3 mb-4 min-h-11 cursor-pointer">
          <input type="checkbox" checked={preferFile} onChange={e => setPreferFile(e.target.checked)} className="mt-1 w-5 h-5 accent-[var(--color-accent)] shrink-0" />
          <span className="text-[15px] leading-relaxed">Let newer edits in the file replace mine<span className="block text-sm text-muted">Off: your edits in the app always win; the file only fills empty fields and adds read dates and formats.</span></span>
        </label>
        <Button onClick={() => fileRef.current?.click()} disabled={!!busy} className="w-full sm:w-auto">Choose a file to import</Button>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.json,text/csv,application/json" className="hidden" onChange={onFile} />
      </section>

      <section className="mt-8 border-t border-line pt-6">
        <h2 className="text-xs uppercase tracking-wider text-muted mb-1">Import from Audible</h2>
        <p className="text-[15px] text-muted mb-4 leading-relaxed">
          Use the CSV spreadsheet or the raw data JSON from the Audible Library Extractor browser extension. Only new purchases are added, matched by ASIN, so you can re-import any time. A title you already own in print gets Audiobook added to the same entry.
        </p>
        <Button onClick={() => audibleRef.current?.click()} disabled={!!busy} className="w-full sm:w-auto">Choose an Audible export</Button>
        <input ref={audibleRef} type="file" accept=".csv,.json,text/csv,application/json" className="hidden" onChange={onAudibleFile} data-testid="audible-input" />
      </section>

      <section className="mt-10 border-t border-line pt-6 text-xs text-muted leading-relaxed space-y-2" aria-label="About">
        <p>No accounts, tracking or analytics. The only outside requests are book lookups and cover images.</p>
        <p>Book data and covers from <a className="underline hover:text-fg" href="https://openlibrary.org/" target="_blank" rel="noopener noreferrer">Open Library</a> (Internet Archive) and <a className="underline hover:text-fg" href="https://books.google.com/" target="_blank" rel="noopener noreferrer">Google Books</a>. Powered by Google for results from Google Books. Audible covers come from your own Audible export.</p>
        <p><a className="underline hover:text-fg" href="privacy.html" target="_blank" rel="noopener">Privacy policy</a></p>
      </section>
    </div>
  );
}
