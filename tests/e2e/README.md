# End-to-end tests

Playwright user-journey tests that run against the **built** Electron app
(`dist-electron/main.js`). They drive the real renderer UI and the real
`electronAPI` IPC — there is no auth bypass and no test-only backdoor.

## Running

```bash
pnpm build:vite        # produce dist/ + dist-electron/
pnpm test:e2e          # run the whole suite
pnpm test:e2e smoke    # run a single spec
```

> If Electron fails to launch as plain Node (the binary prints a Node version,
> or Playwright reports "Process failed to launch"), the parent process is
> exporting `ELECTRON_RUN_AS_NODE=1` (common when launched from an Electron-based
> editor). The harness strips it automatically in `fixtures.ts`.

## How the harness works

`fixtures.ts` launches Electron against a **throwaway temp `userData` dir** and
stubs native dialogs (Keychain save prompt, file save/open) so headless runs
never block. Each test therefore boots into first-run setup and creates — then
destroys — its own encrypted vault. No credentials or data outlive a test.

Teardown calls the production `quitApp` IPC (`app:quit` → graceful shutdown) so
tests that leave unsaved drafts can exit without hanging on the native close
guard. That is harness lifecycle cleanup, not an auth bypass.

Helpers (`helpers/`):

- `auth.ts` — `completeSetup` (create master password + recovery key + skip
  biometric) and `unlock`.
- `budget.ts` / `app.ts` — create a named budget and reach the app shell.
  A named budget enables **draft mode** (edits stage in an overlay until
  "Save Changes"); Quick Budget persists instantly.
- `nav.ts` — `navigateTo` + `expectNoSpinner` (the load-regression guard).
- `schedule.ts` — `dismissReconciliationIfPresent` when shortfall overlay blocks Schedule.
- `seed.ts` — pre-seed via real `electronAPI.*.create`, then `reloadShell`
  (which reselects the budget from the picker, mirroring a real relaunch) so
  the renderer re-reads the snapshot.

### Arrange / act / assert

Setup-style prerequisites are seeded via IPC for speed; the **act and assert
phases always run through the UI**. Setup itself (the golden path) is driven
fully through the UI.

## Coverage

Specs are feature/domain-scoped and overlap at seams rather than running one
monolithic end-to-end path:

- `smoke.spec.ts` — setup → app shell, plus a crawl of every sidebar route
  asserting no stuck spinner (regression guard for the past Goals/Debts hangs).
- `income`, `bills`, `goals`, `debts` — happy / sad / malicious lanes per domain.
- `schedule.spec.ts` — income + bills → rendered schedule, plus the empty state.
- `nav-guard.spec.ts` — the unsaved-changes guard: in-app navigation is free
  (drafts persist for simulation); only exit actions (Lock/Quit) prompt with
  Cancel / Discard All / Save All Changes.
- `auth.spec.ts` — lock → unlock, and a rejected password.

Touchpoint coverage is tracked in `tests/e2e/touchpoint-inventory.json` and
enforced by `scripts/e2e-touchpoints.cjs` (see that file for the tiers/targets).
