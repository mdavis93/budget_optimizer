import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ScheduleComputeProgressReport } from '@shared/scheduleComputeProtocol';
import {
  scheduleProgressLabel,
  scheduleProgressPercent,
} from '../../utils/scheduleComputeProgress';

const STILL_WORKING_MS = 8_000;

interface ScheduleBuildProgressProps {
  heading: string;
  progress: ScheduleComputeProgressReport | null;
  startedAt: number | null;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function ScheduleBuildProgress({
  heading,
  progress,
  startedAt,
}: ScheduleBuildProgressProps) {
  const [now, setNow] = useState(() => Date.now());
  const stageChangedAt = useRef(Date.now());
  const lastStage = useRef<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const key = progress
      ? `${progress.stage}:${progress.current ?? ''}:${progress.total ?? ''}`
      : 'pending';
    if (lastStage.current !== key) {
      lastStage.current = key;
      stageChangedAt.current = Date.now();
    }
  }, [progress]);

  const elapsedMs = startedAt != null ? now - startedAt : 0;
  const stageStuck = now - stageChangedAt.current >= STILL_WORKING_MS;
  const percent = progress ? scheduleProgressPercent(progress) : null;
  const label = progress ? scheduleProgressLabel(progress) : heading;

  return (
    <div className="flex flex-col items-center justify-center gap-3 w-full max-w-sm">
      <RefreshCw className="w-5 h-5 text-primary-500 animate-spin shrink-0" aria-hidden />
      <p className="font-medium text-(--color-text-primary) text-center">{heading}</p>
      <div className="w-full">
        <div
          className="h-2 rounded-full bg-(--color-bg-tertiary) overflow-hidden"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          {...(percent != null ? { 'aria-valuenow': percent } : {})}
        >
          {percent != null ? (
            <div
              className="h-full bg-primary-500 transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          ) : (
            <div className="h-full w-1/3 bg-primary-500/70 animate-pulse" />
          )}
        </div>
      </div>
      <p className="text-sm text-(--color-text-secondary) text-center" aria-live="polite">
        {label}
        {elapsedMs >= 1000 ? ` Elapsed ${formatElapsed(elapsedMs)}.` : null}
      </p>
      {stageStuck ? (
        <p className="text-sm text-(--color-text-secondary) text-center" aria-live="polite">
          Still working — long horizons take longer.
        </p>
      ) : null}
    </div>
  );
}
