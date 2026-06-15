# End-to-end tests

Playwright E2E tests live here and run against the packaged Electron app (`dist-electron/main.js`).

## Current coverage gap

All specs in this directory are currently **`test.skip` placeholders**. They are not executed in CI (`_shared-quality.yml` runs Vitest only). This is why recent production bugs were not caught here:

| Bug | Why E2E missed it |
|-----|-------------------|
| Goals page perpetual spinner | No active navigation test; spec is skipped |
| Debts page perpetual spinner | No debts E2E spec exists |

## Component tests (acceptance layer)

Page-level acceptance tests are Vitest + Testing Library suites under `tests/component/`. Those **did run in CI** but used stable `mockReturnValue` draft mocks, which hide the real-world behavior of `useDraftData()` / `useDraftActions()` returning new object references each render.

Regression tests in `GoalsPage.test.tsx` and `DebtsPage.test.tsx` (describe block: **loading regression**) now simulate unstable draft hook references via `tests/helpers/unstableDraftMock.ts`.

## Enabling real E2E coverage

Before un-skipping specs, add:

1. **Auth bypass** — fixture or test-only IPC to unlock without manual password entry
2. **Database seeding** — deterministic budget with bills, debts, and goals
3. **Navigation assertions** — wait for page heading/content, assert `.animate-spin` is absent after load

Suggested first spec: navigate to `/goals` and `/debts` after seeding data and assert primary content renders within a timeout.
