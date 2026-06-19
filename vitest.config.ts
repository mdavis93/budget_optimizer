import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'tests/component/**/*.test.tsx',
    ],
    exclude: ['node_modules', 'dist', 'dist-electron'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx', 'electron/**/*.ts'],
      exclude: [
        'node_modules',
        'tests',
        '**/*.d.ts',
        'electron/main.ts',
        'electron/preload.ts',
        'electron/electron-env.d.ts',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/types/**',
        'src/constants/version.ts',
        'src/components/schedule/index.ts',
      ],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85,
      },
    },
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@electron': path.resolve(__dirname, './electron'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
});
