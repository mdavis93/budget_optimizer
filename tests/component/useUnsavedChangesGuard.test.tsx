import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useUnsavedChangesGuard } from '../../src/hooks/useUnsavedChangesGuard';

const mockUseDraftOptional = vi.fn();

vi.mock('../../src/context/DraftContext', () => ({
  useDraftOptional: () => mockUseDraftOptional(),
}));

function GuardHarness() {
  const { guardAction, unsavedDialog } = useUnsavedChangesGuard();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div>
      <div data-testid="pathname">{location.pathname}</div>
      <button onClick={() => guardAction(() => navigate('/next'), 'navigate')}>go-next</button>
      {unsavedDialog}
    </div>
  );
}

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<GuardHarness />} />
        <Route path="/next" element={<div>next-page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('useUnsavedChangesGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('happy', () => {
    it('blocks navigation when draft is dirty and allows continue after discard', async () => {
      mockUseDraftOptional.mockReturnValue({
        hasUnsavedChanges: true,
        isSaving: false,
        saveAll: vi.fn().mockResolvedValue(true),
        discardAll: vi.fn(),
      });

      renderGuard();
      fireEvent.click(screen.getByText('go-next'));

      expect(screen.getByTestId('pathname')).toHaveTextContent('/');
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Discard All'));
      await waitFor(() => {
        expect(screen.getByText('next-page')).toBeInTheDocument();
      });
    });
  });

  describe('sad', () => {
    it('stays on current route when save-all continuation fails', async () => {
      mockUseDraftOptional.mockReturnValue({
        hasUnsavedChanges: true,
        isSaving: false,
        saveAll: vi.fn().mockResolvedValue(false),
        discardAll: vi.fn(),
      });

      renderGuard();
      fireEvent.click(screen.getByText('go-next'));
      fireEvent.click(screen.getByText('Save All Changes'));

      await waitFor(() => {
        expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
      });
      expect(screen.getByTestId('pathname')).toHaveTextContent('/');
    });
  });

  describe('hostile', () => {
    it('allows navigation when draft context is unavailable', async () => {
      mockUseDraftOptional.mockReturnValue(null);

      renderGuard();
      fireEvent.click(screen.getByText('go-next'));

      await waitFor(() => {
        expect(screen.getByText('next-page')).toBeInTheDocument();
      });
    });

    it('continues after successful save-all', async () => {
      mockUseDraftOptional.mockReturnValue({
        hasUnsavedChanges: true,
        isSaving: false,
        saveAll: vi.fn().mockResolvedValue(true),
        discardAll: vi.fn(),
      });

      renderGuard();
      fireEvent.click(screen.getByText('go-next'));
      fireEvent.click(screen.getByText('Save All Changes'));

      await waitFor(() => {
        expect(screen.getByText('next-page')).toBeInTheDocument();
      });
    });

    it('closes the dialog without navigating when cancel is clicked', () => {
      mockUseDraftOptional.mockReturnValue({
        hasUnsavedChanges: true,
        isSaving: false,
        saveAll: vi.fn().mockResolvedValue(true),
        discardAll: vi.fn(),
      });

      renderGuard();
      fireEvent.click(screen.getByText('go-next'));
      fireEvent.click(screen.getByText('Cancel'));
      expect(screen.getByTestId('pathname')).toHaveTextContent('/');
    });

    it('shows saving state while save-all is in progress', () => {
      mockUseDraftOptional.mockReturnValue({
        hasUnsavedChanges: true,
        isSaving: true,
        saveAll: vi.fn(),
        discardAll: vi.fn(),
      });

      renderGuard();
      fireEvent.click(screen.getByText('go-next'));
      expect(screen.getByText('Saving...')).toBeInTheDocument();
    });
  });
});
