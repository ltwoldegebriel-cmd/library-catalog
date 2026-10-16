import { useEffect, useRef, useState } from 'react';
import { safeCoverUrl } from '../lib/cover';
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes } from 'react';

type Variant = 'primary' | 'ghost' | 'danger' | 'quiet';
export function Button({ variant = 'ghost', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const v = {
    primary: 'bg-accent text-ink font-semibold hover:brightness-110',
    ghost: 'border border-line text-fg hover:bg-white/5',
    danger: 'border border-red-400/40 text-red-300 hover:bg-red-400/10',
    quiet: 'text-muted hover:text-fg',
  }[variant];
  return <button className={`min-h-11 px-4 rounded-lg text-[15px] inline-flex items-center justify-center gap-2 disabled:opacity-40 transition ${v} ${className}`} {...p} />;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="block text-xs uppercase tracking-wider text-muted mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted mt-1">{hint}</span>}
    </label>
  );
}

export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={`w-full min-w-0 min-h-11 px-3 rounded-lg bg-white/[0.04] border border-line text-fg placeholder:text-muted/70 focus:outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/70 ${p.className ?? ''}`} />;
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  const c = { info: 'border-line text-fg', warn: 'border-accent/50 text-fg', error: 'border-red-400/50 text-red-200' }[tone];
  return <div className={`rounded-lg border ${c} bg-white/[0.03] px-4 py-3 text-[15px] leading-relaxed`}>{children}</div>;
}

export function Cover({ url, title, className = '', compact = false }: { url: string; title: string; className?: string; compact?: boolean }) {
  const [failed, setFailed] = useState('');
  url = safeCoverUrl(url);
  if (url && failed !== url) {
    return <img src={url} alt="" loading="lazy" className={`object-cover bg-white/5 rounded ${className}`} onError={() => setFailed(url)} />;
  }
  if (compact) {
    return (
      <div className={`rounded bg-gradient-to-br from-white/10 to-white/[0.03] border border-line flex items-center justify-center ${className}`}>
        <span className="font-serif text-xl text-muted">{title.trim().charAt(0).toUpperCase() || '?'}</span>
      </div>
    );
  }
  return (
    <div className={`rounded bg-gradient-to-br from-white/10 to-white/[0.03] border border-line flex items-end p-2 overflow-hidden ${className}`}>
      <span className="font-serif text-[11px] leading-tight text-muted line-clamp-4 break-words">{title}</span>
    </div>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="font-serif text-3xl tracking-tight">{children}</h1>
      {sub && <p className="text-muted mt-1">{sub}</p>}
    </div>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog: focus moves inside (to the element marked data-autofocus, else the last
 * button, which is the safe choice), Tab is trapped, Escape closes, and focus returns to
 * whatever opened it.
 */
export function Modal({ open, onClose, labelledBy, children }: { open: boolean; onClose: () => void; labelledBy?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const el = box.current!;
    const items = () => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
    (el.querySelector<HTMLElement>('[data-autofocus]') ?? items().pop() ?? el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const f = items();
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); if (opener?.isConnected) opener.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={labelledBy} className="w-full max-w-sm rounded-xl bg-panel border border-line p-5 outline-none">{children}</div>
    </div>
  );
}

/** Where the book data came from, with the attribution and link back each service asks for. */
export function SourceCredit({ source, link }: { source: string; link?: string }) {
  const google = source.startsWith('Google');
  return (
    <p className="text-sm text-muted flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="source-credit">
      {google
        ? <span className="inline-flex items-center gap-1.5 rounded border border-line px-2 py-0.5 text-fg"><span aria-hidden className="font-semibold"><span style={{ color: '#4285F4' }}>G</span></span>Powered by Google</span>
        : <span>Book data from Open Library</span>}
      {link && <a href={link} target="_blank" rel="noopener noreferrer" className="underline hover:text-fg">View on {google ? 'Google Books' : 'Open Library'}</a>}
    </p>
  );
}
