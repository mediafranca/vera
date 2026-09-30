#!/usr/bin/env bash
set -euo pipefail

source_repository="${VERA_BACKUP_SOURCE_REPOSITORY:-$HOME/.local/share/vera-backups/restic}"
destination_repository="${VERA_BACKUP_ANDREI_REPOSITORY:-sftp:andrei:/Users/hspencer/Backups/vera-restic}"
credential="${VERA_BACKUP_CREDENTIAL:-$HOME/.openclaw/credentials/vera-restic.cred}"
restic_binary="${RESTIC_BINARY:-$HOME/.local/bin/restic}"
bandwidth_kib="${VERA_BACKUP_ANDREI_BANDWIDTH_KIB:-10240}"

if [[ ! -d "$source_repository" ]]; then
  echo "No existe el repositorio Restic local: $source_repository" >&2
  exit 1
fi

if [[ ! -x "$restic_binary" ]]; then
  echo "No se encontró restic ejecutable: $restic_binary" >&2
  exit 1
fi

if [[ ! -f "$credential" ]]; then
  echo "No se encontró la credencial cifrada: $credential" >&2
  exit 1
fi

password_command="systemd-creds --user decrypt --name=vera-restic '$credential' -"
export RESTIC_PASSWORD_COMMAND="$password_command"
export RESTIC_FROM_PASSWORD_COMMAND="$password_command"

# El respaldo local es independiente y ya está verificado. Esta tarea sólo
# replica sus snapshots a Andrei; si el portátil remoto está dormido, el fallo
# no invalida ni bloquea la copia conservada en Alexei.
"$restic_binary" \
  --limit-download "$bandwidth_kib" \
  --limit-upload "$bandwidth_kib" \
  -r "$destination_repository" \
  copy \
  --from-repo "$source_repository" \
  --host alexei \
  --tag vera-sqlite \
  --retry-lock 5m

"$restic_binary" \
  --limit-download "$bandwidth_kib" \
  --limit-upload "$bandwidth_kib" \
  -r "$destination_repository" \
  forget \
  --host alexei \
  --tag vera-sqlite \
  --keep-tag pre-exposure-compaction \
  --keep-daily 7 \
  --keep-weekly 4 \
  --keep-monthly 6 \
  --prune

"$restic_binary" -r "$destination_repository" snapshots \
  --host alexei \
  --tag vera-sqlite \
  --latest 1
