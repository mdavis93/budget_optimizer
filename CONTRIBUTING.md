# Contributing to Budget Optimizer

Thank you for contributing. This project uses a two-phase CI model: a **pre-merge PR gate** that blocks merging, and a **post-merge main stability** check that validates `main` after every merge.

## Development workflow

1. Create a feature branch from `main`.
2. Write code and tests.
3. Use [Conventional Commits](https://www.conventionalcommits.org/) for every commit message.
4. Open a pull request against `main`.
5. Wait for all required checks to pass before merging.
6. After merge, confirm the **Main Stability** workflow succeeds on `main`.

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
| `pr-gate`    | Typecheck, lint, coverage, production CSP build, telemetry guard, production dependency audit |
| `commitlint` | Conventional Commits on every commit in the PR |

### Main Stability (post-merge, does not block merge)

**Workflow:** [`.github/workflows/main-stability.yml`](.github/workflows/main-stability.yml)

Runs on every push to `main` / `master`:

| Job name         | What it validates |
|------------------|-------------------|
| `quality`        | Same checks as PR Gate |
| `electron-build` | `electron:build:ci` packaging and `verify-packaged-app` with `--publish never` (runs on `macos-latest` because the verifier targets the macOS `.app` bundle) |

A failing **Main Stability** run means `main` is broken. Fix forward with a follow-up PR; do not treat this check as optional for long.

## Code coverage

CI runs `pnpm test:coverage:check`, which enforces Vitest thresholds in [`vitest.config.ts`](vitest.config.ts):

| Metric     | Threshold |
|------------|-----------|
| Lines      | 90%       |
| Functions  | 90%       |
| Statements | 90%       |
| Branches   | 85%       |

## Branch protection setup (repository admins)

CI workflows alone do not disable the merge button. A repository admin must configure branch protection on `main` in **GitHub → Settings → Branches → Add branch protection rule** (or **Rulesets**):

| Setting | Recommended value |
|---------|-------------------|
| Require a pull request before merging | On |
| Require status checks to pass before merging | On |
| Require branches to be up to date before merging | On |
| Status checks that are required | `pr-gate`, `commitlint` |
| Do not allow bypassing the above settings | On (optional, strict) |

**Merge queue (recommended):** Enable the merge queue on `main` so required checks re-run against the merge commit before landing. This prevents two green PRs from breaking `main` when combined.

**Do not** require `main-stability` or `electron-build` as pre-merge checks — those run after merge.

### Configure via GitHub CLI

If you have the [GitHub CLI](https://cli.github.com/) installed:

```bash
./scripts/configure-branch-protection.sh
```

Or manually:

```bash
gh api repos/mdavis93/budget_optimizer/branches/main/protection \
  --method PUT \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      { "context": "pr-gate" },
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

Dependabot pull requests are subject to the same **PR Gate** required checks. Merge only when `pr-gate` and `commitlint` are green.
