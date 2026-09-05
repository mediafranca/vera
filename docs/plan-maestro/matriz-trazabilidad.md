# Matriz de trazabilidad — capacidad → spec → implementación → tests → estado

Auditoría base: 2026-08-30. Reconciliada con código y specs el 2026-09-05.
`npm run traceability:check` comprueba que cada archivo de `specs/` tenga una
sola fila aquí; la CI lo ejecuta en cada cambio. El estado de una corrida no se
congela en este documento: `npm run spec`, `npm test`, `npm run typecheck` y
`npm run build` son la autoridad y deben pasar antes de actualizar un estado.

## Cómo leer el estado

- **VERIFICADO** — hay código y hay test que lo ejercita, y el test pasa.
- **IMPLEMENTADO SIN TEST SUFICIENTE** — el código existe y parece correcto,
  pero ningún test lo ejercita (o sólo ejercita una función pura extraída, no
  la integración real).
- **PARCIAL** — una parte está verificada y otra parte de la misma capacidad
  no existe o no está probada.
- **NO ENCONTRADO** — cero líneas de código para lo que la spec o el roadmap
  describen.
- **HUÉRFANA** — la spec existe, es válida, y no hay ningún código que la
  implemente (subconjunto de NO ENCONTRADO, a nivel de spec completa).

## Por spec

| Spec | `allium check` | Implementación | Tests | Estado |
| --- | --- | --- | --- | --- |
| `agent-conversation` | limpio | ninguna (spec de 585 líneas, commit `34c3d43`, un commit antes de esta auditoría) | ninguno | HUÉRFANA por diseño spec-first — recién nacida |
| `agent-participation` | limpio | `server/src/credentials.ts:3`, `core/src/invariants.ts:334`, `web/src/behind.ts:14`, `server/src/server.ts:1539` | `server/test/agent-participation.test.ts` (20/20) | VERIFICADO |
| `bibliographic-integration` | limpio | `server/src/zotero.ts:6` (cita explícita) | `server/test/services.test.ts` (cubre conexión, no re-sincronización) | PARCIAL — falta `BibliographicRecord`/`presence`/`source_version` |
| `block-as-request` | limpio | `server/src/answer.ts` | `server/test/answer.test.ts` | VERIFICADO — ver contradicción sobre `TheModelIsLocalOrThereIsNone` en decisiones-y-preguntas-abiertas.md |
| `block-editing` | limpio | `web/src/caret.ts:3`, `core/src/list.ts:3`, `web/src/outliner.ts:768` | `web/test/caret.test.ts` | VERIFICADO |
| `block-gloss` | warning (`GlossDisclosure` sin usar) | núcleo en `core/graph.ts` (`#glosses`, `set_block_gloss`), UI en `outliner.ts:2692-2864` | `core/test/block-gloss.test.ts` | VERIFICADO |
| `change-application` | limpio | `core/src/types.ts`, `core/src/invariants.ts`, `server/src/server.ts` (`POST /operations/batch`) | `core/test/change-application.test.ts`, `server/test/server.test.ts` | VERIFICADO — el lote idempotente y atómico ya está implementado |
| `confined-writing` | limpio | `server/src/confinement.ts:3`, `web/src/api.ts:1522` | `server/test/confined-writing.test.ts` (14/14) | VERIFICADO |
| `content-media` | limpio | `store/src/objects.ts:6` (`@invariant SourceFidelity`), `web/src/media-dialog.ts`, `executable-frames.ts` | `core/test/markdown.test.ts` (parcial) | VERIFICADO por dominio, sin cita explícita del nombre de spec |
| `controlled-ontology` | warning (`RelationAssertion` sin usar) | `server/src/answer.ts:19`, `process.ts:4`, `core/src/ontology.ts` | `core/test/ontology.test.ts` | VERIFICADO |
| `core` | warning (`PageReference` sin usar) | 11 archivos citan `core.allium` explícitamente | `core/test/core-model.test.ts`, `change-application.test.ts` | VERIFICADO — spec fundacional, la más referenciada |
| `daily-log` | limpio | `web/src/main.ts`, `autocomplete.ts`, `core/src/text.ts` | sin `.test.ts` dedicado (cobertura indirecta probable) | IMPLEMENTADO SIN TEST SUFICIENTE |
| `desktop-distribution` | limpio | `scripts/build-desktop.mjs`, `.github/workflows/desktop.yml`, configuración `build` en `package.json` | verificación de tag y builds de release en CI | PARCIAL — empaquetado alfa construido; firma comercial de Windows/macOS no disponible |
| `document-import` | limpio | `importer/src/document.ts:1`, `server/src/server.ts` | `importer/test/document.test.ts` | VERIFICADO |
| `executable-content-sandbox` | limpio | `core/src/markdown.ts:3`, `web/src/outliner.ts`, `server/src/server.ts` | `core/test/markdown.test.ts` | VERIFICADO |
| `federated-sharing` | limpio | ninguna | ninguno | HUÉRFANA — excluida explícitamente por `shared-space-access.allium:14-15` (complementaria, no contradictoria) |
| `graph-navigation` | limpio | `core/src/graph.ts:2`, `index.ts`, `invariants.ts` | `core/test/graph-navigation.test.ts` | VERIFICADO |
| `hand-drawing` | limpio | `core/src/drawing.ts`, `web/src/canvas.ts`, `keys.ts` | `core/test/drawing.test.ts`, `web/test/canvas.test.ts` | VERIFICADO |
| `identity-access` | limpio | `server/src/human-auth.ts` (WebAuthn completo), `main.ts:38`, `graph.ts:164` | `server/test/issue-owner.test.ts`; uso indirecto en `shared-space-access.test.ts` | PARCIAL — funciona para invitados; el dueño no tiene ceremonia de alta propia (ver decisiones-y-preguntas-abiertas.md, hallazgo E-1) |
| `librarian-round` | limpio | ninguna funcional — un comentario de diseño en `outliner.ts:1002` | ninguno | HUÉRFANA |
| `logseq-block-identity-reference` | limpio | `store/src/projection.ts:1` (cita explícita), `importer/src/import.ts`, `web/src/keys.ts` | `web/test/naming.test.ts`, `importer/test/logseq.test.ts` | VERIFICADO |
| `mcp-server` | información | `mcp/src/tools.ts`, `main.ts`, `client.ts`, `server/src/mcp-page.ts`, `mcp-connect.ts`; lote en `server/src/server.ts` | `mcp/test/tools.test.ts`, `connection.test.ts`, `server/test/mcp-page.test.ts`, `server/test/server.test.ts` | VERIFICADO — escritura individual y por lote implementadas |
| `offline-reconciliation` | limpio | `web/src/replica.ts`, `reconcile.ts`, `outbox.ts`, `held.ts`, `behind.ts` | `web/test/replica.test.ts`, `outbox.test.ts`, `behind.test.ts` (599/599 en el batch core+store+web relevante) | PARCIAL — ver fase 1, unidades 1.2 y 1.3 |
| `page-on-paper` | limpio | `server/src/paper.ts` (coincide literalmente, sin cita de nombre) | `server/test/paper.test.ts` | VERIFICADO por contenido — falta trazabilidad explícita en el código |
| `page-presentation` | limpio | `web/src/presentation.ts`, activación semántica en `web/src/outliner.ts`, reapertura desde `web/src/main.ts` | `web/test/presentation.test.ts`; suite de renderers indirecta | VERIFICADO — botón y preview ordinario, proyección y navegación Reveal, deep link por lámina, refresco explícito de revisión, controles propios, glosas privadas y retorno al bloque fuente |
| `governed-stylesheet` | limpio | `web/src/presentation-style.ts`, `web/src/presentation.ts`, `web/src/styles.css` | `web/test/presentation.test.ts` | VERIFICADO — hoja predeterminada y tema por página, cascada explícita, confinamiento, rechazo de dependencias remotas y último valor válido |
| `page-processing` | limpio | `server/src/structure.ts:2` (cita explícita), `tabularity.ts` | `server/test/structure.test.ts`, `tabularity.test.ts` | VERIFICADO — no confundir con `processing-forms` (huérfana) |
| `peer-networking` | warning (4: `PeerInvitation`, `Reachability`, `PeerExchange`, `RelayedPassage` sin usar) | ninguna | ninguno | HUÉRFANA — coincide con el roadmap: "prototipo de red horizontal" pendiente |
| `personal-site-projection` | warning (3) | `core/src/types.ts`, `store/src/public-projection.ts`, `publication-page.ts` | `server/test/publication.test.ts`, `store/test/public-projection.test.ts` | VERIFICADO |
| `processing-forms` | limpio | ninguna — ni `ProcessingFormDefinition` ni `AFormIsMoreThanItsPrompt` existen en el repo | ninguno | HUÉRFANA — distinta de `page-processing` |
| `query-language` | limpio | `core/src/query.ts`, `query-source.ts` | `core/test/search-and-query.test.ts`, `query-source.test.ts` | VERIFICADO |
| `search-index` | limpio | `core/src/graph.ts`, `index.ts` | `core/test/search-and-query.test.ts` | VERIFICADO |
| `service-connections` | warning (3) | `server/src/services.ts`, `zotero.ts`, `store/src/secrets.ts` | `server/test/services.test.ts` | VERIFICADO funcionalmente — cifrado de secretos es pregunta abierta ya declarada en la propia spec, ver E-4 |
| `shared-space-access` | limpio | `server/src/shared-spaces.ts` | `server/test/shared-space-access.test.ts` (18/18 en corrida limpia; una corrida aislada mostró un 404 atribuible a carrera de puerto entre corridas del test runner, no a la función) | VERIFICADO — agrupar operaciones estructurales en una propuesta atómica queda pendiente, declarado por la propia spec |
| `special-pages` | limpio | `web/src/table.ts`, `governing-table.ts`, `server/src/server.ts` | sin test dedicado hallado | IMPLEMENTADO SIN TEST SUFICIENTE |
| `tasks` | limpio | `core/src/task.ts` | `core/test/task.test.ts` | VERIFICADO |
| `trail` | limpio | `core/src/trail.ts`, `relations.ts`, `web/src/graph/spine.ts`, `promote.ts` | `core/test/trail.test.ts`, `relations.test.ts`, `web/test/spine.test.ts`, `promote.test.ts` | VERIFICADO en núcleo; capa de presentación (`web/src/trail-page.ts`) sin test dedicado |
| `undo` | warning (2) | `core/src/undo.ts` | `core/test/undo.test.ts` | VERIFICADO |
| `voice-capture` | limpio | `web/src/voice.ts:7` (`@invariant TheMachineNeverPassesForAHand`), `server/src/transcribe.ts` | `server/test/transcribe.test.ts` — sin test de cliente (`voice.ts`/`audio-block.ts`) | PARCIAL — más el hallazgo de invariante inexistente citado, ver E-2 |
| `waiting` | limpio | `web/src/waiting.ts` | `web/test/waiting.test.ts` (18/18) | VERIFICADO |
| `workspace-interface` | warning (1) | `web/src/trace.ts`, `outliner.ts`, `store/src/store.ts` | cobertura difusa, decenas de tests indirectos en `web/test/*` | VERIFICADO por dominio — spec "paraguas" |

## Por capacidad del roadmap (sección 1 — prioridad de esta auditoría)

| Capacidad declarada en el roadmap | Estado declarado | Estado verificado | Evidencia |
| --- | --- | --- | --- |
| Registro canónico de operaciones (op-log) | hecho | **VERIFICADO** | `core/src/graph.ts:447-529` (`submitOperation`, única vía de escritura), `:1829-1872` (`replayFromLog`); `store/src/store.ts:131-199` (SAVEPOINT atómico) |
| Edición local optimista | hecho | **VERIFICADO** | `web/src/replica.ts:227-248` (`applyLocally`), 13 tests en `replica.test.ts` |
| Bandeja durable sin red (outbox) | hecho | **VERIFICADO** | `web/src/outbox.ts:95-172`, 13 tests en `outbox.test.ts` |
| Retención local de páginas leídas | hecho | **VERIFICADO** | `web/src/held.ts:131-212`, 36 tests en `held.test.ts` |
| Mostrar retenido primero y reconciliar | hecho | **PARCIAL** | Piezas unitarias probadas (`behind.ts` + `behind.test.ts`); orquestación completa en `main.ts` (3537 líneas) sin test de integración |
| Resolver conflictos por bloque | hecho | **PARCIAL** | Cálculo de desacuerdo y diff VERIFICADO (`behind.ts:155-220`); diálogo de resolución (`reconcile.ts`) y su aplicación (`main.ts:2072-2101`) sin ningún test |
| Restauración integral / continuidad tras pérdida de máquina | pendiente | **NO ENCONTRADO — confirmado** | Sin script, sin test, sin mecanismo de recuperación completo |
| Respaldo, portabilidad, migraciones entre versiones, secretos | pendiente | **NO ENCONTRADO — confirmado, y agravado** | Sin script de backup/export en `scripts/`; secretos de servicios en **texto plano** (`store/src/secrets.ts:52-67`) |
| Autenticación humana y sesiones (dueño) | pendiente | **PARCIAL, más grave de lo declarado** | WebAuthn implementado y probado, pero **sólo para invitados**; el dueño no tiene ninguna vía de alta — ver E-1 |
| Recuperación raíz local fuera de HTTP | hecho | **VERIFICADO, con riesgo** | `server/src/issue-owner.ts` funciona; cada ejecución emite un token sin revocar los anteriores — ver E-5 |
| Espacios compartidos y subgrafos | implementación parcial | **VERIFICADO** para lo declarado hecho | `server/src/shared-spaces.ts`, 18/18 tests; falta agrupar operaciones estructurales, ya declarado por la propia spec |
| Red horizontal entre instancias | pendiente | **NO ENCONTRADO — confirmado** | Cero ocurrencias de `peer`/`federat` en el código |
| Identidad y sincronización federada | pendiente | **NO ENCONTRADO — confirmado** | Igual que arriba |
| Conversación con el bibliotecario | pendiente (spec recién escrita) | **NO ENCONTRADO — confirmado** | Cero entidades `Conversation`/`AgentReply`/`OperationProposal` en el repo |
| VeraAgentManifest | pendiente | **NO ENCONTRADO — confirmado** | Cero ocurrencias relevantes de `manifest`/`Manifest` fuera de PWA/proyección Markdown |
| Fluidez de edición estructural | hecho | **VERIFICADO en lógica, sin prueba de integración DOM** | Cada invariante de la spec tiene contraparte citada en código; pero no existe jsdom/happy-dom en el repo y varios archivos "de interfaz" (`gui-priorities.test.ts`, `mobile-priority.test.ts`) son aserciones de regex sobre el código fuente, no ejecución de comportamiento |
| Arrastre de subárbol desde la viñeta | hecho | **IMPLEMENTADO SIN TEST SUFICIENTE, con hueco de accesibilidad** | Solo eventos HTML5 nativos (`outliner.ts:4062-4133`); sin `touchstart`/`pointerdown`; sin equivalente por teclado para reparentar a posición arbitraria |

## Riesgos técnicos consolidados (de los cuatro agentes, con archivo:línea)

1. Nueve de diez sitios de escritura en `server.ts` no capturan el fallo de
   `recordOperation()`: si SQLite lanza (disco lleno, ocupado, violación de
   restricción), el grafo en memoria del proceso diverge del disco de forma
   silenciosa y persistente hasta el reinicio. El único punto que sí lo maneja
   es `server.ts:1452-1476`.
2. El servidor es un singleton en memoria (`let graph = loadGraph(...)`) sin
   coordinación multi-proceso: dos instancias contra el mismo SQLite
   escribirían sin protección.
3. Secretos de servicios de terceros en texto plano
   (`store/src/secrets.ts:52-67`, columna `secret TEXT`).
4. Sin rate-limiting en ninguna puerta: API, `/human-auth/*`, invitaciones, MCP
   HTTP.
5. Sin límite de tiempo por petición en la puerta MCP pública
   (`mcp/src/http.ts`) — contradice explícitamente `ThePublicDoorHasBounds`.
6. `issue-owner.ts` emite un token raíz nuevo en cada ejecución sin revocar los
   anteriores.
7. El dueño no tiene ninguna vía de autenticación humana propia — toda la
   superficie de `AuthenticatedOwner` depende de un flujo de *bootstrap* de
   passkey que no existe; hoy funciona sólo porque todo corre en loopback.
8. Cero cobertura de test de interacción DOM real en `packages/web` (no hay
   jsdom/happy-dom en ningún `package.json`).
9. Arrastre de subárbol no funciona en touch; sin alternativa de teclado para
    reparentar a una posición arbitraria distinta de "arriba/abajo".
