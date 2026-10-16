import { useEffect, useState, useSyncExternalStore } from 'react';
import { hasUnsaved, reloadNow, subscribeUpdate, takePendingDraft, updateWaiting } from './lib/update';
import { db, takeCleanupNotice } from './lib/db';
import { UNTITLED } from './lib/migrate';
import { LibraryView } from './views/LibraryView';
import { AddView } from './views/AddView';
import { ReviewView } from './views/ReviewView';
import { DetailView } from './views/DetailView';
import { ExportView } from './views/ExportView';
import type { Draft } from './lib/types';

type View =
  | { v: 'library' } | { v: 'add' } | { v: 'export' }
  | { v: 'review'; draft: Draft; source?: string; link?: string; restored?: boolean }
  | { v: 'detail'; id: string; restoreDraft?: Draft };

const tabs = [
  { v: 'library', label: 'Library' },
  { v: 'add', label: 'Add' },
  { v: 'export', label: 'Export' },
] as const;

export default function App() {
  const [view, setView] = useState<View>(() => {
    const p = takePendingDraft();
    if (p?.ctx.kind === 'review') return { v: 'review', draft: p.draft, source: p.ctx.source, link: p.ctx.link, restored: true };
    if (p?.ctx.kind === 'edit') return { v: 'detail', id: p.ctx.id, restoreDraft: p.draft };
    const h = location.hash.slice(1);
    return h === 'add' || h === 'export' ? { v: h } : { v: 'library' };
  });
  const [online, setOnline] = useState(navigator.onLine);
  const update = useSyncExternalStore(subscribeUpdate, updateWaiting);
  const unsaved = useSyncExternalStore(subscribeUpdate, hasUnsaved);
  const [later, setLater] = useState(false);
  const [cleanup, setCleanup] = useState<ReturnType<typeof takeCleanupNotice>>(null);
  // The upgrade runs when the database first opens, so look for its notice after that.
  useEffect(() => { db.open().then(() => setCleanup(takeCleanupNotice())).catch(() => undefined); }, []);

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    addEventListener('online', on); addEventListener('offline', off);
    return () => { removeEventListener('online', on); removeEventListener('offline', off); };
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
    const h = view.v === 'add' || view.v === 'export' ? '#' + view.v : '';
    if (location.hash !== h) history.replaceState(null, '', location.pathname + location.search + h);
  }, [view]);
  useEffect(() => {
    const onHash = () => {
      const h = location.hash.slice(1);
      setView(h === 'add' || h === 'export' ? { v: h } : { v: 'library' });
    };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const active = view.v === 'review' ? 'add' : view.v === 'detail' ? 'library' : view.v;

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-40 bg-bg/90 backdrop-blur border-b border-line pt-[env(safe-area-inset-top)]">
        <div className="max-w-3xl mx-auto px-4 flex items-center justify-between h-14">
          <button onClick={() => setView({ v: 'library' })} className="font-serif text-lg tracking-tight min-h-11 flex items-center">
            Nineveh
          </button>
          <nav className="hidden sm:flex gap-1">
            {tabs.map(t => (
              <button key={t.v} onClick={() => setView({ v: t.v })}
                className={`min-h-11 px-4 rounded-lg text-[15px] ${active === t.v ? 'text-accent' : 'text-muted hover:text-fg'}`}>{t.label}</button>
            ))}
          </nav>
        </div>
        {update && !later && (
          <div role="status" className="border-t border-line bg-panel">
            <div className="max-w-3xl mx-auto px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="flex-1 min-w-48">Update available.{unsaved ? ' Your unsaved changes will be kept.' : ''}</span>
              <button onClick={() => reloadNow()} className="min-h-11 px-3 rounded-lg bg-accent text-ink font-semibold">Reload</button>
              <button onClick={() => setLater(true)} className="min-h-11 px-3 rounded-lg text-muted hover:text-fg">Later</button>
            </div>
          </div>
        )}
        {!online && <div className="text-center text-xs text-ink bg-accent py-1">Offline. Your library still works; lookups wait for a connection.</div>}
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-4 pt-6 pb-28 sm:pb-12">
        {cleanup && (
          <div role="status" className="mb-5 rounded-lg border border-accent/50 bg-white/[0.03] px-4 py-3 text-[15px] leading-relaxed">
            <p>Your library was upgraded and some old data was tidied up:{' '}
              {[cleanup.droppedDates && `${cleanup.droppedDates} invalid or future read date${cleanup.droppedDates > 1 ? 's' : ''} removed`,
                cleanup.untitled && `${cleanup.untitled} book${cleanup.untitled > 1 ? 's' : ''} without a title now called "${UNTITLED}"`,
                cleanup.droppedCovers && `${cleanup.droppedCovers} unsafe cover link${cleanup.droppedCovers > 1 ? 's' : ''} removed`].filter(Boolean).join('; ')}.
              {' '}A copy of the old data was kept on this device.</p>
            <button onClick={() => setCleanup(null)} className="min-h-11 mt-1 text-accent">OK</button>
          </div>
        )}
        {view.v === 'library' && <LibraryView onOpen={id => setView({ v: 'detail', id })} onAdd={() => setView({ v: 'add' })} onExport={() => setView({ v: 'export' })} />}
        {view.v === 'add' && <AddView onReview={(draft, source, link) => setView({ v: 'review', draft, source, link })} />}
        {view.v === 'review' && (
          <ReviewView draft={view.draft} source={view.source} link={view.link} restored={view.restored}
            onSaved={id => setView({ v: 'detail', id })} onCancel={() => setView({ v: 'add' })} onOpen={id => setView({ v: 'detail', id })} />
        )}
        {view.v === 'detail' && <DetailView key={view.id} id={view.id} restoreDraft={view.restoreDraft} onBack={() => setView({ v: 'library' })} />}
        {view.v === 'export' && <ExportView />}
      </main>

      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-bg/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-3">
          {tabs.map(t => (
            <button key={t.v} onClick={() => setView({ v: t.v })}
              className={`h-14 text-[15px] ${active === t.v ? 'text-accent font-semibold' : 'text-muted'}`}>{t.label}</button>
          ))}
        </div>
      </nav>
    </div>
  );
}
