# Contributing to Budget Optimizer

Thank you for contributing. This project uses a three-phase CI model:

1. **PR Gate** — blocks merging until quality and commit-message checks pass.
2. **Merge queue** — re-runs quality checks on the combined merge result before landing on `main`.
3. **Main Stability** — post-merge packaging validation; failures activate a merge freeze.

## Development workflow

1. Create a feature branch from `main`.
2. Write code and tests.
3. Use [Conventional Commits](https://www.conventionalcommits.org/) for every commit message.
4. Open a pull request against `main`.
5. When checks pass, **auto-merge** queues the PR for squash merge (no manual merge click needed).
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

When a PR enters the **merge queue**, only `pr-gate / quality` runs again on the `merge_group` event. Commitlint does not re-run on merge groups.

### Automated merge and merge queue

**Workflows:**

- [`.github/workflows/enable-auto-merge.yml`](.github/workflows/enable-auto-merge.yml) — enables squash auto-merge when a PR is ready.
- [`.github/workflows/merge-freeze.yml`](.github/workflows/merge-freeze.yml) — sets `MERGE_FREEZE` when Main Stability fails on `main`.

**Auto-merge is enabled when all of the following are true:**

| Guard | Condition |
|-------|-----------|
| Target branch | `main` |
| Not a draft | PR is marked ready for review |
| Same repository | Fork PRs are excluded |
| No manual brake | PR does not have the `do-not-automerge` label |
| No active freeze | Repository variable `MERGE_FREEZE` is not `true` |
| Required checks green | `pr-gate / quality` and `commitlint` pass on the PR |

After auto-merge is enabled and checks pass, GitHub adds the PR to the **merge queue**. The queue runs `pr-gate` on a synthetic merge branch, then squash-merges to `main`.

**Dependabot PRs** use the same pipeline. A failed Dependabot PR only blocks itself; user PRs and automation continue unaffected.

### Main Stability (post-merge, merge freeze circuit breaker)

**Workflow:** [`.github/workflows/main-stability.yml`](.github/workflows/main-stability.yml)

Runs on every push to `main` / `master`:

| Job name         | What it validates |
|------------------|-------------------|
| `quality`        | Same checks as PR Gate |
| `electron-build` | `electron:build:ci` packaging and `verify-packaged-app` with `--publish never` (runs on `macos-latest` because the verifier targets the macOS `.app` bundle) |

A failing **Main Stability** run means `main` is broken. The **merge-freeze** workflow sets `MERGE_FREEZE=true`, blocks new auto-merges, and opens a `merge-freeze` issue. The freeze clears automatically when the next Main Stability run on `main` succeeds.

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

## Branch protection and merge queue (repository admins)

Branch protection and merge queue together enforce the automated pipeline on `main`.

| Setting | Value |
|---------|-------|
| Require a pull request before merging | On |
| Require status checks to pass before merging | On |
| Require branches to be up to date before merging | On |
| Required status checks | `pr-gate / quality`, `commitlint` |
| Enforce for administrators | On |
| Require merge queue | On (squash, serial, ALLGREEN) |
| Allow auto-merge | On (Settings → General → Pull Requests) |

**Do not** require `main-stability` or `electron-build` as pre-merge checks — those run after merge.

### Configure via GitHub CLI

```bash
./scripts/configure-branch-protection.sh
./scripts/configure-merge-queue-ruleset.sh
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
