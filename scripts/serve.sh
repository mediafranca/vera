#!/usr/bin/env bash
#
# Arranca, detiene y reinicia el servidor de Vera.
#
#   ./scripts/serve.sh start | stop | restart | status
#
# Existe porque el servidor de una instancia doméstica no se comporta como el de
# producción de nadie: se deja corriendo días, se le habla desde el teléfono por
# Tailscale, y nadie tiene una terminal abierta esperando para pulsar Ctrl-C. Un
# `npm run serve` en primer plano vale para desarrollar y no para vivir con él.
#
# Y hace falta reiniciar más de lo que parece: el cliente se recompila y el
# servidor lo relee solo, pero @vera/core y @vera/store se cargan al arrancar.
# Un cambio en el dominio no llega a la instancia hasta que el proceso vuelve a
# nacer, y eso no avisa: la aplicación sigue respondiendo, con las reglas viejas.

set -euo pipefail
cd "$(dirname "$0")/.."

PUERTO="${VERA_PORT:-4173}"
REGISTRO='.vera-server.log'
ENTRADA='packages/server/src/main.ts'
UNIDAD='vera.service'

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; RESET=''
fi
bien()  { printf '%s\n' "  ${GREEN}✓${RESET} $1"; }
dice()  { printf '%s\n' "${BOLD}→ $1${RESET}"; }
alto()  { printf '%s\n' "  ${RED}✗${RESET} $1" >&2; exit 1; }

vivo() { curl -fsS --max-time 2 "http://localhost:${PUERTO}/health" >/dev/null 2>&1; }
pids() { pgrep -f "node .*${ENTRADA}" 2>/dev/null || true; }

# Si esta instalación ya vive como unidad de usuario, systemd es su dueño.
# Arrancar otro proceso con nohup desde una terminal automatizada lo deja dentro
# del cgroup efímero de esa terminal: parece vivo durante la comprobación y
# muere en cuanto la terminal se cierra. Fue exactamente la caída del 19-08-2026.
gestionado_por_systemd() {
  command -v systemctl >/dev/null 2>&1 || return 1
  [ -n "$(systemctl --user show "$UNIDAD" -p FragmentPath --value 2>/dev/null)" ] || return 1
}

esperar_vivo() {
  for _ in $(seq 1 40); do
    vivo && return 0
    sleep 0.5
  done
  return 1
}

if gestionado_por_systemd; then
  DIRECTORIO_SERVIDO="$(systemctl --user show "$UNIDAD" -p WorkingDirectory --value)"
  case "${1:-restart}" in
    start)
      dice "Arrancando mediante systemd desde ${DIRECTORIO_SERVIDO}"
      systemctl --user start "$UNIDAD"
      esperar_vivo || alto "systemd no dejó a Vera respondiendo en el puerto ${PUERTO}"
      bien "escuchando en http://localhost:${PUERTO}"
      exit 0
      ;;
    stop)
      dice 'Deteniendo mediante systemd'
      systemctl --user stop "$UNIDAD"
      bien 'detenido'
      exit 0
      ;;
    restart)
      dice "Reiniciando mediante systemd desde ${DIRECTORIO_SERVIDO}"
      systemctl --user restart "$UNIDAD"
      esperar_vivo || alto "systemd no dejó a Vera respondiendo en el puerto ${PUERTO}"
      bien "escuchando en http://localhost:${PUERTO}"
      exit 0
      ;;
    status)
      if systemctl --user is-active --quiet "$UNIDAD" && vivo; then
        bien "en pie en el puerto ${PUERTO}, desde ${DIRECTORIO_SERVIDO} (pid $(systemctl --user show "$UNIDAD" -p MainPID --value))"
        exit 0
      fi
      printf '%s\n' '  apagado'
      exit 1
      ;;
  esac
fi

detener() {
  local encontrados
  encontrados="$(pids)"
  if [ -z "$encontrados" ]; then
    bien 'no había ninguno corriendo'
    return 0
  fi
  # TERM primero: el servidor cierra la base ordenadamente. KILL sólo si insiste,
  # porque matar a un proceso con SQLite abierto es lo que deja archivos -wal
  # sueltos y una base que la próxima apertura tiene que reparar.
  # shellcheck disable=SC2086
  kill $encontrados 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ -z "$(pids)" ] && break
    sleep 0.4
  done
  if [ -n "$(pids)" ]; then
    # shellcheck disable=SC2086
    kill -9 $(pids) 2>/dev/null || true
    sleep 0.5
  fi
  bien 'detenido'
}

arrancar() {
  if vivo; then alto "ya hay algo respondiendo en el puerto ${PUERTO}"; fi
  nohup node "$ENTRADA" >"$REGISTRO" 2>&1 &
  # Esperar a que conteste de verdad. Decir «arrancado» y devolver el prompt
  # antes de que responda deja a quien recarga el teléfono mirando un error.
  for _ in $(seq 1 40); do
    vivo && break
    sleep 0.5
  done
  if ! vivo; then
    printf '%s\n' "${DIM}$(tail -20 "$REGISTRO")${RESET}" >&2
    alto "no arrancó; el registro completo está en ${REGISTRO}"
  fi
  bien "escuchando en http://localhost:${PUERTO}"
  grep -E '^  (dueño|páginas|bloques|cliente|voz|lectura):' "$REGISTRO" | sed 's/^/  /' || true
}

case "${1:-restart}" in
  start)
    dice 'Arrancando'
    arrancar
    ;;
  stop)
    dice 'Deteniendo'
    detener
    ;;
  restart)
    dice 'Reiniciando'
    detener
    arrancar
    ;;
  status)
    if vivo; then
      bien "en pie en el puerto ${PUERTO} (pid $(pids | tr '\n' ' '))"
      grep -E '^  (dueño|páginas|bloques|cliente):' "$REGISTRO" 2>/dev/null | sed 's/^/  /' || true
    else
      printf '%s\n' "  apagado"
      exit 1
    fi
    ;;
  *)
    alto "no sé hacer «$1». Prueba start, stop, restart o status."
    ;;
esac
