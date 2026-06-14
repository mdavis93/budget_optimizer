import { app } from 'electron';
import path from 'path';

const APPROVAL_TTL_MS = 60_000;
const approvedExportPaths = new Map<string, number>();

export function approveExportPath(filePath: string): void {
  const resolved = path.resolve(filePath);
  approvedExportPaths.set(resolved, Date.now() + APPROVAL_TTL_MS);
}

export function clearApprovedExportPaths(): void {
  approvedExportPaths.clear();
}

function pruneExpiredPaths(now: number): void {
  for (const [filePath, expiresAt] of approvedExportPaths.entries()) {
    if (expiresAt <= now) {
      approvedExportPaths.delete(filePath);
    }
  }
}

export function validateExportPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const home = path.resolve(app.getPath('home'));

  if (!resolved.startsWith(home + path.sep) && resolved !== home) {
    return false;
  }

  pruneExpiredPaths(Date.now());
  return approvedExportPaths.has(resolved);
}
