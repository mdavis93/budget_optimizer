# Contributing to Budget Optimizer

Thank you for contributing. This project uses a two-phase CI model:

1. **PR Gate** — blocks merging until quality and commit-message checks pass.
2. **Main Stability** — post-merge packaging validation; failures activate a merge freeze.

## Development workflow

1. Create a feature branch from `main`.
2. Write code and tests.
3. Use [Conventional Commits](https://www.conventionalcommits.org/) for every commit message.
4. Open a pull request against `main`. Use the PR template: check **Test plan** boxes only for verification you completed locally before opening the PR (see [Pull request descriptions](#pull-request-descriptions)).
5. When checks pass, **auto-merge** squash-merges the PR to `main` (no manual merge click needed).
6. After merge, confirm **Main Stability** succeeds on `main`.

To hold a PR despite green checks, add the `do-not-automerge` label before or after opening the PR. Draft PRs never receive auto-merge.

### Local quality gates (Husky)

Husky hooks enforce quality before changes reach `origin`. Run `pnpm install` once to activate them (`prepare` → `husky`).

| Hook | When | What runs |
|------|------|-----------|
| `commit-msg` | Every commit | Commitlint (Conventional Commits) |
| `pre-push` | Every push | [`scripts/pre-push-quality.sh`](scripts/pre-push-quality.sh) — same checks as PR Gate quality |

Pre-push runs:

```bash
pnpm typecheck
pnpm typecheck:electron    # tsconfig.node project (electron + vite config)
pnpm lint
pnpm test:coverage:check   # use-native node + Vitest coverage + clean-output verification
pnpm run build:vite && pnpm run verify:csp
pnpm audit --prod --audit-level critical
pnpm audit:dev             # full-tree audit (high+); GHSA allowlist currently empty
```

Run manually anytime: `pnpm prepush`.

### Native ABI auto-swap (`better-sqlite3`)

Node unit tests and Electron (`electron:dev` / `test:e2e`) need different `better-sqlite3` ABIs but share one on-disk binary. [`scripts/use-native.cjs`](scripts/use-native.cjs) is chained into those npm scripts and always load-probes under the *target* runtime (Node or Electron). On success it refreshes a marker under `.cache/native/`; on failure it copies from a version-keyed cache or recompiles. The marker is for debugging only — it is never trusted alone to skip the probe (rebuilds can overwrite the binary while leaving a stale marker).

- Prefer `pnpm test`, `pnpm test:run`, `pnpm electron:dev`, and `pnpm test:e2e` — bare `vitest` / `playwright test` bypass the helper.
- If the ABI looks stuck, delete `.cache/native/` and re-run the script you need.
- **Do not** restore `.cache/native` from CI caches (`actions/cache` or similar); CI should stay markerless and rely on the positive load probe.
- Release packaging must use `pnpm electron:build` / `pnpm electron:build:ci` (rebuild + sync). Do not use `pnpm build` for production packages after Node test runs — it skips native sync.

**Paranoia layers:** (1) Husky before push → (2) PR Gate on the PR → (3) Main Stability after merge to `main`.

## Draft mode

Budget Optimizer uses a **draft overlay** for the active budget's working data (income, bills, debts, goals, schedule, and budget cash fields). User-facing copy uses **"Unsaved changes"** — not "volatile."

| Surface | Persist behavior |
|---------|------------------|
| Income, Bills, Debts, Goals, Schedule | Edits stay in draft until **Save Changes** on that page |
| Settings → budget allocation fields | Draft until Save on Budgets or **Save All** |
| Settings → theme, currency, security | Saved immediately |
| Budgets page → non-current budget details | Saved immediately when you confirm edit |
| Budgets page → current budget details | Draft until Save on Budgets |

**Save All** and the global banner appear when two or more domains are dirty. **Quick Budget** bypasses draft mode for exploratory what-if sessions.

Budget **details** (name, balances, cash targets) are registry metadata on the Budgets page. Budget **contents** (incomes, bills, schedule) require switching to that budget first — data never mixes across budgets.

### Exit and lock behavior

| Action | Dirty-draft behavior |
|--------|----------------------|
| In-app navigation | No prompt (draft stays) |
| Lock App | No prompt; draft preserved across unlock |
| Quit / native window close | Save / Discard / Cancel |
| Switch budgets | Save / Discard / Cancel (local guard on Budgets) |

## Schedule semantics (accepted behaviors)

These behaviors are intentional — not bugs. They are covered by unit tests where noted.

### Income-attached bills (A-03)

Bills marked income-attached (`isIncomeAttached` with `preferredIncomeSourceId`) are placed on **every paycheck** that includes that income source before the exact solver runs. Due-day alignment and the 14-day prepay cap do **not** apply on this path. See `applyIncomeAttachedBills` in `electron/services/scheduler/exactAssignment.ts`.

### Manual assignment (A-02)

Drag-and-drop on the Schedule page may place a bill late or more than 14 days early. The UI shows a **confirmation dialog** before accepting the placement; the user can proceed after confirming. Hard rejection is not enforced — manual placements lock from auto-rebalance.

### Assignment and rebalance (A-08)

Schedule generation uses an **exact windowed solver** (`exactAssignment` / `solve`) to assign bills within due-date eligibility windows, then a **post-assignment rebalance** (`rebalance.ts`) that prefers each paycheck’s target cash-on-hand and only dips toward the minimum (break-glass) floor when needed. It is not a global LP optimizer — shortfalls may remain under sparse paycheck cadences or heavy manual overrides. The README states this limitation. A full LP/constraint solver (**5.4**) is **Won't-do** unless product need resurfaces.

## Post-Audit Backlog

**Status:** Empty — audit is **Done, retained for archival purposes only** ([AUDIT_REPORT.md](AUDIT_REPORT.md)).

### Won't-do

- **5.4** — LP/constraint solver for hard rebalance cases (A-08 enhancement). Declined July 2026; revisit only if product need resurfaces. Exact assignment + post-assignment rebalance shipped in `#71`.

### Closed since audit

- **B-04** — Shared types module (`shared/`, `#59`)
- **B-07** — Presentational splits for large pages (`#81`, `#84`)
- **B-08** — BudgetManager current-budget cache (`#61`)
- **B-09** — Merge DataContext into Draft schedule slice (`#83`; `DataContext` removed)
- **E-04** — `DraftStatusContext` + memoization (`#82`)
- **5.3 / 6.2** — Playwright E2E safety net (`#60`)
- **6.5** — Electron `^33.4.11` → 42 (`#90`; always-probe ABI helper `#89`)
- Dependabot ignore for Electron / TypeScript majors (`#93`) — see [Dependabot PRs](#dependabot-prs)
- Docs currency pass (`#95`); Electron Vite `@shared` aliases (`#96`)

## Pull request descriptions

[`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) pre-fills new PRs with **Summary** and **Test plan** sections.

**Test plan checkboxes are for verification beyond Husky and CI.** Commitlint and the PR Gate quality suite run automatically via Husky on commit/push and again in CI before merge — do not checkbox those.

Check an item when you ran that extra validation before opening the PR:

| Checkbox | Typical local command / method |
|----------|--------------------------------|
| E2E tests | `pnpm test:e2e` |
| Acceptance tests | Scenario-level checks against acceptance criteria |
| AI-assisted verification | Cursor or other agent review of the change |
| Manual smoke test | Hands-on exercise of the affected UI or workflow |

## Commit message format

Every commit in a PR must follow Conventional Commits:

```
<type>(<optional scope>): <description>

[optional body]

[optional footer]
```

Common types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`, `build`, `perf`.

Examples:

- `feat(goals): add achievability panel`
- `fix(export): handle empty budget selection`
- `chore: update vitest to 4.1.8`

If a PR contains multiple commits, **all** of them are validated in CI. Fix bad messages with `git rebase -i` or `git commit --amend` before merging.

## CI pipelines

### PR Gate (pre-merge, blocks merge)

**Workflow:** [`.github/workflows/pr-gate.yml`](.github/workflows/pr-gate.yml)

**Required status checks** (configure in branch protection):

| Check name   | What it validates |
|--------------|-------------------|
| `pr-gate / quality` | Typecheck (renderer + electron), lint, coverage, production CSP build, telemetry guard, production + full-tree dependency audit, SBOM artifact |
| `commitlint` | Conventional Commits on every commit in the PR |

### Automated merge

**Workflows:**

- [`.github/workflows/enable-auto-merge.yml`](.github/workflows/enable-auto-merge.yml) — enables squash auto-merge when a PR is ready.
- [`.github/workflows/merge-freeze.yml`](.github/workflows/merge-freeze.yml) — opens a `merge-freeze` issue when Main Stability fails on `main`.

**Auto-merge is enabled when all of the following are true:**

| Guard | Condition |
|-------|-----------|
| Target branch | `main` |
| Not a draft | PR is marked ready for review |
| Same repository | Fork PRs are excluded |
| No manual brake | PR does not have the `do-not-automerge` label |
| No active freeze | No open issue with the `merge-freeze` label |
| Required checks green | `pr-gate / quality` and `commitlint` pass on the PR |

**Dependabot PRs** use the same pipeline. A failed Dependabot PR only blocks itself; user PRs and automation continue unaffected.

### Main Stability (post-merge, merge freeze circuit breaker)

**Workflow:** [`.github/workflows/main-stability.yml`](.github/workflows/main-stability.yml)

Runs on every push to `main` / `master`, via `workflow_dispatch`, and when **Main Stability Drift Check** detects a new `main` commit without a stability result:

> Auto-merge squash commits are attributed to `github-actions[bot]` and do not trigger `push` or `pull_request` `closed` workflows. **Main Stability Drift Check** dispatches a run when `main` advances without a matching stability result (every 15 minutes). Use `workflow_dispatch` on Main Stability for immediate recovery.

| Job name         | What it validates |
|------------------|-------------------|
| `quality`        | Same checks as PR Gate |
| `electron-build` | `electron:build:ci` packaging and `verify-packaged-app` with `--publish never` (runs on `macos-latest` because the verifier targets the macOS `.app` bundle) |

A failing **Main Stability** run means `main` is broken. The **merge-freeze** workflow opens a `merge-freeze` issue, which blocks new auto-merges. The freeze clears automatically when the next Main Stability run on `main` succeeds and the issue is closed.

Fix forward with a follow-up PR; do not treat Main Stability as optional for long.

### macOS packaging without code signing

Local and CI `electron:build` / `electron:build:ci` set `CSC_IDENTITY_AUTO_DISCOVERY=false` so electron-builder does not search for a Developer ID certificate. Unsigned builds are expected until you configure Apple code signing for distribution.

Native modules (`better-sqlite3`, `keytar`) are rebuilt for Electron via `electron-builder install-app-deps` plus `scripts/rebuild-electron-native.cjs` during `postinstall`. Electron 42+ no longer ships a package-level `postinstall` that downloads the Electron binary, so the root `postinstall` runs `node node_modules/electron/install.js` first. The `electron:build` / `electron:build:ci` scripts rerun that rebuild before packaging so a prior Node test rebuild cannot leak into packaged apps, then run `sync-better-sqlite3-native.cjs` to place the binary where the packaged app expects it. Local day-to-day Node↔Electron flips for tests and `electron:dev` are handled by `scripts/use-native.cjs` (see [Native ABI auto-swap](#native-abi-auto-swap-better-sqlite3)).

## Code coverage

CI runs `pnpm test:coverage:check`, which enforces Vitest thresholds in [`vitest.config.ts`](vitest.config.ts):

| Metric     | Threshold |
|------------|-----------|
| Lines      | 90%       |
| Functions  | 90%       |
| Statements | 90%       |
| Branches   | 85%       |

## Branch protection (repository admins)

Branch protection enforces the automated pipeline on `main`.

| Setting | Value |
|---------|-------|
| Require a pull request before merging | On |
| Require status checks to pass before merging | On |
| Require branches to be up to date before merging | On |
| Required status checks | `pr-gate / quality`, `commitlint` |
| Enforce for administrators | On |
| Allow auto-merge | On (Settings → General → Pull Requests) |

**Do not** require `main-stability` or `electron-build` as pre-merge checks — those run after merge.

### Configure via GitHub CLI

```bash
./scripts/configure-branch-protection.sh
```

Enable **Allow auto-merge** under **Settings → General → Pull Requests** if not already on.

Classic branch protection only:

```bash
gh api repos/mdavis93/budget_optimizer/branches/main/protection \
  --method PUT \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      { "context": "pr-gate / quality" },
      { "context": "commitlint" }
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0
  },
  "restrictions": null
}
EOF
```

Adjust `required_approving_review_count` if you want mandatory code review.

## Dependabot PRs

Dependabot pull requests use the same **PR Gate** and auto-merge pipeline. Failed Dependabot PRs remain open without affecting user PRs or the merge-freeze machinery.

Weekly dependency updates are grouped into up to **four pull requests**:

| Group | Scope |
|-------|--------|
| `production-patch-minor` | Production deps, patch and minor bumps |
| `production-major` | Production deps, major bumps |
| `development-patch-minor` | Dev deps, patch and minor bumps |
| `development-major` | Dev deps, major bumps |

Configuration: [`.github/dependabot.yml`](.github/dependabot.yml).

When `main` advances (including after a Dependabot PR merges), the **Dependabot Refresh** workflow ([`.github/workflows/dependabot-refresh.yml`](.github/workflows/dependabot-refresh.yml)) calls GitHub's update-branch API for each open Dependabot PR that is behind `main`. This keeps strict "branch up to date" protection satisfied without manual rebases. The workflow skips refresh while a `merge-freeze` issue is open.

Auto-merge squash commits do not trigger `push` workflows. **Main Stability Drift Check** dispatches both Main Stability and Dependabot Refresh when `main` advances without a matching workflow run (every 15 minutes). Use `workflow_dispatch` on either workflow for immediate recovery.

Major group PRs may legitimately fail `pr-gate / quality` (breaking migrations). Add the `do-not-automerge` label to hold them without blocking other PRs. Automated **major** bumps for `electron` and `typescript` are ignored in [`.github/dependabot.yml`](.github/dependabot.yml) — those upgrades land as dedicated human-owned PRs.

Individual Dependabot PRs opened before grouping was enabled can be closed once grouped replacements appear on the next weekly run.

## Supply chain

Dependency hygiene runs on three layers, all part of the **PR Gate** quality job (and `pnpm prepush`):

| Layer | Command | Fails on |
|-------|---------|----------|
| Updates | weekly Dependabot, grouped into four PRs (see above) | n/a — keeps deps current |
| Production audit | `pnpm audit --prod --audit-level critical` | any **critical** advisory in the production tree |
| Full-tree audit | `pnpm audit:dev` ([`scripts/audit-dev.cjs`](scripts/audit-dev.cjs)) | any **high+** advisory anywhere, except deferred GHSAs |

**Overrides & deferrals.** Patched versions for vulnerable dev/build transitives are pinned via `overrides` in [`pnpm-workspace.yaml`](pnpm-workspace.yaml). Advisories that can only be cleared by a deferred major upgrade are allowlisted by GHSA id in `scripts/audit-dev.cjs` with a justifying comment — add to that list (never silently widen the severity threshold) when an advisory is genuinely blocked on tracked work. The Electron 33 → 42 allowlist entries were removed when that upgrade landed.

**SBOM.** Every quality run generates a CycloneDX SBOM (`pnpm sbom`, via `@cyclonedx/cdxgen`) and uploads it as the **`sbom`** build artifact on the workflow run. It is regenerated each run and is not committed (git-ignored).
