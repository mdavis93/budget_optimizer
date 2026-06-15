## Summary

<!-- 1–3 bullets: what changed and why -->

-

## Test plan

### Enforced locally (Husky — no checkbox needed)

These run automatically when you commit or push:

| Hook | Checks |
|------|--------|
| `commit-msg` | Commitlint (Conventional Commits) |
| `pre-push` | PR Gate quality parity: typecheck, lint, Vitest coverage, clean test output, production CSP build, critical production dependency audit |

CI re-runs the same quality suite on the PR before auto-merge. Main Stability validates packaging after merge.

### Additional verification (check what applies)

Check items you ran **beyond** the hooks above:

- [ ] E2E tests (`pnpm test:e2e`)
- [ ] Acceptance tests (scenario-level checks against acceptance criteria)
- [ ] AI-assisted verification
- [ ] Manual smoke test

<!-- Optional: note environments, scenarios, or anything hooks and CI do not cover -->
