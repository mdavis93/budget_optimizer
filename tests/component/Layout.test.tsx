import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Layout from '../../src/components/Layout';
import { renderWithRouter } from '../helpers/renderWithProviders';
import { createMockElectronAPI } from '../mocks/electron-api.mock';

const mockUseAuth = vi.fn();
const mockUseBudget = vi.fn();
const mockUseDraft = vi.fn();
const mockUsePlatformExit = vi.fn();

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));
vi.mock('../../src/context/BudgetContext', () => ({
  useBudget: () => mockUseBudget(),
}));
vi.mock('../../src/context/DraftContext', () => ({
  useDraft: () => mockUseDraft(),
  useDraftData: () => mockUseDraft(),
  useDraftStatus: () => mockUseDraft(),
  useDraftActions: () => mockUseDraft(),
}));
vi.mock('../../src/platform/PlatformExitGuard', () => ({
  usePlatformExit: () => mockUsePlatformExit(),
}));
vi.mock('../../src/components/GlobalDraftBanner', () => ({
  default: () => <div>Mock Global Draft Banner</div>,
}));
vi.mock('../../src/components/DraftSaveBar', () => ({
  default: ({ domain }: { domain: string }) => <div>Mock Draft Save Bar {domain}</div>,
}));

describe('Layout', () => {
  const mockAPI = createMockElectronAPI();
  const lock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ lock });
    mockUseBudget.mockReturnValue({
      currentBudget: { id: 'budget-1', name: 'Family Budget' },
      isQuickBudget: false,
    });
    mockUseDraft.mockReturnValue({
      isDraftMode: true,
      isDomainDirty: vi.fn(() => false),
    });
    mockUsePlatformExit.mockReturnValue({
      guardAction: (action: () => void) => action(),
      supportsNativeClose: true,
    });
  });

  describe('happy', () => {
    it('renders and navigates through sidebar links', async () => {
      const user = userEvent.setup();
      renderWithRouter(<Layout />, { route: '/dashboard', mockAPI });
      const navNames = ['Dashboard', 'Income', 'Bills', 'Debts', 'Goals', 'Schedule', 'Summary', 'Export', 'Settings'];
      for (const name of navNames) {
        const link = screen.getByRole('link', { name: new RegExp(name, 'i') });
        expect(link).toBeInTheDocument();
        await user.click(link);
      }
    });
  });

  describe('sad', () => {
    it('shows no-budget badge when current budget is missing', () => {
      mockUseBudget.mockReturnValue({ currentBudget: null, isQuickBudget: false });
      renderWithRouter(<Layout />, { route: '/dashboard', mockAPI });
      expect(screen.getByText('No budget selected')).toBeInTheDocument();
    });
  });

  describe('hostile', () => {
    it('locks without routing through the exit guard', async () => {
      const user = userEvent.setup();
      const guardAction = vi.fn();
      mockUsePlatformExit.mockReturnValue({
        guardAction,
        supportsNativeClose: true,
      });

      renderWithRouter(<Layout />, { route: '/dashboard', mockAPI });
      await user.click(screen.getByRole('button', { name: /Lock App/i }));

      expect(lock).toHaveBeenCalled();
      expect(guardAction).not.toHaveBeenCalled();
    });

    it('shows quick budget badge and dirty-domain indicators', async () => {
      mockUseBudget.mockReturnValue({
        currentBudget: { id: 'budget-1', name: 'Family Budget' },
        isQuickBudget: true,
      });
      mockUseDraft.mockReturnValue({
        isDraftMode: true,
        isDomainDirty: vi.fn((domain: string) => domain === 'income' || domain === 'budget'),
      });

      renderWithRouter(<Layout />, { route: '/income', mockAPI });
      expect(screen.getByText('Quick Budget')).toBeInTheDocument();
      expect(screen.getAllByLabelText('Unsaved changes').length).toBeGreaterThanOrEqual(2);
    });

    it('guards quit app through platform exit hook', async () => {
      const user = userEvent.setup();
      const guardAction = vi.fn();
      mockUsePlatformExit.mockReturnValue({
        guardAction,
        supportsNativeClose: true,
      });

      renderWithRouter(<Layout />, { route: '/dashboard', mockAPI });
      await user.click(screen.getByRole('button', { name: /Quit App/i }));

      expect(guardAction).toHaveBeenCalledWith(expect.any(Function), 'quit the app');
    });

    it('does not guard in-app sidebar navigation even with unsaved changes', async () => {
      const user = userEvent.setup();
      const guardAction = vi.fn();
      mockUsePlatformExit.mockReturnValue({
        guardAction,
        supportsNativeClose: true,
      });
      // Pending draft changes present: navigation must still be free.
      mockUseDraft.mockReturnValue({
        isDraftMode: true,
        isDomainDirty: vi.fn(() => true),
      });

      renderWithRouter(<Layout />, { route: '/dashboard', mockAPI });
      await user.click(screen.getByRole('link', { name: /Schedule/i }));

      // Exit-only guard: sidebar navigation never routes through guardAction.
      expect(guardAction).not.toHaveBeenCalled();
    });

    it('pings activity on user input after throttle window', async () => {
      vi.useFakeTimers();
      renderWithRouter(<Layout />, { route: '/dashboard', mockAPI });

      window.dispatchEvent(new MouseEvent('mousedown'));
      expect(mockAPI.auth.activityPing).not.toHaveBeenCalled();

      vi.advanceTimersByTime(31_000);
      window.dispatchEvent(new KeyboardEvent('keydown'));
      expect(mockAPI.auth.activityPing).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });
  });
});
