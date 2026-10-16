import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getLastBackup, requestPersistence, setLastBackup } from '../lib/db';
import { booksToCsv, booksToJson, booksToXlsx, csvToBooks, jsonToBooks, mergeBooks, newReport, xlsxToBooks, xlsxTruncatedCells, type ParseReport } from '../lib/io';
import { Button, Notice, PageTitle } from '../components/ui';
import { isAudibleHeaders, isAudibleJson, parseAudibleCsv, parseAudibleJson, planAudibleImport } from '../lib/audible';
import Papa from 'papaparse';
import { todayLocal, type Book } from '../lib/types';

function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function parseFile(file: File, rep: ParseReport): Promise<Book[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return xlsxToBooks(await file.arrayBuffer(), rep);
  const text = await file.text();
  const t = text.trimStart();
  if (name.endsWith('.json') || t.startsWith('{') || t.startsWith('[') || t === 'null') return jsonToBooks(text, rep);
  return csvToBooks(text, rep);
}

function reportText(rep: ParseReport): string {
  const parts: string[] = [];
  if (rep.droppedDates) parts.push(`${rep.droppedDates} read date${rep.droppedDates > 1 ? 's' : ''} skipped (invalid or in the future)`);
  if (rep.invalidIsbns) parts.push(`${rep.invalidIsbns} ISBN${rep.invalidIsbns > 1 ? 's' : ''} failed the check digit and were kept as typed`);
  if (rep.skippedRows) parts.push(`${rep.skippedRows} row${rep.skippedRows > 1 ? 's' : ''} without a title skipped`);
  return parts.length ? ' ' + parts.join('; ') + '.' : '';
}

const hasFsAccess = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

export function ExportView() {
  const books = useLiveQuery(() => db.books.toArray(), []);
  const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [last, setLast] = useState(getLastBackup());
  const fileRef = useRef<HTMLInputElement>(null);
  const audibleRef = useRef<HTMLInputElement>(null);
  const [audible, setAudible] = useState<{ file: string; newCount: number; existing: number; merged: number; dupes: number; titles: string[]; mergedTitles: { title: string; formats: string }[] } | null>(null);
  const [preferFile, setPreferFile] = useState(false);
  const handleRef = useRef<any>(null);
  const stamp = todayLocal();
  const n = books?.length ?? 0;

  const done = (text: string) => { setLastBackup(); setLast(getLastBackup()); setMsg({ tone: 'info', text }); };

  function exportAs(kind: 'csv' | 'xlsx' | 'json') {
    if (!books) return;
    setAudible(null);
    try {
      let note = '';
      if (kind === 'csv') download('\uFEFF' + booksToCsv(books), `home-library-${stamp}.csv`, 'text/csv;charset=utf-8');
      if (kind === 'xlsx') {
        const cut = xlsxTruncatedCells(books);
        download(booksToXlsx(books), `home-library-${stamp}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        if (cut) note = ` ${cut} very long field${cut > 1 ? 's were' : ' was'} shortened to fit Excel's limit; use JSON for a full backup.`;
      }
      if (kind === 'json') download(booksToJson(books), `home-library-${stamp}.json`, 'application/json');
      done(`Exported ${books.length} books as ${kind.toUpperCase()}.${note}`);
    } catch (err) {
      setMsg({ tone: 'error', text: `The ${kind.toUpperCase()} export failed: ${(err as Error).message}. Try JSON instead.` });
    }
  }

  async function importBooks(incoming: Book[], label: string, rep: ParseReport = newReport(), preferNewerImport = preferFile) {
    const existing = await db.books.toArray();
    const plan = mergeBooks(existing, incoming, { preferNewerImport });
    await db.books.bulkPut(plan.put);
    requestPersistence();
    const inFile = plan.mergedInFile ? ` ${plan.mergedInFile} repeated in the file and combined.` : '';
    setMsg({ tone: 'info', text: `${label}: ${plan.added} added, ${plan.updated} updated, ${plan.unchanged} already up to date.${inFile}${reportText(rep)}` });
  }

  async function importAudible(f: File) {
    setMsg(null);
    const text = await f.text();
    const items = f.name.toLowerCase().endsWith('.json') || text.trimStart().startsWith('{') ? parseAudibleJson(text) : parseAudibleCsv(text);
    const plan = planAudibleImport(await db.books.toArray(), items);
    await db.transaction('rw', db.books, async () => {
      await db.books.bulkAdd(plan.add);
      await db.books.bulkPut(plan.update);
    });
    requestPersistence();
    setAudible({
      file: f.name, newCount: plan.newCount, existing: plan.existingCount + plan.mergedCount, merged: plan.mergedCount, dupes: plan.skippedInFile,
      titles: plan.add.slice(0, 5).map(b => b.title),
      mergedTitles: plan.update.filter(b => b.formats.length > 1).slice(0, 5).map(b => ({ title: b.title, formats: b.formats.join(' and ') })),
    });
  }

  async function onAudibleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try { await importAudible(f); }
    catch (err) { setAudible(null); setMsg({ tone: 'error', text: `Could not import ${f.name}: ${(err as Error).message}` }); }
  }

  /** Is this file an Audible Library Extractor export? */
  async function looksAudible(f: File): Promise<boolean> {
    const name = f.name.toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) return false;
    const text = await f.text();
    try {
      if (name.endsWith('.json') || text.trimStart().startsWith('{')) return isAudibleJson(JSON.parse(text));
      return isAudibleHeaders(Papa.parse(text.split(/\r?\n/)[0]).data[0] as string[] ?? []);
    } catch { return false; }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      if (await looksAudible(f)) { await importAudible(f); return; }
      setAudible(null);
      const rep = newReport();
      const incoming = await parseFile(f, rep);
      if (!incoming.length) { setMsg({ tone: 'error', text: `No books found in ${f.name}. Each row needs at least a title.` }); return; }
      await importBooks(incoming, `Imported ${f.name}`, rep);
    } catch (err) {
      setMsg({ tone: 'error', text: `Could not read ${f.name}: ${(err as Error).message}` });
    }
  }

  async function backupToFile() {
    if (!books) return;
    const json = booksToJson(books);
    if (!hasFsAccess) {
      download(json, 'home-library-backup.json', 'application/json');
      done('Backup downloaded. Move it to your sync folder (iCloud Drive, Google Drive or Dropbox), or AirDrop or email it to your computer.');
      return;
    }
    try {
      if (!handleRef.current) {
        handleRef.current = await (window as any).showSaveFilePicker({
          suggestedName: 'home-library-backup.json',
          types: [{ description: 'Library backup', accept: { 'application/json': ['.json'] } }],
        });
      }
      const w = await handleRef.current.createWritable();
      await w.write(json); await w.close();
      done(`Backed up ${books.length} books to ${handleRef.current.name}.`);
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') setMsg({ tone: 'error', text: `Backup failed: ${(err as Error).message}` });
    }
  }

  async function loadFromBackup() {
    if (!hasFsAccess || !('showOpenFilePicker' in window)) { fileRef.current?.click(); return; }
    try {
      const [h] = await (window as any).showOpenFilePicker({ types: [{ description: 'Library backup', accept: { 'application/json': ['.json'] } }] });
      const f: File = await h.getFile();
      await importBooks(jsonToBooks(await f.text()), `Synced from ${f.name}`, newReport(), true);
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') setMsg({ tone: 'error', text: `Could not load: ${(err as Error).message}` });
    }
  }

  const lastText = last ? new Date(last).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never';

  return (
    <div>
      <PageTitle sub={`${n} books. Your list stays on this device until you export it.`}>Export and backup</PageTitle>
      {msg && <div className="mb-6"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
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
            <button key={k} disabled={!n} onClick={() => exportAs(k)}
              className="min-h-14 px-4 py-3 rounded-lg border border-line text-left hover:bg-white/5 disabled:opacity-40 flex items-center justify-between gap-3">
              <span className="font-semibold">{label}</span><span className="text-sm text-muted">{sub}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-8 border-t border-line pt-6">
        <h2 className="text-xs uppercase tracking-wider text-muted mb-1">Sync with your computer</h2>
        <p className="text-[15px] text-muted mb-4 leading-relaxed">
          Save one backup file into a synced folder (iCloud Drive, Google Drive or Dropbox). On the other device, open this app and load that file. Books are matched by ISBN and the newest edit wins.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" disabled={!n} onClick={backupToFile} className="flex-1 min-w-40">Backup to file</Button>
          <Button onClick={loadFromBackup} className="flex-1 min-w-40">Load from backup</Button>
        </div>
        <p className="text-sm text-muted mt-3">Last backup: {lastText}</p>
      </section>

      <section className="mt-8 border-t border-line pt-6">
        <h2 className="text-xs uppercase tracking-wider text-muted mb-1">Import</h2>
        <p className="text-[15px] text-muted mb-4 leading-relaxed">CSV, Excel or JSON. Existing books are kept and merged, never wiped.</p>
        <label className="flex items-start gap-3 mb-4 min-h-11 cursor-pointer">
          <input type="checkbox" checked={preferFile} onChange={e => setPreferFile(e.target.checked)} className="mt-1 w-5 h-5 accent-[var(--color-accent)] shrink-0" />
          <span className="text-[15px] leading-relaxed">Let newer edits in the file replace mine<span className="block text-sm text-muted">Off: your edits in the app always win; the file only fills empty fields and adds read dates and formats.</span></span>
        </label>
        <Button onClick={() => fileRef.current?.click()} className="w-full sm:w-auto">Choose a file to import</Button>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.json,text/csv,application/json" className="hidden" onChange={onFile} />
      </section>

      <section className="mt-8 border-t border-line pt-6">
        <h2 className="text-xs uppercase tracking-wider text-muted mb-1">Import from Audible</h2>
        <p className="text-[15px] text-muted mb-4 leading-relaxed">
          Use the CSV spreadsheet or the raw data JSON from the Audible Library Extractor browser extension. Only new purchases are added, matched by ASIN, so you can re-import any time. A title you already own in print gets Audiobook added to the same entry.
        </p>
        <Button onClick={() => audibleRef.current?.click()} className="w-full sm:w-auto">Choose an Audible export</Button>
        <input ref={audibleRef} type="file" accept=".csv,.json,text/csv,application/json" className="hidden" onChange={onAudibleFile} data-testid="audible-input" />
      </section>

      <p className="text-xs text-muted mt-10 leading-relaxed">No accounts, tracking or analytics. The only outside requests are ISBN lookups and cover images from Open Library and Google Books.</p>
    </div>
  );
}
