import { lazy, Suspense, useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { BudgetProvider, useBudget } from './context/BudgetContext';
import { DraftProvider } from './context/DraftContext';
import Layout from './components/Layout';
import BudgetPicker from './components/BudgetPicker';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import LoadingScreen from './components/LoadingScreen';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const SetupPage = lazy(() => import('./pages/SetupPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const IncomePage = lazy(() => import('./pages/IncomePage'));
const BillsPage = lazy(() => import('./pages/BillsPage'));
const DebtsPage = lazy(() => import('./pages/DebtsPage'));
const SchedulePage = lazy(() => import('./pages/SchedulePage'));
const GoalsPage = lazy(() => import('./pages/GoalsPage'));
const SummaryPage = lazy(() => import('./pages/SummaryPage'));
const BudgetsPage = lazy(() => import('./pages/BudgetsPage'));
const ExportPage = lazy(() => import('./pages/ExportPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

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
  const { isFirstTime, isLoading, checkAuthStatus } = useAuth();
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const init = async () => {
      await checkAuthStatus();
      setInitializing(false);
    };
    init();
  }, [checkAuthStatus]);

  if (initializing || isLoading) {
    return <LoadingScreen />;
  }

  return (
    <ErrorBoundary>
      <ToastProvider>
        <HashRouter>
          <BudgetProvider>
          <DraftProvider>
          <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route 
              path="/login" 
              element={isFirstTime ? <Navigate to="/setup" replace /> : <LoginPage />} 
            />
            <Route 
              path="/setup" 
              element={isFirstTime ? <SetupPage /> : <Navigate to="/login" replace />} 
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
          </Suspense>
          </DraftProvider>
          </BudgetProvider>
        </HashRouter>
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
