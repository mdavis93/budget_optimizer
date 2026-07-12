import { Moon, Sun, Monitor } from 'lucide-react';
import clsx from 'clsx';

type Theme = 'light' | 'dark' | 'system';

interface AppearanceSectionProps {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export default function AppearanceSection({ theme, setTheme }: AppearanceSectionProps) {
  return (
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
                onClick={() => setTheme(value as Theme)}
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
  );
}
