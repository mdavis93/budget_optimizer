import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import DraftSaveBar from '../../src/components/DraftSaveBar';
import { renderWithRouter } from '../helpers/renderWithProviders';
import { createMockElectronAPI } from '../mocks/electron-api.mock';

const mockUseDraft = vi.fn();

vi.mock('../../src/context/DraftContext', () => ({
  useDraft: () => mockUseDraft(),
}));

vi.mock('../../src/components/ConfirmDialog', () => ({
  default: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: () => void }) =>
    isOpen ? <button onClick={onConfirm}>confirm-discard</button> : null,
}));

describe('DraftSaveBar', () => {
  const mockAPI = createMockElectronAPI();
  const saveDomain = vi.fn();
  const discardDomain = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDraft.mockReturnValue({
      isDraftMode: true,
      isDomainDirty: vi.fn((domain: string) => domain === 'bills'),
      isSaving: false,
      saveDomain,
      discardDomain,
    });
  });

  describe('happy', () => {
    it('shows save/discard controls when domain is dirty', () => {
      renderWithRouter(<DraftSaveBar domain="bills" />, { mockAPI });
      fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
      expect(saveDomain).toHaveBeenCalledWith('bills');
    });
  });

  describe('sad', () => {
    it('renders nothing when draft mode is off', () => {
      mockUseDraft.mockReturnValue({
        isDraftMode: false,
        isDomainDirty: vi.fn(() => false),
        isSaving: false,
        saveDomain,
        discardDomain,
      });
      renderWithRouter(<DraftSaveBar domain="bills" />, { mockAPI });
      expect(screen.queryByText(/Unsaved changes on/i)).not.toBeInTheDocument();
    });
  });

  describe('hostile', () => {
    it('opens discard confirmation and calls discard', () => {
      renderWithRouter(<DraftSaveBar domain="bills" />, { mockAPI });
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
      fireEvent.click(screen.getByRole('button', { name: 'confirm-discard' }));
      expect(discardDomain).toHaveBeenCalledWith('bills');
    });
  });
});
