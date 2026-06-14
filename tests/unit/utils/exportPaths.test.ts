import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approveExportPath,
  clearApprovedExportPaths,
  validateExportPath,
} from '../../../electron/utils/exportPaths';

const mockGetPath = vi.fn((name: string) => {
  if (name === 'home') {
    return '/Users/tester';
  }
  return '/tmp';
});

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => mockGetPath(name),
  },
}));

describe('exportPaths', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    clearApprovedExportPaths();
  });

  describe('happy', () => {
    it('approves and validates a file under home', () => {
      const filePath = '/Users/tester/Documents/report.html';

      approveExportPath(filePath);

      expect(validateExportPath(filePath)).toBe(true);
      expect(mockGetPath).toHaveBeenCalledWith('home');
    });
  });

  describe('sad', () => {
    it('rejects unapproved file under home', () => {
      expect(validateExportPath('/Users/tester/Documents/unapproved.pdf')).toBe(false);
    });

    it('rejects expired approvals', () => {
      vi.useFakeTimers();
      const filePath = '/Users/tester/Documents/old.xlsx';

      approveExportPath(filePath);
      vi.advanceTimersByTime(60_001);

      expect(validateExportPath(filePath)).toBe(false);
    });

    it('clears approvals explicitly', () => {
      const filePath = '/Users/tester/Documents/clear-me.pdf';
      approveExportPath(filePath);
      clearApprovedExportPaths();

      expect(validateExportPath(filePath)).toBe(false);
    });
  });

  describe('hostile', () => {
    it('rejects traversal outside home directory', () => {
      const traversalPath = '/Users/tester/../../etc/passwd';

      approveExportPath('/Users/tester/Documents/report.pdf');

      expect(path.resolve(traversalPath).startsWith('/Users/tester')).toBe(false);
      expect(validateExportPath(traversalPath)).toBe(false);
    });

    it('rejects sibling path even when approved path exists', () => {
      const approvedPath = '/Users/tester/Exports/allowed.html';
      const siblingTraversal = '/Users/tester/Exports/../Secrets/data.html';

      approveExportPath(approvedPath);

      expect(validateExportPath(siblingTraversal)).toBe(false);
    });
  });
});
