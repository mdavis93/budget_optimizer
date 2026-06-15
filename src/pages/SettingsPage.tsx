import { useState, useEffect, useCallback } from 'react';
import { 
  Moon, 
  Sun, 
  Monitor, 
  Shield, 
  Fingerprint, 
  Key, 
  Clock,
  DollarSign,
  CheckCircle,
  AlertCircle,
  PiggyBank,
  Wallet,
  Target,
  Wand2
} from 'lucide-react';
import { generateSecurePassword } from '../utils/generatePassword';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useBudget } from '../context/BudgetContext';
import { useDraft } from '../context/DraftContext';
import { APP_VERSION } from '../constants/version';
import Modal from '../components/Modal';
import PasswordStrength from '../components/PasswordStrength';
import RecoveryKeyDisplay from '../components/RecoveryKeyDisplay';
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

      <div className="card">
        <h3 className="font-semibold mb-4">Appearance</h3>
        
        <div className="space-y-4">
          <div>
            <label className="label">Theme</label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { value: 'light', icon: Sun, label: 'Light' },
                { value: 'dark', icon: Moon, label: 'Dark' },
                { value: 'system', icon: Monitor, label: 'System' },
              ].map(({ value, icon: Icon, label }) => (
                <button
                  key={value}
                  onClick={() => setTheme(value as typeof theme)}
                  className={clsx(
                    'flex items-center justify-center gap-2 p-3 rounded-lg border transition-colors',
                    theme === value
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400'
                      : 'border-[var(--color-border)] hover:bg-[var(--color-bg-tertiary)]'
                  )}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-medium">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-3 mb-4">
          <Shield className="w-5 h-5 text-primary-500" />
          <h3 className="font-semibold">Security</h3>
        </div>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg bg-[var(--color-bg-tertiary)]">
            <div className="flex items-center gap-3">
              <Key className="w-5 h-5 text-[var(--color-text-secondary)]" />
              <div>
                <p className="font-medium">Master Password</p>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  Change your encryption password
                </p>
              </div>
            </div>
            <button 
              onClick={() => setIsChangePasswordOpen(true)}
              className="btn-secondary"
            >
              Change
            </button>
          </div>

          {biometricAvailable && (
            <div className="flex items-center justify-between p-4 rounded-lg bg-[var(--color-bg-tertiary)]">
              <div className="flex items-center gap-3">
                <Fingerprint className="w-5 h-5 text-[var(--color-text-secondary)]" />
                <div>
                  <p className="font-medium">Fingerprint Unlock</p>
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    {biometricEnabled 
                      ? 'Use Touch ID to unlock the app'
                      : 'Enable fingerprint authentication'
                    }
                  </p>
                </div>
              </div>
              {biometricEnabled ? (
                <span className="text-sm text-success-500 font-medium">Enabled</span>
              ) : (
                <button 
                  onClick={handleEnableBiometric}
                  className="btn-primary"
                >
                  Enable
                </button>
              )}
            </div>
          )}

          <div className="flex items-center justify-between p-4 rounded-lg bg-[var(--color-bg-tertiary)]">
            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-[var(--color-text-secondary)]" />
              <div>
                <label htmlFor="settings-auto-lock" className="font-medium block">Auto-Lock</label>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  Automatically lock after inactivity
                </p>
              </div>
            </div>
            <select
              id="settings-auto-lock"
              value={autoLockMinutes}
              onChange={(e) => handleAutoLockChange(parseInt(e.target.value))}
              className="input w-32"
              disabled={isLoading}
            >
              <option value={0}>Never</option>
              <option value={1}>1 minute</option>
              <option value={5}>5 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-3 mb-4">
          <DollarSign className="w-5 h-5 text-primary-500" />
          <h3 className="font-semibold">Regional</h3>
        </div>
        
        <div className="space-y-4">
          <div>
            <label htmlFor="settings-currency" className="label">Currency</label>
            <select
              id="settings-currency"
              value={currency}
              onChange={(e) => handleCurrencyChange(e.target.value)}
              className="input"
              disabled={isLoading}
            >
              <option value="USD">US Dollar ($)</option>
              <option value="EUR">Euro (€)</option>
              <option value="GBP">British Pound (£)</option>
              <option value="CAD">Canadian Dollar (C$)</option>
              <option value="AUD">Australian Dollar (A$)</option>
              <option value="JPY">Japanese Yen (¥)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-3 mb-4">
          <PiggyBank className="w-5 h-5 text-primary-500" />
          <h3 className="font-semibold">Savings</h3>
        </div>
        
        <div className="space-y-4">
          <div>
            <label htmlFor="settings-savings-apy" className="label">Savings Account APY</label>
            <div className="flex items-center gap-2">
              <input
                id="settings-savings-apy"
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={savingsAPY}
                onChange={(e) => handleSavingsAPYChange(parseFloat(e.target.value) || 0)}
                className="input w-24"
                disabled={isLoading}
              />
              <span className="text-[var(--color-text-secondary)]">%</span>
            </div>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">
              Annual Percentage Yield for savings projections in the Summary view
            </p>
          </div>
        </div>
      </div>
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

        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <Target className="w-5 h-5 text-primary-500" />
            <h3 className="font-semibold">Budget Allocation</h3>
          </div>
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">
            Configure how surplus funds are allocated between cash reserves, savings, and goals for {currentBudget?.name}.
          </p>
          
          <div className="space-y-4">
            <div>
              <label htmlFor="settings-target-cash" className="label">Target Cash on Hand</label>
              <div className="flex items-center gap-2">
                <span className="text-[var(--color-text-secondary)]">$</span>
                <input
                  id="settings-target-cash"
                  type="number"
                  min="0"
                  step="10"
                  value={targetCashOnHand}
                  onChange={(e) => handleTargetCashOnHandChange(parseFloat(e.target.value) || 0)}
                  className="input w-32"
                />
              </div>
              <p className="text-sm text-[var(--color-text-muted)] mt-1">
                Any surplus above this amount is sent to savings
              </p>
            </div>

            <div>
              <label htmlFor="settings-min-cash" className="label">Minimum Cash on Hand</label>
              <div className="flex items-center gap-2">
                <span className="text-[var(--color-text-secondary)]">$</span>
                <input
                  id="settings-min-cash"
                  type="number"
                  min="0"
                  step="10"
                  value={minCashOnHand}
                  onChange={(e) => handleMinCashOnHandChange(parseFloat(e.target.value) || 0)}
                  className="input w-32"
                />
              </div>
              <p className="text-sm text-[var(--color-text-muted)] mt-1">
                Floor balance - goals cannot reduce cash below this
              </p>
            </div>

            <div className="pt-2 border-t border-[var(--color-border)]">
              <label htmlFor="settings-min-savings" className="label flex items-center gap-2">
                <Wallet className="w-4 h-4" />
                Minimum Savings per Paycheck
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[var(--color-text-secondary)]">$</span>
                <input
                  id="settings-min-savings"
                  type="number"
                  min="0"
                  step="10"
                  value={minSavingsPerPaycheck}
                  onChange={(e) => handleMinSavingsPerPaycheckChange(parseFloat(e.target.value) || 0)}
                  className="input w-32"
                />
              </div>
              <p className="text-sm text-[var(--color-text-muted)] mt-1">
                This amount goes to savings first, before allocating to goals. 
                Set to 0 to let goals take priority over savings.
              </p>
            </div>
          </div>
        </div>
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

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

function ChangePasswordModal({ isOpen, onClose, onSuccess }: ChangePasswordModalProps) {
  const [step, setStep] = useState<'form' | 'recovery'>('form');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newRecoveryKey, setNewRecoveryKey] = useState<string | null>(null);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleGeneratePassword = () => {
    const generated = generateSecurePassword();
    setNewPassword(generated);
    setConfirmPassword(generated);
    setShowNewPassword(true);
    setShowConfirmPassword(true);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);

    try {
      const result = await window.electronAPI.auth.changePassword(currentPassword, newPassword);
      
      if (result.success && result.newRecoveryKey) {
        setNewRecoveryKey(result.newRecoveryKey);
        setStep('recovery');
      } else {
        setError(result.error || 'Failed to change password');
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRecoveryConfirmed = async () => {
    await window.electronAPI.auth.clearPendingRecoveryKey();
    handleClose();
    onSuccess('Password changed successfully. New recovery key has been saved.');
  };

  const handleClose = () => {
    setStep('form');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
    setNewRecoveryKey(null);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    onClose();
  };

  if (step === 'recovery' && newRecoveryKey) {
    return (
      <Modal isOpen={isOpen} onClose={() => {}} title="New Recovery Key" size="lg">
        <RecoveryKeyDisplay 
          recoveryKey={newRecoveryKey}
          onConfirm={handleRecoveryConfirmed}
          title="Save Your New Recovery Key"
          description="Your password has been changed. A new recovery key has been generated. Your old recovery key will no longer work."
        />
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Change Master Password">
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="text"
          name="username"
          value="Budget Optimizer"
          autoComplete="username"
          className="hidden"
          readOnly
          tabIndex={-1}
          aria-hidden="true"
        />

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-danger-50 dark:bg-danger-500/10 text-danger-600 dark:text-danger-500 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        <div>
          <label htmlFor="change-current-password" className="label">Current Password</label>
          <input
            id="change-current-password"
            name="password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="input"
            placeholder="Enter current password"
            autoComplete="current-password"
            required
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="change-new-password" className="label mb-0">New Password</label>
            <button
              type="button"
              onClick={handleGeneratePassword}
              className="flex items-center gap-1 text-xs text-primary-500 hover:text-primary-400 transition-colors"
            >
              <Wand2 className="w-3.5 h-3.5" />
              Generate strong password
            </button>
          </div>
          <input
            id="change-new-password"
            name="new-password"
            type={showNewPassword ? 'text' : 'password'}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="input"
            placeholder="Enter new password"
            autoComplete="new-password"
            required
          />
          <PasswordStrength password={newPassword} />
        </div>

        <div>
          <label htmlFor="change-confirm-password" className="label">Confirm New Password</label>
          <input
            id="change-confirm-password"
            name="confirm-password"
            type={showConfirmPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="input"
            placeholder="Confirm new password"
            autoComplete="new-password"
            required
          />
        </div>

        <div className="bg-warning-100 dark:bg-warning-900 p-3 rounded-lg border border-warning-300 dark:border-warning-700">
          <p className="text-sm text-warning-900 dark:text-warning-100">
            Warning: Changing your password will generate a new recovery key and disable fingerprint unlock. 
            You'll need to save the new recovery key and re-enable fingerprint.
          </p>
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={handleClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button type="submit" disabled={isLoading} className="btn-primary flex-1">
            {isLoading ? 'Changing...' : 'Change Password'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
