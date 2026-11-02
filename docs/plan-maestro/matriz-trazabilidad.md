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
| `agent-manifest` | limpio | `server/src/agent-manifests.ts`, `server/src/server.ts`, `web/src/agent-administration.ts` | `server/test/agent-manifest.test.ts`, `web/test/agent-administration.test.ts` | EXPERIMENTAL — principal humano, fuentes constitutivas, manifiesto versionado, activación/rollback, lectura propia y recibo de revisión efectiva; el ejecutor embebido sigue pendiente |
| `agent-participation` | limpio | `server/src/credentials.ts:3`, `core/src/invariants.ts:334`, `web/src/behind.ts:14`, `server/src/server.ts:1539` | `server/test/agent-participation.test.ts` (20/20) | VERIFICADO |
| `agent-tools` | limpio | ninguna; Zotero sigue integrado directamente mediante `server/src/services.ts` y `zotero.ts` | ninguno específico | HUÉRFANA por diseño spec-first — define catálogo de capacidades, concesión humana y proyección mínima al runtime; ejecución y recibos quedan diferidos |
| `capability-authoring` | warnings informativos (2 valores de informe sólo referidos desde contratos) | ninguna | ninguno específico | HUÉRFANA por diseño spec-first — define recetas declarativas, flujos compuestos y adaptadores confinados que un agente puede proponer, pero sólo una persona puede probar y activar |
| `argument-workbench` | limpio | `core/src/argument-workbench.ts`, `core/src/trail.ts`, `web/src/argument-workbench-page.ts`, `web/src/promote.ts` | `core/test/argument-workbench.test.ts`, `core/test/trail.test.ts`, `web/test/promote.test.ts` | PARCIAL — están verificados la siembra atómica desde el breadcrumb, la madurez reversible, la transformación de la misma página y la continuidad cartográfica; quedan abiertas interacciones más ricas de la mesa |
| `bibliographic-integration` | limpio | `server/src/zotero.ts:6` (cita explícita) | `server/test/services.test.ts` (cubre conexión, no re-sincronización) | PARCIAL — falta `BibliographicRecord`/`presence`/`source_version` |
| `block-as-request` | limpio | `server/src/answer.ts` | `server/test/answer.test.ts` | VERIFICADO — ver contradicción sobre `TheModelIsLocalOrThereIsNone` en decisiones-y-preguntas-abiertas.md |
| `block-editing` | limpio | `web/src/caret.ts:3`, `core/src/list.ts:3`, `web/src/outliner.ts:768` | `web/test/caret.test.ts` | VERIFICADO |
| `block-gloss` | warning (`GlossDisclosure` sin usar) | núcleo en `core/graph.ts` (`#glosses`, `set_block_gloss`), UI en `outliner.ts:2692-2864` | `core/test/block-gloss.test.ts` | VERIFICADO |
| `browser-capture` | warnings informativos | `server/src/server.ts` (`POST /captures`, trato `capturar`), `web/src/mcp-page.ts`; cliente en `vera-clip/lib/delivery.ts` | `server/test/server.test.ts`, `server/test/confined-writing.test.ts`; `vera-clip/test/delivery.test.ts` | VERIFICADO — autorización local copiable, identidad propietaria, canal `import`, alcance estrecho, revocación, prioridad local e idempotencia; un emparejamiento sin copiar queda como mejora posterior |
| `change-application` | limpio | `core/src/types.ts`, `core/src/invariants.ts`, `server/src/server.ts` (`POST /operations/batch`) | `core/test/change-application.test.ts`, `server/test/server.test.ts` | VERIFICADO — el lote idempotente y atómico ya está implementado |
| `confined-writing` | limpio | `server/src/confinement.ts:3`, `web/src/api.ts:1522` | `server/test/confined-writing.test.ts` (14/14) | VERIFICADO |
| `content-media` | limpio | `store/src/objects.ts:6` (`@invariant SourceFidelity`), `server/src/server.ts` (gestión transaccional y byte-estable), `web/src/media-dialog.ts`, `executable-frames.ts` | `server/test/media-management.test.ts`, `core/test/markdown.test.ts` | VERIFICADO: administrar un archivo sólo reescribe sus referencias y el registro distingue la transformación automática de la edición textual |
| `controlled-ontology` | warning (`RelationAssertion` sin usar) | `server/src/answer.ts:19`, `process.ts:4`, `core/src/ontology.ts` | `core/test/ontology.test.ts` | VERIFICADO |
| `core` | warning (`PageReference` sin usar) | 11 archivos citan `core.allium` explícitamente | `core/test/core-model.test.ts`, `change-application.test.ts` | VERIFICADO — spec fundacional, la más referenciada |
| `daily-log` | limpio | `web/src/main.ts`, `autocomplete.ts`, `core/src/text.ts` | sin `.test.ts` dedicado (cobertura indirecta probable) | IMPLEMENTADO SIN TEST SUFICIENTE |
| `desktop-distribution` | limpio | `scripts/build-desktop.mjs`, `scripts/stage-macos-legacy.mjs`, `.github/workflows/desktop.yml`, `.github/workflows/macos-catalina.yml`, configuración `build` en `package.json` | verificación de tag, política de actualización y builds de release en CI | PARCIAL — empaquetado alfa y edición Catalina legacy construidos; firma comercial de Windows/macOS no disponible |
| `desktop-connections` | warnings informativos | `desktop/src/conecta.ts`, integración de ciclo de vida y almacén seguro en `desktop/src/main.ts`, superficie en `web/src/mcp-page.ts` | `desktop/test/conecta.test.ts`, `server/test/mcp-page.test.ts`, `server/test/confined-writing.test.ts` | PARCIAL — emparejamiento, custodia, enlace saliente, latido y reconexión verificados por unidad; falta prueba externa contra el relay desplegado y depósito local de Vera Clip |
| `document-import` | limpio | `importer/src/document.ts:1`, `server/src/server.ts`, `web/src/document-import-dialog.ts` | `importer/test/document.test.ts`, `server/test/shared-space-access.test.ts`, `web/test/document-import-dialog.test.ts` | VERIFICADO |
| `editorial-folding` | limpio | `store/src/public-projection.ts`, `server/src/server.ts`, `web/src/outliner.ts` | `store/test/public-projection.test.ts`, `server/test/publication.test.ts` | VERIFICADO — el dueño fija el plegado editorial inicial; cada lector puede apartarse localmente sin reescribirlo |
| `epistemic-provenance` | limpio | vocabulario gobernado en `core/src/ontology.ts` y operaciones genéricas de propiedad; sin entidad ni superficie propia para propuestas de rol | `server/test/server.test.ts` (dominio de `rol epistémico`) | PARCIAL — existe la asignación gobernada del rol actual; faltan el ciclo propuesta/aceptación/rechazo del bibliotecario y su historia dedicada |
| `executable-content-sandbox` | limpio | `core/src/markdown.ts:3`, `web/src/outliner.ts`, `server/src/server.ts` | `core/test/markdown.test.ts` | VERIFICADO |
| `executable-process-blocks` | limpio | `web/src/process-block.ts`, `web/src/outliner.ts`, `server/src/remote-process.ts`, `server/src/pictos-process.ts`, endpoint declarativo en `server/src/server.ts` | `web/test/process-block.test.ts`, `web/test/gui-priorities.test.ts`, `server/test/remote-process.test.ts`, `server/test/pictos-process.test.ts` | PARCIAL — están verificados fuente autocontenida editable, conexión gobernada sin exponer secretos, invocar, ejecutar, regenerar, aceptar como hermano, persistir la traza y encadenar tres bloques; la demostración vectorial local no reproduce el PICTOS actual, cuya producción de mejor calidad pasa por bitmap y cuya reconstrucción estructurada como SVG sigue siendo su debilidad; faltan además puertos múltiples, código insertable y señal de salidas desactualizadas |
| `external-editing` | limpio | `web/src/external-editing.ts` (estado durable, conciliación conservadora y proyección tipada de página/bloque), `web/src/external-editing-dialog.ts`, `web/src/settings.ts`, menús de `web/src/outliner.ts`, ficha `web/src/media-dialog.ts`, `desktop/src/external-editing.ts` y puente IPC; `/operations/batch` cercado por secuencia base | `web/test/external-editing.test.ts`, `web/test/settings-navigation.test.ts`, `desktop/test/external-editing.test.ts`, `server/test/server.test.ts` | PARCIAL — página y bloque abren su fuente portable en el editor asociado; Mermaid, SVG, HTML, p5.js, proceso, MediaWiki y código conservan cercado e identidad al aceptar; las asociaciones son locales al dispositivo y vuelven opcionalmente a la aplicación del sistema; los binarios se gobiernan desde su ficha única de Archivos y reemplazan explícitamente el recurso compartido; faltan cablear allí la edición externa y la conciliación visual en Registro de actividad |
| `federated-sharing` | limpio | ninguna | ninguno | HUÉRFANA — distingue suscripción de sólo lectura, réplica colaborativa, retractación y fork; `shared-space-access` implementa acceso dentro de una instancia, pero el intercambio entre Veras sigue pendiente |
| `graph-navigation` | limpio | `core/src/graph.ts:2`, `index.ts`, `invariants.ts` | `core/test/graph-navigation.test.ts` | VERIFICADO |
| `hand-drawing` | limpio | `core/src/drawing.ts`, `web/src/canvas.ts`, `keys.ts` | `core/test/drawing.test.ts`, `web/test/canvas.test.ts` | VERIFICADO |
| `identity-access` | limpio | `server/src/human-auth.ts` (WebAuthn completo), `main.ts:38`, `graph.ts:164` | `server/test/issue-owner.test.ts`; uso indirecto en `shared-space-access.test.ts` | PARCIAL — funciona para invitados; el dueño no tiene ceremonia de alta propia (ver decisiones-y-preguntas-abiertas.md, hallazgo E-1) |
| `instance-profiles` | limpio | `schema/schema.sql` (`instances.profile`, concesiones e invitaciones); `server/src/instance-governance.ts`; puerta de sesión en `server.ts`; ingreso en `web/src/shared-access.ts` | `server/test/collective-auth.test.ts` | PARCIAL — perfil persistido, sesión humana obligatoria, roles de instancia e invitaciones administrator/editor/reader verificados; migración entre corpus, territorios no globales y gobierno colegiado siguen spec-first |
| `librarian-round` | limpio | ninguna funcional — un comentario de diseño en `outliner.ts:1002` | ninguno | HUÉRFANA |
| `logseq-block-identity-reference` | limpio | `store/src/projection.ts:1` (cita explícita), `importer/src/import.ts`, `web/src/keys.ts` | `web/test/naming.test.ts`, `importer/test/logseq.test.ts` | VERIFICADO |
| `mcp-server` | información | `mcp/src/tools.ts`, `main.ts`, `client.ts`, `server/src/mcp-page.ts`, `mcp-connect.ts`; alta y recetas en `web/src/mcp-page.ts`; consulta, cursores, revisiones y precondiciones en `server/src/server.ts` | `mcp/test/tools.test.ts`, `connection.test.ts`, `server/test/mcp-page.test.ts`, `server/test/server.test.ts`, `web/test/special-surface-layout.test.ts` | VERIFICADO — consulta estructurada y lectura paginada; escritura individual/lote; edición versionada de palabras propias; la primera credencial puede crearse con la puerta todavía vacía |
| `offline-reconciliation` | limpio | `web/src/replica.ts`, `reconcile.ts`, `outbox.ts`, `held.ts`, `behind.ts` | `web/test/replica.test.ts`, `outbox.test.ts`, `behind.test.ts` (599/599 en el batch core+store+web relevante) | PARCIAL — ver fase 1, unidades 1.2 y 1.3 |
| `ontology-roundtrip` | limpio | `web/src/governing-table.ts`, `web/src/ontology-governance-map.ts`, `web/src/main.ts` | `web/test/ontology-governance.test.ts` | EXPERIMENTAL — las tres páginas rectoras conservan identidad e historia y comparten selección, facetas y una edición round-trip; falta validación e impacto antes de ampliar los gestos de escritura |
| `page-on-paper` | limpio | `server/src/paper.ts` (coincide literalmente, sin cita de nombre) | `server/test/paper.test.ts` | VERIFICADO por contenido — falta trazabilidad explícita en el código |
| `page-presentation` | limpio | `web/src/presentation.ts`, activación semántica en `web/src/outliner.ts`, reapertura desde `web/src/main.ts` | `web/test/presentation.test.ts`; suite de renderers indirecta | VERIFICADO — botón y preview ordinario, proyección y navegación Reveal, deep link por lámina, refresco explícito de revisión, controles propios, glosas privadas y retorno al bloque fuente |
| `governed-stylesheet` | limpio | `web/src/presentation-style.ts`, `web/src/presentation.ts`, `web/src/styles.css` | `web/test/presentation.test.ts` | VERIFICADO — hoja predeterminada y tema por página, cascada explícita, confinamiento, rechazo de dependencias remotas y último valor válido |
| `page-processing` | limpio | `server/src/structure.ts:2` (cita explícita), `tabularity.ts` | `server/test/structure.test.ts`, `tabularity.test.ts` | VERIFICADO — no confundir con `processing-forms` (huérfana) |
| `peer-networking` | warning (4: `PeerInvitation`, `Reachability`, `PeerExchange`, `RelayedPassage` sin usar) | ninguna | ninguno | HUÉRFANA — coincide con el roadmap: "prototipo de red horizontal" pendiente |
| `personal-site-projection` | warning (3) | `core/src/types.ts`, `store/src/public-projection.ts`, `publication-page.ts` | `server/test/publication.test.ts`, `store/test/public-projection.test.ts` | VERIFICADO |
| `participant-profiles` | limpio | `server/src/server.ts`, `web/src/participant-profile.ts`, `web/src/activity-page.ts` | `server/test/server.test.ts`, `web/test/participant-profile.test.ts` | VERIFICADO — perfil derivado y durable, separación entre identidad operativa y página semántica, autorización humana de agentes y enlace al registro canónico |
| `processing-forms` | limpio | ninguna — ni `ProcessingFormDefinition` ni `AFormIsMoreThanItsPrompt` existen en el repo | ninguno | HUÉRFANA — distinta de `page-processing` |
| `query-language` | limpio | `core/src/query.ts`, `query-source.ts` | `core/test/search-and-query.test.ts`, `query-source.test.ts` | VERIFICADO |
| `search-index` | limpio | `core/src/graph.ts`, `index.ts` | `core/test/search-and-query.test.ts` | VERIFICADO |
| `service-connections` | warning (3) | `server/src/services.ts`, `zotero.ts`, `store/src/secrets.ts` | `server/test/services.test.ts` | PARCIAL — conexión y prueba verificadas; la implementación todavía conserva `GET /services/:id/secret` y devuelve el valor al dueño, en contradicción con la decisión vigente de reemplazar/revocar sin revelar; cifrado en reposo sigue abierto, ver E-4 |
| `shared-space-access` | limpio | `server/src/shared-spaces.ts`, `server/src/human-auth.ts`, `web/src/shared-access.ts`, `web/src/settings.ts` | `server/test/shared-space-access.test.ts`, `web/test/shared-access.test.ts` | VERIFICADO — una sesión humana puede autorizar otro dispositivo para la misma identidad sin crear participante, membresía ni permiso; agrupar operaciones estructurales en una propuesta atómica queda pendiente, declarado por la propia spec |
| `special-pages` | limpio | `web/src/table.ts`, `governing-table.ts`, `governance-page.ts`, `server/src/server.ts`, starter universal en `server/src/starter-memory.ts` y `starter-governance.ts` | `server/test/starter-memory.test.ts`, `web/test/special-surface-layout.test.ts` | VERIFICADO — una memoria nueva trae Gobierno, Conexiones, Propiedades, Objetos y Relaciones; el índice se deriva de sus declaraciones vivas |
| `tasks` | limpio | `core/src/task.ts` | `core/test/task.test.ts` | VERIFICADO |
| `trail` | limpio | `core/src/trail.ts`, `relations.ts`, `web/src/graph/spine.ts`, `promote.ts` | `core/test/trail.test.ts`, `relations.test.ts`, `web/test/spine.test.ts`, `promote.test.ts` | VERIFICADO en núcleo; capa de presentación (`web/src/trail-page.ts`) sin test dedicado |
| `undo` | warning (2) | `core/src/undo.ts` | `core/test/undo.test.ts` | VERIFICADO |
| `voice-capture` | limpio | `web/src/voice.ts`, `web/src/settings.ts`, `server/src/transcribe.ts`, `server/src/speech.ts`, `server/src/voice-configuration.ts` | `server/test/transcribe.test.ts`, `server/test/speech.test.ts`, `server/test/voice-configuration.test.ts`, `web/test/settings-navigation.test.ts` — sin test de captura real del micrófono | PARCIAL — activación, diagnóstico e instalación asistida de STT/TTS verificadas; falta benchmark por perfil de hardware y voz administrada en Desktop |
| `waiting` | limpio | `web/src/waiting.ts` | `web/test/waiting.test.ts` (18/18) | VERIFICADO |
| `workspace-interface` | warning (1) | `web/src/trace.ts`, `outliner.ts`, `tokens.ts`, `graph/render*.ts`, `mermaid.ts`, `store/src/store.ts`, `public-projection.ts` | cobertura difusa más `tokens.test.ts`, `gui-priorities.test.ts`, `mermaid.test.ts`, `service-status.test.ts`, `public-projection.test.ts` | VERIFICADO por dominio — spec "paraguas"; vocabulario, tinta efectiva y propagación de tokens fijados |

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
| VeraAgentManifest | pendiente | **EXPERIMENTAL** | `agent_principals`, `agent_constitution_pages`, `agent_manifests` y `agent_runtime_receipts`; activación/rollback, lectura propia y divergencia runtime/manifiesto verificadas. El runtime embebido y la migración del Gateway siguen pendientes |
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
