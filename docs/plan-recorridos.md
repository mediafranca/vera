# Plan: del rastro al argumento

> **Documento histórico.** Conserva la medida y el orden que guiaron la primera
> implementación. Varios pasos descritos como ausentes ya existen. Para el mapa
> vigente de conceptos, código y pruebas, ver
> [Fundamentos epistémicos y recorridos argumentales](fundamentos-epistemicos.md).

Estado al escribirlo: `allium check specs/` limpio (0 errores, 0 avisos, 19 specs),
387 tests en verde, `packages/web/src/graph/render3d.ts` con cambios sin confirmar.

Este documento existe porque las specs de `trail.allium` y `workspace-interface.allium`
acaban de describir comportamiento que el código no tiene. Dice cuánto hueco hay,
de qué clase es cada trozo, y en qué orden conviene cerrarlo.

## 1. La medida

Obligaciones derivadas con `allium plan`:

| Spec | Antes | Ahora | Nuevas hoy | Tests que las cubren |
| --- | ---: | ---: | ---: | ---: |
| `trail.allium` | 44 | 55 | +11 | 0 |
| `workspace-interface.allium` | 71 | 82 | +11 | 0 |
| `core.allium` | 81 | 81 | 0 | cubierta |

Lo primero que hay que decir, porque cambia la conversación: **de las 137
obligaciones de estas dos specs, 115 ya estaban sin implementar antes de hoy.**
Ninguna de las dos entró en v0 — `docs/test-obligations.md` lo dice: «las otras
siete specs suman 262 obligaciones más, quedan fuera de v0 y sin tests».

El trabajo de hoy es el 16% de esta deuda. El otro 84% es que el recorrido nunca
se implementó. Eso no lo hace menos deuda, pero sí cambia qué se está decidiendo:
no es «arreglar lo que rompimos», es «construir por fin lo que estaba escrito».

## 2. Dos clases de deuda, y sólo una urge

### Contradicción — el código hace algo que la spec ahora prohíbe

Son seis, todas pequeñas, y son las únicas que corren prisa: mientras existan,
leer el código y leer la spec dan respuestas distintas.

| # | Sitio | Contradicción |
| --- | --- | --- |
| C1 | `packages/core/src/types.ts:17` y `schema/schema.sql:133,424` | `walked` no existe como canal |
| C2 | `packages/web/src/main.ts:385` | `workspace.history` es `string[]`; la spec pide `TraceStep[]` |
| C3 | `packages/web/src/main.ts` (~8 llamadas a `openPage`) | el gesto no se observa; la spec lo exige y prohíbe inferirlo |
| C4 | `packages/web/src/main.ts:610-617` | `drawTrail()` deduplica; el objeto es un *walk* y volver es significativo |
| C5 | `packages/web/src/main.ts:352,386` | `HISTORY = 50` trunca en silencio un rastro que ahora es promovible |
| C6 | `packages/web/src/main.ts:603` | cita `@guarantee TheTrailIsWhereOneIsLocated`; se llama `TheTraceIsWhereOneIsLocated` |

C4 merece una nota porque es un cambio visible: hoy volver dos veces a la misma
página la enseña una vez. La spec decidió lo contrario —volver es significativo, y
prohibirlo sería prohibir leer un círculo como círculo— así que el rastro va a
enseñar repeticiones donde antes las colapsaba.

### Ausencia — la spec describe algo que no existe en ninguna parte

Todo `Trail`, `Crossing`, `crossing_kind`, la promoción, el hilo en el mapa y la
lectura a dos voces. Cero líneas de código. No contradice nada: falta.

## 3. El blocker que no es del recorrido

`packages/store/src/store.ts:42` tiene un mecanismo de migración —`ADDED_COLUMNS`—
que sólo sabe **añadir columnas**. No puede cambiar un `CHECK`.

Añadir `walked` toca dos constraints:

- `operations.channel` (schema.sql:133) — 50.450 filas, el registro canónico
- `block_authorship.channel` (schema.sql:424) — 44.989 filas

`revisions.channel` no tiene `CHECK`, así que no estorba.

En SQLite, cambiar un `CHECK` pide reconstruir la tabla: crear la nueva, copiar,
soltar la vieja, renombrar. Sobre `operations` eso es reconstruir el log canónico
de una base de 50 MB con WAL abierto.

**Esto no es deuda del recorrido: es deuda de Vera.** Cualquier cambio futuro de
spec que toque un constraint choca aquí. Antes de tocar el canal conviene decidir
si se resuelve con un rebuild puntual o introduciendo `PRAGMA user_version` y
migraciones de verdad. Lo segundo cuesta más hoy y deja de doler para siempre.

## 4. Los pasos

Cada uno es entregable por su cuenta y no obliga al siguiente.

### Paso 0 — Migraciones y el canal `walked` — **hecho**
Tocó: `packages/store/src/migrations.ts` (nuevo), `store.ts`, `schema/schema.sql`,
`core/src/types.ts`, `server.ts` (la lista de canales se deriva del dominio en vez
de repetirse), y C6 de paso.

Migración 1 aplicada sobre `data/vera.sqlite`: 50.450 operaciones, `max(sequence)`
y `sum(sequence)` idénticos, 44.989 filas de autoría, los 18 índices en pie,
`foreign_key_check` limpio, `user_version` 0 → 1. Copia previa en
`data/vera.sqlite.bak-pre-migrations`.

400 tests en verde (387 antes, 13 nuevos en `packages/store/test/migrations.test.ts`),
`typecheck` limpio.

Quedan sin resolver dos cosas que este paso deja a la vista y no cierra:
- El cliente WASM/OPFS aplicará el mismo `schema.sql` pero no pasa por `openStore()`,
  así que hoy no tiene por dónde correr migraciones. Cuando se construya, necesita
  su propio arranque que llame a `migrate()`.
- `ADDED_COLUMNS` y `migrations.ts` conviven. Es correcto pero son dos mecanismos;
  si el primero llega a estorbar, el arreglo es una migración que garantice las
  tres columnas y borrar la lista.

### Paso 1 — El rastro recuerda cómo, no sólo dónde
Toca: `main.ts` (estado `history` → `TraceStep[]`, gesto en cada llamada a `openPage`),
`drawTrail()`. Resuelve C2, C3, C4, C5.
Desbloquea: la promoción, que necesita el gesto para escribir el testimonio.
Se ve: el rastro deja de colapsar repeticiones.
Nota: el gesto se observa donde ocurre — enlace, backlink, nodo del mapa, buscador,
píldora del rastro. Ninguno se deduce después mirando el grafo; la spec lo prohíbe
en `TheGestureIsObservedAndNeverInferred`, y la razón es que preguntan cosas
distintas.

### Paso 2 — El rastro se ordena y se poda
Toca: `drawTrail()` y `styles.css` (`#map-trail`, `.trail-pill`). Arrastrar para
reordenar, quitar un paso.
Desbloquea: nada — es hoja.
Se ve: mucho. Es la mitad de componer un argumento, y ocurre antes de que nadie
decida componer uno.
Cuidado: el rastro sigue sin persistir. Media hora de ordenar se pierde al cerrar
la pestaña. Es una pregunta abierta declarada en `trail.allium`, no un descuido —
pero si el paso 2 hace que la gente ordene de verdad, la pregunta deja de ser
teórica.

### Paso 3 — Promover (el corazoncito)
Toca: `main.ts`, `api.ts`, y el camino de operaciones del servidor.
Crea la página privada con `type:: argumento`, un bloque por cita, un bloque vacío
entre cada dos, y `crossed::` en los vacíos con canal `walked`.
Desbloquea: que haya argumentos en el corpus.
Se ve: todo el gesto completo — andar, ordenar, promover, escribir.
**Aquí se puede parar.** Los pasos 0–3 dan el flujo entero sin calcular una sola
cara derivada.

### Paso 4 — Derivar el cruce
Toca: `@vera/core` (nuevo módulo), consulta sobre `page_links` para `crossing_kind`.
Es la primera vez que se necesita «¿hay enlace entre A y B en cualquier sentido,
excluyendo los que salen de la página del recorrido?».
Desbloquea: 5, 6 y los avisos.
Se ve: nada por sí solo.

### Paso 5 — Las dos caras a la vista
Toca: `outliner.ts` (huecos distinguidos por clase al componer) y la lectura a dos
voces.
Se ve: el trabajo que falta deja de ser «renglones vacíos» y pasa a tener clases.

### Paso 6 — El hilo en el mapa
Toca: `graph/render.ts` y `graph/render3d.ts`.
El nodo del recorrido se vuelve hilo, los tramos se dibujan según pasen por camino
o a campo través.
Es el paso más caro y el más prescindible al principio. También es donde está la
imagen que justifica todo lo demás: la aportación con forma.

### Fuera de este plan
`ARewrittenPremiseIsToldToItsGuide` (avisar al guía cuando una premisa se mueve) y
las puertas cerradas al publicar. Los dos dependen del paso 4 y ninguno hace falta
para que un recorrido exista.

## 5. El corte que recomiendo

**Pasos 0 a 3.** Cierra las seis contradicciones, resuelve el blocker de migración
que iba a doler igual por otro lado, y entrega el gesto completo. Lo que queda
después —4, 5, 6— es la lectura del cruce, que es lo más bonito y lo que menos
falta hace para empezar a escribir argumentos.

El orden importa por una razón concreta: el paso 3 escribe testimonio, el
testimonio pide el canal `walked`, y el canal pide el paso 0. No hay atajo.

## 6. Lo que este plan no decide

Tres preguntas abiertas de `trail.allium` van a apretar antes de lo que parece, y
ninguna se contesta escribiendo código:

- Si el rastro ordenado merece sobrevivir a la sesión (aprieta al acabar el paso 2).
- Si el binario del cruce aguanta en la vista de texto, donde no hay tramo que
  dibujar roto (aprieta en el paso 5).
- Si un recorrido publicado es un texto con sus nodos dentro o una capa sobre
  páginas que ya tienen URL (aprieta cuando alguien quiera publicar el primero).
