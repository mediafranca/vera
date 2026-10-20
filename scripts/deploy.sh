#!/usr/bin/env bash
#
# Publica VERA: comprueba, compila, commitea, empuja y verifica que lo publicado
# es lo que el servidor está sirviendo.
#
# El último paso es el que importa y el que suele faltar. Un despliegue no
# termina cuando git dice que sí: termina cuando el aparato que está al otro
# lado —el iPad, el teléfono— puede recibir la versión nueva. Todo lo anterior es
# preparación; esto lo comprueba.
#
#   ./scripts/deploy.sh "mensaje del commit"
#   make deploy m="mensaje del commit"
#
# Se detiene al primer fallo, a propósito: publicar algo que no compila o que no
# pasa sus pruebas es publicar un problema y además taparlo con un commit.

set -euo pipefail

cd "$(dirname "$0")/.."

# --- Colores, sólo si hay terminal delante ----------------------------------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; YELLOW=''; RESET=''
fi

paso()  { printf '%s\n' "${BOLD}→ $1${RESET}"; }
bien()  { printf '%s\n' "  ${GREEN}✓${RESET} $1"; }
aviso() { printf '%s\n' "  ${YELLOW}!${RESET} $1"; }
alto()  { printf '%s\n' "  ${RED}✗${RESET} $1" >&2; exit 1; }

MENSAJE="${1:-}"

# --- 0. Dónde estamos -------------------------------------------------------
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || alto 'esto no es un repositorio git'
RAMA="$(git rev-parse --abbrev-ref HEAD)"
paso "Rama ${RAMA}"

# `dev` es el taller que Herbert prueba; `main` es lo que los servicios
# persistentes sirven desde su worktree propio. Permitir que este script
# publique cualquier rama volvería a mezclar ambas cosas por accidente.
[ "$RAMA" = 'main' ] || alto 'sólo main se despliega; integra dev mediante PR y ejecuta este script desde el worktree de producción'

if [ -z "$(git status --porcelain)" ]; then
  aviso 'no hay nada que commitear; se publica lo que ya está'
  HAY_CAMBIOS=0
else
  HAY_CAMBIOS=1
  [ -n "$MENSAJE" ] || alto 'falta el mensaje del commit — ./scripts/deploy.sh "qué cambió y por qué"'
  printf '%s\n' "${DIM}$(git status --short | sed 's/^/    /')${RESET}"
fi

# --- 1. Que compile ---------------------------------------------------------
paso 'Comprobando tipos'
npm run typecheck >/dev/null 2>&1 || {
  npm run typecheck 2>&1 | tail -20
  alto 'el typecheck falla; no se publica'
}
bien 'tipos correctos'

# --- 2. Que pase sus pruebas ------------------------------------------------
paso 'Corriendo las pruebas'
SALIDA_TESTS="$(npm test 2>&1)" || { printf '%s\n' "$SALIDA_TESTS" | tail -25; alto 'hay pruebas que fallan; no se publica'; }
bien "$(printf '%s\n' "$SALIDA_TESTS" | grep -E '^ℹ pass' | head -1 | tr -s ' ') pruebas"

# --- 3. Que las especificaciones validen ------------------------------------
# El método de este repositorio es la spec antes que el código; publicarlo con
# specs rotas sería declarar lo contrario.
paso 'Validando las especificaciones'
ERRORES_SPEC="$(npm run spec 2>/dev/null | grep -c '"severity": "error"' || true)"
[ "$ERRORES_SPEC" = '0' ] || alto "las especificaciones tienen ${ERRORES_SPEC} errores; corre npm run spec"
bien 'specs válidas'

# --- 4. Compilar el cliente -------------------------------------------------
paso 'Compilando la PWA'
npm run build >/dev/null 2>&1 || { npm run build 2>&1 | tail -20; alto 'la compilación falla'; }

HUELLA="$(grep -o 'src="/build/[^"]*\.js"' packages/web/dist/index.html | head -1 | sed 's/.*\/build\///; s/"$//')"
[ -n "$HUELLA" ] || alto 'el index compilado no nombra ningún build; algo va mal en vite'
bien "build ${HUELLA}"

# --- 5. Commit --------------------------------------------------------------
if [ "$HAY_CAMBIOS" = '1' ]; then
  paso 'Commiteando'
  git add -A
  git commit -q -m "$MENSAJE"
  bien "$(git log --oneline -1)"
fi

# --- 6. Empujar -------------------------------------------------------------
# Que falle no aborta: el iPad recibe la versión del servidor local, no de
# GitHub. Sin red se publica igual y se dice que el remoto quedó atrás.
paso 'Empujando'
if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
  if git push -q 2>/dev/null; then bien 'remoto al día'; else aviso 'no se pudo empujar; el remoto queda atrás'; fi
else
  if git push -q -u origin "$RAMA" 2>/dev/null; then bien "rama publicada como origin/${RAMA}"
  else aviso "la rama no tiene remoto y no se pudo crear; sigue siendo local"; fi
fi

# --- 7. Reiniciar si lo que cambió es el dominio ----------------------------
#
# El cliente se recompila y el servidor lo relee en cada petición. El dominio no:
# @vera/core y @vera/store se cargan una vez al arrancar, así que un cambio en
# las reglas se queda fuera de la instancia hasta que el proceso vuelve a nacer.
# Y no avisa —la aplicación sigue contestando, con las reglas viejas—, que es la
# peor forma de fallar: verificar más abajo que se sirve la huella nueva del
# cliente sería verdad y engañoso a la vez.
#
# Se compara la edad del proceso con la fecha de los archivos, no el commit: da
# igual cómo llegó el cambio —commiteado, traído de otra rama, editado a mano—,
# lo que decide es si el proceso en marcha es anterior a lo que dice servir.
#
# Las fechas se comparan como números y no con `find -newermt`: el `find` de esta
# máquina es `bfs`, que no entiende marcas relativas —«hace 60 segundos»— y
# fallaba en silencio, con lo que este paso no llegaba a ejecutarse nunca.
CORRIENDO="$(pgrep -f 'node .*packages/server/src/main.ts' 2>/dev/null | head -1 || true)"
if [ -n "$CORRIENDO" ]; then
  EDAD="$(ps -o etimes= -p "$CORRIENDO" 2>/dev/null | tr -d ' ')"
  ARRANQUE=$(( $(date +%s) - ${EDAD:-0} ))
  TOCADO="$(find packages/core/src packages/store/src packages/server/src -type f \
    -exec stat -c '%Y' {} + 2>/dev/null | sort -rn | head -1)"
  if [ -n "$TOCADO" ] && [ "$TOCADO" -gt "$ARRANQUE" ]; then
    paso 'El dominio cambió: reiniciando el servidor'
    ./scripts/serve.sh restart >/dev/null 2>&1 || alto 'no se pudo reiniciar; míralo con `make restart`'
    bien 'reiniciado con las reglas nuevas'
  fi
fi

# La puerta MCP HTTP también carga su catálogo una sola vez. Si cambia el
# adaptador y sólo renace Vera, los clientes remotos siguen viendo herramientas
# antiguas aunque la API nueva ya esté activa.
MCP_CORRIENDO="$(pgrep -f 'node .*packages/mcp/src/http.ts' 2>/dev/null | head -1 || true)"
if [ -n "$MCP_CORRIENDO" ]; then
  MCP_EDAD="$(ps -o etimes= -p "$MCP_CORRIENDO" 2>/dev/null | tr -d ' ')"
  MCP_ARRANQUE=$(( $(date +%s) - ${MCP_EDAD:-0} ))
  MCP_TOCADO="$(find packages/mcp/src -type f -exec stat -c '%Y' {} + 2>/dev/null | sort -rn | head -1)"
  if [ -n "$MCP_TOCADO" ] && [ "$MCP_TOCADO" -gt "$MCP_ARRANQUE" ]; then
    paso 'La puerta MCP cambió: reiniciando el servicio HTTP'
    systemctl --user restart vera-mcp-http.service >/dev/null 2>&1 \
      || alto 'no se pudo reiniciar vera-mcp-http.service'
    bien 'catálogo MCP remoto recargado'
  fi
fi

# --- 8. Lo que de verdad importa: ¿lo está sirviendo? -----------------------
#
# Se le pregunta al servidor por su index sin pasar por ningún caché —`?fresh`
# esquiva al service worker, `Cache-Control: no-store` al del navegador— y se
# compara la huella que nombra con la recién compilada. Si coinciden, cualquier
# aparate que abra Vera o vuelva a ella va a recibir esta versión: es
# exactamente la comparación que hace la propia aplicación cada quince minutos.
PUERTO="${VERA_PORT:-4173}"
paso "Verificando que el servidor sirve esta versión (puerto ${PUERTO})"

SERVIDO="$(curl -fsS --max-time 5 "http://localhost:${PUERTO}/index.html?fresh=1" 2>/dev/null \
  | grep -o 'src="/build/[^"]*\.js"' | head -1 | sed 's/.*\/build\///; s/"$//' || true)"

if [ -z "$SERVIDO" ]; then
  aviso "el servidor no responde en el puerto ${PUERTO}"
  aviso 'levántalo con `npm run serve` y los aparatos recibirán esta versión al volver'
  exit 0
fi

if [ "$SERVIDO" = "$HUELLA" ]; then
  bien "sirviendo ${SERVIDO}"
  printf '\n%s\n' "${GREEN}${BOLD}Publicado.${RESET} El iPad lo toma al volver a Vera, o en quince minutos si ya la tiene abierta."
else
  alto "el servidor sirve ${SERVIDO} y lo compilado es ${HUELLA}; ¿VERA_WEB_ROOT apunta a otro sitio?"
fi
