import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { recordDiagnosticBreadcrumb } from './utils/diagnosticContext';
import { useAuth } from './context/AuthContext';
import { BudgetProvider, useBudget } from './context/BudgetContext';
import { DraftProvider } from './context/DraftContext';
import Layout from './components/Layout';
import BudgetPicker from './components/BudgetPicker';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import LoadingScreen from './components/LoadingScreen';
import { PlatformExitGuardProvider } from './platform/PlatformExitGuard';
import LoginPage from './pages/LoginPage';
import SetupPage from './pages/SetupPage';
import DashboardPage from './pages/DashboardPage';
import IncomePage from './pages/IncomePage';
import BillsPage from './pages/BillsPage';
import DebtsPage from './pages/DebtsPage';
import SchedulePage from './pages/SchedulePage';
import GoalsPage from './pages/GoalsPage';
import SummaryPage from './pages/SummaryPage';
import BudgetsPage from './pages/BudgetsPage';
import ExportPage from './pages/ExportPage';
import SettingsPage from './pages/SettingsPage';

function RouteBreadcrumbTracker() {
  const location = useLocation();

  useEffect(() => {
    recordDiagnosticBreadcrumb('route', `${location.pathname}${location.search}`);
  }, [location.pathname, location.search]);

  return null;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isUnlocked, isLoading } = useAuth();
  
  if (isLoading) {
    return <LoadingScreen />;
  }
  
  if (!isUnlocked) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
}

function BudgetRequiredRoute({ children }: { children: React.ReactNode }) {
  const { hasBudgetSelected } = useBudget();
  const [showPicker, setShowPicker] = useState(!hasBudgetSelected);

  useEffect(() => {
    if (hasBudgetSelected) {
      setShowPicker(false);
    }
  }, [hasBudgetSelected]);

  if (showPicker || !hasBudgetSelected) {
    return <BudgetPicker onBudgetSelected={() => setShowPicker(false)} />;
  }

  return <>{children}</>;
}

function App() {
  const { isFirstTime, isUnlocked, checkAuthStatus } = useAuth();
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const init = async () => {
      await checkAuthStatus();
      setInitializing(false);
    };
    init();
  }, [checkAuthStatus]);

  // Gate the tree only on the boot probe. Subsequent isLoading flips must not
  // unmount HashRouter — that drops in-flight navigate() from SetupPage and
  // leaves Linux CI (no biometric step) stranded on Welcome Back.
  if (initializing) {
    return <LoadingScreen />;
  }

  return (
    <ErrorBoundary>
      <ToastProvider>
        <HashRouter>
          <RouteBreadcrumbTracker />
          <BudgetProvider>
          <DraftProvider>
          <PlatformExitGuardProvider>
          <Routes>
            <Route 
              path="/login" 
              element={isFirstTime ? <Navigate to="/setup" replace /> : <LoginPage />} 
            />
            <Route 
              path="/setup" 
              element={
                isFirstTime
                  ? <SetupPage />
                  : <Navigate to={isUnlocked ? '/' : '/login'} replace />
              } 
            />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <BudgetRequiredRoute>
                    <Layout />
                  </BudgetRequiredRoute>
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="income" element={<IncomePage />} />
              <Route path="bills" element={<BillsPage />} />
              <Route path="debts" element={<DebtsPage />} />
              <Route path="schedule" element={<SchedulePage />} />
              <Route path="goals" element={<GoalsPage />} />
              <Route path="summary" element={<SummaryPage />} />
              <Route path="budgets" element={<BudgetsPage />} />
              <Route path="export" element={<ExportPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </PlatformExitGuardProvider>
          </DraftProvider>
          </BudgetProvider>
        </HashRouter>
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
