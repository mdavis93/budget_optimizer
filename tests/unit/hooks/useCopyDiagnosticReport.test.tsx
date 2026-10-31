import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCopyDiagnosticReport } from '../../../src/hooks/useCopyDiagnosticReport';
import { copyDiagnosticReport } from '../../../src/utils/reportError';

const showToast = vi.fn();

vi.mock('../../../src/components/Toast', () => ({
  useToast: () => ({ showToast, dismissToast: vi.fn() }),
}));

vi.mock('../../../src/utils/reportError', () => ({
  copyDiagnosticReport: vi.fn(),
}));

describe('useCopyDiagnosticReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a success toast when the report is copied', async () => {
    vi.mocked(copyDiagnosticReport).mockResolvedValue(true);
    const { result } = renderHook(() => useCopyDiagnosticReport());

    await result.current('diag-1');

    expect(copyDiagnosticReport).toHaveBeenCalledWith('diag-1');
    expect(showToast).toHaveBeenCalledWith('success', 'Report copied to clipboard');
  });

  it('shows an error toast when the copy fails', async () => {
    vi.mocked(copyDiagnosticReport).mockResolvedValue(false);
    const { result } = renderHook(() => useCopyDiagnosticReport());

    await result.current('diag-1');

    expect(showToast).toHaveBeenCalledWith('error', expect.stringContaining('Could not copy'));
  });
});
