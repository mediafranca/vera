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
