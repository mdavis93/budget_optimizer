#!/usr/bin/env bash
# Create or replace the merge-queue ruleset for main (requires GitHub CLI + admin access).
# Classic branch protection REST API cannot require merge queue; use a repository ruleset.
# See CONTRIBUTING.md for the full automated merge pipeline.
set -euo pipefail

REPO="${1:-mdavis93/budget_optimizer}"
OWNER="${REPO%%/*}"
NAME="${REPO##*/}"
RULESET_NAME="main-merge-queue"

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required. Install: https://cli.github.com/"
  exit 1
fi

EXISTING_ID="$(gh api "repos/${REPO}/rulesets" --jq ".[] | select(.name == \"${RULESET_NAME}\") | .id" | head -1 || true)"

if [[ -n "${EXISTING_ID}" ]]; then
  gh api "repos/${REPO}/rulesets/${EXISTING_ID}" --method DELETE
  echo "Removed existing ruleset ${RULESET_NAME} (id ${EXISTING_ID})."
fi

gh api "repos/${REPO}/rulesets" \
  --method POST \
  --input - <<'EOF' || {
  echo "Merge queue ruleset API call failed."
  echo "Enable merge queue manually:"
  echo "  GitHub → Settings → Branches → Branch protection rules → main"
  echo "  → Require merge queue (squash, build concurrency 1, ALLGREEN)"
  exit 1
}
{
  "name": "main-merge-queue",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/main"],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "merge_queue",
      "parameters": {
        "check_response_timeout_minutes": 60,
        "grouping_strategy": "ALLGREEN",
        "max_entries_to_build": 1,
        "max_entries_to_merge": 1,
        "merge_method": "SQUASH",
        "min_entries_to_merge": 1,
        "min_entries_to_merge_wait_minutes": 5
      }
    }
  ]
}
EOF

echo "Merge queue ruleset configured for ${REPO} main."
echo "Ensure Allow auto-merge is enabled: Settings → General → Pull Requests."
