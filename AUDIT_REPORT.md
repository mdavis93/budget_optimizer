# Budget Optimizer — Security, Architecture & Efficiency Audit

**App version:** 3.0.0  
**Audit date:** 2026-08-24  
**Scope:** Full working tree — `src/`, `electron/`, `shared/`, `scripts/`, CI, lockfile, production + full-tree dependency advisories, including uncommitted SQLCipher work  
**Method:** Static review of Electron hardening, IPC/auth/crypto/DB, renderer data flow, schedule pipeline, duplication, hot paths, and package hygiene  
**Threat model:** Local-first desktop finance app. Primary adversaries are (1) malicious or compromised renderer content (XSS, dependency, navigation), (2) other OS users / malware reading disk and leftover files, (3) offline brute-force of stolen `userData`. There is no network backend.

**Supersedes:** The 2026-08-18 audit (verified 2026-08-23). Closed items from that cycle are **not re-litigated** below except where the current tree reopened them or left a residual.

**Implementation status of prior plan:** §5 Phases 0–4 of the 2026-08-18 report are in tree (navigation lock, session CSP, credentials stay in main, draft-only apply, BudgetManager ephemeral Quick Budget, shared constants/currency, `useScheduleEngine`, pnpm-only, `exceljs` as a prod dep). SQLCipher file encryption is **present but not finish-quality** (S-16, S-18).

---

## 1. Executive summary

Budget Optimizer is a capable local-first Electron 42 finance app with a **sound core**: context isolation, sandbox, parameterized SQL, AES-256-GCM payload encryption, unlock-gated IPC for budget data, schedule compute isolated in a `utilityProcess`, and a coherent draft/commit model.

**This audit’s verdict:** the product is **one system**, not a pile of feature silos. The remaining work is **hygiene on the new SQLCipher layer**, **IPC sender/quit invariants**, and **docs drift** — not a second architecture.

**Overall posture:** **B+** for a private desktop finance app (was A- on 2026-08-23). The grade drops because file-level encryption can still leave plaintext siblings on disk, the SQLCipher key is handled as a JS string, and `app:quit` can skip the unsaved-changes guard.


| Domain                      | Grade   | One-line                                                                                          |
| --------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| Electron / IPC security     | **B+**  | Isolation + sender checks on data IPC; `app:quit` and a few probes skip `assertAppSender`         |
| Crypto / at-rest data       | **B+**  | SQLCipher + column GCM is the right stack; key/backup hygiene is unfinished                       |
| Auth / lock                 | **A-**  | Unlock gates, keychain in main, min 12; recovery hash still has legacy salt fallback              |
| Architecture / harmony      | **B+**  | One apply path and one worker engine; main still constructs an unused `SchedulerService`, viewport is applied twice |
| Efficiency / leaks          | **A-**  | Worker + debounce single-flight + junction maps + lazy routes/charts; toast/settings timers are uncleared |
| Bloat / duplication         | **A-**  | Shared constants/formatters; BIP39 list and dual Vite plugins remain by choice                    |
| Dependencies / supply chain | **B+**  | One lockfile; exceljs is a prod dep and asar-excluded because Vite bundles it; two ignored GHSAs  |


| Severity                        | Count | IDs                                      |
| ------------------------------- | ----- | ---------------------------------------- |
| High (open)                     | 0     | —                                        |
| Medium (open)                   | 3     | S-16, S-17, S-18                         |
| Low (open)                      | 9     | S-19, S-20, S-21, S-22, S-23, A-09, A-10, A-11, E-06 |
| Low (accepted / deferred)       | 7     | S-06 residual, S-10, S-15, S-24, A-06, B-03, E-05 |
| Docs drift                      | 1     | D-01                                     |


No critical remote RCE or SQL injection was found. No production debug telemetry remains.

---

## 2. What is already solid — do not re-litigate

Keep these. Remediations below layer on them; they do not replace them.

- Renderer: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, preload via `contextBridge` (`electron/main.ts`, `electron/preload.ts`).
- Navigation lock: `will-navigate` / `will-redirect` / `setWindowOpenHandler(deny)` / permission deny (`electron/utils/navigationLock.ts`, `electron/utils/isAllowedNavigation.ts`).
- Production CSP is session-level and has no third-party hosts (`shared/productionCsp.ts`).
- Data IPC is wrapped in `withBudgetGuard` / `withUnlockGuard` (`electron/ipc/guards.ts`).
- SQLite uses `prepare`/`run` with bound parameters. Payload columns are AES-256-GCM. Settings blobs are encrypted. WAL is checkpointed on `close()`.
- Unlock clears the key (`CryptoService.clearKey` zero-fills the Buffer) and `applyLockSideEffects` closes DB + clears export-path allowlist + ends Quick Budget.
- Keychain unlock (`auth:unlock-with-saved-credentials`) never returns the password to the renderer.
- Export writes require a prior native save-dialog path, TTL, home-directory prefix (`electron/utils/exportPaths.ts`). Residual: no `realpath` (S-21).
- HTML export escapes user strings. PDF window has `javascript: false`, sandbox, and navigation lock; scratch HTML lives under `userData` at `0o700`/`0o600`.
- Schedule work is off-main in `utilityProcess` with newest-wins, timeout, and no DB/keytar in the worker.
- Draft overlay is validated (`validateDraftOverlay`) before compute.
- Quick Budget is ephemeral sqlite through `BudgetManager`, not a second CRUD clone.
- Apply (reconciliation / break-glass) is draft-only.
- Constants and `formatCurrency` live in `shared/`; Settings currency is wired (`AuthContext` + Settings page).
- Diagnostics scrub secrets/paths/money; read/export is unlock-gated.
- Password min length is 12 in `AuthService` (async PBKDF2-SHA-512, 310k). Generator uses rejection sampling.
- Junction lookups use in-memory maps after first decrypt (`skipCache` / `assignmentCache` / override map).
- Layout activity ping, theme media query, schedule progress, close-requested, and locked listeners unsubscribe.
- Routes and charts are `React.lazy`. ESLint covers `src`, `electron`, `shared`.
- CI: typecheck (renderer + electron), lint, coverage, CSP verify, `pnpm audit --prod --audit-level critical`, `pnpm audit:dev`.
- One package manager: pnpm + `pnpm-lock.yaml`. `exceljs` is a production dependency; packaged asar is verified **not** to contain `node_modules/exceljs` because main bundles it.

---

## 3. Architecture — one system (verdict)

Intended data flow (honored):

```
Renderer (draft overlay)
  → guarded IPC
    → BudgetManager (named sqlite XOR ephemeral Quick Budget sqlite)
      → DatabaseService (SQLCipher file + GCM columns)
    → serialize → utilityProcess worker → schedule (ephemeral; persist only on Save)
```

**This is the architecture. Do not add another store, another apply channel, or another scheduler.**

What looks like “two systems” and is **not**:

| Pair                                         | Why it is one system                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| SQLCipher file + AES-GCM columns             | Defense in depth. Same KEK. File layer hides schema/WAL; GCM still holds if cipher pragmas are wrong. **Keep both.** |
| `src/types/index.ts` re-exporting `shared/`  | Compile-time facade, not a second model.                                             |
| `src/utils/formatCurrency.ts` wrapping shared | Default-currency holder for the renderer. One formatter.                             |
| `electron/utils/constants.ts` re-exporting shared | Thin CJS-friendly re-export. Do not fork values.                                   |
| Dual Vite Electron plugins                   | Worker must not `require("./main.js")`. Accepted (A-06).                             |

What **is** leftover bulk / cross-wiring (not a second product):

- `src/context/DraftContext.tsx` (~1143 lines) still owns all draft CRUD after `useScheduleEngine` was extracted (A-09).
- Viewport is sliced in the worker **and** again in the renderer (A-10).
- `electron/main.ts` still constructs `SchedulerService` for the Services bag; IPC never calls `services.scheduler` (A-11). Real compute is `new SchedulerService()` inside the worker.
- `SummaryPage` keeps a local `scheduleData` copy instead of `useSchedule()` (A-12; fold into A-10 if touching schedule UI).

---

## 4. Findings

Each item: **why it matters in this app**, then **the remediation that is correct here**.

### 4.1 Security

#### S-16 — Medium — SQLCipher key is a JS string in a PRAGMA; derived Buffer is never zeroed

**Where:**

- `electron/services/crypto.service.ts` `deriveSqlCipherRawKey()` / `sqlCipherKeyPragma()`
- `electron/utils/sqlcipher.ts` `applySqlCipherKey()`: `db.pragma(\`key = "${crypto.sqlCipherKeyPragma()}"\`)`

**Why it matters here:** The GCM data key is a Buffer that `clearKey()` wipes. The SQLCipher key is HKDF of that key, converted to a hex string (`x'…'`), interpolated into SQL, and left for V8 GC. A finance app that already treats the KEK as wipeable memory should not promote the file key to an immortal string. Empty HKDF salt (`Buffer.alloc(0)`) also skips domain-separation hygiene (IKM is already high-entropy; this is not a brute-force issue, it is key-separation).

String interpolation is not injection today (hex-only), but it is the wrong API: any future format change (passphrase key, quotes) becomes a SQL footgun.

**Remediation:**

1. Derive the SQLCipher key into a `Buffer` (32 bytes).
2. Apply it with the better-sqlite3-multiple-ciphers **Buffer key API** if present (`db.key(buf)` or equivalent); otherwise `pragma` with a validated `/^x'[0-9a-f]{64}'$/` string built in a `try/finally` that `buf.fill(0)`.
3. HKDF salt: use a **fixed public** salt, e.g. `Buffer.from('budget-optimizer-sqlcipher-hkdf-v1')`. Do not use empty salt. Do not use the PBKDF2 salt (that would couple file key to auth salt rotation).
4. Do not cache the hex pragma string on `CryptoService`.
5. Unit test: after `applySqlCipherKey`, the raw key Buffer passed in is zeroed; opening with a wrong key fails `sqlite_master` probe.

**Why this is the right fix:** File encryption is for stolen `userData`. The password already unlocks both layers. The gap is **process-memory and API safety**, which this app already solved for GCM. Match that bar. Do not introduce a second KEK.

---

#### S-17 — Medium — `app:quit` skips sender check and the unsaved-changes guard

**Where:** `electron/main.ts` `ipcMain.handle('app:quit', () => { shutdownApp(); })`. `shutdownApp()` sets `allowWindowClose = true` and quits.

**Why it matters here:** The product’s close path is: window `close` / Cmd+Q → `app:close-requested` → `PlatformExitGuard` (Save / Discard / Cancel) → then `app:quit`. A compromised renderer (or any unexpected `webContents`) can invoke `app:quit` and **discard the draft without a prompt**. That undoes the draft model and the sender invariant used everywhere else.

**Remediation:**

```ts
ipcMain.handle('app:quit', (event) => {
  const senderError = assertAppSender(event);
  if (senderError) return senderError;
  if (!allowWindowClose) {
    mainWindow?.webContents.send('app:close-requested');
    return { success: true };
  }
  shutdownApp();
  return { success: true };
});
```

Wire `assertAppSender` / `setMainWindowGetter` for this handler (today it lives outside `registerIpcHandlers`). Apply the same sender check to `app:show-save-dialog` (it **approves** export paths).

**Why this is the right fix:** One window, one close protocol. Quit must be the *end* of that protocol, not a bypass. This is the same invariant S-08/S-09 already encoded for budget IPC.

---

#### S-18 — Medium — “Successful” SQLCipher migrate can leave plaintext siblings on disk

**Where:** `electron/utils/sqlcipher.ts` `migratePlaintextToSqlCipher`. After verify + rename, `unlinkSync` of `${dbPath}.replaced-plaintext` and `${dbPath}.pre-sqlcipher` is best-effort `warn` only; the function still returns `{ migrated: true }`. `DatabaseService.initialize` then opens the encrypted file and proceeds.

**Why it matters here:** Column GCM never hid schema/IDs; SQLCipher was added specifically so a copied `budget-data.db` is unreadable. A leftover `.pre-sqlcipher` / `.replaced-plaintext` (plus `-wal`/`-shm` if unlink of sidecars failed earlier) is the **old plaintext vault sitting next to the new one**, mode `0o600` in `userData`. Other OS users and local malware are the threat SQLCipher was meant to address. Logging a warning does not restore the product claim.

**Remediation:**

1. After encrypted verify of the live path: if either plaintext sibling still exists, **fail the migrate** (treat as not migrated). Restore from backup if needed so the user can retry. Do **not** return `migrated: true`.
2. On every `initialize()`: if the live file is encrypted **and** `${dbPath}.pre-sqlcipher` or `${dbPath}.replaced-plaintext` exists, attempt unlink; if unlink fails, **do not open** — throw a user-facing error (“Could not remove an unencrypted backup of your budget file”).
3. Keep `0o600` / dir `0o700`. Keep the copy/verify/rename sequence (do not encrypt in place).
4. Tests: inject unlink failure; assert `migrated === false` or initialize throws; assert no silent success with plaintext siblings.

**Why this is the right fix:** Encryption that leaves a plaintext copy is worse than no file encryption (false confidence). Fail closed. The app already refuses to open if migrate fails; extend that to leftover files.

`dest.exec(object.sql)` while copying `sqlite_master` is acceptable here: the source is the user’s own vault, already readable to anyone who can plant malicious schema. Do not spend a phase on a backup-API rewrite unless migrate tests are already being touched — then prefer `better-sqlite3` backup / `VACUUM INTO` only if it stays SQLCipher-keyed on the dest.

---

#### S-19 — Low — Ungated IPC: save-dialog, activity ping, unlock probes

**Where:** `electron/main.ts` `app:show-save-dialog`, `app:get-platform`, `app:check-biometric-available`; `electron/ipc/handlers.ts` `auth:activity-ping`, `auth:is-unlocked`, `auth:is-first-time-setup`, `credentials:has`, `diagnostics:report`.

**Why it matters here:** Save-dialog **allowlists export paths**. Activity ping **resets auto-lock**. Unlock probes and `credentials:has` are login-page necessities. `diagnostics:report` must work on the login screen (already scrubbed).

**Remediation:** `assertAppSender` on `app:show-save-dialog` and `auth:activity-ping`. Leave login probes and `diagnostics:report` ungated **except** sender check (cheap, matches S-09). Do not put unlock guards on `credentials:has` or `auth:is-first-time-setup`.

**Why this is the right fix:** Sender binding is the invariant for a single-window app. Lock/login channels stay reachable from the app window only.

---

#### S-20 — Low — IPC returns raw `Error.message` to the renderer

**Where:** `electron/ipc/guards.ts` `ipcData` / `ipcVoid` use `getErrorMessage`, not `getSafeErrorMessage`. `getSafeErrorMessage` only special-cases `ValidationError`, then falls through to the same raw message — so sqlite/fs errors (`SQLITE_…`, absolute paths under `userData`) can reach React.

**Why it matters here:** The renderer is the XSS domain. Paths and engine errors are useful to an attacker mapping `userData`. Diagnostics already store the real stack in main.

**Remediation:** Renderer-facing `error` string: `ValidationError` → `Invalid ${field}`; everything else → a **fixed map** (`Not found`, `Validation failed`, `Could not write file`, `Schedule failed`, `Database error`). Log the real `error.message` in main only. Export handlers in `handlers.ts` that `return { error: getErrorMessage(error) }` must use the same map.

**Why this is the right fix:** Users do not need sqlite internals. Operators have diagnostics export (unlock-gated). Do not build a telemetry backend.

---

#### S-21 — Low — Export allowlist uses `path.resolve`, not `fs.realpathSync`

**Where:** `electron/utils/exportPaths.ts` `validateExportPath` / `approveExportPath`.

**Why it matters here:** Native save-dialog is the intended disclosure. `path.resolve` does not follow a symlink. If the chosen path under `$HOME` is a symlink to `/tmp` (or another user’s tree), `writeFile` follows it after a successful allowlist check. This needs a planted symlink **and** the user picking that path — not remote RCE, but it is the remaining hole in a control this app already treats as security-critical.

**Remediation:** After dialog return, `fs.realpathSync` (or `realpathSync.native`) both the chosen path (if it exists) and `app.getPath('home')`. Approve and later validate the **real** path. If the target does not exist yet, realpath the parent directory and join the basename. Reject if the real path is outside home. Add a unit test with a temp symlink.

**Why this is the right fix:** The dialog is already the trust boundary. Realpath makes the home-prefix check match what the kernel will write. Do not add a second allowlist.

---

#### S-22 — Low — README documents an 8-character password; AuthService enforces 12

**Where:** `README.md` “minimum 8 characters”. `AuthService` `MIN_PASSWORD_LENGTH = 12`. Setup/Login/Change-password UI already say 12.

**Remediation:** README + any remaining “8 characters” copy → 12. One number, the one `AuthService` uses.

**Why this is the right fix:** Docs that understate policy train users to pick passwords the app will reject — or, worse, future UI refactors that copy README.

---

#### S-23 — Low — HTML export writes without `mode: 0o600`

**Where:** `electron/services/pdf.service.ts` `generateHtmlFile` — `fs.writeFileSync(htmlPath, html)` with no mode. PDF scratch already uses `0o600`.

**Remediation:** `writeFileSync(htmlPath, html, { mode: 0o600 })` (and the final PDF buffer write if it lacks mode). Same confidentiality as scratch HTML.

**Why this is the right fix:** Export is user-chosen disclosure; the file on disk should not be world-readable under a loose umask. Match the PDF scratch policy.

---

#### S-24 — Low (accepted) — Lock parks a dirty draft in renderer RAM

**Where:** `src/context/DraftContext.tsx` `parkedDraftRef` — documented: lock is not a memory wipe.

**Keep.** Product requirement: unsaved simulation survives Lock App. Screen hides data; process memory still holds the overlay until unlock or quit. Encrypting parked state in main would be a new protocol — out of scope unless product changes lock semantics. XSS on an unlocked session already has live draft; parked state matters after lock + XSS on the login page (CSP + nav lock make that hard).

---

#### S-06 residual — Low (accepted) — Recovery hash may still use the login salt

**Where:** `AuthService.recoveryKeyHashMatches` tries `recoverySalt` then `config.salt`.

**Keep:** Legacy vaults that hashed recovery with the password salt must still unlock. New writes already use `recoverySalt`. Do not remove the fallback until a migrate writes a version flag and re-hashes on next successful recovery.

---

#### S-10 residual — Low (accepted) — `allow-unsigned-executable-memory` remains

**Where:** `build/entitlements.mac.plist`. `disable-library-validation` was already dropped after a packaged smoke.

**Keep:** Chromium/Electron JIT cost. Do not re-open without another notarized run.

---

#### S-15 residual — Low (accepted) — DevTools when unpackaged

**Where:** `electron/main.ts` `openDevTools()` under `VITE_DEV_SERVER_URL && !app.isPackaged`.

**Keep:** Dev-only. Packaged builds skip it.

---

### 4.2 Architecture / bulk

#### A-09 — Low — `DraftContext.tsx` is still a CRUD god file

**Where:** `src/context/DraftContext.tsx` (~1143 lines) after `useScheduleEngine` extract.

**Why it matters here:** Schedule bugs no longer land here; income/bill/debt/goal/leave/skip/assignment CRUD still does. PR conflict zone remains.

**Remediation:** Mechanical extract only, **no behavior change**: `draftStore` (state + overlay builder) and `draftMutations` (per-domain CRUD) beside existing `useScheduleEngine` and `draftPersist`. Keep the four context hooks so pages do not churn.

**Why this is the right fix:** The provider split already happened; the file did not finish shrinking. Do not add Redux.

---

#### A-10 — Low — Viewport is applied in the worker and again in the renderer

**Where:**

- Worker: `electron/services/schedule-compute-run.ts` → `SchedulerService.applyViewportFilter`
- Renderer: `src/context/draft/useScheduleEngine.ts` `applyScheduleResult` → `applyScheduleViewport`

**Why it matters here:** The worker already returns `fullPaychecks` plus a viewported slice; the renderer rebuilds canonical + slices again. Two copies of filter logic **will** drift (this class of bug is why `shared/` exists). Extra serialize cost on every build.

**Remediation:** Worker returns the **full horizon only** (`fullPaychecks` / unfiltered paychecks). Renderer owns `applyScheduleViewport` (already in `src/utils/scheduleViewport.ts` using `shared/scheduleViewportSlice.ts`). Delete the worker-side filter call. Keep `SchedulerService.applyViewportFilter` only if tests still need it as a wrapper around the shared helper — one implementation.

**Why this is the right fix:** Viewport is a **presentation** concern (3 vs 12 months). Compute should be identity-stable for cache/coalesce hashes. One filter, on the side that already re-slices when the user changes months without a rebuild.

---

#### A-11 — Low — Main process holds a dead `SchedulerService`

**Where:** `electron/main.ts` `scheduler: new SchedulerService()`; `handlers.ts` Services type includes `scheduler`; **zero** `services.scheduler` call sites. Worker does `new SchedulerService()` in `schedule-compute-run.ts`. Tests already assert IPC does not call the main instance.

**Remediation:** Remove `scheduler` from the main Services bag and `main.ts` construction. Keep the class for the worker and unit tests. Do not “use the main instance” — that would pull compute back onto the UI process.

**Why this is the right fix:** A constructed unused engine looks like a second scheduler. Deleting the instance encodes the one-engine rule.

---

#### A-12 — Low — `SummaryPage` copies schedule into local state

**Where:** `src/pages/SummaryPage.tsx` `scheduleData` + its own `generateSchedule` effect.

**Remediation:** Read `useSchedule().schedule` (and loading/error). Delete the shadow state. Same for Goals if it still calls `goals:get-projections` when `schedule.goalProjections` is already on the cached build **and** the identity hash matches.

**Why this is the right fix:** One schedule in context is the cache. A page-local copy is how Summary and Schedule disagree after a draft edit.

---

#### A-06 — Low (accepted) — Two Electron Vite plugins

**Where:** `vite.config.ts` `vite-plugin-electron/simple` (main+preload) **and** `vite-plugin-electron` (worker) so the worker does not `require("./main.js")`.

**Keep.** Collapse later only with an explicit `inlineDynamicImports` worker build.

---

### 4.3 Efficiency, leaks

#### E-05 — Note (accepted) — Schedule cache retention

`useScheduleEngine` debounce resolves the prior Promise on retrigger. Progress/lock/close listeners unsubscribe. PDF window is destroyed. Worker host disposes. **Do not “fix” listeners.**

`scheduleCacheRef` + `fullScheduleRef` hold a horizon until budget switch / lock. That is intended. Clear on lock already.

Dual encrypt (SQLCipher + GCM) is extra CPU by design. Keep both. Do not add a third cache.

#### E-06 — Low — Uncleared `setTimeout` in Toast / Settings / RecoveryKeyDisplay

**Where:**

- `src/components/Toast.tsx` dismiss timer — no `clearTimeout` on unmount; can `setToasts` after unmount
- `src/pages/SettingsPage.tsx` status-clear timers (multiple)
- `src/components/RecoveryKeyDisplay.tsx` copied-flag timer

**Remediation:** Store timer ids in a ref (or per-toast map); `clearTimeout` in the effect cleanup / dismiss path. Trivial; do with A-12 or a small `fix:` commit.

**Why this is the right fix:** These are real post-unmount setState risks on Settings navigation, not the schedule-cache retention already accepted as E-05.

---

### 4.4 Bloat, docs, supply chain

#### B-03 — Low (accepted) — Ignored advisories

`scripts/audit-dev.cjs`:

- `GHSA-mh99-v99m-4gvg` (brace-expansion / minimatch via electron-builder) — no patched 1.x/2.x.
- `GHSA-qwww-vcr4-c8h2` (react-router RSC CSRF) — HashRouter + Electron, not RSC.

Revisit on electron-builder / react-router-dom major. Do not “upgrade RR to 8” inside a security PR.

Inline BIP-39 wordlist in `crypto.service.ts`: keep. Do not add a wallet library.

`exceljs`: production dependency, Vite-bundled into main, asar-excluded, `verify-packaged-app.cjs` forbids `node_modules/exceljs` and `require('exceljs')` in packaged main. Keep that triangle intact.

#### D-01 — Low — CONTRIBUTING claims the audit backlog is empty

**Where:** `CONTRIBUTING.md` “Post-Audit Backlog — Status: Empty”.

**Remediation:** Point at this file. List open IDs: S-16–S-23, A-09–A-12, E-06, D-01.

**Why this is the right fix:** Contributors will otherwise treat leftovers as “done, archival.”

---

## 5. Coding paradigms — verdict

| Pattern                                               | Status                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------------------- |
| Local-first, main owns secrets, renderer owns UX      | Honored (typed password still crosses IPC once; keychain path does not) |
| Draft overlay until Save                              | Honored                                                                |
| Shared types, electron compute, renderer presentation | Honored                                                                |
| Worker quarantine (no DB/fs)                          | Honored                                                                |
| Guarded IPC + validation at persistence               | Honored except S-17/S-19                                               |
| One package manager, one lockfile                     | Honored                                                                |
| Fail closed on crypto/migrate                         | **Not yet** for leftover plaintext (S-18)                              |

No new framework, state library, or scheduler. No LP solver (won't-do).

---

## 6. Resolution — Plan Agent seed

Attach this file. Implement **only** the open IDs. Do not re-plan Phases 0–4 from 2026-08-18.

### Goal

Finish SQLCipher so stolen `userData` has **no plaintext sibling**, treat the file key like the GCM key (Buffer, wipe, no SQL string), make quit/export-dialog obey the same sender + close protocol as the rest of IPC, realpath export targets, stop leaking engine errors to the renderer, collapse double viewport / dead main scheduler, and fix docs.

### Constraints

- Do not introduce Redux, a new scheduler, or an LP solver.
- Do not remove column GCM. Do not remove SQLCipher.
- Do not expand Quick Budget.
- Do not re-open closed 2026-08-18 items except S-17 (quit) which this audit reopened.
- Keep contextIsolation + sandbox + parameterized SQL.
- Match conventional commits (`fix:`, `refactor:`, `docs:`).
- After the phase: `pnpm typecheck && pnpm typecheck:electron && pnpm lint && pnpm test:run` (and `pnpm verify:csp` only if CSP changes — it should not).

### Phase 5 — SQLCipher finish + IPC close protocol (S-16, S-17, S-18, S-19, S-20)

**PR title:** `fix: wipe SQLCipher keys, fail closed on plaintext leftovers, bind quit to the app window`

1. **S-16** — `CryptoService`: HKDF with fixed public salt; `applySqlCipherKey(db, crypto)` takes a Buffer, applies via package key API or validated pragma, `fill(0)` in `finally`. No stored pragma string. Tests: wrong key fails probe; buffer zeroed.
2. **S-18** — `migratePlaintextToSqlCipher`: leftover plaintext sibling → fail (not `migrated: true`). `DatabaseService.initialize`: refuse to open if `.pre-sqlcipher` or `.replaced-plaintext` exists after unlink retry. Tests for unlink failure.
3. **S-17 / S-19** — `app:quit` and `app:show-save-dialog`: `assertAppSender`. Quit while `!allowWindowClose` sends `app:close-requested` only. `auth:activity-ping`: sender check. Unit tests with a fake non-app sender.
4. **S-20** — `ipcData` / `ipcVoid` / export catch blocks: renderer `error` is a closed set of generic strings; real message stays in main logs + diagnostics.
5. **S-21** — `realpath` (or parent-dir realpath) in `exportPaths.ts`; symlink-out-of-home test.
6. **S-23** — HTML (and PDF final) `writeFileSync` uses `mode: 0o600`.

**Done when:**

- `rg 'sqlCipherKeyPragma|pragma\\(\`key' electron` shows only the validated Buffer path.
- `rg "app:quit" electron/main.ts` is behind `assertAppSender` and `allowWindowClose`.
- Tests cover: migrate unlink failure does not report success; initialize throws if plaintext sibling remains; fake sender rejected on quit and save-dialog.
- `rg "minimum 8" README.md` is empty **if S-22 is in this PR**; else a one-line docs PR.

### Phase 5b — One schedule presentation path (A-10, A-11, A-12, E-06)

**PR title:** `refactor: viewport only in renderer; drop unused main SchedulerService`

1. **A-10** — Worker returns full horizon; renderer `applyScheduleViewport` is the only slice. Grep: one `applyViewportFilter` production call site (tests/wrapper only).
2. **A-11** — Remove `scheduler` from main Services / `main.ts`. Worker still `new SchedulerService()`.
3. **A-12** — `SummaryPage` consumes `useSchedule()`. Optional: Goals reuse `schedule.goalProjections` when identity matches.
4. **E-06** — Clear toast/settings/recovery-key timers on unmount.

**Done when:** `rg "services.scheduler" electron` is empty; Summary has no `useState` schedule copy; changing viewport months does not rebuild the worker job.

### Phase 5c — Docs + DraftContext extract (S-22, D-01, A-09) — split if 5/5b are already large

**PR title:** `docs: password min 12; refactor draft CRUD modules`

1. README min 12. CONTRIBUTING backlog lists open IDs from this file.
2. A-09 extract only if the PR stays mechanical (no schedule/debounce changes). Drop A-09 from the PR if types get noisy.

**Done when:** README matches `MIN_PASSWORD_LENGTH`; CONTRIBUTING does not say “backlog empty.”

### Test plan

- Unit: SQLCipher apply + zero; migrate leftover files; IPC sender on quit/save-dialog; ipc generic errors (sqlite throw → no absolute path in `error` string).
- Component: Login still unlocks; password fields still clear on success/unmount (already true — do not regress).
- E2E: auth, unsaved quit/cancel, export PDF/HTML/xlsx (path allowlist).
- `pnpm audit:dev` green. Do not add GHSAs.

### Out of scope (explicit)

- LP/constraint solver.
- Rewriting the heuristic scheduler.
- React Router 8 (B-03).
- Collapsing dual Vite Electron plugins (A-06).
- Argon2/scrypt migration (PBKDF2-SHA-512 310k stays).
- Removing column GCM or SQLCipher.
- Replacing inline BIP-39 with a dependency.

---

## 7. Suggested Plan Agent prompt (verbatim)

```
You are planning implementation for Budget Optimizer v3.0.0 from AUDIT_REPORT.md (audit 2026-08-24).

Prior §5 Phases 0–4 (2026-08-18) are already implemented. Do not re-plan them.

Open findings to implement: S-16, S-17, S-18, S-19, S-20, S-21, S-23. Architecture: A-10, A-11, A-12, E-06. Docs: S-22, D-01. Optional same-cycle extract: A-09.

Accepted/deferred: S-06 residual, S-10, S-15, S-24, A-06, B-03, E-05.

Product invariants: local-first Electron finance app; main owns secrets and SQLite; renderer owns draft UX; schedule compute stays in utilityProcess; no new frameworks; SQLCipher file encryption plus column GCM; fail closed if plaintext sqlite siblings remain after migrate.

Deliver a plan only for the open items: exact files to touch, tests to add, and grep-based done-when checks. Call out anything in the report that is still stale vs the current working tree.
```
