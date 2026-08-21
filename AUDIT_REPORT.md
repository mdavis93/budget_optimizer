# Budget Optimizer — Security, Architecture & Efficiency Audit

**App version:** 3.0.0  
**Audit date:** 2026-08-18  
**Scope:** Full tree — `src/`, `electron/`, `shared/`, `scripts/`, CI, lockfiles, production + full-tree dependency advisories  
**Method:** Static review of Electron hardening, IPC/auth/crypto/DB, renderer data flow, schedule pipeline, duplication, hot paths, and package hygiene  
**Threat model:** Local-first desktop finance app. Primary adversaries are (1) malicious or compromised renderer content (XSS, dependency, navigation), (2) other OS users / malware reading disk and `/tmp`, (3) offline brute-force of stolen `userData`. There is no network backend.

**Supersedes:** The June 2026 functional audit (v2.8.0). That document is closed/archival; this report is the living backlog and the Plan Agent seed.

---

## 1. Executive summary

Budget Optimizer is a capable local-first Electron 42 finance app with a **sound core**: context isolation, sandbox, parameterized SQL, AES-256-GCM payload encryption, unlock-gated IPC for budget data, schedule compute isolated in a `utilityProcess`, and a coherent draft/commit model on the primary editing surfaces.

It is **not yet one harmonious system**. Several security controls stop at “good Electron defaults” and do not complete the Electron threat model. Credentials still cross the renderer. Feature work has left parallel apply paths, duplicate constants, a 1,500-line DraftContext, and a Quick Budget mode that does not own debts/leaves. Display currency is stored but ignored. A leftover `package-lock.json` fights `pnpm`.

**Overall posture:** B- for a private desktop finance app. Release-worthy after Phase 0–1. Harmony/lean work is Phase 2–3.


| Domain                      | Grade  | One-line                                                                                     |
| --------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| Electron / IPC security     | **C+** | Isolation is on; navigation lock, session CSP, and credential IPC are not finished           |
| Crypto / at-rest data       | **B**  | GCM + PBKDF2 is real; file is not SQLCipher; `/tmp` PDF HTML and plaintext settings leak     |
| Auth / lock                 | **B-** | Unlock gates work; keychain fill is broken; 8-char minimum is weak for a KEK                 |
| Architecture / harmony      | **C+** | Draft+worker is the right shape; Quick Budget, debts IPC, and no-op apply channels are silos |
| Efficiency / leaks          | **B-** | Worker + viewport cache help; hanging debounce promises and JSON cache keys waste work       |
| Bloat / duplication         | **C+** | Lean runtime deps; duplicate types/constants/formatters and unused packages                  |
| Dependencies / supply chain | **B**  | CI audit gates exist; dual lockfile + exceljs-as-devDep + two ignored GHSAs                  |



| Severity | Count | IDs                                   |
| -------- | ----- | ------------------------------------- |
| High     | 4     | S-01, S-02, S-03, S-04                |
| Medium   | 12    | S-05–S-12, A-01–A-04                  |
| Low      | 11    | S-13–S-15, A-05–A-08, E-03–E-04, B-03 |


No critical remote RCE or SQL injection was found. No production debug telemetry (the June S-01 class) remains; CI still greps for it.

---

## 2. What is already solid — do not re-litigate

Keep these. Remediations below layer on them; they do not replace them.

- Renderer: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, preload via `contextBridge` (`electron/main.ts`, `electron/preload.ts`).
- Data IPC is wrapped in `withBudgetGuard` / `withUnlockGuard` (`electron/ipc/guards.ts`).
- SQLite uses `prepare`/`run` with bound parameters. Payload columns are AES-256-GCM (`iv:tag:ciphertext`). Schema v9–v10 encrypted metadata and junctions.
- Unlock clears the key (`CryptoService.clearKey` zero-fills the Buffer) and `applyLockSideEffects` closes DB + clears export-path allowlist.
- Export writes require a prior native save-dialog path, 60s TTL, home-directory prefix (`electron/utils/exportPaths.ts`).
- HTML export escapes user strings (`electron/utils/escapeHtml.ts`). PDF window has `javascript: false`.
- Schedule work is off-main in `utilityProcess` with newest-wins, timeout, and no DB/keytar in the worker.
- Draft overlay is validated (`validateDraftOverlay`) before compute.
- Diagnostics scrub secrets/paths/money and rate-limit reports.
- Production CSP strips `unsafe-eval` / localhost (`vite.config.ts` + `scripts/verify-production-csp.cjs`).
- CI: typecheck (renderer + electron), lint, coverage, CSP verify, `pnpm audit --prod --audit-level critical`, `pnpm audit:dev`.

---

## 3. Findings

Each item: **why it matters in this app**, then **the remediation that is correct here** (not generic advice).

### 3.1 Security

#### S-01 — High — Renderer can navigate off-origin and keep the preload bridge

**Where:** `electron/main.ts` `createWindow()`. No `will-navigate` / `will-redirect` deny, no `setWindowOpenHandler({ action: 'deny' })`, no `setPermissionRequestHandler`.

**Why it matters here:** This app’s entire trusted API (`window.electronAPI`) is injected into one `webContents`. Electron does not drop the preload when that contents navigates. A single XSS, compromised chart/font path, or `window.open`/`location` assignment can attach the finance IPC surface (unlock, export, diagnostics, schedule overlay) to an attacker origin. Sandbox + contextIsolation do **not** stop that. This is the highest-leverage Electron fix remaining.

**Remediation:** In `createWindow`, after constructing `BrowserWindow`:

1. Allow navigation only to the Vite dev URL (unpackaged) or `file:` URLs under `dist/`.
2. `setWindowOpenHandler(() => ({ action: 'deny' }))`.
3. Deny all permission requests (media, clipboard-sanitized, notifications, etc.).
4. Apply the same lock to the PDF `BrowserWindow` (defense in depth; it already has JS off).

**Why this is the right fix:** The app is not a browser. It never needs a second origin or a popup. Navigation deny is cheaper and more correct than auditing every `href`/`window.open` in React.

---

#### S-02 — High — Master password is copied into the renderer; Keychain fill is also broken

**Where:**

- `credentials:get` is `withUnlockGuard`’d (`electron/ipc/handlers.ts`).
- `LoginPage` calls `credentials.get()` **while locked** (`src/pages/LoginPage.tsx` `handleFillFromCredentials`).
- `credentials:save` / `offerSave` / `change-password` still pass the plaintext password across IPC.
- Preload types the password onto `ApiResult`.

**Why it matters here:** Two failures stacked. (1) Fill from Keychain silently no-ops after login lock — a functional hole in the credential feature. (2) The design still treats the renderer as a safe place for the KEK password. Any future XSS (S-01, font CDN, chart DOM) can read React state and IPC results. A finance app should keep the password in main/OS keychain only.

**Remediation:** Replace get/save/offer password IPC with **main-owned** operations:


| New channel                          | Behavior                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `auth:unlock-with-saved-credentials` | Main reads keytar, calls `AuthService.unlock`, never returns the password                                           |
| `credentials:offer-save-current`     | After a successful unlock/create/change/reset **in main**, prompt Keychain save using the password main already has |
| `credentials:has`                    | Keep (boolean only, already unguarded)                                                                              |
| `credentials:delete`                 | Keep, still unlock-gated                                                                                            |


Delete `credentials:get`, `credentials:save`, `credentials:offerSave(password)` from preload and `src/types/electron.d.ts`. Login becomes: biometric, typed password, or “Unlock with Keychain” (one click, no fill into the input). Clear password React state on successful unlock and on unmount.

**Why this is the right fix:** It restores Keychain UX **and** removes the secret from the XSS domain. Guarding `credentials:get` without changing LoginPage was the wrong half-measure.

---

#### S-03 — High — Session has no CSP; production still phones Google Fonts

**Where:** CSP is a meta tag only (`index.html`, swapped in `vite.config.ts`). Production still allows `style-src https://fonts.googleapis.com` and `font-src https://fonts.gstatic.com`. `index.html` always loads Inter/JetBrains from Google.

**Why it matters here:** Meta CSP is bypassed if navigation succeeds (S-01). Google Fonts is a **network identity leak** from a local-first finance app (OS, locale, app usage). It also keeps a remote origin in CSP that S-01 is trying to eliminate. `unsafe-inline` on style is acceptable for Tailwind; remote fonts are not.

**Remediation:**

1. Self-host Inter + JetBrains Mono under `public/fonts/` (or drop to `system-ui` + ui-monospace — even leaner).
2. Production CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-src 'none'`.
3. Set the same policy on `session.defaultSession` via `session.webRequest.onHeadersReceived` (or `protocol.handle`) so it applies even if `index.html` is not the document.
4. Extend `scripts/verify-production-csp.cjs` to fail on `fonts.googleapis.com` / `fonts.gstatic.com`.

**Why this is the right fix:** Local-first means no third-party origins, period. Session-level CSP is the control that survives navigation mistakes.

---

#### S-04 — High — PDF export writes plaintext financial HTML to `os.tmpdir()`

**Where:** `electron/services/pdf.service.ts` `generatePdf`.

**Why it matters here:** The DB is encrypted at rest. The PDF pipeline dumps the full schedule (pay amounts, creditors, balances) into a world-readable temp file, then `loadFile`s it. On multi-user macOS/Linux, or with local malware watching `/tmp`, this undoes column encryption for the duration of export (and on crash, until reboot).

**Remediation:** Write the temp HTML under `app.getPath('temp')` is not enough on some OS layouts. Use `app.getPath('userData')/export-scratch/` with `mode: 0o700` dir and `0o600` file, unique name, `fs.open` + write, load, **always** unlink in `finally` (already present). Optionally skip the file entirely: `loadURL('data:text/html;base64,…')` or `webContents.loadURL` with a custom `app://` protocol that serves from memory. Prefer in-memory/`userData` over `/tmp`.

**Why this is the right fix:** Export is a user-initiated disclosure to a **chosen** path. Intermediate files must have the same confidentiality as `budget-data.db`.

---

#### S-05 — Medium — Password policy is 8 characters; KEK derivation is sync PBKDF2 on the main process

**Where:** `AuthService.createMasterPassword` / `changePassword` / `resetPasswordWithRecoveryKey`; `CryptoService.deriveKey` / `hashPassword` (`pbkdf2Sync`, 310_000, SHA-512). `PasswordStrength` is UI-only and does not block weak passwords.

**Why it matters here:** The password is the KEK for every budget payload. 8 characters + no complexity is offline-crackable if `auth.config` + DB are copied. `pbkdf2Sync` blocks the Electron main thread for hundreds of ms per attempt (unlock, create, recovery) and freezes IPC.

**Remediation:** Enforce min 12 (prefer 16) in `AuthService` (single policy module, used by IPC — not only the React meter). Keep PBKDF2-SHA-512 **or** migrate to `scrypt`/`argon2id` with a version byte in `auth.config` so existing vaults still unlock. Switch to async `pbkdf2`/`scrypt` so the UI stays live. Do **not** bump iterations without a config version — you cannot re-derive without the password.

**Why this is the right fix:** Policy belongs next to the hash, not in the Login form. Async KDF is required because this process also owns SQLite and IPC.

---

#### S-06 — Medium — `auth.config` recovery hash shares the login salt; encryption key is a private field poke

**Where:** `recoveryKeyHash = hashPassword(recoveryKey, salt)` uses the **password** salt. `enableBiometric` / `changePassword` use `this.crypto['encryptionKey']`.

**Where it matters:** Same salt lets an attacker amortize PBKDF2 work across password and recovery-word attacks. Bracket access to a private Buffer is a footgun (bundlers / future TS `erasablePrivate` will break biometric).

**Remediation:** Hash recovery with `recoverySalt` (already used for wrapping the data key). Expose `getEncryptionKeyHex()` / `hasEncryptionKey()` on `CryptoService` instead of poking the field. Zero the hex string after `safeStorage.encryptString`.

**Why this is the right fix:** `recoverySalt` already exists for wrapping; the hash should use it. A real accessor is one line and removes the only private-field break-in.

---

#### S-07 — Medium — SQLite file is not encrypted; settings and IDs are plaintext; WAL not checkpointed

**Where:** `DatabaseService.initialize` (`journal_mode = WAL`), `getSettings`/`updateSettings` store JSON plaintext. Row `id`, `budget_id`, `bill_id`, timestamps are plaintext by design. `close()` does not `wal_checkpoint(TRUNCATE)`.

**Why it matters here:** Column encryption hides amounts/names. An attacker with the file still sees how many budgets/bills/debts exist, which bill a debt links to, last-used budget id, theme, auto-lock, **currency**, and can read `-wal`/`-shm` after a crash. Settings are not secrets of the same grade as incomes, but they are still user finance prefs in a file named `budget-data.db`.

**Remediation (this app, not a rewrite):**

1. Encrypt settings values with `encryptObject` (same as other tables).
2. On `close()`, `PRAGMA wal_checkpoint(TRUNCATE)` then close; chmod `0o600` on `-wal`/`-shm` if they remain.
3. Do **not** adopt SQLCipher in this cycle — native ABI + SQLCipher packaging is a product-sized migration (better-sqlite3 rebuild, Electron ABI). Document as accepted residual: ciphertext + plaintext metadata. Revisit only if the threat model includes disk seizure as primary.

**Why this is the right fix:** Settings encryption and WAL hygiene close real leaks without swapping the storage engine. SQLCipher is the correct *eventual* answer, not the Plan Agent’s first PR.

---

#### S-08 — Medium — Diagnostics and several auth channels skip the unlock guard

**Where:** `diagnostics:report|get-event|get-bundle|export` have no `withUnlockGuard`. `auth:set-auto-lock` has no guard and does not persist. `app:quit` is ungated. `app:show-open-dialog` is exposed but unused by UI.

**Why it matters here:** Diagnostics are scrubbed, but stacks + nav breadcrumbs are still available pre-login (XSS on the login page). `set-auto-lock(0)` disables the in-memory timer until next settings load. `quit` bypasses `PlatformExitGuard` (unsaved draft loss). Open-dialog is extra attack surface for no feature.

**Remediation:** `diagnostics:get-event|get-bundle|export` → `withUnlockGuard`. Keep `diagnostics:report` ungated (errors can happen on the login screen) but keep sanitization. `auth:set-auto-lock` → persist via `database.updateSettings` **or** delete the channel and use `settings:update` only (already guarded). Remove `app:show-open-dialog` from main/preload/types. Leave `app:quit` but have main no-op quit while `allowWindowClose` is false unless the sender is the confirmed-exit path (already the window-close design).

**Why this is the right fix:** Report-on-login is a product need. Read/export of logs is not. One settings write path prevents auto-lock drift.

---

#### S-09 — Medium — IPC does not bind to the app window

**Where:** Handlers ignore `event.sender` except progress + credential dialogs. PDF creates a second `webContents`.

**Why it matters here:** After S-01, this is belt-and-suspenders. If a second window is ever created (PDF, dialog host in `showTopMessageBox`), a confused-deputy call could invoke budget IPC.

**Remediation:** Central `assertAppSender(event)` in `guards.ts`: sender must be `mainWindow.webContents` (or an allowlisted id). Reject others. PDF window has no preload today — keep it that way.

**Why this is the right fix:** One window is the product. Sender checks encode that invariant in the IPC layer, which is where the data lives.

---

#### S-10 — Medium — Hardened Runtime entitlements are fully open

**Where:** `build/entitlements.mac.plist` — `allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation`.

**Why it matters here:** `package.json` sets `hardenedRuntime: true`, then entitlements undo library validation (dylib injection) and unsigned executable memory. Native modules (`better-sqlite3`, `keytar`) often need some of this; `disable-library-validation` is the dangerous one.

**Remediation:** Build a notarized test without `disable-library-validation`. If keytar/sqlite still load (Electron 42 + current ABI scripts), drop it. Keep JIT if Chromium still requires it. Document whatever remains as accepted Electron cost in this file.

**Why this is the right fix:** Guessing entitlements without a packaged run will break Mac builds. The Plan should include a dedicated `electron:build` verification step, not a blind plist edit.

---

#### S-11 — Medium — Password generator has modulo bias

**Where:** `src/utils/generatePassword.ts` — `getRandomValues()[0] % pool.length`.

**Why it matters here:** This generator is offered at setup and recovery reset for the **master password**. Bias is small but unnecessary for a crypto-adjacent helper.

**Remediation:** Rejection sampling (`while (x >= cutoff)`). Keep Web Crypto; do not use `Math.random`.

**Why this is the right fix:** Same API, correct distribution, tiny diff, existing tests.

---

#### S-12 — Medium — Dual API type surfaces will drift and hide IPC bugs

**Where:** Inline interfaces in `electron/preload.ts` **and** `src/types/electron.d.ts`. `lock()` return types already disagree (preload vs d.ts).

**Why it matters here:** The renderer compiles against `electron.d.ts`; preload is a separate TS project. Drift is how S-02 survived (LoginPage types `password?: string` on get).

**Remediation:** One `shared/electronApi.ts` (or `shared/ipc.ts`) with the `electronAPI` shape. Preload `const api: ElectronAPI = …` and `src/types/electron.d.ts` only `import type` + `Window` augment. No second `ScheduleData` / `DraftOverlayInput` in preload.

**Why this is the right fix:** Shared types already exist for domain models (`shared/types`). IPC is the remaining split brain.

---

#### S-13 — Low — Recovery key and passwords linger in React state

**Where:** `LoginPage`, `SetupPage`, `ChangePasswordModal`, `RecoveryKeyDisplay`.

**Remediation:** After success / unmount, set password fields to `''`. Recovery display should be a one-shot copy from `auth:get-pending-recovery-key` then `clearPendingRecoveryKey` (already exists). Do not keep `newRecoveryKey` in state after confirm.

---

#### S-14 — Low — `secureCompare` pads with `Buffer.from(utf8)`

**Where:** `CryptoService.secureCompare`. Hashes are hex of fixed length, so this is unused complexity. `result && a.length === b.length` after compare is fine for equal-length hashes.

**Remediation:** Compare hex with `timingSafeEqual` on `Buffer.from(a, 'hex')` after verifying both match `/^[0-9a-f]{128}$/`. Drop padding.

---

#### S-15 — Low — Dev `openDevTools()` always on

**Where:** `electron/main.ts` when `VITE_DEV_SERVER_URL`.

**Remediation:** Keep for `pnpm electron:dev`; do not ship. Confirm `app.isPackaged` already skips it (it does). No change required unless a packaged-dev hybrid is added.

---

### 3.2 Architecture — not one system

The intended architecture is clear and good:

```
Renderer (draft) → IPC overlay → BudgetManager/DB → serialize → utilityProcess worker → schedule
                                                              ↘ persist only on Save
```

The implementation still has **feature-shaped side doors**.

#### A-01 — Medium — Reconciliation / Break-Glass apply is two systems

**Where:**

- IPC `reconciliation:apply-fixes` and `breakGlassAdvisor:apply` **only validate** and persist nothing (`electron/ipc/handlers.ts`).
- Real apply is `DraftContext.applyReconciliationFixes` / `applyBreakGlassPlan` (draft assignments).
- `useScheduleMutations.handleApplyFixes` **forks**: Quick Budget calls the no-op IPC then `generateSchedule(..., preferredAssignments)`; saved budgets call draft apply.

**Why it matters here:** Same user action, two code paths, one of which is a vestigial IPC that looks like it writes. Comments even say “do not persist locks.” This is the siloed-feature pattern the app should not have.

**Remediation:** Delete both IPC channels, preload methods, e2e touchpoints, and the Quick Budget branch. One function: mutate draft assignments (and preferred seeds for the next build). Quick Budget already lives in `QuickBudgetService` via BudgetManager for income/bills; preferred assignments should go through the same overlay `schedule:build` already accepts. Tests that invoked IPC apply should assert draft state + a `schedule:build` instead.

**Why this is the right fix:** Compute is already overlay-driven. A validate-only write API is ceremony. One apply path is the draft model the rest of the app uses.

---

#### A-02 — Medium — Debts and leaves bypass BudgetManager; Quick Budget is a second product

**Where:** Income/bills/goals/skips/assignments/overrides route through `BudgetManager` (DB vs `QuickBudgetService`). Debts/leaves IPC talks to `DatabaseService` and **requires** `budgetId`. Snapshot hardcodes `debts: []`, `leaves: []` in quick mode. Pages special-case `isQuickBudget` (`DebtsPage`, `GoalsPage`, mutations).

**Why it matters here:** Quick Budget was meant as “try the scheduler without a vault.” It is actually a parallel in-memory CRUD clone that only covers some entities. Users hit dead ends (debts/leaves). Every new entity needs a third implementation (DB + QuickBudget + Draft overlay).

**Remediation (pick one; do not keep the hybrid):**

**Preferred:** Make Quick Budget a real ephemeral budget: `BudgetManager.createBudget({ ephemeral: true })` using the same `DatabaseService` against a temp file or in-memory sqlite (`:memory:` + same schema). Delete `QuickBudgetService`. All IPC goes through BudgetManager. Discard = drop the connection.

**Acceptable smaller step:** Add debts/leaves to `QuickBudgetService` **and** route debts/leaves IPC through BudgetManager like goals. Still two stores, but one IPC shape.

Do not add more `if (isQuickBudget)` in pages.

**Why this is the right fix:** The app already has encryption, migrations, and validation on `DatabaseService`. Duplicating them in RAM is how silos start. In-memory sqlite reuses the one store.

---

#### A-03 — Medium — `DraftContext.tsx` (~1,500 lines) is the god object

**Where:** One file owns snapshot load, per-domain CRUD, dirty tracking, persist, schedule generate/debounce/cache/progress, viewport, diagnostics ids. It is split into four React contexts but not four modules.

**Why it matters here:** Schedule bugs, persist bugs, and income CRUD all land in the same PR conflict zone. `generateSchedule` debounce **drops unresolved Promises** when retriggered (see E-01) because the scheduler is buried in CRUD.

**Remediation:** Mechanical extract, no behavior change first:


| Module                                   | Owns                                                  |
| ---------------------------------------- | ----------------------------------------------------- |
| `src/context/draft/draftStore.ts`        | committed/draft state, dirty domains, overlay builder |
| `src/context/draft/draftPersist.ts`      | already exists as `src/utils/draftPersist.ts` — keep  |
| `src/context/draft/useScheduleEngine.ts` | generate, cache, progress, viewport                   |
| `src/context/DraftContext.tsx`           | providers only                                        |


Keep the four context hooks (`useDraftData` etc.) so pages do not churn.

**Why this is the right fix:** The provider split already happened; the file did not. Extracting `useScheduleEngine` is the prerequisite for fixing E-01 without breaking CRUD.

---

#### A-04 — Medium — Canonical constants and formatters are copied, not shared


| Concept                            | Copies                                                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAX_PREPAY_DAYS = 14`             | `electron/services/scheduler/types.ts`, `src/utils/assignmentConstraints.ts`, comment in `shared/types`                                                                               |
| `SCHEDULE_CALCULATION_MONTHS = 12` | scheduler `types.ts`, `src/utils/scheduleViewport.ts`                                                                                                                                 |
| Currency format                    | `src/utils/formatCurrency.ts`, `electron/utils/constants.ts`, `reconciliationCopy.ts`, `goalAchievabilityMessaging.ts`, ad-hoc `$` in `DebtsPage` / `DebtCard` / chart tickFormatters |
| `PRIORITY_LABELS`                  | `src/types/index.ts`, `electron/utils/constants.ts`                                                                                                                                   |
| Settings `currency`                | Stored, Settings UI writes it, **no formatter reads it** — always `USD`                                                                                                               |


**Why it matters here:** The 14-day rule is a user-visible constraint. Two constants **will** diverge (the June audit was about this class of bug). Currency is a fake setting — architecture theater.

**Remediation:** Move `MAX_PREPAY_DAYS`, `SCHEDULE_CALCULATION_MONTHS`, `SCHEDULE_MAX_CALCULATION_MONTHS`, `PRIORITY_LABELS`, `DEFAULT_*_CASH_ON_HAND` to `shared/constants.ts`. Renderer assignment UI and electron scheduler both import that. One `formatCurrency(amount, currency)` in `shared/formatCurrency.ts` (or renderer-only if electron export must stay CJS-simple — then electron imports the same shared module; Vite already aliases `@shared`). Wire Settings `currency` into that helper **or** remove the setting. Do not keep a dead control.

**Why this is the right fix:** `shared/` is already the SSOT for types and schedule presentation. Constants belong there. A setting that does not change output is bloat.

---

#### A-05 — Low — Preload duplicates the domain model

Covered by S-12. Delete local `IncomeInput` / `ScheduleData` / `AppSettings` in `preload.ts`.

---

#### A-06 — Low — Two Electron Vite plugins

**Where:** `vite.config.ts` uses `vite-plugin-electron/simple` (main+preload) **and** `vite-plugin-electron` (worker) so the worker does not `require("./main.js")`.

**Remediation:** Keep for now; the comment is the reason. Optionally collapse later with an explicit `inlineDynamicImports` worker build. Not a Plan Phase 0 item.

---

#### A-07 — Low — `lazyCharts.tsx` is not lazy

**Where:** Static re-exports + `ChartSuspense` wrapping non-lazy children. Vite already splits `recharts` via `codeSplitting.groups`.

**Remediation:** Either `React.lazy(() => import('./SummaryCharts'))` (and the two default charts) **or** rename to `charts.tsx` and drop the fake Suspense. Prefer real `lazy` so DebtsPage does not pull Summary charts.

**Why this is the right fix:** The filename promises code-splitting the router does not actually have (pages are still eager in `App.tsx`). One or the other, not a costume.

---

#### A-08 — Low — `eslint` only lints `src/`

**Where:** `package.json` `"lint": "eslint src ..."`, `eslint.config.mjs` `files: ['src/**/*.{ts,tsx}']`.

**Remediation:** Lint `electron/**/*.ts` and `shared/**/*.ts` with node globals. Hooks plugin stays renderer-only.

**Why this is the right fix:** Main-process bugs (unguarded IPC, `any`) never fail CI today.

---

### 3.3 Efficiency, leaks, hot paths

#### E-01 — Medium — `generateSchedule` debounce leaks Promises

**Where:** `DraftContext.generateSchedule` — `clearTimeout` without resolving the previous `new Promise`.

**Why it matters here:** Schedule page, export page, and mutations all `await generateSchedule`. Rapid viewport/draft edits accumulate forever-pending Promises and `then` closures over overlay snapshots.

**Remediation:** Single-flight in `useScheduleEngine`: store `{ timer, resolve, reject }` in a ref. On retrigger, `resolve(null)` or `reject(superseded)` the previous promise, then debounce again. Align with the worker’s `superseded` error so UI already knows how to ignore it.

**Why this is the right fix:** The worker already newest-wins. The renderer debounce should too. Do not add a second cache.

---

#### E-02 — Medium — Two schedule hashes; cache key is `JSON.stringify(overlay)`

**Where:** `src/utils/scheduleCache.ts` `buildScheduleCacheKey` stringifies the full overlay. `src/utils/scheduleInputHash.ts` builds a different string for effects. Main uses SHA-256 of serialized worker input (`schedule-compute-serialize.ts`).

**Why it matters here:** Overlay stringify is O(payload) on every generate, unstable key order can miss cache, and the effect hash can disagree with the cache hash → extra 12-month worker jobs (the expensive thing in this app).

**Remediation:** One hash function in `shared/` used by renderer cache **and** (optionally) displayed debug. Worker hash can stay SHA-256 of the serialized IPC payload (that payload is the truth). Renderer should hash the same fields `serializeScheduleComputeInput` cares about, not a parallel ad-hoc join.

**Why this is the right fix:** Duplicate hashing is how “Refresh does nothing” / “stale schedule” bugs return. One definition.

---

#### E-03 — Low — Junction lookups decrypt every row

**Where:** `DatabaseService.findIncomeOverrideId` (and similar skip/assignment finders) `SELECT `* then decrypt-loop.

**Remediation:** When touching those methods, add a ciphertext-unaware index table **or** keep a per-budget in-memory map inside `BudgetManager` after first read (BudgetManager already is the session cache for “current budget”). Do not add SQL on encrypted JSON.

**Why this is the right fix:** You cannot `WHERE` inside GCM blobs. The session already has decrypted entities in RAM after snapshot load — use that.

---

#### E-04 — Low — Pages are eager; recharts chunk exists but routes do not lazy-load

**Where:** `src/App.tsx` static-imports every page. Dashboard/Debts/Summary pull charts.

**Remediation:** `React.lazy` per route. Combine with A-07. Optional; not security.

---

#### E-05 — Note (no leak found) — Event listeners

`Layout` activity ping, `ThemeContext` media query, `DraftContext` `schedule.onProgress`, `onCloseRequested`, `onLocked` all unsubscribe. PDF window is `destroy`ed. `ScheduleComputeHost.dispose` exists. **Do not** “fix” these.

Remaining memory issue is **retention**, not listener leaks: `scheduleCacheRef` + `fullScheduleRef` hold a full horizon schedule until budget switch. That is intended. Clear on lock (already: `isUnlocked` effect nulls schedule).

---

### 3.4 Bloat & dependency hygiene

#### B-01 — Medium — Dual lockfiles

**Where:** `package.json` `"packageManager": "pnpm@9.15.9"` + `pnpm-lock.yaml` + committed `package-lock.json` (npm tree, stale versions e.g. concurrently 8 vs 10).

**Why it matters here:** `pnpm install --frozen-lockfile` in CI is correct; a contributor running `npm i` produces a different tree (and can reintroduce advisories pnpm overrides patched). Dependabot `package-ecosystem: npm` may confuse the two.

**Remediation:** Delete `package-lock.json`. Add `package-lock.json` to `.gitignore`. README already-should say pnpm only (confirm `README.md` / `CONTRIBUTING.md`).

**Why this is the right fix:** One package manager is a security control, not style.

---

#### B-02 — Medium — Unused and mis-classified packages


| Package                                                   | Issue                                                                                                                                                                 |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `concurrently`, `wait-on`                                 | In `package.json` scripts: **zero references**. Dead.                                                                                                                 |
| `exceljs`                                                 | Used at runtime by `spreadsheet.service.ts`, listed as **devDependency**. Bundled by Vite today so the packaged app works; `pnpm audit --prod` does **not** cover it. |
| `clsx`                                                    | Used widely — keep.                                                                                                                                                   |
| Inline BIP-39 wordlist (~2k words in `crypto.service.ts`) | Fine vs adding `bip39` (extra dep). Keep inline **or** move to `electron/data/bip39-en.ts`. Do not add a wallet library.                                              |


**Remediation:** Remove `concurrently` and `wait-on`. Move `exceljs` to `dependencies` (or `optionalDependencies` if you ever drop xlsx). Re-run `pnpm audit --prod`.

**Why this is the right fix:** Prod audit is the gate you already trust. It must see what ships in `dist-electron`.

---

#### B-03 — Low — Ignored advisories (accepted, track)

`scripts/audit-dev.cjs`:

- `GHSA-mh99-v99m-4gvg` (brace-expansion / minimatch via electron-builder) — no patched 1.x/2.x.
- `GHSA-qwww-vcr4-c8h2` (react-router RSC CSRF) — this app is HashRouter + Electron, not RSC.

Keep ignores. Revisit when electron-builder or react-router-dom major lands. Do not “upgrade RR to 8” inside a security PR unless that major is already planned.

---

#### B-04 — Low — Repo clutter (not product)

Untracked `AUDIT_REPORT.docx`, `cov_output.txt`. Do not commit. Add `cov_output.txt` / `*.docx` to gitignore if they keep reappearing.

---

## 4. Coding paradigms — verdict


| Pattern                                               | Status                                                   |
| ----------------------------------------------------- | -------------------------------------------------------- |
| Local-first, main owns secrets, renderer owns UX      | Intended; violated by S-02                               |
| Draft overlay until Save                              | Intended; violated by A-01 dual apply and A-02 debts IPC |
| Shared types, electron compute, renderer presentation | Mostly; constants/formatters not shared (A-04)           |
| Worker quarantine (no DB/fs)                          | Honored                                                  |
| Guarded IPC + validation at persistence               | Honored for CRUD; not for diagnostics/auto-lock          |
| One package manager, one lockfile                     | Violated (B-01)                                          |


No additional framework, state library, or SQLCipher project should be started to “clean this up.” The Plan is subtractive: delete channels, share constants, stop copying passwords, finish Electron window policy.

---

## 5. Resolution — Plan Agent seed

Attach this file. Use the §6 prompt only. Execute §5 in order. Do not start Phase 2 while Phase 0 is open. Each phase is one PR unless noted.

### Goal

Close High security gaps, make credentials and schedule-apply a single path, then remove duplication so the app is one system: **one window policy, one secret owner (main), one apply path (draft overlay), one constant module, one lockfile**.

### Constraints

- Do not introduce SQLCipher, Redux, a new scheduler, or an LP solver.
- Do not expand Quick Budget features until A-02 is chosen and implemented.
- Do not re-open June 2026 closed items (debug telemetry, HTML XSS escape, export path allowlist, worker isolation) except where this report names a remaining hole.
- Keep contextIsolation + sandbox + parameterized SQL + GCM payloads.
- Match existing conventional commits (`fix:`, `refactor:`, `chore:`).
- After each phase: `pnpm typecheck && pnpm typecheck:electron && pnpm lint && pnpm test:run` (and `pnpm verify:csp` if CSP/fonts change).

### Phase 0 — Electron window lock + CSP + temp files (S-01, S-03, S-04)

**PR title:** `fix: lock navigation, self-host fonts, keep PDF HTML out of /tmp`

1. `electron/main.ts` `createWindow`:
  - `webContents.setWindowOpenHandler(() => ({ action: 'deny' }))`
  - `will-navigate` / `will-redirect`: `event.preventDefault()` unless URL is the dev server or a `file:` URL under the app `dist` directory.
  - `session.setPermissionRequestHandler((_, __, cb) => cb(false))`
  - Tests: extend `tests/unit` around a small helper `isAllowedNavigation(url, { devServerUrl, distDir, packaged })` so the policy is unit-tested without booting Electron.
2. Self-host fonts **or** system fonts. Remove Google `<link>`s from `index.html`. Tighten `PRODUCTION_CSP` in `vite.config.ts`. Add `session.webRequest.onHeadersReceived` CSP on the app session. Update `scripts/verify-production-csp.cjs` to reject googleapis/gstatic and to require `object-src 'none'`.
3. `pdf.service.ts`: stop using `os.tmpdir()`. UserData scratch dir `0o700` + file `0o600`, or in-memory load. Keep `javascript: false` and apply the same navigation deny to that window.
4. Add/adjust unit tests for export path + PDF cleanup (`existsSync` false after success and after throw).

**Done when:** Packaged CSP has no third-party hosts; navigation helper tests cover `https://evil.example` deny; PDF temp is not under `/tmp`.

### Phase 1 — Credentials never enter the renderer (S-02, S-08 partial, S-09, S-12, S-13)

**PR title:** `fix: unlock from keychain in main; single electronAPI types`

1. Implement `auth:unlock-with-saved-credentials` in `AuthService` + handlers. Main: `credentials.getPassword()` → `unlock(password)` → zero local string. Return `{ success }` only.
2. After create/change/reset **in the handler**, call `credentials.offerSave` with the password main already has. Remove renderer `offerSave(password)` calls from `SetupPage` / `LoginPage`.
3. Delete `credentials:get|save|offerSave` from handlers, preload, mocks, e2e helpers. Login UI: button “Unlock with saved password” when `credentials.has()` is true.
4. `LoginPage`/`SetupPage`: clear password state on success and unmount.
5. `diagnostics:get-event|get-bundle|export` → `withUnlockGuard`. Remove `app:show-open-dialog`. Either delete `auth:set-auto-lock` or make it persist through `settings:update` only (remove duplicate channel).
6. `assertAppSender` in `guards.ts`; wrap budget/auth-mutating handlers.
7. Collapse preload inline types into `shared` IPC types (S-12). Preload must typecheck against that interface (`satisfies ElectronAPI`).

**Done when:** Grep has no `credentials.get` / `offerSave(` in `src/`. Login e2e still unlocks (typed password + biometric). New unit tests: locked `credentials:get` gone; unlock-with-saved does not return a password field.

### Phase 2 — One apply path, one budget store (A-01, A-02)

**PR title:** `refactor: draft-only reconciliation apply; debts/leaves through BudgetManager`

1. Delete IPC `reconciliation:apply-fixes` and `breakGlassAdvisor:apply` (handlers, preload, `electron.d.ts`, `touchpoint-inventory.json`, handler tests).
2. `useScheduleMutations`: remove `isQuickBudget` apply fork; always `applyReconciliationFixes` / `applyBreakGlassPlan` on draft then `generateSchedule({ force: true })`.
3. **A-02 preferred:** ephemeral sqlite for Quick Budget; delete `quick-budget.service.ts`. All debt/leave/goal methods on BudgetManager. Snapshot no longer special-cases empty debts.
  - If ephemeral sqlite is too large for one PR, split: PR 2a delete apply IPC; PR 2b BudgetManager owns debts/leaves + QuickBudgetService gains debts/leaves (interim). Do not ship 2a without a follow-up ticket for 2b.

**Done when:** One apply implementation; `rg "applyFixes|breakGlassAdvisor:apply" electron src` is empty; Quick Budget either uses the same service as saved budgets or is explicitly documented as interim with debts/leaves routed identically.

### Phase 3 — Harmony + efficiency (A-03, A-04, A-07, A-08, E-01, E-02, S-05, S-06, S-07, S-11)

**PR title:** `refactor: shared constants, schedule engine module, one currency formatter`
If too large for one PR, split: 3a extract + hash + constants; 3b lazy/eslint + S-05/S-06/S-07/S-11.

1. Extract `useScheduleEngine` from `DraftContext` (A-03). Debounce single-flight (E-01) is already in DraftContext working tree — keep it through the extract; do not reimplement.
2. `shared/constants.ts` + single `formatCurrency` (A-04). Wire or remove Settings currency.
3. One renderer schedule hash (E-02): `shared/scheduleIdentity.ts` already exists uncommitted — land it; do not add a second hash. Confirm cache keys are not `JSON.stringify(overlay)`.
4. Real `React.lazy` charts/routes or delete `lazyCharts` costume (A-07). Optional route lazy in same PR if types stay clean.
5. ESLint `electron` + `shared` (A-08).
6. Password min length 12 in `AuthService`; async KDF (S-05). Recovery hash uses `recoverySalt` (S-06). `CryptoService` key accessor (S-06). Encrypt settings blobs; WAL checkpoint on close (S-07). Rejection sampling in `generatePassword` (S-11).

**Done when:** `MAX_PREPAY_DAYS` has a single definition; `generateSchedule` tests include “rapid retrigger resolves prior promise”; settings round-trip encrypted in `database.service` tests.

### Phase 4 — Hygiene (B-01, B-02, S-10)

**PR title:** `chore: pnpm-only lockfile, drop unused deps, reclassify exceljs`

1. Delete `package-lock.json`; gitignore it.
2. Remove `concurrently`, `wait-on`. Move `exceljs` to `dependencies`. `pnpm install` and commit `pnpm-lock.yaml`.
3. Mac entitlements: packaged smoke without `disable-library-validation`; drop if native modules load (S-10). If not, comment in plist + this report as accepted.

**Done when:** Repo has one lockfile; `pnpm audit --prod` still includes exceljs; `rg concurrently` only in lockfile history.

### Test plan (all phases)

- Unit: IPC guards (locked vs unlocked), navigation allowlist, crypto compare, overlay validation, schedule debounce, BudgetManager debts in both modes.
- Component: Login Keychain button does not put a password in a textbox from IPC; unlock still works with typed password.
- E2E: auth.spec, schedule accept-reconciliation, export PDF/HTML/xlsx, lock/quit unsaved guard.
- `pnpm audit:dev` green. `pnpm verify:csp` green.

### Out of scope (explicit)

- LP/constraint solver (June A-08 / 5.4 won’t-do).
- Replacing better-sqlite3 with SQLCipher in this plan.
- Rewriting the heuristic scheduler.
- React Router 8 migration (deferred GHSA).
- Collapsing the dual Vite Electron plugins (A-06).

---

## 6. Suggested Plan Agent prompt (verbatim)

```
You are planning implementation for Budget Optimizer v3.0.0 from AUDIT_REPORT.md (2026-08-18).

Treat §5 Resolution as the spec. Phase 0 first, then 1, 2, 3, 4. Do not skip High findings.

Product invariants: local-first Electron finance app; main owns secrets and SQLite; renderer owns draft UX; schedule compute stays in utilityProcess; no new frameworks; no SQLCipher in this effort.

Deliver a plan with: ordered PRs matching phases 0–4, exact files to touch, tests to add, and grep-based done-when checks from the report. Call out anything in the report that is now stale vs the current working tree (including uncommitted changes).
```

