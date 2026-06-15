import { vi } from 'vitest';

export function suppressExpectedConsoleErrors(run: () => void): void {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    run();
  } finally {
    spy.mockRestore();
  }
}
