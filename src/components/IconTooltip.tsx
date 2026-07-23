import type { ReactNode } from 'react';
import clsx from 'clsx';

interface IconTooltipProps {
  label: string;
  children: ReactNode;
  className?: string;
  /** Prefer left so tooltips are not clipped by overflow-hidden card edges. */
  side?: 'left' | 'right' | 'top';
}

/**
 * Hover/focus tooltip for icons. Prefer this over native `title` — browser
 * tooltips are unreliable inside buttons and often fail to reappear on re-hover.
 */
export default function IconTooltip({
  label,
  children,
  className,
  side = 'left',
}: IconTooltipProps) {
  return (
    <span
      className={clsx('relative z-10 inline-flex shrink-0 group/icon-tip', className)}
      aria-label={label}
    >
      {children}
      <span
        role="tooltip"
        className={clsx(
          'pointer-events-none absolute z-20 w-64 max-w-[min(16rem,70vw)]',
          'rounded-md border border-(--color-border) bg-(--color-bg-secondary) px-2.5 py-1.5',
          'text-left text-xs font-normal leading-snug text-(--color-text-primary) shadow-md',
          'opacity-0 transition-opacity duration-150',
          'group-hover/icon-tip:opacity-100 group-focus-within/icon-tip:opacity-100',
          side === 'left' && 'right-full top-1/2 mr-2 -translate-y-1/2',
          side === 'right' && 'left-full top-1/2 ml-2 -translate-y-1/2',
          side === 'top' && 'bottom-full left-1/2 mb-2 -translate-x-1/2'
        )}
      >
        {label}
      </span>
    </span>
  );
}
