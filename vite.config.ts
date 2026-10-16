import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/** Content Security Policy, added to the built index.html only (the dev server needs inline scripts). */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://covers.openlibrary.org https://archive.org https://*.archive.org https://books.google.com https://*.googleusercontent.com https://m.media-amazon.com",
  "connect-src 'self' https://openlibrary.org https://www.googleapis.com",
  "media-src 'self' blob: mediastream:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const cspPlugin = {
  name: 'csp-meta',
  apply: 'build' as const,
  transformIndexHtml: (html: string) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
};

export default defineConfig(({ command, isPreview }) => ({
  // GitHub Pages project site lives at /library-catalog/
  base: command === 'build' || isPreview ? '/library-catalog/' : '/',
  plugins: [
    react(),
    tailwindcss(),
    cspPlugin,
    VitePWA({
      // Prompt, never auto-reload: an update must not throw away a half-typed book (H1).
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Nineveh: Home Library',
        short_name: 'Nineveh',
        id: '/library-catalog/',
        description: 'Catalog your home books. Local-first, no account.',
        categories: ['books', 'lifestyle', 'productivity'],
        lang: 'en',
        orientation: 'any',
        theme_color: '#111113',
        background_color: '#111113',
        display: 'standalone',
        start_url: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        screenshots: [
          { src: 'screenshots/01-library-list.jpg', sizes: '1080x1920', type: 'image/jpeg', form_factor: 'narrow', label: 'Your library as a list' },
          { src: 'screenshots/02-library-grid.jpg', sizes: '1080x1920', type: 'image/jpeg', form_factor: 'narrow', label: 'Cover grid' },
          { src: 'screenshots/03-book-detail.jpg', sizes: '1080x1920', type: 'image/jpeg', form_factor: 'narrow', label: 'A book with read dates' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        globIgnores: ['**/screenshots/**', '**/privacy.html'],
        cleanupOutdatedCaches: true,
        // Take control on the very first visit (so it works offline at once). Updates still wait for the user.
        clientsClaim: true,
        // Open Library asks clients to cache. Their covers are kept for 30 days (offline use).
        // Google and Amazon images are not stored by the app; the browser's normal HTTP cache
        // follows their own cache headers.
        runtimeCaching: [{
          urlPattern: ({ url }) => url.hostname === 'covers.openlibrary.org' || url.hostname === 'archive.org' || url.hostname.endsWith('.archive.org'),
          handler: 'CacheFirst',
          options: { cacheName: 'covers-ol', expiration: { maxEntries: 1500, maxAgeSeconds: 60 * 60 * 24 * 30, purgeOnQuotaError: true }, cacheableResponse: { statuses: [0, 200] } },
        }],
      },
    }),
  ],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any));
