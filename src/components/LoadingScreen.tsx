import { Loader2 } from 'lucide-react';

export default function LoadingScreen() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-(--color-bg-primary)">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-10 h-10 text-primary-500 animate-spin" />
        <p className="text-(--color-text-secondary) text-sm">Loading...</p>
      </div>
    </div>
  );
}
