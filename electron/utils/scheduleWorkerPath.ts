import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/**
 * Resolve the packaged/dev path to schedule-worker.js beside main.js.
 */
export function resolveScheduleWorkerPath(): string {
  const candidates = [
    path.join(__dirname, 'schedule-worker.js'),
    path.join(process.cwd(), 'dist-electron', 'schedule-worker.js'),
  ];

  if (app?.isPackaged) {
    candidates.unshift(path.join(process.resourcesPath, 'app.asar', 'dist-electron', 'schedule-worker.js'));
    candidates.unshift(path.join(__dirname, 'schedule-worker.js'));
  }

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // continue
    }
  }

  // Default next to main bundle (vite multi-entry output).
  return path.join(__dirname, 'schedule-worker.js');
}

export function scheduleWorkerExists(): boolean {
  try {
    return fs.existsSync(resolveScheduleWorkerPath());
  } catch {
    return false;
  }
}
