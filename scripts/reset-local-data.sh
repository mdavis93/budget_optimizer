#!/usr/bin/env bash
set -euo pipefail

# Quit this app first if it is running, so files are not recreated while deleting
pkill -f "budget-optimizer" 2>/dev/null || true
pkill -f "Budget Optimizer.app" 2>/dev/null || true

DEV_DATA_DIR="${HOME}/Library/Application Support/budget-optimizer"
PROD_DATA_DIR="${HOME}/Library/Application Support/Budget Optimizer"

rm -rf "${DEV_DATA_DIR}"
rm -rf "${PROD_DATA_DIR}"

security delete-generic-password -s "Budget Optimizer" -a "master" 2>/dev/null || true

echo "Removed local Budget Optimizer data:"
echo "  - ${DEV_DATA_DIR}"
echo "  - ${PROD_DATA_DIR}"
echo "Restart the app to create a new account."
