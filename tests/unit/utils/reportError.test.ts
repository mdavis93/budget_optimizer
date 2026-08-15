import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copyDiagnosticReport, reportError } from '../../../src/utils/reportError';
import { createMockElectronAPI } from '../../mocks/electron-api.mock';

describe('reportError', () => {
  let mockAPI: ReturnType<typeof createMockElectronAPI>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAPI = createMockElectronAPI();
    window.electronAPI = mockAPI as unknown as Window['electronAPI'];
  });

  describe('happy', () => {
    it('reports Error instances and returns the diagnostic id', async () => {
      mockAPI.diagnostics.report.mockResolvedValue({
        success: true,
        data: { id: 'diag-1' },
      });
      const err = new Error('boom');
      err.stack = 'stack-line';
      await expect(reportError('renderer:test', err)).resolves.toBe('diag-1');
      expect(mockAPI.diagnostics.report).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'renderer:test',
          message: 'boom',
          stack: 'stack-line',
        })
      );
    });

    it('reports string errors', async () => {
      mockAPI.diagnostics.report.mockResolvedValue({
        success: true,
        data: { id: 'diag-str' },
      });
      await expect(reportError('renderer:test', 'plain')).resolves.toBe('diag-str');
      expect(mockAPI.diagnostics.report).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'plain', stack: null })
      );
    });
  });

  describe('sad', () => {
    it('returns undefined when diagnostics API is missing', async () => {
      window.electronAPI = {} as Window['electronAPI'];
      await expect(reportError('renderer:test', 'x')).resolves.toBeUndefined();
    });

    it('returns undefined when report fails or omits id', async () => {
      mockAPI.diagnostics.report.mockResolvedValueOnce({ success: false, error: 'nope' });
      await expect(reportError('renderer:test', 123)).resolves.toBeUndefined();

      mockAPI.diagnostics.report.mockResolvedValueOnce({ success: true, data: {} });
      await expect(reportError('renderer:test', null)).resolves.toBeUndefined();
    });
  });

  describe('hostile', () => {
    it('swallows report exceptions', async () => {
      mockAPI.diagnostics.report.mockRejectedValue(new Error('ipc down'));
      await expect(reportError('renderer:test', 'x')).resolves.toBeUndefined();
    });
  });
});

describe('copyDiagnosticReport', () => {
  let mockAPI: ReturnType<typeof createMockElectronAPI>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAPI = createMockElectronAPI();
    window.electronAPI = mockAPI as unknown as Window['electronAPI'];
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  describe('happy', () => {
    it('writes the event bundle JSON to the clipboard', async () => {
      mockAPI.diagnostics.getEvent.mockResolvedValue({
        success: true,
        data: { errors: [{ id: 'e1' }] },
      });
      await expect(copyDiagnosticReport('e1')).resolves.toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('"id": "e1"')
      );
    });
  });

  describe('sad', () => {
    it('returns false when getEvent fails or has no data', async () => {
      mockAPI.diagnostics.getEvent.mockResolvedValueOnce({ success: false, error: 'missing' });
      await expect(copyDiagnosticReport('missing')).resolves.toBe(false);

      mockAPI.diagnostics.getEvent.mockResolvedValueOnce({ success: true });
      await expect(copyDiagnosticReport('empty')).resolves.toBe(false);
    });
  });

  describe('hostile', () => {
    it('returns false when clipboard write throws', async () => {
      mockAPI.diagnostics.getEvent.mockResolvedValue({
        success: true,
        data: { errors: [] },
      });
      vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'));
      await expect(copyDiagnosticReport('e1')).resolves.toBe(false);
    });
  });
});
