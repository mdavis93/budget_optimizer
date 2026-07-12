import { useState, useEffect, useCallback } from 'react';
import { 
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useBudget } from '../context/BudgetContext';
import { useDraft } from '../context/DraftContext';
import { APP_VERSION } from '../constants/version';
import {
  AppearanceSection,
  SecuritySection,
  RegionalSection,
  SavingsSection,
  BudgetAllocationSection,
  ChangePasswordModal,
} from '../components/settings';
import clsx from 'clsx';

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { biometricAvailable, biometricEnabled, enableBiometric } = useAuth();
  const { currentBudget, updateBudget } = useBudget();
  const draft = useDraft();
  const [currency, setCurrency] = useState('USD');
  const [autoLockMinutes, setAutoLockMinutes] = useState(5);
  const [savingsAPY, setSavingsAPY] = useState(0);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | null; message: string }>({
    type: null,
    message: ''
  });
  
  // Budget-specific settings
  const [targetCashOnHand, setTargetCashOnHand] = useState(250);
  const [minCashOnHand, setMinCashOnHand] = useState(100);
  const [minSavingsPerPaycheck, setMinSavingsPerPaycheck] = useState(0);

  // Load settings on mount
  useEffect(() => {
    let isMounted = true;
    
    const loadSettings = async () => {
      try {
        const result = await window.electronAPI.settings.get();
        if (isMounted && result.success && result.data) {
          setCurrency(result.data.currency || 'USD');
          setAutoLockMinutes(result.data.autoLockMinutes ?? 5);
          setSavingsAPY(result.data.savingsAPY ?? 0);
        }
      } catch {
        // Settings load failed, using defaults
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };
    loadSettings();
    
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    if (draft.budgetFields) {
      setTargetCashOnHand(draft.budgetFields.targetCashOnHand);
      setMinCashOnHand(draft.budgetFields.minCashOnHand);
      setMinSavingsPerPaycheck(draft.budgetFields.minSavingsPerPaycheck);
    } else if (currentBudget) {
      setTargetCashOnHand(currentBudget.targetCashOnHand);
      setMinCashOnHand(currentBudget.minCashOnHand);
      setMinSavingsPerPaycheck(currentBudget.minSavingsPerPaycheck);
    }
  }, [currentBudget, draft.budgetFields]);

  // Save settings when they change
  const saveSettings = useCallback(async (updates: { currency?: string; autoLockMinutes?: number; savingsAPY?: number }) => {
    try {
      const result = await window.electronAPI.settings.update(updates);
      if (result.success) {
        // If auto-lock changed, update the timer
        if (updates.autoLockMinutes !== undefined) {
          await window.electronAPI.auth.setAutoLock(updates.autoLockMinutes);
        }
        setStatus({ type: 'success', message: 'Settings saved' });
        setTimeout(() => setStatus({ type: null, message: '' }), 2000);
      }
    } catch {
      setStatus({ type: 'error', message: 'Failed to save settings' });
      setTimeout(() => setStatus({ type: null, message: '' }), 3000);
    }
  }, []);

  const handleCurrencyChange = (value: string) => {
    setCurrency(value);
    saveSettings({ currency: value });
  };

  const handleAutoLockChange = (value: number) => {
    setAutoLockMinutes(value);
    saveSettings({ autoLockMinutes: value });
  };

  const handleSavingsAPYChange = (value: number) => {
    const clampedValue = Math.min(100, Math.max(0, value));
    setSavingsAPY(clampedValue);
    saveSettings({ savingsAPY: clampedValue });
  };

  const handleTargetCashOnHandChange = (value: number) => {
    if (!currentBudget) return;
    const clampedValue = Math.max(0, value);
    setTargetCashOnHand(clampedValue);
    if (draft.isDraftMode) {
      draft.updateBudgetFields({ targetCashOnHand: clampedValue });
    } else {
      void updateBudget(currentBudget.id, { targetCashOnHand: clampedValue });
    }
  };

  const handleMinCashOnHandChange = (value: number) => {
    if (!currentBudget) return;
    const clampedValue = Math.max(0, value);
    setMinCashOnHand(clampedValue);
    if (draft.isDraftMode) {
      draft.updateBudgetFields({ minCashOnHand: clampedValue });
    } else {
      void updateBudget(currentBudget.id, { minCashOnHand: clampedValue });
    }
  };

  const handleMinSavingsPerPaycheckChange = (value: number) => {
    if (!currentBudget) return;
    const clampedValue = Math.max(0, value);
    setMinSavingsPerPaycheck(clampedValue);
    if (draft.isDraftMode) {
      draft.updateBudgetFields({ minSavingsPerPaycheck: clampedValue });
    } else {
      void updateBudget(currentBudget.id, { minSavingsPerPaycheck: clampedValue });
    }
  };

  const handleEnableBiometric = async () => {
    const success = await enableBiometric();
    if (success) {
      setStatus({ type: 'success', message: 'Fingerprint unlock enabled' });
    } else {
      setStatus({ type: 'error', message: 'Failed to enable fingerprint unlock' });
    }
    
    setTimeout(() => setStatus({ type: null, message: '' }), 3000);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-semibold">Settings</h2>
        <p className="text-[var(--color-text-secondary)]">
          Customize your app preferences and security settings
        </p>
      </div>

      {status.type && (
        <div className={clsx(
          'flex items-center gap-2 p-4 rounded-lg',
          status.type === 'success' 
            ? 'bg-success-50 dark:bg-success-500/10 text-success-700 dark:text-success-400'
            : 'bg-danger-50 dark:bg-danger-500/10 text-danger-700 dark:text-danger-400'
        )}>
          {status.type === 'success' ? (
            <CheckCircle className="w-5 h-5" />
          ) : (
            <AlertCircle className="w-5 h-5" />
          )}
          {status.message}
        </div>
      )}

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Saved immediately</h3>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            These preferences are written to disk as soon as you change them.
          </p>
        </div>

        <AppearanceSection theme={theme} setTheme={setTheme} />

        <SecuritySection
          onChangePassword={() => setIsChangePasswordOpen(true)}
          biometricAvailable={biometricAvailable}
          biometricEnabled={biometricEnabled}
          onEnableBiometric={handleEnableBiometric}
          autoLockMinutes={autoLockMinutes}
          onAutoLockChange={handleAutoLockChange}
          isLoading={isLoading}
        />

        <RegionalSection
          currency={currency}
          onCurrencyChange={handleCurrencyChange}
          isLoading={isLoading}
        />

        <SavingsSection
          savingsAPY={savingsAPY}
          onSavingsAPYChange={handleSavingsAPYChange}
          isLoading={isLoading}
        />
      </section>

      {currentBudget && (
        <section className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Requires Save (Budget)</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">
              Changes here stay unsaved until you use Save Changes on the Budgets page or Save All
              from the banner.
            </p>
          </div>

          <BudgetAllocationSection
            budgetName={currentBudget.name}
            targetCashOnHand={targetCashOnHand}
            minCashOnHand={minCashOnHand}
            minSavingsPerPaycheck={minSavingsPerPaycheck}
            onTargetCashOnHandChange={handleTargetCashOnHandChange}
            onMinCashOnHandChange={handleMinCashOnHandChange}
            onMinSavingsPerPaycheckChange={handleMinSavingsPerPaycheckChange}
          />
        </section>
      )}

      <div className="card bg-[var(--color-bg-tertiary)]">
        <h3 className="font-semibold mb-2">About Budget Optimizer</h3>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Version {APP_VERSION}
        </p>
        <p className="text-sm text-[var(--color-text-secondary)] mt-2">
          A secure desktop app for managing your income and optimizing bill payments.
          Your data is encrypted locally using AES-256-GCM encryption.
        </p>
      </div>

      <ChangePasswordModal 
        isOpen={isChangePasswordOpen}
        onClose={() => setIsChangePasswordOpen(false)}
        onSuccess={(message) => {
          setIsChangePasswordOpen(false);
          setStatus({ type: 'success', message });
          setTimeout(() => setStatus({ type: null, message: '' }), 5000);
        }}
      />
    </div>
  );
}
