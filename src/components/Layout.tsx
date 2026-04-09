import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Wallet, 
  Receipt, 
  Calendar, 
  Download, 
  Settings,
  Lock,
  Shield,
  TrendingUp,
  Power,
  Briefcase,
  Zap,
  Target,
  CreditCard
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { DataProvider } from '../context/DataContext';
import { useBudget } from '../context/BudgetContext';
import clsx from 'clsx';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/income', icon: Wallet, label: 'Income' },
  { to: '/bills', icon: Receipt, label: 'Bills' },
  { to: '/debts', icon: CreditCard, label: 'Debts' },
  { to: '/schedule', icon: Calendar, label: 'Schedule' },
  { to: '/goals', icon: Target, label: 'Goals' },
  { to: '/summary', icon: TrendingUp, label: 'Summary' },
  { to: '/budgets', icon: Briefcase, label: 'Budgets' },
  { to: '/export', icon: Download, label: 'Export' },
];

export default function Layout() {
  const { lock } = useAuth();
  const { currentBudget, isQuickBudget } = useBudget();
  const location = useLocation();

  return (
    <DataProvider>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary-600 focus:text-white focus:rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
      >
        Skip to main content
      </a>
      <div className="flex h-screen bg-[var(--color-bg-primary)]">
        <aside className="w-64 flex flex-col bg-[var(--color-bg-secondary)] border-r border-[var(--color-border)]">
          <div className="titlebar h-14 flex items-center px-6 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2 pl-16">
              <Shield className="w-6 h-6 text-primary-500" />
              <span className="font-semibold text-lg">Budget Optimizer</span>
            </div>
          </div>

          {/* Current Budget Indicator */}
          <div className="px-4 py-3 border-b border-[var(--color-border)]">
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
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-bg-tertiary)]">
                <Briefcase className="w-4 h-4 text-[var(--color-text-secondary)]" />
                <span className="text-sm text-[var(--color-text-secondary)]">
                  No budget selected
                </span>
              </div>
            )}
          </div>
          
          <nav className="flex-1 p-4 space-y-1">
            {navItems.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary-500/10 text-primary-500'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
                  )
                }
              >
                <Icon className="w-5 h-5" />
                {label}
              </NavLink>
            ))}
          </nav>
          
          <div className="p-4 space-y-1 border-t border-[var(--color-border)]">
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary-500/10 text-primary-500'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
                )
              }
            >
              <Settings className="w-5 h-5" />
              Settings
            </NavLink>
            <button
              onClick={lock}
              className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors w-full text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
            >
              <Lock className="w-5 h-5" />
              Lock App
            </button>
            <button
              onClick={() => window.electronAPI.quitApp()}
              className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors w-full text-[var(--color-text-secondary)] hover:bg-danger-50 dark:hover:bg-danger-500/10 hover:text-danger-600 dark:hover:text-danger-500"
            >
              <Power className="w-5 h-5" />
              Quit App
            </button>
          </div>
        </aside>
        
        <main id="main-content" className="flex-1 flex flex-col overflow-hidden">
          <div className="titlebar h-14 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)] flex items-center px-6">
            <h1 className="text-lg font-semibold capitalize">
              {location.pathname.split('/')[1] || 'Dashboard'}
            </h1>
          </div>
          <div className="flex-1 overflow-auto p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </DataProvider>
  );
}
