# Decisiones vigentes y preguntas abiertas

Estado al escribirlo: 2026-08-30. Este registro no duplica las preguntas
abiertas que ya viven declaradas dentro de cada spec (`open question "…"`) ni
las páginas de decisión del corpus de Vera. Reúne dos cosas distintas: (1)
preguntas que esta auditoría encontró y que **no estaban visibles** en ningún
documento antes de hoy, y (2) las preguntas ya declaradas en specs que son
bloqueantes concretas para la fase 1 y merecen quedar citadas aquí porque el
plan de ejecución las referencia por número.

## Hallazgos nuevos de esta auditoría (no declarados antes)

### E-1. Dos mecanismos de recuperación del dueño, sólo uno implementado
`identity-access.allium` especifica `TheOwnerIssuesFromTheMachine` →
`AccessToken` de agente, y está implementado (`issue-owner.ts`).
`shared-space-access.allium` especifica un mecanismo *distinto*:
`AuthorizeOwnerAuthenticatorFromMachine` → `AuthenticatorEnrollment` → passkey
WebAuthn (`HumanAccessBootstrap`/`awaiting_first_passkey`). Este segundo
mecanismo **no existe en el código**: la única función que inserta en
`authenticator_enrollments` es `redeemInvitation`
(`packages/server/src/shared-spaces.ts:309`), pensada para invitados, no para
el dueño.

**Por qué bloquea:** cerrar `NobodyIsAssumed` (unidad 1.4) requiere que el
dueño pueda presentar una credencial humana real. Hoy no puede — el sistema de
sesión humana sólo se ejerce para invitados.

**Opciones:**
- (a) Construir el *bootstrap* de passkey del dueño tal como
  `shared-space-access.allium` ya lo especifica. Costo: una superficie de
  *enrollment* nueva y sensible (es la puerta que decide quién es el dueño).
  Consecuencia: dos specs quedan coherentes entre sí sin tocar ninguna.
- (b) Retirar `AuthorizeOwnerAuthenticatorFromMachine` de
  `shared-space-access.allium` y declarar que el dueño se identifica ante la
  aplicación web mediante el mismo `AccessToken` de `issue-owner.ts`, adaptado
  para el navegador. Costo: revisar la spec (`tend`) para eliminar la
  ambigüedad. Consecuencia: un solo mecanismo de identidad de dueño en todo
  el sistema, más simple de auditar.

Esta es una decisión de producto y de seguridad, no de implementación: decide
quién puede llegar a ser el dueño de una instancia y por qué puerta.

**Decisión (2026-08-30, Herbert):** construir el *bootstrap* de passkey del
dueño tal como `shared-space-access.allium` ya lo especifica (opción a). La
unidad `u1.4a` de `cola-priorizada.md` queda desbloqueada.

### E-2. Invariante citado en código que no existe en ninguna spec
`packages/server/src/transcribe.ts:6` declara implementar
`@invariant EveryLinkIsHumanlyConfirmed`. Ese nombre no aparece en ninguno de
los 38 archivos `.allium` (grep exhaustivo). O el invariante fue renombrado o
removido de `voice-capture.allium` sin actualizar la cita, o nunca llegó a
escribirse en la spec.

**Por qué importa:** el método del repositorio (`CONTRIBUTING.md` §1) hace de
la cita `@invariant`/`@guarantee` el mecanismo con el que se va del código a
su razón y de la razón al código. Una cita rota rompe ese mecanismo justo en
el dominio de voz, donde la garantía en juego (que un enlace generado por
transcripción fue confirmado por una persona) es sensible.

**Acción sugerida:** revisar `voice-capture.allium` con `weed` para encontrar
si el invariante correcto tiene otro nombre hoy, y corregir la cita en
`transcribe.ts` — o, si el invariante nunca se escribió, escribirlo.

### E-3. Invariante con el mismo nombre en dos specs sin relación declarada
`@invariant TheModelIsLocalOrThereIsNone` está declarado de forma
independiente en `specs/block-as-request.allium:37` y en
`specs/controlled-ontology.allium:551`. `block-as-request.allium` no importa
`controlled-ontology.allium` (su único `use` es `core.allium`). El código que
implementa el escenario de `block-as-request.allium`
(`packages/server/src/answer.ts:19`) cita la versión de
`controlled-ontology.allium`.

**Por qué importa:** son conceptos relacionados pero no idénticos — "no hay
modelo remoto" aplicado a responder un bloque vs. aplicado a procesar una
página — y el código no distingue cuál gobierna cuál. Si mañana una de las dos
specs cambia ese invariante, no hay forma de saber si la otra debía cambiar
también.

**Acción sugerida:** decidir si es el mismo invariante (y entonces
`block-as-request.allium` debería importarlo de `controlled-ontology.allium`
en vez de redeclararlo) o si son dos invariantes distintos que merecen nombres
distintos.

### E-4. Secretos de servicios de terceros en texto plano
`packages/store/src/secrets.ts:52-67` guarda el secreto de una conexión de
servicio (por ejemplo, la clave de Zotero) en una columna `secret TEXT` sin
cifrar. `service-connections.allium` ya declara esto como pregunta abierta —
no es un descuido de implementación, es una decisión de producto pendiente.
Esta auditoría eleva su prioridad porque **la unidad 1.3 (respaldo) no puede
cerrarse responsablemente mientras esto siga así**: un respaldo del `.sqlite`
sería, hoy, también una copia de las claves de terceros sin protección
adicional.

**Opciones:** cifrado en reposo con clave derivada de la máquina (coherente
con `TheMachineIsTheLastResort`); cifrado con passphrase de la persona
(más seguro, más fricción); o excluir la tabla de cualquier respaldo y
exigir reconexión manual tras restaurar (más simple, pierde comodidad).

**Decisión inicial (2026-08-30, Herbert):** cifrado con passphrase de la
persona (opción b). Al elicitar el mecanismo (`u1.3b-spec`), el alcance
creció de fondo: no cifrar `service_secrets`, sino que **la base entera** no
se abriera sin la passphrase, con clave de recuperación, límite de intentos
y re-cifrado al cambiarla — todo quedó escrito en
`specs/corpus-encryption.allium`.

**Decisión final (2026-08-30, Herbert, mismo día):** al ver el costo real
—migrar de `node:sqlite` a un motor con cifrado nativo, y que perder la
passphrase y la clave de recuperación a la vez volvería el corpus entero
irrecuperable— Herbert decidió **no seguir por ese camino**.
`corpus-encryption.allium` se retiró del repositorio;
`service-connections.allium` vuelve a su pregunta abierta original, con una
nota que registra la exploración para que no se repita sin saberlo.

**Estado actual de E-4:** sin resolver, otra vez. Los secretos de
`service_secrets` siguen en texto plano. La autenticación del dueño queda
enteramente cubierta por u1.4a (passkey WebAuthn); no hay una segunda capa
de passphrase. Si se retoma este problema más adelante, empieza de nuevo
por una elicitación acotada — las tres opciones originales de esta entrada
siguen vigentes, incluida la de cifrar sólo la tabla.

### E-5. Recuperación raíz acumula credenciales sin revocar las anteriores
Cada ejecución de `npm run owner:credential` (`issue-owner.ts`) emite un
`AccessToken` de alcance completo y sin expiración, sin invalidar los emitidos
antes. Una recuperación repetida (por ejemplo, por error, o por costumbre)
deja credenciales raíz vivas acumulándose.

**Acción sugerida:** decidir si `issue-owner.ts` debe revocar las anteriores al
emitir una nueva, o si debe listarlas y pedir confirmación antes de sumar una
más.

### E-6. `federated-sharing.allium` y `peer-networking.allium` no se
referencian entre sí
Ambas describen la misma federación desde ángulos distintos — contenido/
revisión la primera, transporte/identidad la segunda — pero ninguna declara un
`use` hacia la otra. `SharingDestination` no menciona `PeerIdentity`/
`VeraPeer`. Sin esa costura, una `Distribution` no tiene forma declarada de
viajar por un `PeerConnection`.

**Por qué bloquea:** la unidad 1.5 (prototipo de red horizontal) necesita
ambas specs trabajando juntas. Escribir código antes de resolver esto arriesga
construir la costura en la implementación en vez de en la spec, que es
exactamente lo que el método del repositorio busca evitar.

### E-7. Cifras técnicas desactualizadas en documentos y en el perfil FONDEF
Tres lugares afirman cifras de specs/tests que ya no son ciertas:
- [[VERA — FONDEF IDeA I+D 2027]] (2026-08-24): "35 especificaciones Allium,
  1.206 pruebas automatizadas aprobadas". Hoy: **38 specs, 1298 pruebas**.
- `docs/test-obligations.md:39,52`: "34 specs". Hoy: **38**.
- `docs/plan-recorridos.md:3` y `docs/plan-local-first.md:3` son snapshots
  fechados correctamente formulados como tales — no son un problema, son el
  patrón correcto que los dos documentos anteriores no siguieron.

**Por qué importa más de lo que parece:** el perfil FONDEF usa estas cifras
como evidencia de madurez tecnológica (TRL) ante una entidad externa. Una
cifra desactualizada, aunque la dirección del error sea favorable (el sistema
creció, no se estancó), es exactamente el tipo de imprecisión que una revisión
técnica externa detecta primero y que cuesta credibilidad de forma
desproporcionada a su tamaño.

**Acción sugerida:** actualizar la cifra en el perfil FONDEF antes de
postular, y considerar que `docs/test-obligations.md` derive su cifra
automáticamente (`ls specs/*.allium | wc -l`) en vez de escribirla a mano, ya
que el propio documento reconoce no ser autoritativo pero repite un número
fijo de todos modos.

### E-8. `npm test` no es reproduciblemente verde en un checkout limpio
Sin `npm run build` previo, `npm test` falla 1/1298
(`shared-space-access.test.ts:230`) porque el servidor de test sirve
`packages/web/dist`, que no existe hasta compilar. `package.json` no declara
un `pretest`. `make check` no lo sufre porque corre `test` antes que nada pero
en un entorno donde probablemente ya hay un `dist/` de una build anterior —
la propia definición de `check: test spec` en el `Makefile` no fuerza un build
limpio primero.

**Acción sugerida:** decidir si el test debe dejar de depender de `dist/`
(mejor aislamiento) o si `package.json` debe declarar la dependencia
explícitamente (`"pretest": "npm run build"` o el test correspondiente se salta
si no hay `dist/`). Es una decisión pequeña pero afecta la confianza de
cualquier agente nuevo que clone el repositorio y corra `npm test` como primer
paso.

### E-9. Las referencias de bloque no son transclusiones vivas y pueden quedar obsoletas

La sintaxis `((block:id))` se presenta hoy como un enlace con un extracto
resuelto, no como una ventana editable al bloque canónico. Además, la lista
`blockRefs` llega con la lectura de la página y puede quedar antigua cuando una
edición local añade o cambia una referencia: el redibujo desde la réplica local
conserva el contenido nuevo y el enriquecimiento anterior, por lo que la cita
puede tardar en renderizarse o quedar sin resolver hasta una recarga canónica.

**Evidencia (2026-09-28):** una carga fresca resolvió 21 referencias en unos
170 ms y no dejó citas colgantes reales. Esto hace improbable que SQLite o la
resolución del servidor sean el cuello principal; el defecto está en la
reconciliación y validación del estado derivado en el cliente. La validación de
una página retenida tampoco compara `blockRefs`, de modo que puede aceptar como
vigente una lectura cuyo contenido coincide pero cuyo enriquecimiento no.

**Camino acordado:** primero corregir la actualización inmediata y la invalidez
del enriquecimiento; luego especificar una transclusión visualmente distinguible
que edite el bloque fuente mediante la vía ordinaria de operaciones. Antes de
construirla hay que decidir profundidad del subárbol, edición concurrente,
permisos y reconciliación. Estas decisiones viven desde ahora en
`argument-workbench.allium`; la transclusión será una capacidad compartida con
la mesa de trabajo, no un parche visual aislado.

### E-10. La promoción del breadcrumb todavía crea directamente un argumento

`trail.allium`, `workspace-interface.allium` y la implementación vigente
conservan el modelo anterior: promover un tramo del breadcrumb crea de inmediato
una página `tipo:: argumento`. La exploración conceptual del 2026-09-28 decidió
otra frontera: el tramo sólo reúne material y debe sembrar una página de
preparación argumental, cuyo estado de madurez declara la persona y cuyo término
publicable es `Argumento`.

**Deuda deliberada:** no se reescribe todavía el flujo legado. Primero se
cerrarán el nombre canónico de la página, la escala compacta de maduración y el
gesto con que se seleccionan las perlas del tramo. Después se consolidarán las
tres specs y la implementación como una sola migración, conservando dos
propiedades del diseño anterior: el gesto pequeño desde el mapa y la creación
atómica de una página completamente sembrada.

## Preguntas ya declaradas en specs, citadas aquí por ser bloqueantes de la fase 1

Estas ya existen como `open question` en su spec de origen. Se listan porque
`fase-1-local-first-sincronizacion.md` las referencia y conviene no tener que
saltar a la spec para saber cuáles son.

- **`offline-reconciliation.allium`:** cuánto de un corpus grande se replica en
  un teléfono y qué hay disponible antes de terminar de hidratarse; qué pasa
  con lo pendiente cuando la credencial caduca sin red; qué camino de
  recuperación conserva lo pendiente cuando el almacén local está lleno, no
  disponible o corrupto. (Citadas también en `docs/plan-local-first.md §7`.)
- **`identity-access.allium`:** dónde vive la credencial de un colaborador
  entre visita y visita; si caduca la de una persona; si los permisos son por
  rol o por capacidad; cuándo expira una sesión y qué pasa con las operaciones
  pendientes de un agente revocado. (Citadas también en
  `docs/plan-nadie-por-omision.md §7`.)
- **`agent-conversation.allium`:** si un hilo de Telegram y uno de Vera son la
  misma conversación o requieren traspaso explícito; qué conversaciones se
  conservan, destilan o caducan; dónde vive la primera interfaz; cuándo una
  respuesta puede escribir directamente y cuándo debe proponer.
- **`VERA — Identidad federada`:** identidad anclada al dominio (simple, pero
  se rompe al mudarse) vs. WebID/Solid-OIDC vs. identificadores portables
  propios.
- **`service-connections.allium`:** tratamiento de secretos de servicios —
  ver E-4, que la eleva a bloqueante de 1.3.

## Decisiones ya tomadas y vigentes (no se reabren aquí)

- **Modo 2 (público de lectura) antes que modo 3 (público de acceso).**
  Decidido y documentado en `docs/exponer-vera.md`. Esta auditoría no encontró
  nada que lo contradiga.
- **`TheMachineIsTheLastResort`** como raíz de confianza de una instancia
  soberana. Vigente; E-1 y E-5 son consecuencias de aplicarlo bien, no
  cuestionamientos del principio.
- **Precompetitivo, no interés público**, como modalidad FONDEF preferida —
  documentado en [[VERA — FONDEF IDeA I+D 2027]], fuera del alcance técnico de
  esta auditoría.
