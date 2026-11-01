import type { LegacyHighs } from 'highs';

type HighsLoader = (options?: { locateFile?: (file: string) => string }) => Promise<LegacyHighs>;

let highsPromise: Promise<LegacyHighs> | null = null;

function resolveLoader(module: unknown): HighsLoader {
  if (typeof module === 'function') {
    return module as HighsLoader;
  }
  if (module && typeof module === 'object' && 'default' in module) {
    const loader = (module as { default: unknown }).default;
    if (typeof loader === 'function') {
      return loader as HighsLoader;
    }
  }
  throw new Error('highs loader export is missing');
}

/**
 * Compile the HiGHS WASM module once per process. Solve stays synchronous
 * on the returned handle. The cached promise is the compiled runtime, not
 * per-job solver state.
 */
export function loadHighs(): Promise<LegacyHighs> {
  if (!highsPromise) {
    highsPromise = import('highs').then((module) => resolveLoader(module)());
  }
  return highsPromise;
}

/** Test-only: drop the compiled runtime so the next load compiles again. */
export function resetHighsLoader(): void {
  highsPromise = null;
}
