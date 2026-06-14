import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import GlobalDraftBanner from '../../src/components/GlobalDraftBanner';
import { renderWithRouter } from '../helpers/renderWithProviders';
import { createMockElectronAPI } from '../mocks/electron-api.mock';

const mockUseDraft = vi.fn();

vi.mock('../../src/context/DraftContext', () => ({
  useDraft: () => mockUseDraft(),
}));

vi.mock('../../src/components/ConfirmDialog', () => ({
  default: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: () => void }) =>
    isOpen ? <button onClick={onConfirm}>confirm-discard-all</button> : null,
}));

describe('GlobalDraftBanner', () => {
  const mockAPI = createMockElectronAPI();
  const saveAll = vi.fn();
  const discardAll = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDraft.mockReturnValue({
      isDraftMode: true,
      dirtyDomains: new Set(['income', 'bills']),
      isSaving: false,
      saveAll,
      discardAll,
    });
  });

  describe('happy', () => {
    it('shows multi-domain dirty banner and saves all', () => {
      renderWithRouter(<GlobalDraftBanner />, { route: '/dashboard', mockAPI });
      expect(screen.getByText('2 pages have unsaved changes')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Save All Changes/i }));
      expect(saveAll).toHaveBeenCalled();
    });
  });

  describe('sad', () => {
    it('hides banner when only one dirty domain exists', () => {
      mockUseDraft.mockReturnValue({
        isDraftMode: true,
        dirtyDomains: new Set(['income']),
        isSaving: false,
        saveAll,
        discardAll,
      });
      renderWithRouter(<GlobalDraftBanner />, { mockAPI });
      expect(screen.queryByText(/unsaved changes/i)).not.toBeInTheDocument();
    });
  });

  describe('hostile', () => {
    it('discards all changes after confirmation', () => {
      renderWithRouter(<GlobalDraftBanner />, { mockAPI });
      fireEvent.click(screen.getByRole('button', { name: 'Discard All' }));
      fireEvent.click(screen.getByRole('button', { name: 'confirm-discard-all' }));
      expect(discardAll).toHaveBeenCalled();
    });
  });
});
