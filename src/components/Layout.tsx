import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import {
  LayoutDashboard,
  Wallet,
  Receipt,
  Calendar,
  Download,
  Settings,
  Lock,
  TrendingUp,
  Power,
  Briefcase,
  Zap,
  Target,
  CreditCard
} from 'lucide-react';
import AppIcon from './AppIcon';
import { useAuth } from '../context/AuthContext';
import { useBudget } from '../context/BudgetContext';
import { useDraftStatus } from '../context/DraftContext';
import { usePlatformExit } from '../platform/PlatformExitGuard';
import GlobalDraftBanner from './GlobalDraftBanner';
import DraftSaveBar from './DraftSaveBar';
import clsx from 'clsx';
import { DraftDomain, ROUTE_DRAFT_DOMAIN } from '../types/draft';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/income', icon: Wallet, label: 'Income', domain: 'income' as DraftDomain },
  { to: '/bills', icon: Receipt, label: 'Bills', domain: 'bills' as DraftDomain },
  { to: '/debts', icon: CreditCard, label: 'Debts', domain: 'debts' as DraftDomain },
  { to: '/schedule', icon: Calendar, label: 'Schedule', domain: 'schedule' as DraftDomain },
  { to: '/goals', icon: Target, label: 'Goals', domain: 'goals' as DraftDomain },
  { to: '/summary', icon: TrendingUp, label: 'Summary' },
  { to: '/budgets', icon: Briefcase, label: 'Budgets', domain: 'budget' as DraftDomain },
  { to: '/export', icon: Download, label: 'Export' },
];

export default function Layout() {
  const { lock } = useAuth();
  const { currentBudget, isQuickBudget } = useBudget();
  const { isDraftMode, isDomainDirty } = useDraftStatus();
  const { guardAction } = usePlatformExit();
  const location = useLocation();
  const currentDomain = ROUTE_DRAFT_DOMAIN[location.pathname];

  // In-app navigation never blocks: the draft lives in DraftProvider (above the
  // routed pages), so switching pages preserves uncommitted changes and lets the
  // user simulate freely. Save/Discard prompts only on exit (Quit / window close).
  // Lock App is privacy-only and does not force settling the draft.

  const handleQuit = () => {
    guardAction(() => window.electronAPI.quitApp(), 'quit the app');
  };

  useEffect(() => {
    let lastPing = Date.now();
    const pingActivity = () => {
      const now = Date.now();
      if (now - lastPing < 30_000) {
        return;
      }
      lastPing = now;
      void window.electronAPI.auth.activityPing();
    };

    window.addEventListener('mousedown', pingActivity);
    window.addEventListener('keydown', pingActivity);

    return () => {
      window.removeEventListener('mousedown', pingActivity);
      window.removeEventListener('keydown', pingActivity);
    };
  }, []);

  const handleLock = () => {
    void lock();
  };

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary-600 focus:text-white focus:rounded-lg focus:outline-hidden focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
      >
        Skip to main content
      </a>
      <div className="flex h-screen bg-(--color-bg-primary)">
        <aside className="w-64 flex flex-col bg-(--color-bg-secondary) border-r border-(--color-border)">
          <div className="titlebar h-14 flex items-center px-6 border-b border-(--color-border)">
            <div className="flex items-center gap-2 pl-16">
              <AppIcon className="w-6 h-6" />
              <span className="font-semibold text-lg">Budget Optimizer</span>
            </div>
          </div>

          <div className="px-4 py-3 border-b border-(--color-border)">
            {isQuickBudget ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-warning-500 dark:bg-warning-600">
                <Zap className="w-4 h-4 text-white" />
                <span className="text-sm font-medium text-white">
                  Quick Budget
                </span>
              </div>
            ) : currentBudget ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary-100 dark:bg-primary-800">
                <Briefcase className="w-4 h-4 text-primary-700 dark:text-primary-200" />
                <span className="text-sm font-medium text-primary-800 dark:text-primary-100 truncate">
                  {currentBudget.name}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--color-bg-tertiary)">
                <Briefcase className="w-4 h-4 text-(--color-text-secondary)" />
                <span className="text-sm text-(--color-text-secondary)">
                  No budget selected
                </span>
              </div>
            )}
          </div>
          
          <nav className="flex-1 p-4 space-y-1">
            {navItems.map(({ to, icon: Icon, label, domain }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary-500/10 text-primary-500'
                      : 'text-(--color-text-secondary) hover:bg-(--color-bg-tertiary) hover:text-(--color-text-primary)'
                  )
                }
              >
                <Icon className="w-5 h-5" />
                <span className="flex-1">{label}</span>
                {isDraftMode && domain && isDomainDirty(domain) && (
                  <span className="w-2 h-2 rounded-full bg-warning-500" aria-label="Unsaved changes" />
                )}
              </NavLink>
            ))}
          </nav>
          
          <div className="p-4 space-y-1 border-t border-(--color-border)">
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary-500/10 text-primary-500'
                    : 'text-(--color-text-secondary) hover:bg-(--color-bg-tertiary) hover:text-(--color-text-primary)'
                )
              }
            >
              <Settings className="w-5 h-5" />
              <span className="flex-1">Settings</span>
              {isDraftMode && isDomainDirty('budget') && (
                <span className="w-2 h-2 rounded-full bg-warning-500" aria-label="Unsaved changes" />
              )}
            </NavLink>
            <button
              onClick={handleLock}
              className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors w-full text-(--color-text-secondary) hover:bg-(--color-bg-tertiary) hover:text-(--color-text-primary)"
            >
              <Lock className="w-5 h-5" />
              Lock App
            </button>
            <button
              onClick={handleQuit}
              className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors w-full text-(--color-text-secondary) hover:bg-danger-50 dark:hover:bg-danger-500/10 hover:text-danger-600 dark:hover:text-danger-500"
            >
              <Power className="w-5 h-5" />
              Quit App
            </button>
          </div>
        </aside>
        
        <main id="main-content" className="flex-1 flex flex-col overflow-hidden">
          <div className="titlebar h-14 bg-(--color-bg-secondary) border-b border-(--color-border) flex items-center px-6">
            <h1 className="text-lg font-semibold capitalize">
              {location.pathname.split('/')[1] || 'Dashboard'}
            </h1>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-6">
            <GlobalDraftBanner />
            <Outlet />
          </div>
          {/* Domain save/discard lives in the main column footer (not an overlay). */}
          {currentDomain && <DraftSaveBar domain={currentDomain} />}
        </main>
      </div>
    </>
  );
}
