import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { BudgetProvider, useBudget } from './context/BudgetContext';
import { DraftProvider } from './context/DraftContext';
import Layout from './components/Layout';
import BudgetPicker from './components/BudgetPicker';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
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
import LoadingScreen from './components/LoadingScreen';

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
          </DraftProvider>
          </BudgetProvider>
        </HashRouter>
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
