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

### Local checks before pushing

```bash
pnpm typecheck
pnpm lint
pnpm test:coverage:check
pnpm run build:vite && pnpm run verify:csp
```

Commit messages are validated locally via Husky (`commit-msg` hook) when you run `pnpm install` (which triggers `prepare` → `husky`).

## Pull request descriptions

[`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) pre-fills new PRs with **Summary** and **Test plan** sections.

**Test plan checkboxes are for pre-PR verification only.** Check an item when you ran that validation locally before opening the PR. Leave items unchecked if they do not apply or were not run.

| Checkbox | Typical local command / method |
|----------|--------------------------------|
| Commitlint | Husky on commit, or `pnpm exec commitlint --from origin/main` |
| Unit tests | `pnpm test:run` or `pnpm test:coverage:check` |
| Integration tests | Vitest suites that span multiple modules/services (when touched) |
| Acceptance tests | Scenario-level checks against acceptance criteria |
| E2E tests | `pnpm test:e2e` |
| AI-assisted verification | Cursor or other agent review of the change |
| Manual smoke test | Hands-on exercise of the affected UI or workflow |

Do **not** use the Test plan for CI status (`pr-gate / quality`, `commitlint` on the PR). Those checks are enforced separately and auto-merge when green; they are not manually ticked in the description.

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
| `pr-gate / quality` | Typecheck, lint, coverage, production CSP build, telemetry guard, production dependency audit |
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

Native modules (`better-sqlite3`, `keytar`) are rebuilt for Electron via `electron-builder install-app-deps` plus `scripts/rebuild-electron-native.cjs` during `postinstall`. The `electron:build` scripts rerun that rebuild before packaging so a prior Node test rebuild cannot leak into packaged apps, then run `sync-better-sqlite3-native.cjs` to place the binary where the packaged app expects it.

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
