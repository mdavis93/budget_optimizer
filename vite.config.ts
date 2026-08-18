import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import electron from 'vite-plugin-electron/simple';
import electronMulti from 'vite-plugin-electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PRODUCTION_CSP } from './shared/productionCsp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mainExternals = [
  'electron',
  'better-sqlite3',
  'keytar',
  'date-fns',
];

/** Shared by renderer and electron main/preload builds (plugin does not inherit root aliases). */
const aliases = {
  '@': path.resolve(__dirname, './src'),
  '@electron': path.resolve(__dirname, './electron'),
  '@shared': path.resolve(__dirname, './shared'),
};

export default defineConfig(async ({ mode }) => {
  const analyze = process.env.ANALYZE === '1';
  const visualizerPlugin = analyze
    ? (await import('rollup-plugin-visualizer')).visualizer({
        filename: 'dist/stats.html',
        gzipSize: true,
        open: false,
      })
    : null;

  return {
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'production-csp',
      transformIndexHtml(html: string) {
        if (mode === 'production') {
          return html.replace(
            /<meta http-equiv="Content-Security-Policy" content="[^"]*">/,
            `<meta http-equiv="Content-Security-Policy" content="${PRODUCTION_CSP}">`
          );
        }
        return html;
      },
    },
    {
      name: 'copy-electron-static',
      closeBundle() {
        const from = path.resolve(__dirname, 'electron/static/dev-server-down.html');
        const toDir = path.resolve(__dirname, 'dist-electron');
        if (!fs.existsSync(from)) {
          return;
        }
        fs.mkdirSync(toDir, { recursive: true });
        fs.copyFileSync(from, path.join(toDir, 'dev-server-down.html'));
      },
    },
    ...(visualizerPlugin ? [visualizerPlugin] : []),
    ...(await electron({
      main: {
        entry: 'electron/main.ts',
        onstart(options) {
          options.startup();
        },
        vite: {
          resolve: { alias: aliases },
          build: {
            outDir: 'dist-electron',
            rolldownOptions: {
              external: mainExternals,
              output: {
                format: 'cjs',
              },
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          resolve: { alias: aliases },
          build: {
            outDir: 'dist-electron',
            rolldownOptions: {
              external: ['electron'],
              output: {
                format: 'cjs',
              },
            },
          },
        },
      },
      renderer: {},
    })),
    // Separate utilityProcess bundle — must NOT share chunks with main.js
    // (shared chunks caused the worker to require("./main.js")).
    electronMulti({
      entry: 'electron/workers/scheduleCompute.worker.ts',
      vite: {
        resolve: { alias: aliases },
        build: {
          outDir: 'dist-electron',
          emptyOutDir: false,
          lib: {
            entry: path.resolve(__dirname, 'electron/workers/scheduleCompute.worker.ts'),
            formats: ['cjs'],
            fileName: () => 'schedule-worker.js',
          },
          rolldownOptions: {
            external: mainExternals,
            output: {
              format: 'cjs',
              codeSplitting: false,
            },
          },
        },
      },
    }),
  ],
  resolve: {
    alias: aliases,
  },
  build: {
    outDir: 'dist',
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              test: /node_modules\/(recharts|d3-)/,
              name: 'recharts',
            },
            {
              test: /node_modules\/(react\/|react-dom\/|react-router-dom\/)/,
              name: 'react-vendor',
            },
            {
              test: /node_modules\/date-fns\//,
              name: 'date-fns',
            },
            {
              test: /node_modules\/lucide-react\//,
              name: 'lucide',
            },
          ],
        },
      },
    },
  },
};
});
