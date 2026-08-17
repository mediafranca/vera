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

/** 11 — los valores de propiedades participan en la búsqueda FTS. */
const addPropertySearch: Migration = {
  version: 11,
  name: 'índice FTS de propiedades',
  apply(db) {
    const properties = db
      .prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type = 'table' AND name = 'property_assignments'")
      .get() as { n: number };
    // El esquema anterior a property_assignments no tiene nada que indexar. Al
    // abrirlo mediante openStore, schema.sql crea la tabla antes de llegar aquí.
    if (properties.n === 0) return;
    // En openStore schema.sql llega primero; la migración también es autónoma
    // porque migrate() es una unidad pública y sus pruebas parten del esquema
    // histórico, sin aplicar el destino por adelantado.
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS properties_fts USING fts5 (
        key, value, content = 'property_assignments', content_rowid = 'rowid',
        tokenize = 'unicode61 remove_diacritics 2'
      );
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
    `);
    // Una tabla FTS de contenido externo no recoge hacia atrás las filas que ya
    // existían: `rebuild` materializa el corpus anterior una sola vez.
    db.exec("INSERT INTO properties_fts(properties_fts) VALUES('rebuild')");
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
  addPropertySearch,
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
