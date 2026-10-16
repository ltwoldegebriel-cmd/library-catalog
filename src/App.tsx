import { useEffect, useState } from 'react';
import { LibraryView } from './views/LibraryView';
import { AddView } from './views/AddView';
import { ReviewView } from './views/ReviewView';
import { DetailView } from './views/DetailView';
import { ExportView } from './views/ExportView';
import type { Draft } from './lib/types';

type View =
  | { v: 'library' } | { v: 'add' } | { v: 'export' }
  | { v: 'review'; draft: Draft; source?: string }
  | { v: 'detail'; id: string };

const tabs = [
  { v: 'library', label: 'Library' },
  { v: 'add', label: 'Add' },
  { v: 'export', label: 'Export' },
] as const;

export default function App() {
  const [view, setView] = useState<View>(() => {
    const h = location.hash.slice(1);
    return h === 'add' || h === 'export' ? { v: h } : { v: 'library' };
  });
  const [online, setOnline] = useState(navigator.onLine);

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
            Home Library
          </button>
          <nav className="hidden sm:flex gap-1">
            {tabs.map(t => (
              <button key={t.v} onClick={() => setView({ v: t.v })}
                className={`min-h-11 px-4 rounded-lg text-[15px] ${active === t.v ? 'text-accent' : 'text-muted hover:text-fg'}`}>{t.label}</button>
            ))}
          </nav>
        </div>
        {!online && <div className="text-center text-xs text-ink bg-accent py-1">Offline. Your library still works; lookups wait for a connection.</div>}
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-4 pt-6 pb-28 sm:pb-12">
        {view.v === 'library' && <LibraryView onOpen={id => setView({ v: 'detail', id })} onAdd={() => setView({ v: 'add' })} onExport={() => setView({ v: 'export' })} />}
        {view.v === 'add' && <AddView onReview={(draft, source) => setView({ v: 'review', draft, source })} />}
        {view.v === 'review' && (
          <ReviewView draft={view.draft} source={view.source}
            onSaved={id => setView({ v: 'detail', id })} onCancel={() => setView({ v: 'add' })} onOpen={id => setView({ v: 'detail', id })} />
        )}
        {view.v === 'detail' && <DetailView id={view.id} onBack={() => setView({ v: 'library' })} />}
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
