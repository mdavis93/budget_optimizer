import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';

interface AuthContextType {
  isUnlocked: boolean;
  isFirstTime: boolean;
  isLoading: boolean;
  biometricAvailable: boolean;
  biometricEnabled: boolean;
  error: string | null;
  checkAuthStatus: () => Promise<void>;
  createPassword: (password: string) => Promise<boolean>;
  unlock: (password: string) => Promise<boolean>;
  unlockWithBiometric: () => Promise<boolean>;
  lock: () => Promise<void>;
  enableBiometric: () => Promise<boolean>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isFirstTime, setIsFirstTime] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialStatusResolvedRef = useRef(false);

  const checkAuthStatus = useCallback(async () => {
    // Only the first status probe may flash the full-app loading screen.
    // Later refreshes (setup → dashboard, lock/unlock) must not unmount the
    // router — that races navigate() into /login on Linux CI.
    const isInitialProbe = !initialStatusResolvedRef.current;
    if (isInitialProbe) {
      setIsLoading(true);
    }
    try {
      const firstTime = await window.electronAPI.auth.isFirstTimeSetup();
      setIsFirstTime(firstTime);
      
      const bioAvailable = await window.electronAPI.checkBiometricAvailable();
      setBiometricAvailable(bioAvailable);
      
      if (!firstTime) {
        const bioEnabled = await window.electronAPI.auth.isBiometricEnabled();
        setBiometricEnabled(bioEnabled);
      }
      
      const unlocked = await window.electronAPI.auth.isUnlocked();
      setIsUnlocked(unlocked);
    } catch (err) {
      console.error('Failed to check auth status:', err);
      setError('Failed to initialize application');
      // Prefer setup over login when auth state cannot be read (e.g. preload/IPC unavailable)
      setIsFirstTime(true);
      setIsUnlocked(false);
    } finally {
      initialStatusResolvedRef.current = true;
      setIsLoading(false);
    }
  }, []);

  const createPassword = useCallback(async (password: string): Promise<boolean> => {
    setError(null);
    try {
      const result = await window.electronAPI.auth.createMasterPassword(password);
      if (result.success) {
        setIsFirstTime(false);
        setIsUnlocked(true);
        return true;
      } else {
        setError(result.error || 'Failed to create password');
        return false;
      }
    } catch {
      setError('An unexpected error occurred');
      return false;
    }
  }, []);

  const unlock = useCallback(async (password: string): Promise<boolean> => {
    setError(null);
    try {
      const result = await window.electronAPI.auth.unlock(password);
      if (result.success) {
        setIsUnlocked(true);
        return true;
      } else {
        setError(result.error || 'Invalid password');
        return false;
      }
    } catch {
      setError('An unexpected error occurred');
      return false;
    }
  }, []);

  const unlockWithBiometric = useCallback(async (): Promise<boolean> => {
    setError(null);
    try {
      const result = await window.electronAPI.auth.unlockWithBiometric();
      if (result.success) {
        setIsUnlocked(true);
        return true;
      } else {
        setError(result.error || 'Biometric authentication failed');
        return false;
      }
    } catch {
      setError('Biometric authentication failed');
      return false;
    }
  }, []);

  const lock = useCallback(async () => {
    await window.electronAPI.auth.lock();
    setIsUnlocked(false);
  }, []);

  const enableBiometric = useCallback(async (): Promise<boolean> => {
    try {
      const result = await window.electronAPI.auth.enableBiometric();
      if (result.success) {
        setBiometricEnabled(true);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        isUnlocked,
        isFirstTime,
        isLoading,
        biometricAvailable,
        biometricEnabled,
        error,
        checkAuthStatus,
        createPassword,
        unlock,
        unlockWithBiometric,
        lock,
        enableBiometric,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
