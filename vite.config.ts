import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, type Plugin, type PluginOption} from 'vite';

/**
 * Adds a Content-Security-Policy to the built page. GitHub Pages can't set response
 * headers, so it goes in a <meta> tag. Only the production build gets it, because the
 * dev server relies on inline scripts and websockets for hot reload.
 */
function contentSecurityPolicy(dataOrigin: string): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    // MapLibre and React set inline styles; the Inter font CSS comes from Google Fonts.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data: blob: https://tile.openstreetmap.org",
    // MapLibre's worker is served from this site; it fetches OpenStreetMap tiles.
    "worker-src 'self'",
    `connect-src 'self' ${dataOrigin} https://tile.openstreetmap.org`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      {tag: 'meta', attrs: {'http-equiv': 'Content-Security-Policy', content: policy}, injectTo: 'head-prepend'},
    ],
  };
}

export default defineConfig(({command, mode}) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const plugins: PluginOption[] = [react(), tailwindcss()];

  // Production builds read temperature tiles from VITE_DATA_URL; fail early if it is missing.
  if (command === 'build') {
    const url = env.VITE_DATA_URL;
    if (!url || !/^https:\/\/[^\s"'<>]+\/$/.test(url)) {
      throw new Error(
        'Set VITE_DATA_URL to the public HTTPS folder holding manifest.json, ending in "/" ' +
          '(see .env.example).',
      );
    }
    plugins.push(contentSecurityPolicy(new URL(url).origin));
  }

  return {
    base: './',
    plugins,
    build: {
      // MapLibre is about 1 MB on its own; keep it in its own long-cached chunk.
      chunkSizeWarningLimit: 1100,
      rollupOptions: {
        output: {
          manualChunks: (id: string) => (id.includes('node_modules/maplibre-gl') ? 'maplibre' : undefined),
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {ignored: ['**/working/**']},
    },
  };
});
