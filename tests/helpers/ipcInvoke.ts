import { IpcMain } from 'electron';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

export function createMockIpcMain(): IpcMain & {
  handlers: Map<string, Handler>;
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
} {
  const handlers = new Map<string, Handler>();

  const ipcMain = {
    handlers,
    handle(channel: string, listener: Handler) {
      handlers.set(channel, listener);
    },
    invoke(channel: string, ...args: unknown[]) {
      const handler = handlers.get(channel);
      if (!handler) {
        return Promise.reject(new Error(`No handler registered for ${channel}`));
      }
      return Promise.resolve(handler({}, ...args));
    },
  } as IpcMain & {
    handlers: Map<string, Handler>;
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  };

  return ipcMain;
}
