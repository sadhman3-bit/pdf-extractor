import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { token } from './scripts/tokens.mjs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "img-src 'self' blob: data:",
  "style-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Adds the Content Security Policy meta tag to built pages only (dev uses inline HMR styles). */
function cspPlugin(): Plugin {
  return {
    name: 'pdfx-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

/** Fills index.html's theme colour from tokens.css. */
function themeColorPlugin(): Plugin {
  return {
    name: 'pdfx-theme-color',
    transformIndexHtml: (html) => html.replace('%THEME_COLOR%', token('topbar')),
  };
}

export default defineConfig(({ mode }) => ({
  base: '/pdf-extractor/',
  define: {
    __PDFX_TEST__: JSON.stringify(mode === 'test'),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    preact(),
    cspPlugin(),
    themeColorPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'PDF Extractor',
        short_name: 'PDF Extractor',
        description: 'Turn supplier PDFs into identical, checked CSV and JSON tables.',
        theme_color: token('topbar'),
        background_color: token('bg'),
        display: 'standalone',
        start_url: '/pdf-extractor/',
        scope: '/pdf-extractor/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,wasm,gz,bcmap,pfb,ttf,json}'],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // Take control on the first visit, so the app works offline without a second load.
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
}));
