import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import DraftSaveBar from '../../src/components/DraftSaveBar';
import { renderWithRouter } from '../helpers/renderWithProviders';
import { createMockBill, createMockElectronAPI, createMockIncome } from '../mocks/electron-api.mock';

const mockUseDraft = vi.fn();

vi.mock('../../src/context/DraftContext', () => ({
  useDraft: () => mockUseDraft(),
  useDraftData: () => mockUseDraft(),
  useDraftActions: () => mockUseDraft(),
}));

vi.mock('../../src/components/ConfirmDialog', () => ({
  default: ({
    isOpen,
    onConfirm,
    confirmText,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
    confirmText?: string;
  }) =>
    isOpen ? (
      <button onClick={onConfirm} data-testid={`confirm-${confirmText?.toLowerCase().replace(/\s+/g, '-')}`}>
        {confirmText}
      </button>
    ) : null,
}));

describe('DraftSaveBar', () => {
  const mockAPI = createMockElectronAPI();
  const saveDomains = vi.fn();
  const discardDomain = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDraft.mockReturnValue({
      isDraftMode: true,
      isDomainDirty: vi.fn((domain: string) => domain === 'bills'),
      isSaving: false,
      draft: {
        incomes: [createMockIncome()],
        bills: [createMockBill()],
        debts: [],
        goals: [],
        skippedBills: [],
        billAssignments: [],
        incomeOverrides: [],
        budget: null,
      },
      dirtyDomains: new Set(['bills']),
      saveDomains,
      discardDomain,
    });
  });

  describe('happy', () => {
    it('shows save/discard controls when domain is dirty', () => {
      renderWithRouter(<DraftSaveBar domain="bills" />, { mockAPI });
      fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
      expect(saveDomains).toHaveBeenCalledWith(['bills']);
    });
  });

  describe('sad', () => {
    it('renders nothing when draft mode is off', () => {
      mockUseDraft.mockReturnValue({
        isDraftMode: false,
        isDomainDirty: vi.fn(() => false),
        isSaving: false,
        draft: {
          incomes: [],
          bills: [],
          debts: [],
          goals: [],
          skippedBills: [],
          billAssignments: [],
          incomeOverrides: [],
          budget: null,
        },
        dirtyDomains: new Set(),
        saveDomains,
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
      fireEvent.click(screen.getByTestId('confirm-discard'));
      expect(discardDomain).toHaveBeenCalledWith('bills');
    });

    it('prompts before saving bills that depend on draft income', () => {
      mockUseDraft.mockReturnValue({
        isDraftMode: true,
        isDomainDirty: vi.fn((domain: string) => domain === 'bills' || domain === 'income'),
        isSaving: false,
        draft: {
          incomes: [createMockIncome({ id: 'draft-income-1' })],
          bills: [createMockBill({ id: 'draft-bill-1', preferredIncomeSourceId: 'draft-income-1' })],
          debts: [],
          goals: [],
          skippedBills: [],
          billAssignments: [],
          incomeOverrides: [],
          budget: null,
        },
        dirtyDomains: new Set(['income', 'bills']),
        saveDomains,
        discardDomain,
      });

      renderWithRouter(<DraftSaveBar domain="bills" />, { mockAPI });
      fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
      expect(saveDomains).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId('confirm-save'));
      expect(saveDomains).toHaveBeenCalledWith(['income', 'bills']);
    });
  });
});
