import { describe, expect, it } from 'vitest';
import path from 'path';
import { pathToFileURL } from 'url';
import { isAllowedNavigation } from '../../../electron/utils/isAllowedNavigation';

const distDir = '/Users/tester/app/dist';
const recoveryDir = '/Users/tester/app/dist-electron';
const scratchDir = '/Users/tester/Library/Application Support/budget-optimizer/export-scratch';
const viteOrigin = 'http://localhost:5173';

const appUnpackaged = {
  devServerUrl: viteOrigin,
  distDir,
  packaged: false,
  extraFileRoots: [recoveryDir],
};

const appPackaged = {
  distDir,
  packaged: true,
};

const pdfOpts = {
  distDir: scratchDir,
  packaged: true,
  extraFileRoots: [scratchDir],
};

describe('isAllowedNavigation', () => {
  describe('app policy', () => {
    it('denies https://evil.example', () => {
      expect(isAllowedNavigation('https://evil.example/', appUnpackaged)).toBe(false);
      expect(isAllowedNavigation('https://evil.example/steal', appPackaged)).toBe(false);
    });

    it('allows the Vite origin when unpackaged', () => {
      expect(isAllowedNavigation(`${viteOrigin}/`, appUnpackaged)).toBe(true);
      expect(isAllowedNavigation(`${viteOrigin}/src/main.tsx`, appUnpackaged)).toBe(true);
    });

    it('denies the Vite origin when packaged', () => {
      expect(isAllowedNavigation(`${viteOrigin}/`, appPackaged)).toBe(false);
    });

    it('allows file: under distDir', () => {
      const url = pathToFileURL(path.join(distDir, 'index.html')).href;
      expect(isAllowedNavigation(url, appPackaged)).toBe(true);
      expect(isAllowedNavigation(url, appUnpackaged)).toBe(true);
    });

    it('allows file: under recovery extraFileRoots', () => {
      const url = pathToFileURL(path.join(recoveryDir, 'dev-server-down.html')).href;
      expect(isAllowedNavigation(url, appUnpackaged)).toBe(true);
    });

    it('denies file: under export-scratch for the app window', () => {
      const url = pathToFileURL(path.join(scratchDir, 'report.html')).href;
      expect(isAllowedNavigation(url, appUnpackaged)).toBe(false);
      expect(isAllowedNavigation(url, appPackaged)).toBe(false);
    });

    it('denies file: outside distDir and extraFileRoots', () => {
      const url = pathToFileURL('/etc/passwd').href;
      expect(isAllowedNavigation(url, appPackaged)).toBe(false);
    });

    it('denies javascript: and data:', () => {
      expect(isAllowedNavigation('javascript:alert(1)', appUnpackaged)).toBe(false);
      expect(isAllowedNavigation('data:text/html,hi', appUnpackaged)).toBe(false);
    });
  });

  describe('pdf policy', () => {
    it('allows file: under the scratch extraFileRoots', () => {
      const url = pathToFileURL(path.join(scratchDir, 'budget-optimizer-1.html')).href;
      expect(isAllowedNavigation(url, pdfOpts)).toBe(true);
    });

    it('denies https://evil.example and any http(s)', () => {
      expect(isAllowedNavigation('https://evil.example/', pdfOpts)).toBe(false);
      expect(isAllowedNavigation('http://localhost:5173/', pdfOpts)).toBe(false);
    });

    it('denies file: under distDir when dist is not an extra root', () => {
      const url = pathToFileURL(path.join(distDir, 'index.html')).href;
      expect(
        isAllowedNavigation(url, {
          distDir: scratchDir,
          packaged: true,
          extraFileRoots: [scratchDir],
        })
      ).toBe(false);
    });
  });
});
