import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export default function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="w-16 h-16 rounded-full bg-(--color-bg-tertiary) flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-(--color-text-muted)" />
      </div>
      <h3 className="text-lg font-medium mb-2">{title}</h3>
      <p className="text-(--color-text-secondary) text-center max-w-sm mb-6">
        {description}
      </p>
      {action && (
        <button onClick={action.onClick} className="btn-primary">
          {action.label}
        </button>
      )}
    </div>
  );
}
