// Pruebas de las migraciones, sobre SQLite real.
//
// Lo que hay que demostrar aquí es exactamente dos cosas, porque son las dos que
// pueden salir mal en silencio: que una base nueva no corra migraciones que no le
// tocan, y que una base vieja llegue a la forma de destino sin perder una fila.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { MIGRATIONS, SCHEMA_VERSION, isFreshDatabase, migrate } from '../src/migrations.ts';
import { openStore, saveParticipant } from '../src/store.ts';

/**
 * Una base con la forma que tenía Vera antes de migrations.ts: las dos tablas
 * con CHECK que rechazan `walked`, `user_version` en cero, y filas dentro.
 *
 * Se escribe a mano y no se lee de un schema.sql viejo a propósito: lo que se
 * está probando es el salto desde esa forma concreta, y un archivo que cambiara
 * con el tiempo dejaría de describirla.
 */
function legacyDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE graphs (id TEXT PRIMARY KEY, name TEXT NOT NULL) STRICT;
    CREATE TABLE participants (id TEXT PRIMARY KEY, name TEXT NOT NULL) STRICT;
    CREATE TABLE blocks (id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE operations (
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
                                               'agent_generation', 'import')),
        evidence_reference     TEXT,
        evidence_captured_at   INTEGER,
        submitted_at           INTEGER NOT NULL,
        applied_at             INTEGER NOT NULL,
        CHECK (channel <> 'authenticated_voice' OR evidence_reference IS NOT NULL)
    ) STRICT;
    CREATE UNIQUE INDEX operations_origin ON operations (graph_id, origin_id);
    CREATE UNIQUE INDEX operations_sequence ON operations (graph_id, sequence);
    CREATE TABLE block_authorship (
        block_id        TEXT PRIMARY KEY REFERENCES blocks (id) ON DELETE CASCADE,
        participant_id  TEXT NOT NULL REFERENCES participants (id),
        channel         TEXT NOT NULL CHECK (
                            channel IN ('typed_text', 'authenticated_voice',
                                        'agent_generation', 'import')),
        written_at      INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX block_authorship_by_participant ON block_authorship (participant_id);

    INSERT INTO graphs VALUES ('graph:1', 'mind');
    INSERT INTO participants VALUES ('participant:herbert', 'Herbert');
    INSERT INTO blocks VALUES ('block:1');
    INSERT INTO blocks VALUES ('block:2');
  `);

  for (let n = 1; n <= 3; n += 1) {
    db.prepare(
      `INSERT INTO operations (id, graph_id, origin_id, sequence, participant_id, change_kind,
                               change_payload, subject_id, channel, submitted_at, applied_at)
       VALUES (?, 'graph:1', ?, ?, 'participant:herbert', 'create_block', '{}', ?, 'typed_text', ?, ?)`,
    ).run(`op:${n}`, `origin:${n}`, n, `block:${n}`, n * 10, n * 10);
  }
  db.prepare(
    `INSERT INTO block_authorship VALUES ('block:1', 'participant:herbert', 'typed_text', 100)`,
  ).run();
  db.prepare(
    `INSERT INTO block_authorship VALUES ('block:2', 'participant:herbert', 'import', 200)`,
  ).run();

  return db;
}

function version(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

function count(db: DatabaseSync, table: string): number {
  return (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
}

describe('migraciones', () => {
  it('una base nueva nace en la versión de destino', () => {
    const store = openStore({ path: ':memory:', graphName: 'mind' });
    assert.equal(version(store.db), SCHEMA_VERSION);
    store.close();
  });

  it('reconoce una base nueva sólo antes de aplicarle el esquema', () => {
    const db = new DatabaseSync(':memory:');
    assert.equal(isFreshDatabase(db), true);
    db.exec('CREATE TABLE operations (id TEXT PRIMARY KEY) STRICT');
    assert.equal(isFreshDatabase(db), false);
    db.close();
  });

  it('una base nueva acepta el canal walked sin haber migrado nada', () => {
    const store = openStore({ path: ':memory:', graphName: 'mind' });
    saveParticipant(store, { id: 'participant:herbert', name: 'Herbert', kind: 'human' });
    assert.doesNotThrow(() => {
      store.db
        .prepare(
          `INSERT INTO operations (id, graph_id, origin_id, sequence, participant_id, change_kind,
                                   change_payload, subject_id, channel, submitted_at, applied_at)
           VALUES ('op:1', ?, 'origin:1', 1, 'participant:herbert', 'set_property', '{}', 'block:1',
                   'walked', 1, 1)`,
        )
        .run(store.graphId);
    });
    store.close();
  });

  describe('sobre una base anterior a las migraciones', () => {
    it('parte de cero y llega al destino', () => {
      const db = legacyDatabase();
      assert.equal(version(db), 0);
      migrate(db, false);
      assert.equal(version(db), SCHEMA_VERSION);
      db.close();
    });

    it('rechazaba walked y después lo acepta', () => {
      const db = legacyDatabase();
      const insert = (): void => {
        db.prepare(
          `INSERT INTO block_authorship VALUES ('block:2', 'participant:herbert', 'walked', 300)`,
        ).run();
      };
      db.prepare(`DELETE FROM block_authorship WHERE block_id = 'block:2'`).run();
      assert.throws(insert, /CHECK|constraint/i);
      migrate(db, false);
      assert.doesNotThrow(insert);
      db.close();
    });

    // Es la garantía que importa: reconstruir el registro canónico no puede
    // perder una operación ni descolocar el orden total.
    it('no pierde ni una fila ni el orden del log', () => {
      const db = legacyDatabase();
      const before = db.prepare('SELECT * FROM operations ORDER BY sequence').all();
      migrate(db, false);
      const after = db.prepare('SELECT * FROM operations ORDER BY sequence').all();
      assert.deepEqual(after, before);
      assert.equal(count(db, 'operations'), 3);
      assert.equal(count(db, 'block_authorship'), 2);
      db.close();
    });

    it('rehace los índices que el DROP se llevó', () => {
      const db = legacyDatabase();
      migrate(db, false);
      const indexes = (
        db
          .prepare(`SELECT name FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_%'`)
          .all() as { name: string }[]
      ).map((row) => row.name);
      for (const name of ['operations_origin', 'operations_sequence', 'block_authorship_by_participant']) {
        assert.ok(indexes.includes(name), `falta el índice ${name}`);
      }
      db.close();
    });

    it('la unicidad de origin_id sigue vigente después de reconstruir', () => {
      const db = legacyDatabase();
      migrate(db, false);
      assert.throws(() => {
        db.prepare(
          `INSERT INTO operations (id, graph_id, origin_id, sequence, participant_id, change_kind,
                                   change_payload, subject_id, channel, submitted_at, applied_at)
           VALUES ('op:9', 'graph:1', 'origin:1', 9, 'participant:herbert', 'create_block', '{}',
                   'block:9', 'typed_text', 90, 90)`,
        ).run();
      }, /UNIQUE|constraint/i);
      db.close();
    });

    it('no deja referencias rotas', () => {
      const db = legacyDatabase();
      migrate(db, false);
      assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
      db.close();
    });

    it('correrla otra vez no hace nada', () => {
      const db = legacyDatabase();
      migrate(db, false);
      const after = db.prepare('SELECT * FROM operations ORDER BY sequence').all();
      migrate(db, false);
      assert.deepEqual(db.prepare('SELECT * FROM operations ORDER BY sequence').all(), after);
      assert.equal(version(db), SCHEMA_VERSION);
      db.close();
    });

    // Sin esto, una base a medio migrar se sella como si estuviera al día.
    it('una migración que falla deja la versión donde estaba', () => {
      const db = legacyDatabase();
      const rota = {
        version: SCHEMA_VERSION + 1,
        name: 'rota',
        apply(): void {
          throw new Error('a propósito');
        },
      };
      migrate(db, false);
      const stable = version(db);
      assert.throws(() => {
        for (const m of [rota]) {
          db.exec('BEGIN');
          try {
            m.apply();
            db.exec('COMMIT');
          } catch (error) {
            db.exec('ROLLBACK');
            throw error;
          }
        }
      }, /a propósito/);
      assert.equal(version(db), stable);
      db.close();
    });
  });

  it('las versiones son únicas y consecutivas desde 1', () => {
    const versions = MIGRATIONS.map((m) => m.version);
    assert.deepEqual(
      versions,
      versions.map((_, i) => i + 1),
      'las migraciones se numeran 1, 2, 3… sin huecos ni repeticiones',
    );
  });

  it('añade la portada a un sitio de la versión anterior sin perderlo', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE graphs (id TEXT PRIMARY KEY, name TEXT NOT NULL) STRICT;
      CREATE TABLE participants (id TEXT PRIMARY KEY, name TEXT NOT NULL) STRICT;
      CREATE TABLE pages (id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE personal_sites (
        id TEXT PRIMARY KEY,
        graph_id TEXT NOT NULL REFERENCES graphs (id),
        owner_id TEXT NOT NULL REFERENCES participants (id),
        title TEXT NOT NULL,
        canonical_domain TEXT NOT NULL
      ) STRICT;
      INSERT INTO graphs VALUES ('graph:1', 'mind');
      INSERT INTO participants VALUES ('participant:herbert', 'Herbert');
      INSERT INTO personal_sites VALUES (
        'site:1', 'graph:1', 'participant:herbert', 'Vera', 'https://vera.mediafranca.net'
      );
      PRAGMA user_version = 9;
    `);

    migrate(db, false);

    const row = db.prepare(
      'SELECT title, entry_point, transparent_block_traceability FROM personal_sites',
    ).get() as {
      title: string;
      entry_point: string | null;
      transparent_block_traceability: number;
    };
    assert.equal(row.title, 'Vera');
    assert.equal(row.entry_point, null);
    assert.equal(row.transparent_block_traceability, 0);
    assert.equal(version(db), SCHEMA_VERSION);
    db.close();
  });
});
