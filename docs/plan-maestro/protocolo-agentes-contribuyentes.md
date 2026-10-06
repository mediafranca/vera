# Protocolo para agentes contribuyentes

Estado al escribirlo: 2026-08-30. Este documento no repite
[`CONTRIBUTING.md`](../../CONTRIBUTING.md), que ya fija el método (Allium
antes que código), las ramas, los commits, el pull request y la seguridad.
Añade sólo lo que falta para que varios agentes —humanos o de IA— trabajen en
paralelo sobre [cola-priorizada.md](cola-priorizada.md) sin pisarse, sin
inventar un tablero de estado nuevo, y sin salirse del modelo de ramas que
`CONTRIBUTING.md` ya establece.

## 1. Cómo reclamar una unidad

La cola priorizada (`cola-priorizada.md`) es una fotografía, no un tablero
editable — igual que `docs/plan-local-first.md` y sus hermanos son
fotografías fechadas, no páginas que cualquiera actualiza. El mecanismo de
reclamo **es el mismo que ya existe para cualquier rama**:

1. Antes de empezar, corre `git branch -a` (o revisa los PR abiertos hacia
   `dev`) y busca si alguien ya abrió una rama para esa unidad o
   una que toque los mismos archivos.
2. Si está libre, ábrela con el nombre de la unidad, siguiendo la convención
   de `CONTRIBUTING.md §2`: `vN.M-tema-en-dos-o-tres-palabras`. Usa el
   identificador de la unidad (por ejemplo `u1.1`, `u1.2` de
   `cola-priorizada.md`) como referencia en el primer commit, no como nombre
   de rama — el nombre de rama describe el trabajo, no el número de la lista.
3. El primer commit de la rama declara, en su cuerpo, qué unidad de
   `cola-priorizada.md` cierra o de qué unidad forma parte, y qué spec la
   gobierna — exactamente la información que `CONTRIBUTING.md §5` ya pide para
   el pull request, adelantada al primer commit para que quien mire
   `git log --all --oneline` entienda qué se está reclamando sin abrir el PR.

No existe archivo de "reclamos" para editar. Si dos agentes abren rama para la
misma unidad al mismo tiempo, gana quien llega primero a PR revisado — el
otro rebasa o abandona, igual que cualquier colisión de ramas hoy.

## 2. Cómo declarar archivos y símbolos afectados sin colisionar

`cola-priorizada.md` ya lista, por unidad, los archivos que probablemente toca.
Antes de escribir código:

- **Confirma con grep, no con la lista.** La lista es una hipótesis de esta
  auditoría al 2026-08-30; el código puede haber cambiado desde entonces.
- **Si la unidad toca un archivo grande y compartido** (`server.ts`,
  `outliner.ts`, `main.ts` son los tres que aparecen una y otra vez en la
  evidencia de esta auditoría), dilo explícitamente en el primer commit: "toca
  `server.ts` líneas ~2490 (conexiones), no toca el resto del archivo". Esto
  no impide colisiones, pero las hace visibles antes de que dos ramas lleguen
  a PR con el mismo archivo modificado de formas incompatibles.
- **Usa un worktree por tarea**, como ya indica `CONTRIBUTING.md §2`
  (`make worktree n=tarea`). Dos tareas en el mismo directorio fallan al
  confirmar, no al trabajar — el worktree es la defensa real, no la
  declaración. Si el worktree lo crea una herramienta distinta de
  `scripts/worktree.sh` (por ejemplo, la de un agente), confirma que instaló
  sus propias dependencias — `readlink -f node_modules/@vera/core` debe
  apuntar dentro del propio worktree, no al checkout principal. Si no hay
  `node_modules`, un import por especificador de paquete resuelve subiendo
  directorios hasta encontrarlo en otro sitio, silenciosamente, y `make check`
  puede dar verde probando código que no es el que se editó (ver la nota de
  entorno al final de `cola-priorizada.md`, encontrada al ejecutar u1.4a).
- **Nunca levantes un segundo servidor** contra el mismo `data/vera.sqlite`
  desde un worktree distinto — `CONTRIBUTING.md` ya lo prohíbe y esta
  auditoría encontró por qué importa más de lo que parece: el servidor es un
  singleton en memoria sin coordinación multi-proceso (riesgo 3 de
  `matriz-trazabilidad.md`).

## 3. Cómo evitar colisiones entre unidades relacionadas

Varias unidades de la cola tocan el mismo archivo por razones distintas (por
ejemplo, `u1.1` y `u1.2` tocan `server.ts` y `main.ts` respectivamente, pero
`u1.4` también toca `server.ts`). La regla:

- **Una unidad, una rama, un asunto** — ya es la regla de `CONTRIBUTING.md
  §2`. Si al trabajar una unidad encuentras que necesitas tocar código de otra
  unidad todavía no reclamada, anótalo y ábrele su propia rama; no la
  absorbas.
- **Las unidades marcadas como dependientes en `cola-priorizada.md` se
  reclaman en orden.** No es una regla técnica de git, es una regla de
  coherencia: implementar `u1.2` (resolución de conflictos) antes que `u1.1`
  (integridad de escritura) funciona, pero hereda el defecto que `u1.1`
  existe para cerrar.
- **Si tu unidad necesita una spec nueva o una revisión de spec existente**
  (marcado en la cola), esa revisión es su propia rama y su propio PR, antes
  del código — `CONTRIBUTING.md §1` ya lo exige ("si es un cambio de
  comportamiento sin spec, se pide primero la spec").

## 4. Cómo entregar evidencia

Igual que pide `CONTRIBUTING.md §5`, con un añadido específico para trabajo
que nace de esta auditoría: si el PR cierra o avanza una unidad de
`cola-priorizada.md`, el cuerpo del PR cita el identificador de la unidad y
copia (no resume) la salida de los comandos de verificación que esa unidad
declara en `fase-1-local-first-sincronizacion.md`. Un PR que dice "cierra
u1.1" sin la salida de `node --test packages/server/test/server.test.ts` no
cumple el criterio de evidencia — es exactamente el mismo estándar que ya
exige `CONTRIBUTING.md` para `npm run spec`, extendido a los tests
específicos que la unidad nombra.

## 5. Cómo registrar decisiones

Dos destinos distintos según el tipo de decisión, para no duplicar:

- **Decisiones de comportamiento del producto** (qué debe hacer Vera) van a
  una spec Allium, con `open question` si no están resueltas —
  `CONTRIBUTING.md §1` ya lo exige y `decisiones-y-preguntas-abiertas.md` de
  este plan cita las que hoy bloquean la fase 1.
- **Decisiones de alcance o secuencia del propio plan maestro** (por ejemplo,
  reordenar la cola, cerrar una fase, descubrir que una unidad ya no aplica)
  se anotan en el encabezado del documento que cambia, con fecha — el mismo
  patrón "Estado al escribirlo" que ya usan `docs/plan-*.md`. No se abre un
  archivo nuevo de decisiones por cada cambio pequeño.
- **Decisiones que le corresponden a Herbert y no a quien ejecuta** (ver
  `informe-final.md`, sección de decisiones) no las toma un agente por su
  cuenta ni las da por resueltas en un commit. Se preguntan, se documentan
  como pregunta, y se espera respuesta — igual que este mismo encargo de
  auditoría pidió explícitamente.

## 6. Cómo hacer handoff

Cuando una unidad queda a medio camino (por tiempo, por bloqueo, por una
pregunta abierta que apareció trabajándola):

1. **Deja la rama empujada**, aunque no esté lista para PR — con
   `--force-with-lease` si es necesario sobre tu propia rama, como permite
   `CONTRIBUTING.md §2`.
2. **El último commit describe el estado real**, no un progreso optimista:
   qué falta, qué se intentó y no funcionó, qué pregunta quedó sin responder.
   Es la misma disciplina que `docs/plan-local-first.md §7` aplica ("lo que
   este plan no decide") aplicada a una rama individual.
3. **No marques la unidad como completa en ningún lado** salvo que
   `make check` esté en verde y el PR esté abierto. Una unidad "casi lista" es
   una unidad pendiente, no una completada con detalles menores.
4. **Si la pregunta que bloqueó el trabajo es nueva** (no estaba en
   `decisiones-y-preguntas-abiertas.md` ni en la spec), agrégala ahí con el
   mismo formato que las existentes: qué se encontró, por qué bloquea, qué
   opciones hay.

## 7. Qué hacer si la cola está agotada o desactualizada

`cola-priorizada.md` es una fotografía al 2026-08-30. Si al leerla una unidad
ya está hecha, ya no aplica, o el código cambió lo suficiente como para que la
descripción sea engañosa: no la edites en el sitio como si fuera un tablero
vivo. Ábrele una rama de documentación (`docs: actualizar cola priorizada tras
u1.1`) que la corrija, con el mismo criterio de PR que cualquier otro cambio —
esto mantiene la cola confiable sin convertirla en el tablero de estado que
`docs/README.md` explícitamente evita.

## 8. Coordinación entre varios repositorios y muchos agentes en paralelo

Añadido el 2026-09-03, tras un episodio real: una sesión construyó
`client-grants.allium` sobre un modelo de credencial que otra sesión ya había
cambiado en `origin/main` — sólo lo notó porque otra sesión (esta) mencionó
de pasada un commit reciente, no porque el proceso lo obligara. El fondo del
problema no era falta de mensajes: era que nada obligaba a mirar
`origin/main` antes de seguir trabajando.

- **Antes de empezar, retomar o publicar cualquier tarea, ejecuta `npm run
  preflight`.** Hace `git fetch --prune` y compara contra el upstream real de
  la rama; si no existe, usa `origin/HEAD`. No presupone `origin/main`, porque
  hoy este repositorio sigue `origin/v0.6-federacion`. Repite el control al
  final: otra persona puede haber publicado mientras trabajabas. En cualquier
  otro repositorio relacionado hay que ejecutar su preflight equivalente o,
  si no existe, hacer el fetch y la comparación explícitamente.
- **Cuando resuelvas una pregunta abierta de una spec Allium, anúncialo
  activamente** a las sesiones que puedan depender de ella (`ListAgents` +
  `SendMessage`), en el momento de decidirlo — no basta con que quede en el
  commit. Un cambio de contrato silencioso es exactamente lo que invalida
  trabajo ajeno en curso.
- **Cuando tu tarea cruza repositorios** (por ejemplo `vera` y
  `vera-conecta`, que comparten un contrato pero viven en repos separados),
  identifica primero quién más está trabajando en el otro repositorio antes
  de tocar una interfaz compartida — el nombre de la sesión en `ListAgents`
  suele bastar para ubicarla. Pregunta alcance antes de asumir que un archivo
  está libre, y confirma antes de mergear a la rama principal de cada
  repositorio, no sólo en el propio.
- **Un worktree que ya se mezcló a la rama principal es redundante, no
  huérfano.** Antes de borrarlo, confirma con quien lo creó (si sigue vivo en
  `ListAgents`) o verifica que su contenido esté completo en la rama
  principal del repositorio correspondiente. Un worktree marcado como
  `locked` en `git worktree list` normalmente significa que una sesión viva
  lo tiene abierto — no se retira sin preguntar.
