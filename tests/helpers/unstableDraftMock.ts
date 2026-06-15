import { vi } from 'vitest';

/**
 * Simulates real `useDraftData()` behavior: each hook call returns a new object reference
 * even when the underlying draft state is unchanged. Stable `mockReturnValue` mocks hide
 * effect dependency bugs from passing the merged `useDraft()` object into effect deps.
 */
export function unstableDraftMock<T extends object>(factory: () => T): () => T {
  return () => ({ ...factory() });
}

/** Delayed async resolver for exercising load-state races in page tests. */
export function delayedResolve<T>(value: T, ms = 100): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

/** Vitest mock that returns a new object on every invocation. */
export function viUnstableDraftMock<T extends object>(factory: () => T) {
  return vi.fn(unstableDraftMock(factory));
}
