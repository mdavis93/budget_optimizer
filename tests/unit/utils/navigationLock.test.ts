import { describe, expect, it, vi } from 'vitest';
import { attachNavigationLock, denyAllPermissions } from '../../../electron/utils/navigationLock';

describe('navigationLock', () => {
  it('denies window.open and unallowed navigation', () => {
    const handlers: Record<string, (event: { preventDefault: () => void }, url: string) => void> = {};
    const webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((event: string, handler: (event: { preventDefault: () => void }, url: string) => void) => {
        handlers[event] = handler;
      }),
    };

    attachNavigationLock(webContents as never, {
      distDir: '/app/dist',
      packaged: true,
    });

    expect(webContents.setWindowOpenHandler).toHaveBeenCalled();
    const openHandler = webContents.setWindowOpenHandler.mock.calls[0][0];
    expect(openHandler()).toEqual({ action: 'deny' });

    const preventDefault = vi.fn();
    handlers['will-navigate']({ preventDefault }, 'https://evil.example/');
    expect(preventDefault).toHaveBeenCalled();
    preventDefault.mockClear();
    handlers['will-redirect']({ preventDefault }, 'https://evil.example/');
    expect(preventDefault).toHaveBeenCalled();
  });

  it('denies all permission requests', () => {
    const session = { setPermissionRequestHandler: vi.fn() };
    denyAllPermissions(session as never);
    const handler = session.setPermissionRequestHandler.mock.calls[0][0];
    const cb = vi.fn();
    handler({}, 'notifications', cb);
    expect(cb).toHaveBeenCalledWith(false);
  });
});
