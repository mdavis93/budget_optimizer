/**
 * Absolute calendar anchors for e2e seeds and schedule viewport pins.
 * Prefer these over `new Date()` / `toISOString()` so CI does not drift
 * when the runner's clock moves past a seeded income window.
 */
export const E2E_SCHEDULE_START = '2026-01-01';
export const E2E_INCOME_START = '2026-01-02';
export const E2E_INCOME_END = '2026-03-31';
/** Far enough past a 12-month viewport to expose a per-goal View shortcut. */
export const E2E_GOAL_FAR = '2028-01-15';
/** Near-horizon goal target for underfunded / at-risk assertions. */
export const E2E_GOAL_NEAR = '2026-07-01';
