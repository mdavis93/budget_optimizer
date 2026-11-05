import { Moon, Sun, Monitor } from 'lucide-react';
import clsx from 'clsx';
import { THEME_OPTIONS, type ThemeSetting } from '@shared/themes';

const THEME_ICONS = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} as const;

interface AppearanceSectionProps {
  theme: ThemeSetting;
  setTheme: (theme: ThemeSetting) => void;
}

export default function AppearanceSection({ theme, setTheme }: AppearanceSectionProps) {
  return (
    <div className="card">
      <h3 className="font-semibold mb-4">Appearance</h3>
      
      <div className="space-y-4">
        <div>
          <label className="label">Theme</label>
          <div className="grid grid-cols-3 gap-3">
            {THEME_OPTIONS.map(({ value, label }) => {
              const Icon = THEME_ICONS[value];
              return (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  className={clsx(
                    'flex items-center justify-center gap-2 p-3 rounded-lg border transition-colors',
                    theme === value
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400'
                      : 'border-(--color-border) hover:bg-(--color-bg-tertiary)'
                  )}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-medium">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
