import type { ElectronAPI } from '@shared/electronApi';

export type { ElectronAPI };

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
