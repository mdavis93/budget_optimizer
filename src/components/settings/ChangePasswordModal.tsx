import { useState } from 'react';
import { AlertCircle, Wand2 } from 'lucide-react';
import { generateSecurePassword } from '../../utils/generatePassword';
import Modal from '../Modal';
import PasswordStrength from '../PasswordStrength';
import RecoveryKeyDisplay from '../RecoveryKeyDisplay';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export default function ChangePasswordModal({ isOpen, onClose, onSuccess }: ChangePasswordModalProps) {
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
