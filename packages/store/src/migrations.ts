// Migraciones del esquema, versionadas con `PRAGMA user_version`.
//
// El problema que resuelven, dicho una vez: `schema/schema.sql` está escrito con
// `CREATE TABLE IF NOT EXISTS`, así que describe la forma de destino y no sabe
// llevar a nadie hasta ella. Sobre una base nueva crea todo ya al día; sobre una
// base que ya existe no toca una sola tabla. Añadir una columna se salvaba con
// ADDED_COLUMNS en store.ts, pero cambiar un CHECK, un índice o el tipo de una
// columna no se salva con nada: en SQLite eso pide reconstruir la tabla.
//
// De aquí en adelante, un cambio sobre una tabla que ya existe se escribe dos
// veces —en schema.sql, que es la forma de destino, y aquí, que es el camino— y
// las dos tienen que coincidir. Es duplicación y es a propósito: la alternativa
// es derivar el camino leyendo el destino, que obliga a un motor de diffs de
// esquema, y un motor de diffs se equivoca en silencio justo el día que toca
// migrar el registro canónico.
//
// La versión es un entero y sólo sube. `user_version` vale 0 en toda base
// anterior a este archivo, que es exactamente lo que hace falta para reconocerla.

import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  readonly version: number;
  readonly name: string;
  /** Se ejecuta dentro de una transacción, con las claves foráneas apagadas. */
  apply(db: DatabaseSync): void;
}

/**
 * Reconstruye una tabla para cambiar algo que ALTER TABLE no alcanza.
 *
 * Es el procedimiento que documenta SQLite: crear la nueva con la forma que se
 * quiere, copiar, soltar la vieja, renombrar, rehacer los índices. Se le pasan
 * las columnas explícitamente en vez de `SELECT *` porque el orden importa y
 * porque un `*` copiaría en silencio una columna que la migración quería tirar.
 */
function rebuildTable(
  db: DatabaseSync,
  table: string,
  createNew: string,
  columns: readonly string[],
  indexes: readonly string[],
): void {
  const list = columns.join(', ');
  db.exec(createNew);
  db.exec(`INSERT INTO ${table}_new (${list}) SELECT ${list} FROM ${table}`);
  db.exec(`DROP TABLE ${table}`);
  db.exec(`ALTER TABLE ${table}_new RENAME TO ${table}`);
  for (const index of indexes) db.exec(index);
}

/**
 * 1 — el canal `walked`.
 *
 * core.allium admite un cuarto canal de contribución: lo que alguien produjo
 * andando por el corpus, que es de donde sale el testimonio de un cruce (ver
 * trail.allium). Dos CHECK lo rechazaban, y un CHECK no se cambia sin rehacer la
 * tabla.
 *
 * `revisions.channel` no aparece aquí porque no lleva CHECK: es TEXT a secas y
 * acepta el valor nuevo sin tocarla.
 */
const addWalkedChannel: Migration = {
  version: 1,
  name: 'canal walked',
  apply(db) {
    rebuildTable(
      db,
      'operations',
      `CREATE TABLE operations_new (
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
                                                 'agent_generation', 'import', 'walked')),
          evidence_reference     TEXT,
          evidence_captured_at   INTEGER,
          submitted_at           INTEGER NOT NULL,
          applied_at             INTEGER NOT NULL,
          CHECK (channel <> 'authenticated_voice' OR evidence_reference IS NOT NULL)
      ) STRICT`,
      [
        'id',
        'graph_id',
        'origin_id',
        'sequence',
        'participant_id',
        'change_kind',
        'change_payload',
        'subject_id',
        'channel',
        'evidence_reference',
        'evidence_captured_at',
        'submitted_at',
        'applied_at',
      ],
      [
        'CREATE UNIQUE INDEX operations_origin ON operations (graph_id, origin_id)',
        'CREATE UNIQUE INDEX operations_sequence ON operations (graph_id, sequence)',
      ],
    );

    rebuildTable(
      db,
      'block_authorship',
      `CREATE TABLE block_authorship_new (
          block_id        TEXT PRIMARY KEY REFERENCES blocks (id) ON DELETE CASCADE,
          participant_id  TEXT NOT NULL REFERENCES participants (id),
          channel         TEXT NOT NULL CHECK (
                              channel IN ('typed_text', 'authenticated_voice',
                                          'agent_generation', 'import', 'walked')),
          written_at      INTEGER NOT NULL
      ) STRICT`,
      ['block_id', 'participant_id', 'channel', 'written_at'],
      ['CREATE INDEX block_authorship_by_participant ON block_authorship (participant_id)'],
    );
  },
};

const addPageOriginCreatedAt: Migration = {
  version: 2,
  name: 'procedencia temporal de páginas',
  apply(db) {
    const pages = db
      .prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type = 'table' AND name = 'pages'")
      .get() as { n: number } | undefined;
    if ((pages?.n ?? 0) > 0) db.exec('ALTER TABLE pages ADD COLUMN origin_created_at INTEGER');
  },
};

/**
 * 3 — el secreto de un servicio.
 *
 * Una página de servicio gobierna a la vista todo lo que se puede mirar, y el
 * secreto vive aquí, fuera del log: el log es append-only, y una clave escrita
 * en él no se puede desescribir nunca. Ver service-connections.allium y la tabla
 * en schema.sql, que es la misma forma dicha en el sitio de destino.
 */
const addServiceSecrets: Migration = {
  version: 3,
  name: 'secretos de servicio',
  apply(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS service_secrets (
      graph_id      TEXT NOT NULL REFERENCES graphs (id),
      page_id       TEXT NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      secret        TEXT NOT NULL,
      saved_at      INTEGER NOT NULL,
      last_used_at  INTEGER,
      PRIMARY KEY (graph_id, page_id, name)
    ) STRICT`);
  },
};


/**
 * 4 — el canal `drawn`.
 *
 * Un dibujo hecho a mano llega con denominación de origen humana, como una
 * grabación: un trazo con su presión prueba que alguien lo hizo con la mano
 * sobre una pantalla. Ver specs/hand-drawing.allium. Dos CHECK lo rechazaban, y
 * un CHECK no se cambia sin rehacer la tabla — es la misma operación que hizo
 * falta para `walked`, y por eso esta migración se parece tanto a la primera.
 */
const addDrawnChannel: Migration = {
  version: 4,
  name: 'canal drawn',
  apply(db) {
    rebuildTable(
      db,
      'operations',
      `CREATE TABLE operations_new (
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
      ) STRICT`,
      [
        'id',
        'graph_id',
        'origin_id',
        'sequence',
        'participant_id',
        'change_kind',
        'change_payload',
        'subject_id',
        'channel',
        'evidence_reference',
        'evidence_captured_at',
        'submitted_at',
        'applied_at',
      ],
      [
        'CREATE UNIQUE INDEX operations_origin ON operations (graph_id, origin_id)',
        'CREATE UNIQUE INDEX operations_sequence ON operations (graph_id, sequence)',
      ],
    );

    rebuildTable(
      db,
      'block_authorship',
      `CREATE TABLE block_authorship_new (
          block_id        TEXT PRIMARY KEY REFERENCES blocks (id) ON DELETE CASCADE,
          participant_id  TEXT NOT NULL REFERENCES participants (id),
          channel         TEXT NOT NULL CHECK (
                              channel IN ('typed_text', 'authenticated_voice',
                                          'agent_generation', 'import', 'walked',
                                          'drawn')),
          written_at      INTEGER NOT NULL
      ) STRICT`,
      ['block_id', 'participant_id', 'channel', 'written_at'],
      ['CREATE INDEX block_authorship_by_participant ON block_authorship (participant_id)'],
    );
  },
};

/**
 * 5 — el registro de exposición.
 *
 * El log dice lo que se escribió; nada decía lo que se leyó. Ver
 * specs/mcp-server.allium y las tablas en schema.sql, que son esta misma forma
 * dicha en el sitio de destino.
 */
const addExposureLog: Migration = {
  version: 5,
  name: 'registro de exposición',
  apply(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS exposures (
      id              TEXT PRIMARY KEY,
      graph_id        TEXT NOT NULL REFERENCES graphs (id),
      participant_id  TEXT NOT NULL REFERENCES participants (id),
      credential_id   TEXT REFERENCES access_tokens (id),
      client          TEXT,
      surface         TEXT NOT NULL,
      subject         TEXT NOT NULL,
      outcome         TEXT NOT NULL,
      volume          INTEGER NOT NULL,
      at              INTEGER NOT NULL
    ) STRICT`);
    db.exec('CREATE INDEX IF NOT EXISTS exposures_by_participant ON exposures (participant_id, at)');
    db.exec('CREATE INDEX IF NOT EXISTS exposures_by_time ON exposures (at)');
    db.exec(`CREATE TABLE IF NOT EXISTS exposed_subjects (
      exposure_id  TEXT NOT NULL REFERENCES exposures (id) ON DELETE CASCADE,
      subject_id   TEXT NOT NULL,
      PRIMARY KEY (exposure_id, subject_id)
    ) STRICT`);
    db.exec('CREATE INDEX IF NOT EXISTS exposed_by_subject ON exposed_subjects (subject_id)');
  },
};

const addBlockGlosses: Migration = {
  version: 7,
  name: 'glosas canónicas de bloques',
  apply(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS block_glosses (
      block_id    TEXT PRIMARY KEY REFERENCES blocks (id) ON DELETE CASCADE,
      content     TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    ) STRICT`);
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS glosses_fts USING fts5 (
      content,
      content = 'block_glosses',
      content_rowid = 'rowid',
      tokenize = 'unicode61 remove_diacritics 2'
    )`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS glosses_fts_insert AFTER INSERT ON block_glosses BEGIN
      INSERT INTO glosses_fts (rowid, content) VALUES (new.rowid, new.content);
    END`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS glosses_fts_delete AFTER DELETE ON block_glosses BEGIN
      INSERT INTO glosses_fts (glosses_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    END`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS glosses_fts_update AFTER UPDATE OF content ON block_glosses BEGIN
      INSERT INTO glosses_fts (glosses_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      INSERT INTO glosses_fts (rowid, content) VALUES (new.rowid, new.content);
    END`);
  },
};

/*
 * El cerco de una credencial: qué clase puede plantar y con qué se marca.
 *
 * Ver specs/confined-writing.allium. Una fila por credencial cercada, y ninguna
 * para las que escriben sin cerco: el cerco se concede, no es un régimen que
 * caiga sobre lo que ya existe.
 *
 * No guarda qué páginas plantó. Eso se deriva del registro de operaciones —quién
 * sometió el `create_page` de cada página—, que ya lo sabe y no puede
 * desincronizarse de lo que de verdad pasó. Una tabla de propiedad sería un
 * segundo sitio diciendo lo mismo.
 */
const addConfinements: Migration = {
  version: 6,
  name: 'cercos de credencial',
  apply(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS confinements (
      token_id    TEXT PRIMARY KEY REFERENCES access_tokens (id) ON DELETE CASCADE,
      graph_id    TEXT NOT NULL REFERENCES graphs (id),
      kind        TEXT NOT NULL,
      source      TEXT,
      granted_by  TEXT NOT NULL REFERENCES participants (id),
      granted_at  INTEGER NOT NULL
    ) STRICT`);
    /*
     * Y el índice que hace barato preguntar quién plantó una página.
     *
     * `planted_by` se contesta buscando el `create_page` de esa página en el
     * registro, y se pregunta en cada escritura de una credencial cercada. Sin
     * índice es un recorrido del log entero por cada bloque que escriba una
     * máquina, que en un corpus de sesenta mil operaciones se nota.
     */
    db.exec(
      'CREATE INDEX IF NOT EXISTS operations_by_subject ON operations (subject_id, change_kind)',
    );
  },
};

const addMediaMetadata: Migration = {
  version: 8,
  name: 'descripción y texto alternativo de medios',
  apply(db) {
    const exists = db
      .prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type = 'table' AND name = 'media'")
      .get() as { n: number };
    // Las bases de las primeras versiones no tenían todavía almacén de medios.
    // schema.sql se lo crea al abrir; la migración sólo transforma el que ya estaba.
    if (exists.n === 0) return;
    db.exec('ALTER TABLE media ADD COLUMN description TEXT');
    db.exec('ALTER TABLE media ADD COLUMN alternative_text TEXT');
  },
};

/**
 * 9 — la publicación dice qué revisión y de qué mano.
 *
 * La tabla existía desde el primer esquema y nadie la escribía nunca, así que
 * describía una publicación más pobre que la que la spec pide: sitio, página,
 * ruta y fecha, sin revisión y sin quien publicó. Sin revisión, «lo publicado»
 * era la página de ahora y no el texto que se publicó; sin publicador, «quién
 * publicó esto» se leía del dueño de hoy, que no tiene por qué ser el de
 * entonces.
 *
 * Añadir dos columnas NOT NULL a una tabla con filas exige inventarles un valor,
 * y aquí no hay ninguno honesto que inventar. Por eso la migración se planta si
 * encuentra filas: en toda base existente hay cero, y una que las tuviera vendría
 * de un camino de escritura que nunca existió.
 */
const addPublicationProvenance: Migration = {
  version: 9,
  name: 'revisión y mano de una publicación',
  apply(db) {
    const table = db
      .prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type = 'table' AND name = 'publications'")
      .get() as { n: number };
    if (table.n === 0) return;
    const rows = db.prepare('SELECT count(*) AS n FROM publications').get() as { n: number };
    if (rows.n > 0) {
      throw new Error(
        `publications tiene ${rows.n} filas anteriores a que publicar registrara revisión y ` +
          'autor. No hay valor honesto que darles: revísalas a mano antes de migrar.',
      );
    }
    rebuildTable(
      db,
      'publications',
      `CREATE TABLE publications_new (
          id                     TEXT PRIMARY KEY,
          site_id                TEXT NOT NULL REFERENCES personal_sites (id),
          page_id                TEXT NOT NULL REFERENCES pages (id),
          revision_operation_id  TEXT NOT NULL REFERENCES operations (id),
          path                   TEXT NOT NULL,
          published_at           INTEGER NOT NULL,
          published_by           TEXT NOT NULL REFERENCES participants (id)
      ) STRICT`,
      ['id', 'site_id', 'page_id', 'path', 'published_at'],
      ['CREATE UNIQUE INDEX publications_path ON publications (site_id, path)'],
    );
  },
};

/** 10 — la portada pertenece al sitio, no al comando que construye sus archivos. */
const addSiteEntryPoint: Migration = {
  version: 10,
  name: 'portada persistida del sitio',
  apply(db) {
    const sites = db
      .prepare(
        "SELECT count(*) AS n FROM sqlite_schema WHERE type = 'table' AND name = 'personal_sites'",
      )
      .get() as { n: number } | undefined;
    if ((sites?.n ?? 0) === 0) return;

    const columns = db.prepare('PRAGMA table_info(personal_sites)').all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === 'entry_point')) return;

    db.exec(
      'ALTER TABLE personal_sites ADD COLUMN entry_point TEXT REFERENCES pages (id) ON DELETE SET NULL',
    );
  },
};

/** 11 — espacios compartidos, capacidades de invitación y matrícula humana. */
const addSharedSpaces: Migration = {
  version: 11,
  name: 'espacios compartidos e invitaciones humanas',
  apply(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS shared_spaces (
        id TEXT PRIMARY KEY, graph_id TEXT NOT NULL REFERENCES graphs (id),
        owner_id TEXT NOT NULL REFERENCES participants (id), name TEXT NOT NULL,
        slug TEXT NOT NULL, selector_key TEXT NOT NULL, selector_value TEXT NOT NULL,
        audience TEXT NOT NULL CHECK (audience IN ('anybody', 'restricted')),
        status TEXT NOT NULL CHECK (status IN ('active', 'withdrawn')), created_at INTEGER NOT NULL,
        UNIQUE (graph_id, slug)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS access_invitations (
        id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES shared_spaces (id) ON DELETE CASCADE,
        issued_by TEXT NOT NULL REFERENCES participants (id), permissions TEXT NOT NULL,
        proof_digest TEXT NOT NULL UNIQUE, intended_contact TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'redeemed', 'revoked', 'expired')),
        issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        redeemed_by TEXT REFERENCES participants (id), redeemed_at INTEGER
      ) STRICT;
      CREATE TABLE IF NOT EXISTS access_grants (
        id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES shared_spaces (id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL REFERENCES participants (id), permissions TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
        granted_by TEXT NOT NULL REFERENCES participants (id), granted_at INTEGER NOT NULL,
        revoked_at INTEGER, UNIQUE (space_id, participant_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS authenticator_enrollments (
        id TEXT PRIMARY KEY, graph_id TEXT NOT NULL REFERENCES graphs (id),
        participant_id TEXT NOT NULL REFERENCES participants (id),
        authorized_by TEXT NOT NULL REFERENCES participants (id), proof_digest TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'revoked', 'expired')),
        expires_at INTEGER NOT NULL
      ) STRICT;
    `);
  },
};

/** 12 — passkeys WebAuthn, desafíos efímeros y sesiones humanas revocables. */
const addHumanAuthentication: Migration = {
  version: 12,
  name: 'passkeys y sesiones humanas',
  apply(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS human_authenticators (
        credential_id TEXT PRIMARY KEY, participant_id TEXT NOT NULL REFERENCES participants (id),
        public_key BLOB NOT NULL, counter INTEGER NOT NULL, transports TEXT NOT NULL,
        device_type TEXT NOT NULL, backed_up INTEGER NOT NULL CHECK (backed_up IN (0,1)),
        label TEXT, registered_at INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active','revoked'))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS webauthn_challenges (
        id TEXT PRIMARY KEY, participant_id TEXT NOT NULL REFERENCES participants (id),
        purpose TEXT NOT NULL CHECK (purpose IN ('registration','authentication')),
        challenge TEXT NOT NULL, rp_id TEXT NOT NULL, origin TEXT NOT NULL, expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS human_sessions (
        id TEXT PRIMARY KEY, participant_id TEXT NOT NULL REFERENCES participants (id),
        proof_digest TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('active','revoked','expired')),
        began_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
        revoked_at INTEGER
      ) STRICT;
    `);
  },
};

/** 14 — pertenencia compuesta de espacios: criterios múltiples y páginas manuales. */
const composeSharedSpaceMembership: Migration = {
  version: 14,
  name: 'criterios múltiples y páginas manuales en espacios compartidos',
  apply(db) {
    const columns = db.prepare('PRAGMA table_info(shared_spaces)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'criterion_combination')) {
      db.exec("ALTER TABLE shared_spaces ADD COLUMN criterion_combination TEXT NOT NULL DEFAULT 'any' CHECK (criterion_combination IN ('any','all'))");
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS shared_space_criteria (
        id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES shared_spaces (id) ON DELETE CASCADE,
        selector_key TEXT NOT NULL, selector_value TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active','removed')),
        added_by TEXT NOT NULL REFERENCES participants (id), added_at INTEGER NOT NULL, removed_at INTEGER
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_shared_space_criterion
        ON shared_space_criteria(space_id,selector_key,selector_value) WHERE status='active';
      CREATE TABLE IF NOT EXISTS shared_space_manual_pages (
        id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES shared_spaces (id) ON DELETE CASCADE,
        page_id TEXT NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('active','removed')),
        added_by TEXT NOT NULL REFERENCES participants (id), added_at INTEGER NOT NULL, removed_at INTEGER
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_manual_page_inclusion
        ON shared_space_manual_pages(space_id,page_id) WHERE status='active';
      INSERT INTO shared_space_criteria
        (id,space_id,selector_key,selector_value,status,added_by,added_at)
      SELECT 'criterion:migrated:' || id,id,selector_key,selector_value,'active',owner_id,created_at
      FROM shared_spaces
      WHERE NOT EXISTS (SELECT 1 FROM shared_space_criteria c WHERE c.space_id=shared_spaces.id);
    `);
  },
};

/** 15 — propuestas editoriales atribuidas dentro de espacios compartidos. */
const addSharedProposals: Migration = {
  version: 15,
  name: 'propuestas editoriales de espacios compartidos',
  apply(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS shared_proposals (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES shared_spaces (id) ON DELETE CASCADE,
      page_id TEXT NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES participants (id),
      origin_id TEXT NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('typed_text','drawn','walked')),
      change_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('awaiting_review','accepted','rejected')),
      proposed_at INTEGER NOT NULL,
      reviewed_by TEXT REFERENCES participants (id),
      reviewed_at INTEGER,
      UNIQUE (space_id, author_id, origin_id)
    ) STRICT;`);
  },
};

/** 13 — conectivas con identidad e historia propias. */
const addCrossings: Migration = {
  version: 13,
  name: 'conectivas persistentes',
  apply(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS crossings (
      id TEXT PRIMARY KEY,
      graph_id TEXT NOT NULL REFERENCES graphs (id),
      from_page TEXT NOT NULL REFERENCES pages (id),
      to_page TEXT NOT NULL REFERENCES pages (id),
      content TEXT NOT NULL,
      term TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK (from_page <> to_page),
      UNIQUE (graph_id, from_page, to_page)
    ) STRICT`);
    db.exec('CREATE INDEX IF NOT EXISTS crossings_by_destination ON crossings (graph_id, to_page)');
    const revisions = db.prepare(
      "SELECT count(*) AS n FROM sqlite_schema WHERE type='table' AND name='revisions'",
    ).get() as { n: number } | undefined;
    if ((revisions?.n ?? 0) > 0) {
      const columns = db.prepare(`PRAGMA table_info(revisions)`).all() as { name: string }[];
      if (!columns.some((one) => one.name === 'crossing_id')) {
        db.exec('ALTER TABLE revisions ADD COLUMN crossing_id TEXT');
      }
    }
  },
};

/** 16 — los bloques pueden pertenecer al outline de una relación. */
const addCrossingBlockOwners: Migration = {
  version: 16,
  name: 'outlines de relaciones',
  apply(db) {
    const table = db.prepare(
      `SELECT count(*) AS n FROM sqlite_schema WHERE type='table' AND name='blocks'`,
    ).get() as { n: number };
    if (table.n === 0) return;
    const columns = db.prepare('PRAGMA table_info(blocks)').all() as { name: string }[];
    if (!columns.some((one) => one.name === 'page_id')) return;
    rebuildTable(
      db,
      'blocks',
      `CREATE TABLE blocks_new (
          id          TEXT PRIMARY KEY,
          page_id     TEXT REFERENCES pages (id),
          crossing_id TEXT REFERENCES crossings (id),
          parent_id   TEXT REFERENCES blocks (id),
          position    INTEGER NOT NULL,
          content     TEXT NOT NULL,
          created_at  INTEGER NOT NULL,
          CHECK ((page_id IS NULL) <> (crossing_id IS NULL))
       ) STRICT`,
      ['id', 'page_id', 'parent_id', 'position', 'content', 'created_at'],
      [
        'CREATE INDEX blocks_by_page ON blocks (page_id, parent_id, position)',
        'CREATE INDEX blocks_by_crossing ON blocks (crossing_id, parent_id, position)',
      ],
    );
    db.exec(`
      INSERT INTO blocks (id, page_id, crossing_id, parent_id, position, content, created_at)
      SELECT 'block:' || replace(id, 'crossing:', 'crossing-') || ':root',
             NULL, id, NULL, 0, content, created_at
      FROM crossings
      WHERE NOT EXISTS (SELECT 1 FROM blocks b WHERE b.crossing_id = crossings.id);

      INSERT OR IGNORE INTO block_authorship (block_id, participant_id, channel, written_at)
      SELECT 'block:' || replace(c.id, 'crossing:', 'crossing-') || ':root',
             r.authored_by, r.channel, r.recorded_at
      FROM crossings c
      JOIN revisions r ON r.crossing_id = c.id
      WHERE r.recorded_at = (
        SELECT max(latest.recorded_at) FROM revisions latest WHERE latest.crossing_id = c.id
      );
    `);
  },
};

const addAgentConversations: Migration = {
  version: 17,
  name: 'conversaciones durables con agentes',
  apply(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_conversations (
        id TEXT PRIMARY KEY,
        graph_id TEXT NOT NULL REFERENCES graphs (id),
        human_id TEXT NOT NULL REFERENCES participants (id),
        agent_id TEXT NOT NULL REFERENCES participants (id),
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
        created_at INTEGER NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS agent_conversation_pair
        ON agent_conversations (graph_id, human_id, agent_id) WHERE status = 'active';
      CREATE TABLE IF NOT EXISTS agent_requests (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES agent_conversations (id),
        graph_id TEXT NOT NULL REFERENCES graphs (id),
        asked_by TEXT NOT NULL REFERENCES participants (id),
        modality TEXT NOT NULL CHECK (modality IN ('audio', 'command', 'block', 'conversation_page', 'page')),
        text TEXT NOT NULL,
        source_page_id TEXT REFERENCES pages (id) ON DELETE SET NULL,
        source_block_id TEXT REFERENCES blocks (id) ON DELETE SET NULL,
        context_snapshot TEXT NOT NULL,
        retry_of TEXT REFERENCES agent_requests (id),
        status TEXT NOT NULL CHECK (status IN ('queued', 'working', 'answered', 'failed', 'cancelled')),
        dispatch_status TEXT NOT NULL CHECK (dispatch_status IN ('pending', 'delivered', 'failed')),
        dispatch_attempts INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        last_dispatch_at INTEGER,
        failure_reason TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS agent_requests_by_source
        ON agent_requests (source_page_id, source_block_id, created_at);
      CREATE INDEX IF NOT EXISTS agent_requests_pending
        ON agent_requests (status, dispatch_status, created_at);
      CREATE TABLE IF NOT EXISTS agent_replies (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE REFERENCES agent_requests (id) ON DELETE CASCADE,
        answered_by TEXT NOT NULL REFERENCES participants (id),
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS agent_operation_proposals (
        id TEXT PRIMARY KEY,
        reply_id TEXT NOT NULL UNIQUE REFERENCES agent_replies (id) ON DELETE CASCADE,
        proposed_by TEXT NOT NULL REFERENCES participants (id),
        changes_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('proposed', 'accepted', 'rejected')),
        proposed_at INTEGER NOT NULL,
        decided_by TEXT REFERENCES participants (id),
        decided_at INTEGER
      ) STRICT;
    `);
  },
};

const addDendriticGraphView: Migration = {
  version: 18,
  name: 'vista dendrítica D4',
  apply(db) {
    const workspaceTable = db.prepare(
      "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = 'workspaces'",
    ).get() as { present: number } | undefined;
    // Los corpus anteriores a la introducción de espacios no tienen nada que
    // reconstruir. schema.sql creará directamente la versión vigente.
    if (workspaceTable === undefined) return;
    rebuildTable(
      db,
      'workspaces',
      `CREATE TABLE workspaces_new (
        participant_id TEXT NOT NULL REFERENCES participants (id),
        graph_id TEXT NOT NULL REFERENCES graphs (id),
        active_page TEXT REFERENCES pages (id),
        layout TEXT NOT NULL DEFAULT 'split' CHECK (layout IN ('text_only', 'graph_only', 'split')),
        split_divider_position REAL NOT NULL DEFAULT 0.5,
        graph_view TEXT NOT NULL DEFAULT 'graph_2d' CHECK (graph_view IN ('graph_2d', 'graph_3d', 'graph_d4')),
        colour_scheme TEXT NOT NULL DEFAULT 'light' CHECK (colour_scheme IN ('light', 'dark')),
        design_tokens TEXT,
        graph_reach INTEGER,
        PRIMARY KEY (participant_id, graph_id)
      ) STRICT`,
      [
        'participant_id', 'graph_id', 'active_page', 'layout',
        'split_divider_position', 'graph_view', 'colour_scheme',
        'design_tokens', 'graph_reach',
      ],
      [],
    );
  },
};

/** 19 — cada superficie decide si hace transparente la historia pública de sus bloques. */
const addTransparentBlockTraceability: Migration = {
  version: 19,
  name: 'trazabilidad transparente de bloques por superficie',
  apply(db) {
    const table = db.prepare(
      "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = 'personal_sites'",
    ).get() as { present: number } | undefined;
    if (table === undefined) return;
    const columns = db.prepare('PRAGMA table_info(personal_sites)').all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === 'transparent_block_traceability')) return;
    db.exec(`ALTER TABLE personal_sites ADD COLUMN transparent_block_traceability
      INTEGER NOT NULL DEFAULT 0 CHECK (transparent_block_traceability IN (0, 1))`);
  },
};

/** 20 — índice de subcadenas para la búsqueda interactiva resumida por página. */
const addInteractiveSearchIndexes: Migration = {
  version: 20,
  name: 'índices interactivos de búsqueda por subcadena',
  apply(db) {
    for (const [index, column, table] of [
      ['pages_search', 'title', 'pages'],
      ['blocks_search', 'content', 'blocks'],
      ['property_values_search', 'value', 'property_assignments'],
      ['glosses_search', 'content', 'block_glosses'],
    ] as const) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      // Algunas bases de prueba e instalaciones antiquísimas sólo contienen
      // el registro mínimo. schema.sql completará esas tablas al abrirlas; la
      // migración no debe inventar un índice contra una columna aún ausente.
      if (!columns.some((one) => one.name === column)) continue;
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${index} USING fts5 (
        ${column}, content = '${table}', content_rowid = 'rowid',
        tokenize = 'trigram remove_diacritics 1'
      )`);
      db.exec(`INSERT INTO ${index} (${index}) VALUES ('rebuild')`);
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${index}_insert AFTER INSERT ON ${table} BEGIN
        INSERT INTO ${index} (rowid, ${column}) VALUES (new.rowid, new.${column});
      END`);
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${index}_delete AFTER DELETE ON ${table} BEGIN
        INSERT INTO ${index} (${index}, rowid, ${column}) VALUES ('delete', old.rowid, old.${column});
      END`);
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${index}_update AFTER UPDATE OF ${column} ON ${table} BEGIN
        INSERT INTO ${index} (${index}, rowid, ${column}) VALUES ('delete', old.rowid, old.${column});
        INSERT INTO ${index} (rowid, ${column}) VALUES (new.rowid, new.${column});
      END`);
    }
  },
};

/**
 * 21 — exposiciones compactas.
 *
 * El registro anterior repetía una fila por cada página o bloque entregado. Una
 * búsqueda interactiva podía convertir una sola tecla en decenas de miles de
 * filas y la auditoría terminaba pesando mucho más que la memoria que vigilaba.
 * Conservamos una magnitud por llamada y retiramos el índice microscópico.
 */
const compactExposureLog: Migration = {
  version: 21,
  name: 'exposiciones compactas',
  apply(db) {
    const present = db.prepare(
      "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = 'exposures'",
    ).get() as { present: number } | undefined;
    if (present === undefined) return;
    const columns = db.prepare('PRAGMA table_info(exposures)').all() as Array<{ name: string }>;
    if (!columns.some((one) => one.name === 'delivered_count')) {
      db.exec('ALTER TABLE exposures ADD COLUMN delivered_count INTEGER NOT NULL DEFAULT 0');
    }
    db.exec('DROP TABLE IF EXISTS exposed_subjects');
  },
};

/** 22 — propuestas generales de agentes, atadas a una revisión del bloque. */
const addOperationReviewProposals: Migration = {
  version: 22,
  name: 'propuestas de operación revisables',
  apply(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS operation_review_proposals (
      id TEXT PRIMARY KEY,
      graph_id TEXT NOT NULL REFERENCES graphs (id),
      proposed_by TEXT NOT NULL REFERENCES participants (id),
      origin_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      page_id TEXT NOT NULL,
      block_id TEXT NOT NULL,
      change_json TEXT NOT NULL,
      target_revision TEXT NOT NULL,
      original_content TEXT NOT NULL,
      purpose TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('awaiting_review','accepted','rejected','conflicted')
      ),
      proposed_at INTEGER NOT NULL,
      decided_by TEXT REFERENCES participants (id),
      decided_at INTEGER,
      UNIQUE (graph_id, proposed_by, origin_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS operation_review_proposals_pending
      ON operation_review_proposals (graph_id, status, proposed_at)`);
  },
};

/** 23 — perfil de gobierno e identidades humanas de una instancia colectiva. */
const addInstanceProfiles: Migration = {
  version: 23,
  name: 'perfiles personal y colectivo',
  apply(db) {
    const instances = db.prepare(
      "SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name='instances'",
    ).get() as { present: number } | undefined;
    if (instances !== undefined) {
      const columns = db.prepare('PRAGMA table_info(instances)').all() as Array<{ name: string }>;
      if (!columns.some((one) => one.name === 'profile')) {
        db.exec("ALTER TABLE instances ADD COLUMN profile TEXT NOT NULL DEFAULT 'personal' CHECK (profile IN ('personal','collective'))");
      }
    }
    db.exec(`CREATE TABLE IF NOT EXISTS instance_governance_grants (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL REFERENCES instances (id) ON DELETE CASCADE,
      participant_id TEXT NOT NULL REFERENCES participants (id),
      role TEXT NOT NULL CHECK (role IN ('root_custodian','administrator','editor','contributor','reader','publisher')),
      status TEXT NOT NULL CHECK (status IN ('active','revoked')),
      granted_by TEXT NOT NULL REFERENCES participants (id),
      granted_at INTEGER NOT NULL,
      revoked_at INTEGER
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_instance_role
      ON instance_governance_grants(instance_id,participant_id,role) WHERE status='active';
    CREATE TABLE IF NOT EXISTS collective_invitations (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL REFERENCES instances (id) ON DELETE CASCADE,
      issued_by TEXT NOT NULL REFERENCES participants (id),
      role TEXT NOT NULL CHECK (role IN ('administrator','editor','contributor','reader','publisher')),
      proof_digest TEXT NOT NULL UNIQUE,
      intended_contact TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending','redeemed','revoked','expired')),
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      redeemed_by TEXT REFERENCES participants (id),
      redeemed_at INTEGER
    ) STRICT`);
  },
};

/** 24 — una portada explícita y estable para cada superficie compartida. */
const addSharedSpaceEntryPoint: Migration = {
  version: 24,
  name: 'portada persistida de espacios compartidos',
  apply(db) {
    const spaces = db.prepare(
      "SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name='shared_spaces'",
    ).get() as { present: number } | undefined;
    if (spaces === undefined) return;
    const columns = db.prepare('PRAGMA table_info(shared_spaces)').all() as Array<{ name: string }>;
    if (!columns.some((one) => one.name === 'entry_point')) {
      db.exec('ALTER TABLE shared_spaces ADD COLUMN entry_point TEXT REFERENCES pages (id) ON DELETE SET NULL');
    }
  },
};

/** 25 — una identidad estable puede tener muchas credenciales y accesos. */
const stabiliseParticipantIdentity: Migration = {
  version: 25,
  name: 'identidad estable de participantes',
  apply(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS participant_reconciliations (
        duplicate_id TEXT PRIMARY KEY REFERENCES participants (id),
        canonical_id TEXT NOT NULL REFERENCES participants (id),
        reconciled_by TEXT NOT NULL REFERENCES participants (id),
        reason TEXT NOT NULL,
        reconciled_at INTEGER NOT NULL,
        CHECK (duplicate_id <> canonical_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS participant_name_history (
        id TEXT PRIMARY KEY,
        participant_id TEXT NOT NULL REFERENCES participants (id),
        former_name TEXT NOT NULL,
        new_name TEXT NOT NULL,
        changed_by TEXT NOT NULL REFERENCES participants (id),
        changed_at INTEGER NOT NULL
      ) STRICT;
    `);

    const exists = (table: string): boolean => db.prepare(
      `SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name=?`,
    ).get(table) !== undefined;

    if (exists('access_invitations')) {
      db.exec('ALTER TABLE access_invitations ADD COLUMN participant_id TEXT REFERENCES participants (id)');
      db.exec(`UPDATE access_invitations SET participant_id=redeemed_by WHERE redeemed_by IS NOT NULL`);
      db.exec(`UPDATE access_invitations SET status='revoked' WHERE participant_id IS NULL AND status='pending'`);
      rebuildTable(
        db,
        'access_invitations',
        `CREATE TABLE access_invitations_new (
          id TEXT PRIMARY KEY,
          space_id TEXT NOT NULL REFERENCES shared_spaces (id) ON DELETE CASCADE,
          issued_by TEXT NOT NULL REFERENCES participants (id),
          participant_id TEXT REFERENCES participants (id),
          permissions TEXT NOT NULL,
          proof_digest TEXT NOT NULL UNIQUE,
          intended_contact TEXT,
          status TEXT NOT NULL CHECK (status IN ('pending','redeemed','revoked','expired')),
          issued_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          redeemed_by TEXT REFERENCES participants (id),
          redeemed_at INTEGER,
          CHECK (participant_id IS NOT NULL OR status IN ('revoked','expired'))
        ) STRICT`,
        ['id', 'space_id', 'issued_by', 'participant_id', 'permissions', 'proof_digest', 'intended_contact',
          'status', 'issued_at', 'expires_at', 'redeemed_by', 'redeemed_at'],
        [],
      );
    }

    if (exists('collective_invitations')) {
      db.exec('ALTER TABLE collective_invitations ADD COLUMN participant_id TEXT REFERENCES participants (id)');
      db.exec(`UPDATE collective_invitations SET participant_id=redeemed_by WHERE redeemed_by IS NOT NULL`);
      db.exec(`UPDATE collective_invitations SET status='revoked' WHERE participant_id IS NULL AND status='pending'`);
      rebuildTable(
        db,
        'collective_invitations',
        `CREATE TABLE collective_invitations_new (
          id TEXT PRIMARY KEY,
          instance_id TEXT NOT NULL REFERENCES instances (id) ON DELETE CASCADE,
          issued_by TEXT NOT NULL REFERENCES participants (id),
          participant_id TEXT REFERENCES participants (id),
          role TEXT NOT NULL CHECK (role IN ('administrator','editor','contributor','reader','publisher')),
          proof_digest TEXT NOT NULL UNIQUE,
          intended_contact TEXT,
          status TEXT NOT NULL CHECK (status IN ('pending','redeemed','revoked','expired')),
          issued_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          redeemed_by TEXT REFERENCES participants (id),
          redeemed_at INTEGER,
          CHECK (participant_id IS NOT NULL OR status IN ('revoked','expired'))
        ) STRICT`,
        ['id', 'instance_id', 'issued_by', 'participant_id', 'role', 'proof_digest', 'intended_contact',
          'status', 'issued_at', 'expires_at', 'redeemed_by', 'redeemed_at'],
        [],
      );
    }

    if (exists('access_grants')) rebuildTable(
      db,
      'access_grants',
      `CREATE TABLE access_grants_new (
        id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES shared_spaces (id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL REFERENCES participants (id),
        permissions TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active','revoked')),
        granted_by TEXT NOT NULL REFERENCES participants (id),
        granted_at INTEGER NOT NULL,
        revoked_at INTEGER
      ) STRICT`,
      ['id', 'space_id', 'participant_id', 'permissions', 'status', 'granted_by',
        'granted_at', 'revoked_at'],
      ['CREATE UNIQUE INDEX one_active_space_grant ON access_grants(space_id,participant_id) WHERE status=\'active\''],
    );
  },
};

/** 26 — el dueño compone el plegado inicial sin convertirlo en contenido. */
const addEditorialFolds: Migration = {
  version: 26,
  name: 'plegado editorial compartido',
  apply(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS block_presentation_folds (
      block_id TEXT PRIMARY KEY REFERENCES blocks (id) ON DELETE CASCADE,
      set_by TEXT NOT NULL REFERENCES participants (id),
      set_at INTEGER NOT NULL
    ) STRICT`);
  },
};

/** 27 — distingue enlaces portadores de enlaces ligados a una identidad. */
const addIdentifiedInvitations: Migration = {
  version: 27,
  name: 'invitaciones ligadas a identidad',
  apply(db) {
    const invitations = db.prepare(
      "SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name='access_invitations'",
    ).get() as { present: number } | undefined;
    if (invitations === undefined) return;
    const columns = db.prepare('PRAGMA table_info(access_invitations)').all() as Array<{ name: string }>;
    if (!columns.some((one) => one.name === 'proof_mode')) {
      db.exec("ALTER TABLE access_invitations ADD COLUMN proof_mode TEXT NOT NULL DEFAULT 'bearer' CHECK (proof_mode IN ('bearer','identified'))");
    }
  },
};

/** 28 — una IA tiene principal humano y una constitución portable versionada. */
const addAgentManifests: Migration = {
  version: 28,
  name: 'principal y manifiesto de agentes',
  apply(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_principals (
        agent_id TEXT PRIMARY KEY REFERENCES participants (id),
        human_id TEXT NOT NULL REFERENCES participants (id),
        established_by TEXT NOT NULL REFERENCES participants (id),
        established_at INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active','revoked'))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS agent_constitution_pages (
        agent_id TEXT NOT NULL REFERENCES participants (id),
        page_id TEXT NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('identity','purpose','practice','memory','governance')),
        position INTEGER NOT NULL,
        added_by TEXT NOT NULL REFERENCES participants (id),
        added_at INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active','removed')),
        PRIMARY KEY (agent_id, page_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS agent_manifests (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES participants (id),
        version INTEGER NOT NULL,
        digest TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft','active','superseded','failed')),
        created_by TEXT NOT NULL REFERENCES participants (id),
        created_at INTEGER NOT NULL,
        activated_by TEXT REFERENCES participants (id),
        activated_at INTEGER,
        supersedes_id TEXT REFERENCES agent_manifests (id),
        failure_reason TEXT,
        UNIQUE (agent_id, version)
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_agent_manifest
        ON agent_manifests(agent_id) WHERE status = 'active';
    `);

    // Una Vera personal ya declara quién es su persona soberana. Los agentes
    // históricos quedan ligados a ella sin deducir identidad desde el nombre ni
    // desde una credencial concreta. En una Vera colectiva la elección exige un
    // acto humano posterior: no se apropian agentes por omisión.
    const has = (table: string): boolean => db.prepare(
      "SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?",
    ).get(table) !== undefined;
    const participantColumns = has('participants')
      ? db.prepare('PRAGMA table_info(participants)').all() as Array<{ name: string }>
      : [];
    if (has('instances') && participantColumns.some((one) => one.name === 'kind')) {
      db.exec(`INSERT OR IGNORE INTO agent_principals
        (agent_id,human_id,established_by,established_at,status)
        SELECT p.id,i.owner_id,i.owner_id,unixepoch('now') * 1000,'active'
        FROM participants p
        JOIN instances i ON i.profile='personal'
        WHERE p.kind='agent'`);
    }
  },
};

/** 29 — sesiones conversacionales, voz conservada y progreso durable. */
const addConversationalSessions: Migration = {
  version: 29,
  name: 'sesiones, voz y progreso conversacional',
  apply(db) {
    const requests = db.prepare(
      "SELECT 1 FROM sqlite_schema WHERE type='table' AND name='agent_requests'",
    ).get();
    // Algunos fósiles parciales usados para comprobar migraciones anteriores no
    // contienen todavía el subsistema conversacional. schema.sql les dará la
    // forma de destino al abrir; aquí no hay filas que transformar.
    if (requests === undefined) return;
    const columns = db.prepare('PRAGMA table_info(agent_requests)').all() as Array<{ name: string }>;
    if (!columns.some((one) => one.name === 'recording_id')) {
      db.exec('ALTER TABLE agent_requests ADD COLUMN recording_id TEXT REFERENCES recordings(id) ON DELETE SET NULL');
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_request_events (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL REFERENCES agent_requests (id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('stage', 'tool', 'pending')),
        text TEXT NOT NULL,
        created_by TEXT NOT NULL REFERENCES participants (id),
        created_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS agent_request_events_by_request
        ON agent_request_events (request_id, created_at);
    `);
  },
};

export const MIGRATIONS: readonly Migration[] = [
  addWalkedChannel,
  addPageOriginCreatedAt,
  addServiceSecrets,
  addDrawnChannel,
  addExposureLog,
  addConfinements,
  addBlockGlosses,
  addMediaMetadata,
  addPublicationProvenance,
  addSiteEntryPoint,
  addSharedSpaces,
  addHumanAuthentication,
  addCrossings,
  composeSharedSpaceMembership,
  addSharedProposals,
  addCrossingBlockOwners,
  addAgentConversations,
  addDendriticGraphView,
  addTransparentBlockTraceability,
  addInteractiveSearchIndexes,
  compactExposureLog,
  addOperationReviewProposals,
  addInstanceProfiles,
  addSharedSpaceEntryPoint,
  stabiliseParticipantIdentity,
  addEditorialFolds,
  addIdentifiedInvitations,
  addAgentManifests,
  addConversationalSessions,
];

/** La versión a la que llega una base nueva sin correr una sola migración. */
export const SCHEMA_VERSION = MIGRATIONS.reduce((top, m) => Math.max(top, m.version), 0);

function userVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  return row?.user_version ?? 0;
}

function setUserVersion(db: DatabaseSync, version: number): void {
  // PRAGMA no acepta parámetros ligados; el valor es un entero de este módulo,
  // nunca de fuera.
  db.exec(`PRAGMA user_version = ${version}`);
}

/**
 * Si esta base acaba de nacer.
 *
 * Hay que preguntarlo ANTES de aplicar schema.sql, y ahí está toda la sutileza
 * del asunto: después de aplicarlo, una base nueva y una base vieja sin migrar
 * son indistinguibles —las dos tienen todas las tablas y `user_version` en 0— y
 * correrle las migraciones a la nueva sería reconstruir tablas recién creadas
 * con la forma que ya tenían.
 */
export function isFreshDatabase(db: DatabaseSync): boolean {
  const row = db
    .prepare(`SELECT count(*) AS n FROM sqlite_schema WHERE type = 'table' AND name = 'operations'`)
    .get() as { n: number } | undefined;
  return (row?.n ?? 0) === 0;
}

/**
 * Lleva la base hasta SCHEMA_VERSION, corriendo lo que le falte y nada más.
 *
 * Una base nueva se sella en la versión de destino sin ejecutar ninguna
 * migración: schema.sql ya la creó con esa forma. Una que venía de antes corre
 * las que le falten, en orden, cada una en su propia transacción — si la tercera
 * falla, la base queda en la segunda y no a medio camino de ninguna.
 */
export function migrate(db: DatabaseSync, fresh: boolean): void {
  if (fresh) {
    setUserVersion(db, SCHEMA_VERSION);
    return;
  }

  const from = userVersion(db);
  const pending = MIGRATIONS.filter((m) => m.version > from).sort((a, b) => a.version - b.version);
  if (pending.length === 0) return;

  for (const migration of pending) {
    // Fuera de la transacción a propósito: SQLite ignora este PRAGMA dentro de
    // una, y reconstruir una tabla a la que otras apuntan necesita que esté
    // apagado. Se restaura pase lo que pase.
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec('BEGIN');
      try {
        migration.apply(db);
        setUserVersion(db, migration.version);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }

      const broken = db.prepare('PRAGMA foreign_key_check').all();
      if (broken.length > 0) {
        throw new Error(
          `La migración ${migration.version} (${migration.name}) dejó ${broken.length} referencias rotas`,
        );
      }
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
}
