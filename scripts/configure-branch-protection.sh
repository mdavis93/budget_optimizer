#!/usr/bin/env bash
# Configure classic branch protection on main (requires GitHub CLI + admin access).
# For merge queue, run ./scripts/configure-merge-queue-ruleset.sh after this script.
# See CONTRIBUTING.md for manual setup via the GitHub UI.
set -euo pipefail

REPO="${1:-mdavis93/budget_optimizer}"

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required. Install: https://cli.github.com/"
  echo "Or configure branch protection manually — see CONTRIBUTING.md."
  exit 1
fi

gh api "repos/${REPO}/branches/main/protection" \
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

echo "Branch protection configured for ${REPO} main."
echo "Next: ./scripts/configure-merge-queue-ruleset.sh"
echo "Then enable Allow auto-merge: Settings → General → Pull Requests."
