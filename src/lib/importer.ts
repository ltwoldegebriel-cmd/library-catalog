/**
 * Import and export plumbing for the UI: file size limit, parsing and export off the main
 * thread with a timeout, a cross-tab import lock, and one atomic write.
 */
import { db, requestPersistence } from './db';
import { MAX_IMPORT_BYTES, mergeBooks, type MergeOptions, type MergePlan } from './io';
import { parseInput, buildExport, isSpreadsheet, type Parsed, type FileInput, type ExportKind } from './fileparse';
import { planAudibleImport, type AudibleItem } from './audible';
import type { Book } from './types';

export const PARSE_TIMEOUT_MS = 60_000;
export const EXPORT_TIMEOUT_MS = 120_000;
export class UserError extends Error {}

function runWorker<T>(msg: unknown, timeoutMs: number, timeoutText: string, transfer: Transferable[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    let w: Worker;
    try { w = new Worker(new URL('./io.worker.ts', import.meta.url), { type: 'module' }); }
    catch (e) { reject(e); return; }
    const t = setTimeout(() => { w.terminate(); reject(new UserError(timeoutText)); }, timeoutMs);
    w.onmessage = (e: MessageEvent<{ ok: boolean; value?: T; error?: string }>) => {
      clearTimeout(t); w.terminate();
      if (e.data.ok) resolve(e.data.value as T); else reject(new UserError(e.data.error ?? 'Unknown error'));
    };
    w.onerror = ev => { clearTimeout(t); w.terminate(); reject(new Error(ev.message || 'The file reader stopped.')); };
    w.postMessage(msg, transfer);
  });
}
const hasWorker = () => typeof Worker !== 'undefined';

export async function readImportFile(f: File, audibleOnly = false): Promise<Parsed> {
  if (f.size > MAX_IMPORT_BYTES) throw new UserError(`This file is ${(f.size / 1048576).toFixed(0)} MB. The limit is ${MAX_IMPORT_BYTES / 1048576} MB. Split it into smaller files.`);
  const input: FileInput = isSpreadsheet(f.name) ? { name: f.name, bytes: await f.arrayBuffer() } : { name: f.name, text: await f.text() };
  if (!hasWorker()) return parseInput(input, audibleOnly);
  return runWorker<Parsed>({ op: 'parse', file: input, audibleOnly }, PARSE_TIMEOUT_MS,
    'Reading this file took too long and was stopped. If it is a spreadsheet, save it as CSV and try again.', input.bytes ? [input.bytes] : []);
}

export async function makeExport(kind: ExportKind, books: Book[]): Promise<{ data: string | ArrayBuffer; cut: number }> {
  if (!hasWorker()) return buildExport(kind, books);
  try { return await runWorker({ op: 'export', kind, books }, EXPORT_TIMEOUT_MS, 'The export took too long and was stopped. Try CSV or JSON.'); }
  catch (e) { if (e instanceof UserError) throw e; return buildExport(kind, books); }
}

export const WAIT_TEXT = 'Waiting for an import in another tab or window to finish';

/**
 * One import at a time across all tabs (Web Locks). If another tab holds the lock, `onWait`
 * is called and this import waits its turn, then merges against the updated library.
 */
export async function withImportLock<T>(fn: () => Promise<T>, onWait?: () => void): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks?.request) return fn();
  const NONE = Symbol('none');
  const first = await locks.request('nineveh-import', { ifAvailable: true }, async lock => (lock ? fn() : NONE));
  if (first !== NONE) return first as T;
  onWait?.();
  return locks.request('nineveh-import', async () => fn()) as Promise<T>;
}

const CHUNK = 2000;
async function putChunked(books: Book[], add = false) {
  for (let i = 0; i < books.length; i += CHUNK) {
    const part = books.slice(i, i + CHUNK);
    await (add ? db.books.bulkAdd(part) : db.books.bulkPut(part));
  }
}

/** Read, merge and write inside one read-write transaction, so tabs cannot interleave. Atomic. */
export async function applyImport(incoming: Book[], opts: MergeOptions): Promise<MergePlan> {
  const plan = await db.transaction('rw', db.books, async () => {
    const existing = await db.books.toArray();
    const p = mergeBooks(existing, incoming, opts);
    await putChunked(p.put);
    return p;
  });
  requestPersistence();
  return plan;
}

export async function applyAudible(items: AudibleItem[]) {
  const plan = await db.transaction('rw', db.books, async () => {
    const p = planAudibleImport(await db.books.toArray(), items);
    await putChunked(p.add, true);
    await putChunked(p.update);
    return p;
  });
  requestPersistence();
  return plan;
}
