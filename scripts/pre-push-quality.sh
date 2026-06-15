#!/usr/bin/env bash
# Pre-push quality gate — mirrors .github/workflows/_shared-quality.yml (PR Gate).
set -euo pipefail

OUTPUT_FILE="${TMPDIR:-/tmp}/budget-optimizer-pre-push-test-output.txt"

echo "Running pre-push quality checks (PR Gate parity)..."

pnpm rebuild better-sqlite3

if rg -q "7289/ingest|#region agent log|debug-f84ef2" src electron; then
  echo "Debug telemetry patterns found in source"
  exit 1
fi

pnpm typecheck
pnpm lint

pnpm test:coverage:check 2>&1 | tee "$OUTPUT_FILE"
bash scripts/verify-test-output-clean.sh "$OUTPUT_FILE"

pnpm run build:vite && pnpm run verify:csp
pnpm audit --prod --audit-level critical

echo "Pre-push quality checks passed."
