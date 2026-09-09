#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
database="${VERA_BACKUP_DATABASE:-$repository_root/data/vera.sqlite}"
restic_repository="${VERA_BACKUP_REPOSITORY:-$HOME/.local/share/vera-backups/restic}"
credential="${VERA_BACKUP_CREDENTIAL:-$HOME/.openclaw/credentials/vera-restic.cred}"
restic_binary="${RESTIC_BINARY:-$HOME/.local/bin/restic}"
sqlite_binary="${SQLITE3_BINARY:-$(command -v sqlite3 2>/dev/null || true)}"

# Los servicios de usuario reciben un PATH más estrecho que la sesión
# interactiva. En Alexei sqlite3 vive bajo Linuxbrew, así que lo resolvemos de
# forma explícita cuando systemd no logra encontrarlo.
if [[ -z "$sqlite_binary" && -x /home/linuxbrew/.linuxbrew/bin/sqlite3 ]]; then
  sqlite_binary=/home/linuxbrew/.linuxbrew/bin/sqlite3
fi

if [[ ! -f "$database" ]]; then
  echo "No existe la base de VERA: $database" >&2
  exit 1
fi

if [[ ! -x "$restic_binary" ]]; then
  echo "No se encontró restic ejecutable: $restic_binary" >&2
  exit 1
fi

if [[ -z "$sqlite_binary" || ! -x "$sqlite_binary" ]]; then
  echo "No se encontró sqlite3 ejecutable" >&2
  exit 1
fi

if [[ ! -f "$credential" ]]; then
  echo "No se encontró la credencial cifrada: $credential" >&2
  exit 1
fi

temporary_directory="$(mktemp -d)"
snapshot="$temporary_directory/vera.sqlite"
cleanup() {
  rm -f "$snapshot"
  rmdir "$temporary_directory" 2>/dev/null || true
}
trap cleanup EXIT

# La API de backup de SQLite produce una fotografía consistente aun si Vera está
# escribiendo. No se copia directamente el archivo vivo ni se depende del WAL.
"$sqlite_binary" "$database" ".timeout 60000" ".backup '$snapshot'"

integrity="$("$sqlite_binary" "$snapshot" 'PRAGMA integrity_check;')"
if [[ "$integrity" != "ok" ]]; then
  echo "La copia SQLite no superó integrity_check: $integrity" >&2
  exit 1
fi

export RESTIC_PASSWORD_COMMAND="systemd-creds --user decrypt --name=vera-restic '$credential' -"

# stdin-filename mantiene una ruta estable entre ejecuciones para maximizar la
# deduplicación, sin conservar la copia temporal de 1,5 GB en el filesystem.
"$restic_binary" -r "$restic_repository" backup \
  --host alexei \
  --tag vera-sqlite \
  --stdin --stdin-filename vera.sqlite < "$snapshot"

"$restic_binary" -r "$restic_repository" forget \
  --host alexei \
  --tag vera-sqlite \
  --keep-daily 7 \
  --keep-weekly 4 \
  --keep-monthly 6 \
  --prune
