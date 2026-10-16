import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { setUpdateReady } from './lib/update';
import './index.css';

// Prompt mode: a new version waits until the user chooses to reload (never mid-edit).
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() { setUpdateReady(updateSW); },
  onRegisteredSW(_url, reg) {
    if (reg) setInterval(() => { if (navigator.onLine) reg.update().catch(() => undefined); }, 60 * 60 * 1000);
  },
});
// v3 kept Google and Amazon covers for a year in a "covers" cache; that cache is retired.
if ('caches' in window) caches.delete('covers').catch(() => undefined);

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
