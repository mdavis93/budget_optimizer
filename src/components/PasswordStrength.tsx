import clsx from 'clsx';

interface PasswordStrengthProps {
  password: string;
}

function calculateStrength(password: string): { score: number; label: string; color: string } {
  let score = 0;
  
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  
  if (score <= 2) return { score: 1, label: 'Weak', color: 'bg-danger-500' };
  if (score <= 4) return { score: 2, label: 'Fair', color: 'bg-warning-500' };
  if (score <= 5) return { score: 3, label: 'Good', color: 'bg-primary-500' };
  return { score: 4, label: 'Strong', color: 'bg-success-500' };
}

export default function PasswordStrength({ password }: PasswordStrengthProps) {
  const { score, label, color } = calculateStrength(password);
  
  if (!password) return null;
  
  return (
    <div className="mt-2 space-y-1">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={clsx(
              'h-1 flex-1 rounded-full transition-colors',
              i <= score ? color : 'bg-[var(--color-border)]'
            )}
          />
        ))}
      </div>
      <p className={clsx('text-xs', {
        'text-danger-500': score === 1,
        'text-warning-500': score === 2,
        'text-primary-500': score === 3,
        'text-success-500': score === 4,
      })}>
        {label}
      </p>
    </div>
  );
}
