#!/usr/bin/env bash
set -euo pipefail

database="${VERA_DATABASE:-/data/vera.sqlite}"
objects="${VERA_OBJECTS:-/data/objects}"

mkdir -p "$(dirname "$database")" "$objects"

# Un volumen nuevo de Fly llega bajo root. El proceso de Vera no necesita esa
# autoridad: la usa sólo este arranque para entregar el volumen al usuario node.
if [[ "$(id -u)" = 0 ]]; then
  chown -R node:node "$(dirname "$database")"
  exec gosu node "$0" "$@"
fi

if [[ ! -f "$database" ]]; then
  if [[ -z "${VERA_OWNER:-}" || -z "${VERA_OWNER_NAME:-}" ]]; then
    printf '%s\n' 'Una Vera nueva necesita VERA_OWNER y VERA_OWNER_NAME.' >&2
    exit 64
  fi
  node packages/server/src/initialize.ts \
    "$database" "$VERA_OWNER" "$VERA_OWNER_NAME" "${VERA_PROFILE:-personal}"
fi

exec "$@"
