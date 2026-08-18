import path from 'path';
import { fileURLToPath } from 'url';

export interface NavigationAllowOpts {
  devServerUrl?: string;
  distDir: string;
  packaged: boolean;
  extraFileRoots?: string[];
}

function isPathInside(filePath: string, root: string): boolean {
  const resolvedFile = path.resolve(filePath);
  const resolvedRoot = path.resolve(root);
  if (resolvedFile === resolvedRoot) {
    return true;
  }
  const relative = path.relative(resolvedRoot, resolvedFile);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function isAllowedNavigation(url: string, opts: NavigationAllowOpts): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol === 'javascript:' || protocol === 'data:') {
    return false;
  }

  if (protocol === 'http:' || protocol === 'https:') {
    if (opts.packaged || !opts.devServerUrl) {
      return false;
    }
    try {
      return parsed.origin === new URL(opts.devServerUrl).origin;
    } catch {
      return false;
    }
  }

  if (protocol === 'file:') {
    let filePath: string;
    try {
      filePath = fileURLToPath(parsed);
    } catch {
      return false;
    }
    const roots = [opts.distDir, ...(opts.extraFileRoots ?? [])];
    return roots.some((root) => isPathInside(filePath, root));
  }

  return false;
}
