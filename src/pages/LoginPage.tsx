import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Eye, EyeOff, Fingerprint, AlertCircle, Key, ArrowLeft, Check, Wand2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import PasswordStrength from '../components/PasswordStrength';
import RecoveryKeyDisplay from '../components/RecoveryKeyDisplay';
import { generateSecurePassword } from '../utils/generatePassword';

type LoginMode = 'login' | 'recovery' | 'new-password' | 'show-new-recovery';

export default function LoginPage() {
  const navigate = useNavigate();
  const { unlock, unlockWithBiometric, biometricAvailable, biometricEnabled, error, clearError } = useAuth();
  const [mode, setMode] = useState<LoginMode>('login');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const [recoveryKey, setRecoveryKey] = useState('');
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [newPasswordError, setNewPasswordError] = useState<string | null>(null);
  
  const [newRecoveryKey, setNewRecoveryKey] = useState<string | null>(null);
  const [filledFromKeychain, setFilledFromKeychain] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);

  const handleFillFromCredentials = async () => {
    const result = await window.electronAPI.credentials.get();
    if (result.success && result.password) {
      setPassword(result.password);
      setFilledFromKeychain(true);
    }
  };

  const handleGenerateNewPassword = () => {
    const generated = generateSecurePassword();
    setNewPassword(generated);
    setConfirmNewPassword(generated);
    setShowNewPassword(true);
    setShowConfirmNewPassword(true);
    setNewPasswordError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    
    setIsLoading(true);
    clearError();
    
    const success = await unlock(password);
    
    if (success) {
      navigate('/dashboard');
    }
    
    setIsLoading(false);
  };

  const handleBiometric = async () => {
    setIsLoading(true);
    clearError();
    
    const success = await unlockWithBiometric();
    
    if (success) {
      navigate('/dashboard');
    }
    
    setIsLoading(false);
  };

  const handleVerifyRecoveryKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecoveryError(null);
    setIsLoading(true);

    const result = await window.electronAPI.auth.verifyRecoveryKey(recoveryKey);
    
    if (result.success) {
      setMode('new-password');
    } else {
      setRecoveryError(result.error || 'Invalid recovery key');
    }
    
    setIsLoading(false);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewPasswordError(null);

    if (newPassword.length < 8) {
      setNewPasswordError('Password must be at least 8 characters');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setNewPasswordError('Passwords do not match');
      return;
    }

    setIsLoading(true);

    try {
      const result = await window.electronAPI.auth.resetPasswordWithRecovery(recoveryKey, newPassword);

      if (result.success && result.newRecoveryKey) {
        setNewRecoveryKey(result.newRecoveryKey);
        setMode('show-new-recovery');
        void window.electronAPI.credentials.offerSave(newPassword);
      } else {
        setNewPasswordError(result.error || 'Failed to reset password');
      }
    } catch {
      setNewPasswordError('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRecoveryComplete = async () => {
    await window.electronAPI.auth.clearPendingRecoveryKey();
    navigate('/dashboard');
  };

  const handleBackToLogin = () => {
    setMode('login');
    setRecoveryKey('');
    setNewPassword('');
    setConfirmNewPassword('');
    setRecoveryError(null);
    setNewPasswordError(null);
    clearError();
  };

  if (mode === 'show-new-recovery' && newRecoveryKey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg-primary)] p-4">
        <div className="titlebar fixed top-0 left-0 right-0 h-8" />
        
        <div className="w-full max-w-md">
          <RecoveryKeyDisplay 
            recoveryKey={newRecoveryKey}
            onConfirm={handleRecoveryComplete}
            title="New Recovery Key Generated"
            description="Your password has been reset. A new recovery key has been generated. Save it in a safe place."
          />
        </div>
      </div>
    );
  }

  if (mode === 'new-password') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg-primary)] p-4">
        <div className="titlebar fixed top-0 left-0 right-0 h-8" />
        
        <div className="w-full max-w-sm">
          <button
            onClick={() => setMode('recovery')}
            className="flex items-center gap-1 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>

          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-success-500/10 mb-4">
              <Check className="w-8 h-8 text-success-500" />
            </div>
            <h1 className="text-2xl font-semibold mb-2">Create New Password</h1>
            <p className="text-[var(--color-text-secondary)]">
              Recovery key verified! Create a new master password.
            </p>
          </div>
          
          <form onSubmit={handleResetPassword} className="space-y-4">
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

            {newPasswordError && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-danger-50 dark:bg-danger-500/10 text-danger-600 dark:text-danger-500 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {newPasswordError}
              </div>
            )}
            
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="newPassword" className="label mb-0">New Password</label>
                <button
                  type="button"
                  onClick={handleGenerateNewPassword}
                  className="flex items-center gap-1 text-xs text-primary-500 hover:text-primary-400 transition-colors"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  Generate strong password
                </button>
              </div>
              <div className="relative">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  id="newPassword"
                  name="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="input pr-10"
                  placeholder="Enter new password"
                  autoComplete="new-password"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                >
                  {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              <PasswordStrength password={newPassword} />
            </div>

            <div>
              <label htmlFor="confirmNewPassword" className="label">Confirm New Password</label>
              <input
                type={showConfirmNewPassword ? 'text' : 'password'}
                id="confirmNewPassword"
                name="confirm-password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                className="input"
                placeholder="Confirm new password"
                autoComplete="new-password"
              />
              {confirmNewPassword && newPassword === confirmNewPassword && (
                <div className="flex items-center gap-1 mt-2 text-success-500 text-xs">
                  <Check className="w-3 h-3" />
                  Passwords match
                </div>
              )}
            </div>
            
            <button
              type="submit"
              disabled={isLoading || !newPassword || !confirmNewPassword}
              className="btn-primary w-full"
            >
              {isLoading ? 'Resetting...' : 'Reset Password'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (mode === 'recovery') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg-primary)] p-4">
        <div className="titlebar fixed top-0 left-0 right-0 h-8" />
        
        <div className="w-full max-w-sm">
          <button
            onClick={handleBackToLogin}
            className="flex items-center gap-1 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Login
          </button>

          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-warning-500/10 mb-4">
              <Key className="w-8 h-8 text-warning-500" />
            </div>
            <h1 className="text-2xl font-semibold mb-2">Recover Account</h1>
            <p className="text-[var(--color-text-secondary)]">
              Enter your 12-word recovery key to reset your password.
            </p>
          </div>
          
          <form onSubmit={handleVerifyRecoveryKey} className="space-y-4">
            {recoveryError && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-danger-50 dark:bg-danger-500/10 text-danger-600 dark:text-danger-500 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {recoveryError}
              </div>
            )}
            
            <div>
              <label htmlFor="recoveryKey" className="label">Recovery Key</label>
              <textarea
                id="recoveryKey"
                value={recoveryKey}
                onChange={(e) => setRecoveryKey(e.target.value)}
                className="input min-h-[100px] font-mono text-sm"
                placeholder="word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12"
                autoFocus
              />
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                Enter all 12 words separated by spaces
              </p>
            </div>
            
            <button
              type="submit"
              disabled={isLoading || !recoveryKey.trim()}
              className="btn-primary w-full"
            >
              {isLoading ? 'Verifying...' : 'Verify Recovery Key'}
            </button>
          </form>

          <div className="mt-6 p-4 rounded-lg bg-[var(--color-bg-tertiary)]">
            <p className="text-xs text-[var(--color-text-muted)]">
              Don't have your recovery key? Unfortunately, without it, your encrypted data cannot be recovered. 
              You would need to start fresh with a new account.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg-primary)] p-4">
      <div className="titlebar fixed top-0 left-0 right-0 h-8" />
      
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary-500/10 mb-4">
            <Shield className="w-8 h-8 text-primary-500" />
          </div>
          <h1 className="text-2xl font-semibold mb-2">Welcome Back</h1>
          <p className="text-[var(--color-text-secondary)]">
            Enter your master password to unlock
          </p>
        </div>
        
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
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="password" className="label mb-0">Master Password</label>
              <button
                type="button"
                onClick={handleFillFromCredentials}
                className="flex items-center gap-1 text-xs text-primary-500 hover:text-primary-400 transition-colors"
              >
                <Key className="w-3.5 h-3.5" />
                Fill from Keychain
              </button>
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input pr-10"
                placeholder="Enter your password"
                autoComplete="current-password"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              {filledFromKeychain
                ? 'Password filled from system credential store.'
                : 'If you saved your password to Keychain, click Fill from Keychain to use it.'}
            </p>
          </div>
          
          <button
            type="submit"
            disabled={isLoading || !password.trim()}
            className="btn-primary w-full"
          >
            {isLoading ? 'Unlocking...' : 'Unlock'}
          </button>
          
          {biometricAvailable && biometricEnabled && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[var(--color-border)]" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-2 bg-[var(--color-bg-primary)] text-[var(--color-text-muted)]">
                    or
                  </span>
                </div>
              </div>
              
              <button
                type="button"
                onClick={handleBiometric}
                disabled={isLoading}
                className="btn-secondary w-full"
              >
                <Fingerprint className="w-5 h-5 mr-2" />
                Unlock with Fingerprint
              </button>
            </>
          )}
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => setMode('recovery')}
            className="text-sm text-[var(--color-text-secondary)] hover:text-primary-500 transition-colors"
          >
            Forgot password?
          </button>
        </div>
      </div>
    </div>
  );
}
