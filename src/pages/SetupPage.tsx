import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Eye, EyeOff, AlertCircle, Check, Fingerprint } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import PasswordStrength from '../components/PasswordStrength';
import RecoveryKeyDisplay from '../components/RecoveryKeyDisplay';

type SetupStep = 'password' | 'recovery-key' | 'biometric' | 'complete';

export default function SetupPage() {
  const navigate = useNavigate();
  const { enableBiometric, biometricAvailable, error, clearError, checkAuthStatus } = useAuth();
  const [step, setStep] = useState<SetupStep>('password');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);

  const handleCreatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    clearError();
    
    if (password.length < 8) {
      setValidationError('Password must be at least 8 characters');
      return;
    }
    
    if (password !== confirmPassword) {
      setValidationError('Passwords do not match');
      return;
    }
    
    setIsLoading(true);
    
    const result = await window.electronAPI.auth.createMasterPassword(password);
    
    if (result.success && result.recoveryKey) {
      setRecoveryKey(result.recoveryKey);
      setStep('recovery-key');
    } else {
      setValidationError(result.error || 'Failed to create password');
    }
    
    setIsLoading(false);
  };

  const handleRecoveryKeyConfirmed = async () => {
    await window.electronAPI.auth.clearPendingRecoveryKey();
    
    if (biometricAvailable) {
      setStep('biometric');
    } else {
      await checkAuthStatus();
      navigate('/dashboard');
    }
  };

  const handleEnableBiometric = async () => {
    setIsLoading(true);
    await enableBiometric();
    await checkAuthStatus();
    navigate('/dashboard');
  };

  const handleSkipBiometric = async () => {
    await checkAuthStatus();
    navigate('/dashboard');
  };

  if (step === 'recovery-key' && recoveryKey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg-primary)] p-4">
        <div className="titlebar fixed top-0 left-0 right-0 h-8" />
        
        <div className="w-full max-w-md">
          <RecoveryKeyDisplay 
            recoveryKey={recoveryKey}
            onConfirm={handleRecoveryKeyConfirmed}
          />
        </div>
      </div>
    );
  }

  if (step === 'biometric') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg-primary)] p-4">
        <div className="titlebar fixed top-0 left-0 right-0 h-8" />
        
        <div className="w-full max-w-sm text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary-500/10 mb-4">
            <Fingerprint className="w-8 h-8 text-primary-500" />
          </div>
          <h1 className="text-2xl font-semibold mb-2">Enable Fingerprint Unlock</h1>
          <p className="text-[var(--color-text-secondary)] mb-8">
            Use your fingerprint for faster, secure access to your budget data.
          </p>
          
          <div className="space-y-3">
            <button
              onClick={handleEnableBiometric}
              disabled={isLoading}
              className="btn-primary w-full"
            >
              {isLoading ? 'Setting up...' : 'Enable Fingerprint'}
            </button>
            <button
              onClick={handleSkipBiometric}
              disabled={isLoading}
              className="btn-ghost w-full"
            >
              Skip for now
            </button>
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
          <h1 className="text-2xl font-semibold mb-2">Create Master Password</h1>
          <p className="text-[var(--color-text-secondary)]">
            This password will encrypt all your financial data. Make sure it's strong and memorable.
          </p>
        </div>
        
        <form onSubmit={handleCreatePassword} className="space-y-4">
          {(error || validationError) && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-danger-50 dark:bg-danger-500/10 text-danger-600 dark:text-danger-500 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error || validationError}
            </div>
          )}
          
          <div>
            <label htmlFor="password" className="label">Master Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input pr-10"
                placeholder="Create a strong password"
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
            <PasswordStrength password={password} />
          </div>
          
          <div>
            <label htmlFor="confirmPassword" className="label">Confirm Password</label>
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input pr-10"
                placeholder="Confirm your password"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
              >
                {showConfirm ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {confirmPassword && password === confirmPassword && (
              <div className="flex items-center gap-1 mt-2 text-success-500 text-xs">
                <Check className="w-3 h-3" />
                Passwords match
              </div>
            )}
          </div>
          
          <div className="pt-2">
            <button
              type="submit"
              disabled={isLoading || !password || !confirmPassword}
              className="btn-primary w-full"
            >
              {isLoading ? 'Creating...' : 'Create Password'}
            </button>
          </div>
          
          <p className="text-xs text-[var(--color-text-muted)] text-center">
            Your password is never stored. A recovery key will be generated next.
          </p>
        </form>
      </div>
    </div>
  );
}
