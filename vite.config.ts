import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// SW_PORT picks the dev server port (default 5173); playwright.config.ts reads the same variable.
const port = Number(process.env.SW_PORT) || 5173;

export default defineConfig({
  base: './',
  server: { port, strictPort: true },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      devOptions: { enabled: false },
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Starwake',
        short_name: 'Starwake',
        description: 'A browser space game.',
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: '#000000',
        theme_color: '#05070f',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,json,webmanifest}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
});
