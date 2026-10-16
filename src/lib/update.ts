/**
 * Service worker updates never reload on their own. When a new version is waiting, the app
 * shows "Update available"; the user picks when to reload. Any unsaved book form is stashed
 * in sessionStorage first and reopened after the reload, so typing is never lost.
 */
import type { Draft } from './types';

export type DraftCtx = { kind: 'review'; source?: string; link?: string } | { kind: 'edit'; id: string };
export interface PendingDraft { ctx: DraftCtx; draft: Draft }

const KEY = 'nineveh-pending-draft';
let live: PendingDraft | null = null;
let needRefresh = false;
let apply: ((reload?: boolean) => Promise<void>) | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());

export const subscribeUpdate = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const updateWaiting = () => needRefresh;
export const hasUnsaved = () => !!live;

export function setUpdateReady(fn: (reload?: boolean) => Promise<void>) { apply = fn; needRefresh = true; emit(); }

/** BookForm calls this on every change; null when the form matches what it started with. */
export function trackDraft(p: PendingDraft | null) { const was = !!live; live = p; if (was !== !!p) emit(); }

export async function reloadNow() {
  if (live) { try { sessionStorage.setItem(KEY, JSON.stringify(live)); } catch { /* fall through: keep the page */ return; } }
  // Activate the waiting worker and reload once it takes over; fall back to a plain reload.
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
  if (sw) {
    sw.addEventListener('controllerchange', () => location.reload(), { once: true });
    const reg = await sw.getRegistration().catch(() => undefined);
    reg?.waiting?.postMessage({ type: 'SKIP_WAITING' });
  }
  if (apply) apply(true).catch(() => undefined);
  setTimeout(() => location.reload(), 3000);
}

export function takePendingDraft(): PendingDraft | null {
  try {
    const v = sessionStorage.getItem(KEY);
    if (!v) return null;
    sessionStorage.removeItem(KEY);
    const p = JSON.parse(v) as PendingDraft;
    return p && p.draft && typeof p.draft.title === 'string' ? p : null;
  } catch { return null; }
}

/** Warn before closing the tab with unsaved typing (covers manual reloads too). */
if (typeof window !== 'undefined') addEventListener('beforeunload', e => {
  if (live && !sessionStorage.getItem(KEY)) { e.preventDefault(); (e as { returnValue: unknown }).returnValue = ''; }
});
