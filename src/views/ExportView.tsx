import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getLastBackup, setLastBackup } from '../lib/db';
import { booksToCsv, booksToJson, booksToXlsx, csvToBooks, jsonToBooks, mergeBooks, xlsxToBooks } from '../lib/io';
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

async function parseFile(file: File): Promise<Book[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return xlsxToBooks(await file.arrayBuffer());
  const text = await file.text();
  if (name.endsWith('.json') || text.trimStart().startsWith('{') || text.trimStart().startsWith('[')) return jsonToBooks(text);
  return csvToBooks(text);
}

const hasFsAccess = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

export function ExportView() {
  const books = useLiveQuery(() => db.books.toArray(), []);
  const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [last, setLast] = useState(getLastBackup());
  const fileRef = useRef<HTMLInputElement>(null);
  const audibleRef = useRef<HTMLInputElement>(null);
  const [audible, setAudible] = useState<{ file: string; newCount: number; existing: number; dupes: number; titles: string[] } | null>(null);
  const handleRef = useRef<any>(null);
  const stamp = todayLocal();
  const n = books?.length ?? 0;

  const done = (text: string) => { setLastBackup(); setLast(getLastBackup()); setMsg({ tone: 'info', text }); };

  function exportAs(kind: 'csv' | 'xlsx' | 'json') {
    if (!books) return;
    if (kind === 'csv') download('\uFEFF' + booksToCsv(books), `home-library-${stamp}.csv`, 'text/csv;charset=utf-8');
    if (kind === 'xlsx') download(booksToXlsx(books), `home-library-${stamp}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    if (kind === 'json') download(booksToJson(books), `home-library-${stamp}.json`, 'application/json');
    done(`Exported ${books.length} books as ${kind.toUpperCase()}.`);
  }

  async function importBooks(incoming: Book[], label: string) {
    const existing = await db.books.toArray();
    const plan = mergeBooks(existing, incoming);
    await db.books.bulkPut(plan.put);
    setMsg({ tone: 'info', text: `${label}: ${plan.added} added, ${plan.updated} updated, ${plan.unchanged} already up to date.` });
  }

  async function importAudible(f: File) {
    setMsg(null);
    const text = await f.text();
    const items = f.name.toLowerCase().endsWith('.json') || text.trimStart().startsWith('{') ? parseAudibleJson(text) : parseAudibleCsv(text);
    const plan = planAudibleImport(await db.books.toArray(), items);
    await db.books.bulkAdd(plan.add);
    setAudible({ file: f.name, newCount: plan.newCount, existing: plan.existingCount, dupes: plan.skippedInFile, titles: plan.add.slice(0, 5).map(b => b.title) });
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
      const incoming = await parseFile(f);
      if (!incoming.length) { setMsg({ tone: 'error', text: `No books found in ${f.name}. Each row needs at least a title.` }); return; }
      await importBooks(incoming, `Imported ${f.name}`);
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
      await importBooks(jsonToBooks(await f.text()), `Synced from ${f.name}`);
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
            {audible.dupes > 0 && <p className="text-sm text-muted mt-1">{audible.dupes} repeated in the file and skipped.</p>}
            {audible.titles.length > 0 && (
              <ul className="mt-3 text-[15px] space-y-1">
                {audible.titles.map((t, i) => <li key={i} className="truncate"><span className="text-accent mr-2">+</span>{t}</li>)}
                {audible.newCount > audible.titles.length && <li className="text-muted text-sm">and {audible.newCount - audible.titles.length} more</li>}
              </ul>
            )}
            <p className="text-xs text-muted mt-3 break-words">From {audible.file}. New titles are marked as Audiobook.</p>
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
        <Button onClick={() => fileRef.current?.click()} className="w-full sm:w-auto">Choose a file to import</Button>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.json,text/csv,application/json" className="hidden" onChange={onFile} />
      </section>

      <section className="mt-8 border-t border-line pt-6">
        <h2 className="text-xs uppercase tracking-wider text-muted mb-1">Import from Audible</h2>
        <p className="text-[15px] text-muted mb-4 leading-relaxed">
          Use the CSV spreadsheet or the raw data JSON from the Audible Library Extractor browser extension. Only new purchases are added, matched by ASIN, so you can re-import any time.
        </p>
        <Button onClick={() => audibleRef.current?.click()} className="w-full sm:w-auto">Choose an Audible export</Button>
        <input ref={audibleRef} type="file" accept=".csv,.json,text/csv,application/json" className="hidden" onChange={onAudibleFile} data-testid="audible-input" />
      </section>

      <p className="text-xs text-muted mt-10 leading-relaxed">No accounts, tracking or analytics. The only outside requests are ISBN lookups and cover images from Open Library and Google Books.</p>
    </div>
  );
}
