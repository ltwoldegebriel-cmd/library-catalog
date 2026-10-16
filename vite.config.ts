import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ command, isPreview }) => ({
  // GitHub Pages project site lives at /library-catalog/
  base: command === 'build' || isPreview ? '/library-catalog/' : '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Home Library',
        short_name: 'Library',
        description: 'Catalog your home books. Local-first, no account.',
        theme_color: '#111113',
        background_color: '#111113',
        display: 'standalone',
        start_url: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        runtimeCaching: [{
          urlPattern: ({ url }) => url.hostname === 'covers.openlibrary.org' || url.hostname.endsWith('books.google.com') || url.hostname.endsWith('googleusercontent.com'),
          handler: 'CacheFirst',
          options: { cacheName: 'covers', expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } },
        }],
      },
    }),
  ],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any));
