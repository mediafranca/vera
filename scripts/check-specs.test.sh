#!/usr/bin/env bash
set -euo pipefail

fixtures=$(mktemp -d)
trap 'rm -rf "$fixtures"' EXIT
cat > "$fixtures/allium" <<'MOCK'
#!/usr/bin/env bash
printf '%s' "$ALLIUM_REPORT"
exit "$ALLIUM_STATUS"
MOCK
chmod +x "$fixtures/allium"
export PATH="$fixtures:$PATH"

check() {
  local expected=$1
  export ALLIUM_STATUS=$2 ALLIUM_REPORT=$3
  local actual=0
  bash scripts/check-specs.sh > /dev/null 2>&1 || actual=$?
  if [ "$expected" = pass ]; then
    [ "$actual" -eq 0 ]
  else
    [ "$actual" -ne 0 ]
  fi
}

check pass 0 '{"diagnostics":[],"findings":[]}'
check pass 1 '{"diagnostics":[{"severity":"warning"}],"findings":[]}'
check fail 1 '{"diagnostics":[{"severity":"error"}],"findings":[]}'
check fail 0 '{"diagnostics":[],"findings":[{"kind":"unresolved"}]}'
check fail 2 '{"diagnostics":[],"findings":[]}'
check fail 127 ''
check fail 0 ''
check fail 0 '{invalid'
printf 'Verificador Allium: 8 casos comprobados.\n'
