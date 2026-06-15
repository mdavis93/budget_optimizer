#!/usr/bin/env bash
# Fail if test output contains known noise patterns.
set -euo pipefail

OUTPUT_FILE="${1:?usage: verify-test-output-clean.sh <output-file>}"

FORBIDDEN=(
  'MODULE_TYPELESS_PACKAGE_JSON'
  'React Router Future Flag Warning'
  'not wrapped in act'
  '\[INFO\] \[DATABASE\]'
  '\[WARN\] \[BUDGET\]'
  'Not implemented: navigation to another Document'
)

for pattern in "${FORBIDDEN[@]}"; do
  if rg -q "$pattern" "$OUTPUT_FILE"; then
    echo "Test output noise detected (pattern: $pattern)"
    rg -n "$pattern" "$OUTPUT_FILE" | head -5
    exit 1
  fi
done

echo "Test output clean — no forbidden patterns found."
