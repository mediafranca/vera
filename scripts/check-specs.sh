#!/usr/bin/env bash
set -euo pipefail

report=$(mktemp)
trap 'rm -f "$report"' EXIT

status=0
allium check specs/ > "$report" || status=$?
cat "$report"
if [ "$status" -ne 0 ] && [ "$status" -ne 1 ]; then
  exit "$status"
fi

# Mismo criterio que .github/workflows/desktop.yml: advertencias visibles, errores bloqueantes.
jq -s -e 'length > 0 and all(.[];
  ((.findings // []) | length == 0) and
  ((.diagnostics // []) | all(.severity != "error")))' "$report"
