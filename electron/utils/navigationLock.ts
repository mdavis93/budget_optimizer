import type { Session, WebContents } from 'electron';
import { isAllowedNavigation, type NavigationAllowOpts } from './isAllowedNavigation';

export function attachNavigationLock(webContents: WebContents, opts: NavigationAllowOpts): void {
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const denyUnlessAllowed = (event: { preventDefault: () => void }, navigationUrl: string) => {
    if (!isAllowedNavigation(navigationUrl, opts)) {
      event.preventDefault();
    }
  };

  webContents.on('will-navigate', denyUnlessAllowed);
  webContents.on('will-redirect', denyUnlessAllowed);
}

/**
 * Deny every renderer permission request except the explicitly allowed ones.
 * `navigator.clipboard.writeText` is gated on `clipboard-sanitized-write`, so the
 * main window must allow it for "Copy report" to work.
 */
export function denyAllPermissions(
  session: Session,
  allowedPermissions: readonly string[] = []
): void {
  session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowedPermissions.includes(permission));
  });
}
