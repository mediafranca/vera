-- Vera: esquema canónico.
--
-- Un único archivo aplicado igual en el servidor (node:sqlite) y en la copia de
-- trabajo del cliente (SQLite WASM + OPFS, todavía sin construir), para que las
-- consultas de grafo y de texto se escriban una sola vez.
--
-- Correspondencia con las specs:
--   participants, graphs, memberships, pages, blocks, revisions  core.allium
--   property_assignments, publications, personal_sites           core.allium
--   instances                                                    identity-access.allium
--   operations                                                   change-application.allium
--   page_links                                                   graph-navigation.allium
--   unported_queries                                             query-language.allium
--   blocks_fts, pages_fts                                        search-index.allium
--   media, media_references                                      content-media.allium
--   recordings, spoken_origins                                   voice-capture.allium
--   access_tokens, block_authorship                              agent-participation.allium
--
-- Los días de la bitácora (daily-log.allium) no tienen tabla propia: un día es
-- una página cuyo título es su fecha, y darle una tabla partiría en dos lo que el
-- corpus tiene como uno solo. Lo que sí falta es `inscription_origins`, el
-- equivalente de `spoken_origins` para lo que se inscribe desde un día: hoy nada
-- guarda de qué día salió un bloque, y el @invariant InscribedContentNamesItsDay
-- no tiene dónde apoyarse.
--
-- Falta `properties_fts`. search-index.allium declara `property_value` como campo
-- buscable y su @guarantee OneSearchReachesEverySearchableField exige que una sola
-- búsqueda cubra títulos, contenido y valores de propiedad. Hoy cubre los dos
-- primeros. Ver docs/test-obligations.md.
--
-- Regla que gobierna todo lo demás: `operations` es el registro canónico. Las
-- tablas de estado son su materialización y los índices derivados son
-- reconstruibles. Nada fuera de submitOperation() escribe en ellas.
--
-- Este archivo describe la forma de DESTINO, no la historia. Es lo que se crea
-- en una base nueva, de una vez y ya al día. Una base que ya existía no llega
-- aquí sola: `CREATE TABLE IF NOT EXISTS` no toca una tabla que está, así que
-- cualquier cambio sobre una tabla existente —una columna, un CHECK, un índice—
-- pide además una migración en packages/store/src/migrations.ts. Las dos cosas
-- se escriben juntas o la base de quien ya venía usando Vera se queda atrás sin
-- que nada lo diga. Ver SCHEMA_VERSION allí.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

------------------------------------------------------------
-- Participación e instancia
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS participants (
    id      TEXT PRIMARY KEY,
    name    TEXT NOT NULL,
    kind    TEXT NOT NULL CHECK (kind IN ('human', 'agent')),
    status  TEXT NOT NULL CHECK (status IN ('active', 'suspended'))
) STRICT;

CREATE TABLE IF NOT EXISTS graphs (
    id    TEXT PRIMARY KEY,
    name  TEXT NOT NULL
) STRICT;

-- invariant OneInstanceServesOneGraph
CREATE TABLE IF NOT EXISTS instances (
    id        TEXT PRIMARY KEY,
    graph_id  TEXT NOT NULL UNIQUE REFERENCES graphs (id),
    owner_id  TEXT NOT NULL REFERENCES participants (id)
) STRICT;

CREATE TABLE IF NOT EXISTS memberships (
    graph_id        TEXT NOT NULL REFERENCES graphs (id),
    participant_id  TEXT NOT NULL REFERENCES participants (id),
    status          TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
    PRIMARY KEY (graph_id, participant_id)
) STRICT;

------------------------------------------------------------
-- Contenido
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pages (
    id          TEXT PRIMARY KEY,
    graph_id    TEXT NOT NULL REFERENCES graphs (id),
    title       TEXT NOT NULL,
    title_key   TEXT NOT NULL,
    visibility  TEXT NOT NULL CHECK (visibility IN ('private', 'public')),
    created_at  INTEGER NOT NULL,
    origin_created_at INTEGER
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS pages_title_key ON pages (graph_id, title_key);

-- blocks.id ES el stable_id de core.allium. No se regenera al editar ni al mover:
-- esa ausencia de UPDATE sobre la clave es la garantía StableBlockAddress.
CREATE TABLE IF NOT EXISTS blocks (
    id          TEXT PRIMARY KEY,
    page_id     TEXT NOT NULL REFERENCES pages (id),
    parent_id   TEXT REFERENCES blocks (id),
    position    INTEGER NOT NULL,
    content     TEXT NOT NULL,
    created_at  INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS blocks_by_page ON blocks (page_id, parent_id, position);
CREATE INDEX IF NOT EXISTS blocks_by_parent ON blocks (parent_id);

-- Una sola marginalia canónica por bloque. Su historia vive en operations y
-- revisions; esta tabla materializa únicamente la versión visible actual.
CREATE TABLE IF NOT EXISTS block_glosses (
    block_id    TEXT PRIMARY KEY REFERENCES blocks (id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
) STRICT;

-- invariant PropertyTargetsOneSubject y PropertyKeyIsUniquePerSubject
CREATE TABLE IF NOT EXISTS property_assignments (
    id        TEXT PRIMARY KEY,
    graph_id  TEXT NOT NULL REFERENCES graphs (id),
    page_id   TEXT REFERENCES pages (id),
    block_id  TEXT REFERENCES blocks (id),
    key       TEXT NOT NULL,
    value     TEXT NOT NULL,
    CHECK ((page_id IS NULL) <> (block_id IS NULL))
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS property_unique_per_page
    ON property_assignments (page_id, key) WHERE page_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS property_unique_per_block
    ON property_assignments (block_id, key) WHERE block_id IS NOT NULL;

------------------------------------------------------------
-- Registro de cambios: la fuente de verdad
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS change_logs (
    graph_id       TEXT PRIMARY KEY REFERENCES graphs (id),
    last_sequence  INTEGER NOT NULL DEFAULT 0
) STRICT;

-- origin_id lo genera el dispositivo que envía: es la clave de idempotencia.
-- sequence lo asigna el servidor: es el orden total dentro del grafo.
CREATE TABLE IF NOT EXISTS operations (
    id                     TEXT PRIMARY KEY,
    graph_id               TEXT NOT NULL REFERENCES graphs (id),
    origin_id              TEXT NOT NULL,
    sequence               INTEGER NOT NULL,
    participant_id         TEXT NOT NULL REFERENCES participants (id),
    change_kind            TEXT NOT NULL,
    change_payload         TEXT NOT NULL,
    subject_id             TEXT NOT NULL,
    channel                TEXT NOT NULL CHECK (
                               channel IN ('typed_text', 'authenticated_voice',
                                           'agent_generation', 'import', 'walked',
                                           'drawn')),
    evidence_reference     TEXT,
    evidence_captured_at   INTEGER,
    submitted_at           INTEGER NOT NULL,
    applied_at             INTEGER NOT NULL,
    CHECK (channel <> 'authenticated_voice' OR evidence_reference IS NOT NULL)
) STRICT;

-- invariant OperationOriginIsUniqueWithinLog: reenviar no aplica dos veces
CREATE UNIQUE INDEX IF NOT EXISTS operations_origin ON operations (graph_id, origin_id);
-- invariant OperationSequenceIsUniqueWithinLog
CREATE UNIQUE INDEX IF NOT EXISTS operations_sequence ON operations (graph_id, sequence);

CREATE TABLE IF NOT EXISTS revisions (
    id              TEXT PRIMARY KEY,
    operation_id    TEXT NOT NULL UNIQUE REFERENCES operations (id),
    graph_id        TEXT NOT NULL REFERENCES graphs (id),
    page_id         TEXT,
    block_id        TEXT,
    authored_by     TEXT NOT NULL REFERENCES participants (id),
    channel         TEXT NOT NULL,
    recorded_at     INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS revisions_by_block ON revisions (block_id);
CREATE INDEX IF NOT EXISTS revisions_by_page ON revisions (page_id);

------------------------------------------------------------
-- Índices derivados: reconstruibles, nunca fuente de verdad
------------------------------------------------------------

-- target_id nulo = la página nombrada todavía no existe. La referencia se
-- conserva porque es intención de escribirla, no basura.
CREATE TABLE IF NOT EXISTS page_links (
    id            TEXT PRIMARY KEY,
    graph_id      TEXT NOT NULL REFERENCES graphs (id),
    source_page   TEXT NOT NULL REFERENCES pages (id),
    source_block  TEXT NOT NULL REFERENCES blocks (id) ON DELETE CASCADE,
    target_title  TEXT NOT NULL,
    target_key    TEXT NOT NULL,
    target_id     TEXT REFERENCES pages (id)
) STRICT;

CREATE INDEX IF NOT EXISTS links_by_source ON page_links (source_block);
CREATE INDEX IF NOT EXISTS links_by_target ON page_links (target_id);
CREATE INDEX IF NOT EXISTS links_waiting ON page_links (graph_id, target_key)
    WHERE target_id IS NULL;

CREATE TABLE IF NOT EXISTS block_tags (
    block_id  TEXT NOT NULL REFERENCES blocks (id) ON DELETE CASCADE,
    page_id   TEXT NOT NULL REFERENCES pages (id),
    tag       TEXT NOT NULL,
    PRIMARY KEY (block_id, tag)
) STRICT;

CREATE INDEX IF NOT EXISTS tags_by_name ON block_tags (tag);

-- Las 32 {{query}} del corpus. Se preserva el texto literal: el invariante
-- NoSilentTranslation prohíbe traducirlas a máquina.
CREATE TABLE IF NOT EXISTS unported_queries (
    id           TEXT PRIMARY KEY,
    graph_id     TEXT NOT NULL REFERENCES graphs (id),
    block_id     TEXT NOT NULL UNIQUE REFERENCES blocks (id) ON DELETE CASCADE,
    source_text  TEXT NOT NULL,
    ported_to    TEXT,
    ported_by    TEXT REFERENCES participants (id),
    ported_at    INTEGER,
    CHECK (ported_to IS NULL OR ported_by IS NOT NULL)
) STRICT;

------------------------------------------------------------
-- Búsqueda de texto completo
------------------------------------------------------------

CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5 (
    content,
    content = 'blocks',
    content_rowid = 'rowid',
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5 (
    title,
    content = 'pages',
    content_rowid = 'rowid',
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE IF NOT EXISTS glosses_fts USING fts5 (
    content,
    content = 'block_glosses',
    content_rowid = 'rowid',
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE IF NOT EXISTS properties_fts USING fts5 (
    key,
    value,
    content = 'property_assignments',
    content_rowid = 'rowid',
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS blocks_fts_insert AFTER INSERT ON blocks BEGIN
    INSERT INTO blocks_fts (rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS blocks_fts_delete AFTER DELETE ON blocks BEGIN
    INSERT INTO blocks_fts (blocks_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS blocks_fts_update AFTER UPDATE OF content ON blocks BEGIN
    INSERT INTO blocks_fts (blocks_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    INSERT INTO blocks_fts (rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS pages_fts_insert AFTER INSERT ON pages BEGIN
    INSERT INTO pages_fts (rowid, title) VALUES (new.rowid, new.title);
END;

CREATE TRIGGER IF NOT EXISTS pages_fts_delete AFTER DELETE ON pages BEGIN
    INSERT INTO pages_fts (pages_fts, rowid, title) VALUES ('delete', old.rowid, old.title);
END;

CREATE TRIGGER IF NOT EXISTS pages_fts_update AFTER UPDATE OF title ON pages BEGIN
    INSERT INTO pages_fts (pages_fts, rowid, title) VALUES ('delete', old.rowid, old.title);
    INSERT INTO pages_fts (rowid, title) VALUES (new.rowid, new.title);
END;

CREATE TRIGGER IF NOT EXISTS glosses_fts_insert AFTER INSERT ON block_glosses BEGIN
    INSERT INTO glosses_fts (rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS glosses_fts_delete AFTER DELETE ON block_glosses BEGIN
    INSERT INTO glosses_fts (glosses_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS glosses_fts_update AFTER UPDATE OF content ON block_glosses BEGIN
    INSERT INTO glosses_fts (glosses_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    INSERT INTO glosses_fts (rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS properties_fts_insert AFTER INSERT ON property_assignments BEGIN
    INSERT INTO properties_fts (rowid, key, value) VALUES (new.rowid, new.key, new.value);
END;

CREATE TRIGGER IF NOT EXISTS properties_fts_delete AFTER DELETE ON property_assignments BEGIN
    INSERT INTO properties_fts (properties_fts, rowid, key, value)
    VALUES ('delete', old.rowid, old.key, old.value);
END;

CREATE TRIGGER IF NOT EXISTS properties_fts_update AFTER UPDATE OF key, value ON property_assignments BEGIN
    INSERT INTO properties_fts (properties_fts, rowid, key, value)
    VALUES ('delete', old.rowid, old.key, old.value);
    INSERT INTO properties_fts (rowid, key, value) VALUES (new.rowid, new.key, new.value);
END;

------------------------------------------------------------
-- Medios y publicación
------------------------------------------------------------

-- Los binarios viven en el almacén de objetos direccionado por hash; aquí sólo
-- su metadata y sus relaciones.
CREATE TABLE IF NOT EXISTS media (
    hash           TEXT PRIMARY KEY,
    media_type     TEXT NOT NULL,
    byte_size      INTEGER NOT NULL,
    custody        TEXT NOT NULL CHECK (custody IN ('internal', 'external_reference')),
    original_name  TEXT,
    description    TEXT,
    alternative_text TEXT,
    created_at     INTEGER NOT NULL
) STRICT;

-- La cascada de validación que va de una grabación al contenido.
--
-- Lo canónico es la cadena, no ninguno de sus eslabones. Vive fuera del registro
-- de operaciones por la misma razón que `media`: una grabación es un activo con
-- ciclo de vida, no un cambio del grafo. Lo que sí pasa por el registro son los
-- bloques que se asientan de ella, con canal `authenticated_voice` y su evidencia.
CREATE TABLE IF NOT EXISTS recordings (
    id                    TEXT PRIMARY KEY,
    graph_id              TEXT NOT NULL REFERENCES graphs (id),
    -- Nulo cuando se descartó el audio, que sólo se puede hacer al final.
    audio_hash            TEXT REFERENCES media (hash),
    media_type            TEXT NOT NULL,
    duration_ms           INTEGER,
    stage                 TEXT NOT NULL CHECK (
                            stage IN ('captured', 'transcribed', 'transcript_validated', 'content_settled')
                          ),
    transcript            TEXT,
    -- El bloque que le guarda el lugar en la escritura, cuando se habló dentro de
    -- un documento. Nulo cuando la grabación no tiene lugar: existe por sí sola y
    -- se asentará donde su hablante decida después. Si el bloque se borra antes
    -- de asentar, esto vuelve a nulo y la grabación sobrevive.
    placed_in_block       TEXT REFERENCES blocks (id) ON DELETE SET NULL,
    -- Quien habla y cuándo. Sin autenticación todavía, se asume el propietario,
    -- y queda dicho en la referencia en vez de fingir que está probado.
    evidence_reference    TEXT NOT NULL,
    evidence_captured_at  INTEGER NOT NULL,
    captured_by           TEXT NOT NULL REFERENCES participants (id),
    captured_at           INTEGER NOT NULL,
    validated_by          TEXT REFERENCES participants (id),
    validated_at          INTEGER
) STRICT;

-- La denominación de origen de un bloque. Va aparte del bloque porque el
-- contenido cambia y el origen no: reescribir lo dicho no cambia que se dijo.
CREATE TABLE IF NOT EXISTS spoken_origins (
    block_id      TEXT PRIMARY KEY REFERENCES blocks (id) ON DELETE CASCADE,
    recording_id  TEXT NOT NULL REFERENCES recordings (id)
) STRICT;

CREATE INDEX IF NOT EXISTS spoken_origins_by_recording ON spoken_origins (recording_id);

-- La ruta tal como está escrita en el Markdown, y el objeto al que resuelve.
--
-- Vive aparte de `media` por dos razones. La primera es que `media` está
-- indexada por contenido: dos rutas distintas con los mismos bytes son un solo
-- objeto, y no cabrían en una columna de `media`. La segunda es que el texto del
-- bloque no se toca. El bloque sigue diciendo `../assets/foo.png` —que es lo que
-- mantiene la proyección Markdown portable y legible fuera de Vera— y la
-- resolución ocurre al presentar, no al guardar.
CREATE TABLE IF NOT EXISTS media_references (
    graph_id  TEXT NOT NULL REFERENCES graphs (id),
    path      TEXT NOT NULL,
    hash      TEXT NOT NULL REFERENCES media (hash),
    PRIMARY KEY (graph_id, path)
) STRICT;

CREATE INDEX IF NOT EXISTS media_references_by_hash ON media_references (hash);

CREATE TABLE IF NOT EXISTS personal_sites (
    id                TEXT PRIMARY KEY,
    graph_id          TEXT NOT NULL REFERENCES graphs (id),
    owner_id          TEXT NOT NULL REFERENCES participants (id),
    title             TEXT NOT NULL,
    canonical_domain  TEXT NOT NULL,
    entry_point       TEXT REFERENCES pages (id) ON DELETE SET NULL
) STRICT;

-- Publicar es una operación, no un atributo de la página: deja escrito qué
-- revisión de qué página quedó en qué dirección de qué sitio, cuándo y de qué
-- mano. `revision_operation_id` apunta al registro canónico y no a la tabla
-- `revisions`, que es su materialización: una operación aceptada deja
-- exactamente una revisión, así que nombrar la operación nombra la revisión sin
-- un segundo identificador que mantener de acuerdo con el primero.
CREATE TABLE IF NOT EXISTS publications (
    id                     TEXT PRIMARY KEY,
    site_id                TEXT NOT NULL REFERENCES personal_sites (id),
    page_id                TEXT NOT NULL REFERENCES pages (id),
    revision_operation_id  TEXT NOT NULL REFERENCES operations (id),
    path                   TEXT NOT NULL,
    published_at           INTEGER NOT NULL,
    published_by           TEXT NOT NULL REFERENCES participants (id)
) STRICT;

-- @invariant PublicationPathIsUniqueWithinSite
CREATE UNIQUE INDEX IF NOT EXISTS publications_path ON publications (site_id, path);

------------------------------------------------------------
-- Preferencias de sesión (RememberedSessionPresentation)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workspaces (
    participant_id          TEXT NOT NULL REFERENCES participants (id),
    graph_id                TEXT NOT NULL REFERENCES graphs (id),
    active_page             TEXT REFERENCES pages (id),
    layout                  TEXT NOT NULL DEFAULT 'split'
                                CHECK (layout IN ('text_only', 'graph_only', 'split')),
    split_divider_position  REAL NOT NULL DEFAULT 0.5,
    graph_view              TEXT NOT NULL DEFAULT 'graph_2d'
                                CHECK (graph_view IN ('graph_2d', 'graph_3d')),
    colour_scheme           TEXT NOT NULL DEFAULT 'light'
                                CHECK (colour_scheme IN ('light', 'dark')),
    -- Los tokens de diseño, como JSON. Van con el participante y no con el
    -- navegador: el sistema de diseño es de quien lo ajustó, no del aparato
    -- desde el que lo ajustó. Guardarlos como texto y no en columnas evita que
    -- añadir un token pida una migración del esquema; lo que los valida es
    -- DEFAULT_TOKENS en el cliente, que es donde se sabe qué token existe.
    design_tokens           TEXT,
    -- Cuántos saltos alcanza el mapa desde la página en foco. Saltos y no
    -- cantidad de nodos: la pregunta es «qué tan lejos de aquí», que es un hecho
    -- del grafo y no de la pantalla.
    graph_reach             INTEGER,
    PRIMARY KEY (participant_id, graph_id)
) STRICT;

-- collapsed:: del corpus importado es estado de interfaz, no contenido.
CREATE TABLE IF NOT EXISTS block_collapse_state (
    participant_id  TEXT NOT NULL REFERENCES participants (id),
    block_id        TEXT NOT NULL REFERENCES blocks (id) ON DELETE CASCADE,
    collapsed       INTEGER NOT NULL CHECK (collapsed IN (0, 1)),
    PRIMARY KEY (participant_id, block_id)
) STRICT;

------------------------------------------------------------
-- Participación de agentes (agent-participation.allium)
------------------------------------------------------------

-- Credenciales de agente.
--
-- No pasan por `operations` y es deliberado: una credencial no es contenido del
-- grafo. Emitirla y retirarla no cambia lo que el corpus dice, del mismo modo
-- que plegar un bloque no lo cambia. El registro canónico guarda lo que se
-- escribió, no quién tenía permiso para escribirlo.
--
-- @invariant TheSecretIsNeverStored: aquí sólo vive el digest. El secreto se
-- devuelve una vez, al emitirlo, y no se puede reconstruir desde esta tabla.
CREATE TABLE IF NOT EXISTS access_tokens (
    id              TEXT PRIMARY KEY,
    graph_id        TEXT NOT NULL REFERENCES graphs (id),
    participant_id  TEXT NOT NULL REFERENCES participants (id),
    secret_digest   TEXT NOT NULL UNIQUE,
    -- Los alcances van como lista separada por comas y ordenada. Son tres y no
    -- se consultan por alcance; una tabla aparte costaría una unión por petición
    -- para no ganar nada.
    scopes          TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
    label           TEXT NOT NULL,
    issued_by       TEXT NOT NULL REFERENCES participants (id),
    issued_at       INTEGER NOT NULL,
    expires_at      INTEGER,
    revoked_at      INTEGER,
    last_used_at    INTEGER,
    -- @invariant RevokedCredentialsAreInert
    CHECK (status <> 'revoked' OR revoked_at IS NOT NULL)
) STRICT;

CREATE INDEX IF NOT EXISTS access_tokens_by_participant
    ON access_tokens (graph_id, participant_id);

-- El cerco de una credencial: qué clase puede plantar y con qué se marca.
--
-- Una credencial cercada escribe sin que nadie revise, a cambio de no poder
-- salir de casa: crea páginas de la clase concedida, escribe dentro de las que
-- ella plantó, y no borra nada aunque traiga el alcance `discard`. Ver
-- specs/confined-writing.allium.
--
-- Una fila por credencial cercada, y ninguna para las que escriben sin cerco: el
-- cerco se concede, no es un régimen que caiga sobre lo que ya existe.
--
-- No guarda qué páginas plantó. Eso se deriva del registro de operaciones —quién
-- sometió el `create_page` de cada página—, que ya lo sabe y no puede
-- desincronizarse de lo que de verdad pasó.
CREATE TABLE IF NOT EXISTS confinements (
    token_id    TEXT PRIMARY KEY REFERENCES access_tokens (id) ON DELETE CASCADE,
    graph_id    TEXT NOT NULL REFERENCES graphs (id),
    -- La clase de cosa que puede crear, con la palabra del corpus.
    kind        TEXT NOT NULL,
    -- Con qué se marca su procedencia. Nulo cuando no se quiso marcar nada.
    source      TEXT,
    -- @invariant AFenceIsGrantedByAPerson
    granted_by  TEXT NOT NULL REFERENCES participants (id),
    granted_at  INTEGER NOT NULL
) STRICT;

-- Y el índice que hace barato preguntar quién plantó una página: se pregunta en
-- cada escritura de una credencial cercada, y sin él es un recorrido del log.
CREATE INDEX IF NOT EXISTS operations_by_subject
    ON operations (subject_id, change_kind);

-- De qué mano salió el texto que un bloque tiene ahora.
--
-- @invariant GeneratedContentIsAlwaysDistinguishable: se materializa aquí para
-- que distinguir lo escrito de lo generado sea una lectura y no un recorrido del
-- registro. Es reconstruible desde `operations`, como todo lo demás.
--
-- Vive aparte de `spoken_origins` porque responden preguntas distintas: uno dice
-- de dónde vinieron las palabras y el otro quién las escribió por última vez. Un
-- bloque puede tener los dos y nombrar participantes distintos en cada uno.
CREATE TABLE IF NOT EXISTS block_authorship (
    block_id        TEXT PRIMARY KEY REFERENCES blocks (id) ON DELETE CASCADE,
    participant_id  TEXT NOT NULL REFERENCES participants (id),
    channel         TEXT NOT NULL CHECK (
                        channel IN ('typed_text', 'authenticated_voice',
                                    'agent_generation', 'import', 'walked',
                                    'drawn')),
    written_at      INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS block_authorship_by_participant
    ON block_authorship (participant_id);


-- ---------------------------------------------------------------------------
-- Servicios de fuera: lo que Vera necesita presentar para hablar con ellos
-- ---------------------------------------------------------------------------

-- El secreto de un servicio, y sólo el secreto.
--
-- Una página de servicio gobierna todo lo demás a la vista —qué servicio es, qué
-- biblioteca, qué colecciones, cuándo se sincronizó— porque eso es conocimiento y
-- el conocimiento vive en el corpus. El secreto no: es un valor que hay que
-- poder presentar y que no se puede publicar.
--
-- Fuera del log a propósito. El log es append-only y es lo que hace auditable a
-- Vera; una clave escrita ahí no se puede desescribir nunca, ni rotándola ni
-- borrando el bloque. Aquí, en cambio, olvidar una clave la borra de verdad, que
-- es lo único que significa «olvidar» tratándose de un secreto.
--
-- Y por eso mismo no viaja: no entra al Markdown que se copia o se descarga, no
-- entra a la proyección, no se indexa y no se publica. Lo que la página enseña de
-- él es que está guardado, cuándo, y sus últimos caracteres.
--
-- Ver specs/service-connections.allium.
CREATE TABLE IF NOT EXISTS service_secrets (
    graph_id      TEXT NOT NULL REFERENCES graphs (id),
    -- La página que gobierna este servicio. Borrarla olvida su secreto: una
    -- credencial sin página que la explique es una llave sin puerta.
    page_id       TEXT NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
    -- Cuál de las credenciales de ese servicio es. Casi siempre una —«clave»—,
    -- pero hay servicios que piden dos, y nombrarlas es más barato que
    -- descubrir el día que haga falta que aquí sólo cabía una.
    name          TEXT NOT NULL,
    secret        TEXT NOT NULL,
    saved_at      INTEGER NOT NULL,
    last_used_at  INTEGER,
    PRIMARY KEY (graph_id, page_id, name)
) STRICT;


-- ---------------------------------------------------------------------------
-- Registro de exposición: qué memoria salió, hacia dónde y bajo qué concesión
-- ---------------------------------------------------------------------------

-- El log de operaciones cuenta lo que se escribió, y eso bastaba mientras todo
-- el que entraba escribía. Una inteligencia artificial hace algo que el log no
-- ve: recibe. Se lleva páginas, extractos y contexto sin modificar una coma, y
-- de eso no quedaba rastro.
--
-- Vive en la API y no en el adaptador MCP, y la diferencia es la que decide si
-- esto sirve: en MCP, el mayor lector del corpus —un agente que entra por HTTP
-- directo— quedaría fuera del registro y el registro sería decorativo. Aquí lo
-- hereda toda puerta.
--
-- Se anota lo entregado y no lo consultado: una búsqueda que devolvió doce
-- extractos expuso doce cosas, y el registro tiene que poder nombrarlas. El
-- texto completo de la respuesta no se guarda: copiarlo siempre dejaría una
-- segunda copia del corpus dentro del registro que existía para vigilarlo.
--
-- Ver specs/mcp-server.allium, contrato WhatWasReadIsRecorded.
CREATE TABLE IF NOT EXISTS exposures (
    id              TEXT PRIMARY KEY,
    graph_id        TEXT NOT NULL REFERENCES graphs (id),
    -- Quién se lo llevó. Sale de la credencial, nunca de lo que diga quien pide.
    participant_id  TEXT NOT NULL REFERENCES participants (id),
    -- Con qué credencial, para poder revocar sabiendo qué se revoca. Nulo cuando
    -- la lectura entró sin credencial, que es hoy el caso del cliente web: no se
    -- oculta esa ausencia, se registra como lo que es.
    credential_id   TEXT REFERENCES access_tokens (id),
    -- Qué cliente dijo ser. Se registra y no se cree.
    client          TEXT,
    -- Por dónde entró y qué pidió.
    surface         TEXT NOT NULL,
    subject         TEXT NOT NULL,
    outcome         TEXT NOT NULL,
    -- Cuánto viajó, en caracteres. Un número tosco a propósito: sirve para ver
    -- de un vistazo cuánta memoria salió por ahí, no para facturar.
    volume          INTEGER NOT NULL,
    at              INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS exposures_by_participant ON exposures (participant_id, at);
CREATE INDEX IF NOT EXISTS exposures_by_time ON exposures (at);

-- Y qué se entregó exactamente en esa llamada: las direcciones estables de las
-- páginas y los bloques que viajaron. Una tabla aparte porque una sola búsqueda
-- expone muchas cosas, y porque preguntar «quién ha leído esta página» tiene que
-- ser una consulta y no una lectura de todo el registro.
CREATE TABLE IF NOT EXISTS exposed_subjects (
    exposure_id  TEXT NOT NULL REFERENCES exposures (id) ON DELETE CASCADE,
    subject_id   TEXT NOT NULL,
    PRIMARY KEY (exposure_id, subject_id)
) STRICT;

CREATE INDEX IF NOT EXISTS exposed_by_subject ON exposed_subjects (subject_id);
