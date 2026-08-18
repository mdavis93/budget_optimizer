import { beforeEach, describe, expect, it } from 'vitest';
import {
  collectRendererDiagnostics,
  getDiagnosticBreadcrumbs,
  inferredErrorCode,
  parseDynamicImportPath,
  recordDiagnosticBreadcrumb,
  resetDiagnosticBreadcrumbsForTests,
} from '../../../src/utils/diagnosticContext';

describe('diagnosticContext', () => {
  beforeEach(() => {
    resetDiagnosticBreadcrumbsForTests();
    window.location.hash = '#/goals';
  });

  describe('happy', () => {
    it('records a capped navigation trail', () => {
      for (let i = 0; i < 25; i += 1) {
        recordDiagnosticBreadcrumb('route', `/page-${i}`);
      }
      const crumbs = getDiagnosticBreadcrumbs();
      expect(crumbs).toHaveLength(20);
      expect(crumbs[0].detail).toBe('/page-5');
      expect(crumbs[19].detail).toBe('/page-24');
    });

    it('parses dynamic import module paths', () => {
      expect(
        parseDynamicImportPath(
          'Failed to fetch dynamically imported module: http://localhost:5173/src/pages/SettingsPage.tsx'
        )
      ).toBe('/src/pages/SettingsPage.tsx');
      expect(inferredErrorCode('Failed to fetch dynamically imported module: http://x/a.tsx')).toBe(
        'DYNAMIC_IMPORT'
      );
    });

    it('captures hash route and trail in the runtime bag', () => {
      recordDiagnosticBreadcrumb('route', '/goals');
      const bag = collectRendererDiagnostics(new TypeError('nope'));
      expect(bag.route).toBe('/goals');
      expect(bag.errorName).toBe('TypeError');
      expect(bag.navTrail).toEqual(
        expect.arrayContaining([expect.objectContaining({ detail: '/goals' })])
      );
    });
  });

  describe('sad', () => {
    it('returns null for non-import messages and keeps explicit codes', () => {
      expect(parseDynamicImportPath('kaboom')).toBeNull();
      expect(inferredErrorCode('kaboom')).toBeNull();
      expect(inferredErrorCode('kaboom', 'EXISTING')).toBe('EXISTING');
    });
  });

  describe('hostile', () => {
    it('truncates oversized kind and detail fields', () => {
      recordDiagnosticBreadcrumb('k'.repeat(80), 'd'.repeat(400));
      const [crumb] = getDiagnosticBreadcrumbs();
      expect(crumb.kind).toHaveLength(40);
      expect(crumb.detail).toHaveLength(160);
    });
  });
});
