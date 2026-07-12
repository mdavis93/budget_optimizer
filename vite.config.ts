import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import electron from 'vite-plugin-electron/simple';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mainExternals = [
  'electron',
  'better-sqlite3',
  'keytar',
  'date-fns',
];

/** Applied to dist/index.html when mode === 'production'. Dev keeps relaxed CSP in index.html for HMR. */
const PRODUCTION_CSP =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "img-src 'self' data:; " +
  "font-src 'self' https://fonts.gstatic.com; " +
  "connect-src 'self';";

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
    ...(visualizerPlugin ? [visualizerPlugin] : []),
    ...(await electron({
      main: {
        entry: 'electron/main.ts',
        onstart(options) {
          options.startup();
        },
        vite: {
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
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@electron': path.resolve(__dirname, './electron'),
      '@shared': path.resolve(__dirname, './shared'),
    },
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
