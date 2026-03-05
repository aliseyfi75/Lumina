import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'icons/*.png'],
      manifest: {
        name: 'Lumina – Vocabulary Builder',
        short_name: 'Lumina',
        description: 'Build your vocabulary with smart spaced repetition.',
        theme_color: '#16a34a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: './',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Use NetworkFirst for API calls so online always wins; cache as fallback
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.dictionaryapi\.dev\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'dictionary-api-cache',
              expiration: { maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            urlPattern: /^https:\/\/getpantry\.cloud\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pantry-api-cache',
              expiration: { maxAgeSeconds: 60 * 5 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
        // Pre-cache all static assets built by Vite
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff,woff2}'],
      },
    }),
  ],
  base: './',
});
