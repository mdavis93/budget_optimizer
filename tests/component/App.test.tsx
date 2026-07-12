import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../../src/App';

const authState = {
  isUnlocked: true,
  isFirstTime: false,
  isLoading: false,
  checkAuthStatus: vi.fn(async () => {}),
};

const budgetState = {
  hasBudgetSelected: true,
};

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('../../src/context/BudgetContext', () => ({
  useBudget: () => budgetState,
  BudgetProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../src/context/DraftContext', () => ({
  DraftProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useDraftOptional: () => null,
}));

vi.mock('../../src/components/Layout', () => ({
  default: () => <div>Mock Layout</div>,
}));

vi.mock('../../src/components/BudgetPicker', () => ({
  default: ({ onBudgetSelected }: { onBudgetSelected: () => void }) => (
    <button onClick={onBudgetSelected}>Mock Budget Picker</button>
  ),
}));

vi.mock('../../src/pages/LoginPage', () => ({ default: () => <div>Login Page</div> }));
vi.mock('../../src/pages/SetupPage', () => ({ default: () => <div>Setup Page</div> }));
vi.mock('../../src/pages/DashboardPage', () => ({ default: () => <div>Dashboard Page</div> }));
vi.mock('../../src/pages/IncomePage', () => ({ default: () => <div>Income Page</div> }));
vi.mock('../../src/pages/BillsPage', () => ({ default: () => <div>Bills Page</div> }));
vi.mock('../../src/pages/DebtsPage', () => ({ default: () => <div>Debts Page</div> }));
vi.mock('../../src/pages/SchedulePage', () => ({ default: () => <div>Schedule Page</div> }));
vi.mock('../../src/pages/GoalsPage', () => ({ default: () => <div>Goals Page</div> }));
vi.mock('../../src/pages/SummaryPage', () => ({ default: () => <div>Summary Page</div> }));
vi.mock('../../src/pages/BudgetsPage', () => ({ default: () => <div>Budgets Page</div> }));
vi.mock('../../src/pages/ExportPage', () => ({ default: () => <div>Export Page</div> }));
vi.mock('../../src/pages/SettingsPage', () => ({ default: () => <div>Settings Page</div> }));

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = '#/';
    authState.isUnlocked = true;
    authState.isFirstTime = false;
    authState.isLoading = false;
    authState.checkAuthStatus = vi.fn(async () => {});
    budgetState.hasBudgetSelected = true;
  });

  describe('happy', () => {
    it('renders app shell for unlocked users with budget selected', async () => {
      render(<App />);
      await waitFor(() => {
        expect(authState.checkAuthStatus).toHaveBeenCalled();
      });
      expect(await screen.findByText('Mock Layout')).toBeInTheDocument();
    });
  });

  describe('sad', () => {
    it('shows loading screen during boot before auth status resolves', async () => {
      let resolveCheck: () => void = () => undefined;
      authState.checkAuthStatus = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveCheck = resolve;
          })
      );
      render(<App />);
      expect(await screen.findByText('Loading...')).toBeInTheDocument();
      resolveCheck();
      await waitFor(() => {
        expect(authState.checkAuthStatus).toHaveBeenCalled();
      });
    });

    it('redirects locked users to login', async () => {
      authState.isUnlocked = false;
      authState.isFirstTime = false;
      window.location.hash = '#/dashboard';
      render(<App />);
      expect(await screen.findByText('Login Page')).toBeInTheDocument();
    });

    it('routes first-time users to setup', async () => {
      authState.isUnlocked = false;
      authState.isFirstTime = true;
      window.location.hash = '#/login';
      render(<App />);
      expect(await screen.findByText('Setup Page')).toBeInTheDocument();
    });

    it('redirects unlocked users from setup to the app shell', async () => {
      authState.isFirstTime = false;
      authState.isUnlocked = true;
      window.location.hash = '#/setup';
      render(<App />);
      expect(await screen.findByText('Mock Layout')).toBeInTheDocument();
    });

    it('redirects locked non-first-time users from setup to login', async () => {
      authState.isFirstTime = false;
      authState.isUnlocked = false;
      window.location.hash = '#/setup';
      render(<App />);
      expect(await screen.findByText('Login Page')).toBeInTheDocument();
    });
  });

  describe('hostile', () => {
    it('shows budget picker when no budget is selected', async () => {
      budgetState.hasBudgetSelected = false;
      render(<App />);
      expect(await screen.findByRole('button', { name: 'Mock Budget Picker' })).toBeInTheDocument();
    });
  });
});
