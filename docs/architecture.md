# Arquitectura tecnológica

La [arquitectura pública](https://vera.mediafranca.net/vera-arquitectura/)
explica el modelo general. Este documento describe su implementación en el
repositorio y distingue lo construido de lo propuesto.

> **Estado:** mixto, y conviene leerlo así. Las secciones marcadas **construido**
> registran lo que v0 efectivamente usa. Las marcadas **propuesta** siguen siendo
> revisables y no comprometen a nada. Las especificaciones Allium definen el
> comportamiento de Vera; este documento no convierte decisiones técnicas en
> requisitos del producto.

## Criterios

El stack debe favorecer una instancia soberana con un solo grafo, uso offline
desde varios dispositivos, Markdown portable, medios nativos, despliegue en un
Linux personal y una ruta de migración simple. La concurrencia masiva y el
multi-tenant no son objetivos de v0.

## Lo que v0 corrigió de la propuesta inicial

La propuesta original de este documento eligió un stack convencional de
aplicación web. Al construir el primer recorrido, casi todas esas piezas
resultaron innecesarias para un grafo personal de un solo escritor, y cada una
habría costado superficie de dependencia, tiempo de build y una capa más entre
la spec y el comportamiento observable. El resultado es deliberado:

| Se propuso | Se usó | Por qué |
| --- | --- | --- |
| pnpm | npm workspaces | una dependencia menos que instalar antes de instalar |
| React | TypeScript y DOM directo | la interfaz es un outliner y dos lienzos; no hay estado de componente que justifique un framework |
| vite-plugin-pwa / Workbox | `sw.js` escrito a mano | 40 líneas legibles contra un generador cuya política de caché habría que auditar igual |
| TanStack Query | `fetch` directo | el estado remoto es una página a la vez |
| CodeMirror 6 | `<textarea>` | v0 edita el texto de un bloque, no un documento |
| Radix UI | elementos nativos | `<button>`, `<nav>` y `<input type="search">` ya son accesibles |
| Fastify | `node:http` | ocho rutas |
| better-sqlite3 | `node:sqlite` | está en la biblioteca estándar; no compila nada |
| Drizzle | SQL explícito | el esquema es un archivo legible y las queries de grafo son CTE recursivos que el ORM no expresaría mejor |
| Vitest | `node --test` | ejecuta TypeScript directamente, sin build intermedio |
| unified/remark/rehype | renderizador propio | v0 sólo necesita Markdown en línea, y el sanitizado es escapar primero |
| D3 y 3d-force-graph | igual | única propuesta que se conservó tal cual |
| FTS5 | igual | igual |

Las dependencias de ejecución de v0 son tres: `d3`, `3d-force-graph` y el
`three` que este último arrastra. Todas viven en la PWA. `@vera/core`,
`@vera/store`, `@vera/importer` y `@vera/server` no tienen ninguna.

Nada de esto descarta las piezas descartadas para siempre. CodeMirror vuelve a
la mesa cuando haya que editar código y sketches; remark, cuando la proyección
pública necesite el mismo pipeline que el HTML. La regla que se aplicó fue no
adoptarlas antes de tener el problema que resuelven.

## Lenguaje y repositorio — construido

- **TypeScript** en cliente, servidor y herramientas de importación/exportación.
- **Node.js 24** o superior como runtime, por `node:sqlite` y por la ejecución
  directa de TypeScript.
- **npm workspaces** para un monorepo con paquetes compartidos.

Fuera de la PWA no hay paso de compilación: Node ejecuta los `.ts` tal como
están, y `tsc --noEmit` verifica sin emitir. Esto elimina la clase entera de
errores en que lo que corre no es lo que se leyó.

## PWA — construido

- **Vite** para el build y el servidor de desarrollo, que hace proxy de las
  rutas de la API al servidor local.
- TypeScript sobre el DOM, sin framework. `outliner.ts` construye el árbol de
  bloques, `graph/render.ts` la vista 2D y `graph/render3d.ts` la 3D.
- **CSS custom properties** como tokens editables en `tokens.ts`, con esquema
  claro y oscuro. No se adopta un tema visual prefabricado.
- `manifest.webmanifest` y un service worker propio que cachea el armazón de la
  aplicación y nada más.

La decisión explícita del service worker de v0: **no** cachea respuestas de
`/operations` ni lecturas del grafo. Servir grafo viejo sin poder escribir sería
peor que declarar que no hay red.

### Presentar es una proyección de página — construido

El corpus declara **qué es una cosa**; el programa aporta **cómo puede mirarse**.
Presentar no es una clase semántica: cualquier página con bloques puede entrar
al visor desde su menú, sin escribir `tipo`, crear HTML de diapositivas ni
guardar el nombre de una biblioteca visual. `page-presentation.allium` mantiene
la página como fuente canónica; `web/src/presentation.ts` deriva una lámina por
cada bloque raíz y monta el visor.

La ontología no dice “Reveal.js” porque el adaptador espacial no cambia qué es
la página. Esa dependencia puede cambiar sin migrar el corpus.

El estado exacto de cumplimiento está en la
[matriz de trazabilidad](plan-maestro/matriz-trazabilidad.md): la primera
vertical está construida, mientras varias garantías avanzadas de la spec siguen
marcadas como parciales.

## Cliente offline — parte construida

El navegador sostiene una réplica del dominio en memoria, retiene en IndexedDB
las páginas ya leídas y guarda allí las operaciones pendientes antes de darlas
por escritas. Los cambios se aplican localmente, sobreviven al cierre y se envían
en orden cuando vuelve la red. No hay SQLite WASM ni OPFS en el cliente.

La réplica no descarga el corpus completo: conserva hasta 240 páginas según su
última lectura. Falta resolver la reconciliación de dos manos que hayan editado
el mismo bloque y completar la lectura retenida primero ante un servidor lento.

## Servidor — construido

- **`node:http`** para la API HTTP y para servir la PWA construida.
- Rutas: `GET /health`, `/pages`, `/pages/:id`, `/search`, `/graph/:id`, `/ops`,
  `/invariants`, y `POST /operations`.
- Validación explícita en el borde, sin generador de esquemas.

`GET /invariants` expone la verificación de invariantes de `@vera/core` sobre el
grafo cargado. Sobre el corpus real devuelve `[]`.

Quedan pendientes de v0 y sin implementar: el canal de eventos para notificar
cambios, los registros estructurados y OpenAPI. No se necesita GraphQL, Redis,
una cola distribuida ni microservicios.

## Persistencia canónica — construido

- **SQLite** en modo WAL como base canónica del servidor.
- **`node:sqlite`** como adaptador, desde la biblioteca estándar de Node.
- **`schema/schema.sql`**, un único archivo explícito, con la correspondencia
  entre cada tabla y la spec que la gobierna anotada en el encabezado.
- **FTS5** para búsqueda textual sobre títulos y contenido de bloques.
- Tablas relacionales para páginas, bloques, links, tags, propiedades, permisos,
  fuentes y operaciones. Los recorridos usan CTE recursivos.

La regla que gobierna todo lo demás: `operations` es el registro canónico. Las
tablas de estado son su materialización y los índices derivados son
reconstruibles. Nada fuera de `submitOperation()` escribe en ellas.

**Migraciones**, versionadas con `PRAGMA user_version` en
`packages/store/src/migrations.ts`. El reparto es el siguiente y conviene tenerlo
claro antes de tocar el esquema:

- `schema/schema.sql` describe la **forma de destino**. Está escrito con
  `CREATE TABLE IF NOT EXISTS`, así que sobre una base nueva la crea entera y ya
  al día, y sobre una base que ya existe no toca una sola tabla.
- `migrations.ts` describe el **camino**. Cada migración lleva un entero que sólo
  sube; una base nueva se sella en la versión de destino sin ejecutar ninguna.

Un cambio sobre una tabla existente —una columna, un `CHECK`, un índice— se
escribe en los dos sitios o la base de quien ya venía usando Vera se queda atrás
sin que nada lo diga. Es duplicación y es a propósito: derivar el camino leyendo
el destino pide un motor de diffs de esquema, y un motor de diffs se equivoca en
silencio justo el día que toca migrar el registro canónico.

Cambiar un `CHECK` obliga a reconstruir la tabla —crear, copiar, soltar,
renombrar, rehacer índices—, que es lo que hace `rebuildTable()`. Cada migración
corre en su propia transacción con las claves foráneas apagadas, y termina con un
`PRAGMA foreign_key_check`: si una falla, la base queda en la anterior y no a
medio camino de ninguna.

`ADDED_COLUMNS` en `store.ts` es anterior y no crece más. Se queda por las bases
en `user_version = 0` a las que les falta alguna de esas tres columnas.

PostgreSQL queda como ruta de escalamiento si una futura Vera necesita muchos
escritores simultáneos o alojamiento multi-tenant. No es requisito de v0.

## Sincronización — parte construida

El registro monotónico de operaciones existe, no la replicación entre
dispositivos:

1. cada operación lleva una clave idempotente de origen — **construido**;
2. el servidor autoriza y aplica la operación en una transacción — **construido**;
3. el servidor asigna una secuencia canónica — **construido**;
4. cada dispositivo solicita operaciones posteriores a su cursor — `GET /ops`
   sirve el registro, pero ningún cliente mantiene un cursor;
5. dos ediciones offline del mismo bloque se presentan como conflicto para
   resolución humana — **no construido**; hoy no hay segunda escritura posible.

Vera sincroniza el registro, nunca el archivo SQLite. No se incorpora un CRDT en
v0: la colaboración carácter por carácter no es un requisito y añadirla
complicaría identidad, procedencia y borrado. Yjs o Automerge sólo se evaluarían
si ese comportamiento se vuelve necesario.

## Grafo y queries — construido

- Modelo persistente relacional con nodos y aristas explícitos. Los links se
  derivan del contenido del bloque: existen exactamente mientras el texto los
  diga, y ningún participante los envía como operación propia.
- Lenguaje de queries propio, construido como expresiones componibles en
  `core/query.ts`: términos de título, contenido, tag, propiedad y dirección de
  link, con `and`, `or` y `not`.
- **D3** para la navegación 2D y **3d-force-graph** para la 3D, reutilizando
  conducta probada de con§tel.

Del corpus de `mind`, 30 queries de Logseq no se pudieron portar y quedaron
registradas en `unported_queries` con su texto original, en lugar de
desaparecer en silencio.

Las queries ya pueden escribirse en bloques mediante la sintaxis de superficie.
Mermaid también se renderiza en la aplicación.

## Markdown e hipermedia — parte construida

- `outliner.ts` renderiza Markdown en línea —enlaces wiki, tags, negrita,
  cursiva, código y enlaces externos— escapando el HTML antes que nada.
- `store/projection.ts` proyecta la base a Markdown en una sola dirección, con
  determinismo como requisito duro: proyectar dos veces el mismo estado produce
  bytes idénticos, o el `git diff` deja de significar nada.
- La correspondencia entre `stable_id` y ruta vive en un manifiesto, fuera del
  texto. Los archivos proyectados no llevan UUID técnicos.

El cliente renderiza Markdown completo, Mermaid, PDF, dibujo y contenido
ejecutable. HTML, sketches p5.js e ilustraciones SVG explícitas se presentan en
iframes aislados, reciben sólo los tokens visuales y devuelven únicamente la
altura que necesitan; su fuente permanece editable. La proyección pública
reutiliza el contenido autorizado sin dar acceso al corpus privado.

## Audio y transcripción — construido

- **MediaRecorder** en el navegador para captura.
- **FFmpeg** en el servidor para inspección, normalización y derivados.
- **whisper.cpp** local como motor inicial de transcripción, detrás de un
  contrato sustituible.
- La transcripción es corregible y conserva el audio como fuente; capturar,
  transcribir y eliminar son operaciones distintas.

## Archivos y respaldo — parte construida

- Audio, imágenes, PDF y otros binarios viven fuera de SQLite en un almacén
  local direccionado por **SHA-256**.
- SQLite conserva identidad, hash, MIME, tamaño, procedencia y relaciones. El
  almacén de objetos se usa para audio, documentos e imágenes.
- Backups consistentes usan la API de backup de SQLite; los binarios se respaldan
  con **restic** hacia un destino independiente de la máquina que sirve Vera.
- Git recibe Markdown y manifiestos deterministas. El archivo SQLite activo y
  sus WAL no se usan como historial Git — ya está en `.gitignore`.

## Identidad y seguridad

Los agentes ya se autentican; las personas todavía no.

**Hecho.** Un agente participa con una credencial: token revocable, con alcance
y digest almacenado en lugar del secreto. La identidad de una operación sale de
la credencial, nunca de lo que el cuerpo afirme, y el canal se deriva de qué es
quien escribe. Ver [`agent-participation.allium`](../specs/agent-participation.allium)
y `packages/server/src/credentials.ts`.

| Ruta | Qué hace |
| --- | --- |
| `POST /agents` | Admite un agente como participante. Sólo el dueño. |
| `POST /agents/credentials` | Emite una credencial. Devuelve el secreto una vez. |
| `GET /agents/credentials` | Lista las credenciales. Nunca sus secretos. |
| `POST /agents/credentials/:id/revoke` | La retira. No toca lo que escribió. |
| `GET /agents/whoami` | Quién es el portador y con qué alcances. |

Los alcances son `read`, `write` y `discard`. `discard` va aparte porque borrar
es el único acto que el grafo no puede enseñarte después.

**Pendiente.**

- **Passkeys/WebAuthn** para humanos, implementadas con SimpleWebAuthn.
- Cookies de sesión `HttpOnly`, `Secure` y `SameSite`; protección CSRF donde
  corresponda.
- Autorización de lectura por alcance: hoy `read` se emite y se muestra, pero
  las rutas de lectura no lo exigen todavía.
- Publicación: `OnlySiteOwnerPublishes` ya impide que un agente publique.

v0 no autentica al dueño. Quien llega sin credencial se toma por él, que es
como Vera ha funcionado desde el principio: corre en `localhost` con un único
participante propietario sembrado por el importador. Lo que cambió es que esa
vía ya no puede escribir como otro — para firmar como el bibliotecario hace falta su
credencial. Sigue siendo aceptable mientras la instancia no escuche
fuera de la máquina, y deja de serlo el día que lo haga.

## Publicación — construida en su recorrido básico

- Una operación separada autoriza o retira cada página publicada.
- El proyector genera HTML estático, portada, URLs canónicas y metadatos desde
  las páginas autorizadas.
- El sitio público no accede a la base privada en tiempo de lectura.
- Faltan búsqueda pública, RSS y completar la proyección de algunos medios.

## Pruebas y calidad — parte construida

- **`node --test`** para unidades e integración; el resultado de `npm test` es
  la autoridad, no un recuento copiado en este documento.
- **fast-check** para propiedades e invariantes derivadas de Allium, sobre
  secuencias de hasta 40 operaciones.
- TypeScript estricto, verificado con `tsc --noEmit` en la raíz y en la PWA.

Pendientes: **Playwright** para recorridos completos, responsive, instalación
PWA y escenarios offline; pruebas de migración automatizadas contra una copia
representativa de `mind`; ESLint, formateo automático y CI. Lo que cubre y lo
que no cubre la suite actual está en [test-obligations.md](test-obligations.md).

## Despliegue inicial — propuesta

- Un contenedor de Vera y volúmenes explícitos para SQLite, objetos y
  proyecciones.
- **Docker Compose** para reproducibilidad local y futura migración a un VPS.
- **Cloudflare Tunnel** como entrada HTTPS sin abrir puertos del hogar.
- **Tailscale** como acceso administrativo privado.
- GitHub Actions para validación y publicación estática, no para operar la base
  privada.

Hoy Vera se ejecuta con `npm run serve` sobre la máquina de trabajo.

## Estructura

La que existe:

```text
packages/
  core/         tipos, reglas e invariantes derivados de las specs
  store/        SQLite canónico, registro de operaciones y proyección Markdown
  importer/     ingesta de un grafo Logseq con reporte de pérdida
  server/       API HTTP local
  web/          el espacio de trabajo: outliner, grafo 2D y 3D, búsqueda, PWA
schema/         schema.sql, el esquema canónico
specs/          comportamiento Allium
docs/           arquitectura, benchmark y obligaciones de prueba
```

Los paquetes previstos para las fases siguientes —medios, sincronización,
importadores de Jekyll y Zotero, y el sitio público— se agregarán cuando exista
el comportamiento que los justifique, no antes.

## Frontera de licencia

El monorepo y todos los paquetes `@vera/*` forman hoy un solo programa bajo
`AGPL-3.0-only`. La frontera arquitectónica entre núcleo, superficies, puerta
MCP e importadores no es una excepción de licencia: distribuir u operar por red
una versión modificada debe conservar la reciprocidad que corresponda.

Un futuro SDK, protocolo o plantilla de extensiones podría publicarse con una
licencia permisiva para facilitar interoperabilidad, pero sólo mediante una
decisión explícita, un paquete claramente separado y su propio archivo de
licencia. Hasta entonces no existe esa excepción. Los plugins independientes
no pasan a ser AGPL por el solo hecho de hablar un protocolo; su compatibilidad
jurídica dependerá de cómo se vinculen y distribuyan, y debe auditarse antes de
incorporarlos.

Esta frontera no alcanza el corpus: notas, medios y datos de cada instalación
son contenido de su propietario, no parte del programa.

## Decisiones deliberadamente diferidas

- sintaxis de superficie del lenguaje de queries y su parser;
- granularidad exacta de sincronización y presentación de conflictos;
- migraciones de esquema sobre una base con estado propio;
- proveedor alternativo de transcripción;
- migración de SQLite a PostgreSQL;
- empaquetado nativo mediante Capacitor, si la PWA resulta insuficiente.
