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

export function denyAllPermissions(session: Session): void {
  session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}
