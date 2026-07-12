import { Shield, Fingerprint, Key, Clock } from 'lucide-react';

interface SecuritySectionProps {
  onChangePassword: () => void;
  biometricAvailable: boolean;
  biometricEnabled: boolean;
  onEnableBiometric: () => void;
  autoLockMinutes: number;
  onAutoLockChange: (value: number) => void;
  isLoading: boolean;
}

export default function SecuritySection({
  onChangePassword,
  biometricAvailable,
  biometricEnabled,
  onEnableBiometric,
  autoLockMinutes,
  onAutoLockChange,
  isLoading,
}: SecuritySectionProps) {
  return (
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
            onClick={onChangePassword}
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
                onClick={onEnableBiometric}
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
            onChange={(e) => onAutoLockChange(parseInt(e.target.value))}
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
  );
}
