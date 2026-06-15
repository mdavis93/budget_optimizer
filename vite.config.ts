import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mainExternals = [
  'electron',
  'better-sqlite3',
  'keytar',
  'exceljs',
  'date-fns',
  'uuid',
];

/**
 * vite-plugin-electron injects Rolldown-only options that Vite 6 passes to Rollup.
 * Remove when upgrading to Vite 8.
 */
function stripInvalidRollupOptions(): Plugin {
  return {
    name: 'strip-invalid-rollup-options',
    configResolved(config) {
      const rollupOptions = config.build?.rollupOptions;
      if (!rollupOptions) {
        return;
      }

      if ('platform' in rollupOptions) {
        delete (rollupOptions as Record<string, unknown>).platform;
      }

      const outputs = rollupOptions.output;
      if (!outputs) {
        return;
      }

      const outputList = Array.isArray(outputs) ? outputs : [outputs];
      for (const output of outputList) {
        if (output && 'codeSplitting' in output) {
          delete (output as Record<string, unknown>).codeSplitting;
        }
      }
    },
  };
}

/** Applied to dist/index.html when mode === 'production'. Dev keeps relaxed CSP in index.html for HMR. */
export const PRODUCTION_CSP =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "img-src 'self' data:; " +
  "font-src 'self' https://fonts.gstatic.com; " +
  "connect-src 'self';";

export default defineConfig(async ({ mode }) => ({
  plugins: [
    react(),
    {
      name: 'production-csp',
      transformIndexHtml(html) {
        if (mode === 'production') {
          return html.replace(
            /<meta http-equiv="Content-Security-Policy" content="[^"]*">/,
            `<meta http-equiv="Content-Security-Policy" content="${PRODUCTION_CSP}">`
          );
        }
        return html;
      },
    },
    ...(await electron({
      main: {
        entry: 'electron/main.ts',
        onstart(options) {
          options.startup();
        },
        vite: {
          plugins: [stripInvalidRollupOptions()],
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
          plugins: [stripInvalidRollupOptions()],
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
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) {
            return 'recharts';
          }
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router-dom/')
          ) {
            return 'react-vendor';
          }
        },
      },
    },
  },
}));
