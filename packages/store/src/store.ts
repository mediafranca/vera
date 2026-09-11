// Persistencia de Vera sobre SQLite.
//
// Reparto de responsabilidades, que conviene tener claro antes de leer el
// código: `operations` es el registro canónico y las tablas de estado son su
// materialización. Al arrancar, el log se reproduce sobre un VeraGraph y ese
// grafo responde las lecturas; las reglas viven en @vera/core y sólo allí, para
// que no existan dos implementaciones que puedan discrepar.
//
// Las tablas materializadas se mantienen igualmente al día porque son lo que
// consultan la proyección Markdown y, más adelante, el cliente WASM.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VeraGraph, titleKey } from '@vera/core';
import type {
  Change,
  Operation,
  ParticipantId,
  ParticipantKind,
  PersonalSite,
  Publication,
} from '@vera/core';

import { isFreshDatabase, migrate } from './migrations.ts';

const DEFAULT_SCHEMA = join(dirname(fileURLToPath(import.meta.url)), '../../../schema/schema.sql');

export interface Store {
  readonly db: DatabaseSync;
  readonly graphId: string;
  close(): void;
}

export interface OpenOptions {
  /** Ruta al archivo; `:memory:` para una base efímera. */
  path: string;
  graphName?: string;
  graphId?: string;
}

/**
 * Columnas que llegaron después de que hubiera bases en uso.
 *
 * `CREATE TABLE IF NOT EXISTS` no toca una tabla que ya existe, así que una
 * columna nueva no llegaría nunca a la base de alguien que viene usando Vera. Se
 * añade aquí, y como sólo se agrega lo que falta, correrlo de nuevo no hace nada.
 *
 * No crece más. Es anterior a migrations.ts y se queda por lo que ya arregla: hay
 * bases en `user_version = 0` a las que les falta alguna de estas tres columnas,
 * y ninguna migración se las va a añadir porque la migración 1 no sabe de ellas.
 * Todo cambio nuevo de esquema va a migrations.ts, incluido añadir una columna.
 */
const ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [
  {
    table: 'recordings',
    column: 'placed_in_block',
    definition: 'TEXT REFERENCES blocks (id) ON DELETE SET NULL',
  },
  { table: 'workspaces', column: 'design_tokens', definition: 'TEXT' },
  { table: 'workspaces', column: 'graph_reach', definition: 'INTEGER' },
];

function addMissingColumns(db: DatabaseSync): void {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const present = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(
      (c) => c.name === column,
    );
    if (!present) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function openStore(options: OpenOptions): Store {
  const db = new DatabaseSync(options.path);
  // Antes de aplicar el esquema, porque después una base nueva y una vieja sin
  // migrar son indistinguibles. Ver isFreshDatabase().
  const fresh = isFreshDatabase(db);
  db.exec(readFileSync(process.env['VERA_SCHEMA'] ?? DEFAULT_SCHEMA, 'utf8'));
  addMissingColumns(db);
  migrate(db, fresh);
  db.exec('CREATE INDEX IF NOT EXISTS blocks_by_crossing ON blocks (crossing_id, parent_id, position)');

  const graphId = options.graphId ?? 'graph:1';
  db.prepare('INSERT OR IGNORE INTO graphs (id, name) VALUES (?, ?)').run(
    graphId,
    options.graphName ?? 'mind',
  );
  db.prepare('INSERT OR IGNORE INTO change_logs (graph_id, last_sequence) VALUES (?, 0)').run(
    graphId,
  );

  return {
    db,
    graphId,
    close: () => db.close(),
  };
}

// ---------------------------------------------------------------------------
// Participantes
// ---------------------------------------------------------------------------

export function saveParticipant(
  store: Store,
  participant: { id: ParticipantId; name: string; kind: ParticipantKind; status?: string },
): void {
  store.db
    .prepare(
      `INSERT INTO participants (id, name, kind, status) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, status = excluded.status`,
    )
    .run(participant.id, participant.name, participant.kind, participant.status ?? 'active');
  store.db
    .prepare(
      `INSERT INTO memberships (graph_id, participant_id, status) VALUES (?, ?, 'active')
       ON CONFLICT (graph_id, participant_id) DO NOTHING`,
    )
    .run(store.graphId, participant.id);
}

// ---------------------------------------------------------------------------
// Escritura: una operación aplicada se vuelve durable
// ---------------------------------------------------------------------------

/**
 * Persiste una operación que @vera/core ya aceptó y aplicó, junto con el efecto
 * que dejó en el estado materializado. Todo ocurre en una transacción: una
 * operación aplica entera o no aparece.
 */
export function recordOperation(store: Store, graph: VeraGraph, operation: Operation): void {
  const { db } = store;
  // SAVEPOINT y no BEGIN: así una importación en lote puede envolver miles de
  // operaciones en una sola transacción exterior sin que esta anide mal.
  const savepoint = `op_${operation.sequence}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  try {
    const submission = operation.submission;
    db.prepare(
      `INSERT INTO operations (
         id, graph_id, origin_id, sequence, participant_id, change_kind, change_payload,
         subject_id, channel, evidence_reference, evidence_captured_at, submitted_at, applied_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      operation.id,
      store.graphId,
      operation.originId,
      operation.sequence,
      submission.submittedBy,
      submission.change.kind,
      JSON.stringify(submission.change),
      operation.subjectId,
      submission.channel,
      submission.evidence?.reference ?? null,
      submission.evidence?.capturedAt ?? null,
      submission.submittedAt,
      operation.appliedAt,
    );

    db.prepare('UPDATE change_logs SET last_sequence = ? WHERE graph_id = ?').run(
      operation.sequence,
      store.graphId,
    );

    /*
     * La revisión que corresponde a ESTA operación.
     *
     * Por su lugar en la lista y no por su número: revisiones y operaciones se
     * empujan a la vez, así que van en paralelo, pero los números tienen huecos
     * en cuanto una operación no se pudo guardar. Buscando por número, todo lo
     * que viniera después de un hueco se quedaba sin revisión y nadie lo decía.
     */
    const revision = graph.revisions()[graph.operations().findIndex((one) => one.id === operation.id)];
    if (revision !== undefined) {
      db.prepare(
        `INSERT INTO revisions (id, operation_id, graph_id, page_id, block_id, crossing_id, authored_by, channel, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        `rev:${operation.sequence}`,
        operation.id,
        store.graphId,
        revision.page,
        revision.block,
        revision.crossing,
        revision.authoredBy,
        revision.channel,
        revision.recordedAt,
      );
    }

    materialise(store, graph, submission.change, operation.subjectId);
    materialiseAuthorship(store, graph, submission.change, operation.subjectId);
    db.exec(`RELEASE ${savepoint}`);
  } catch (error) {
    db.exec(`ROLLBACK TO ${savepoint}`);
    db.exec(`RELEASE ${savepoint}`);
    throw error;
  }
}

/**
 * Carga masiva. Persiste el log entero y después materializa el estado final de
 * una sola vez.
 *
 * Hace falta una ruta aparte porque materialise() lee el estado actual del
 * grafo mientras recorre operaciones en orden histórico: un bloque creado en la
 * operación 100 puede enlazar a una página que nació en la 5000, y esa clave
 * ajena todavía no existiría. Aquí el orden deja de importar.
 */
export function recordAllOperations(store: Store, graph: VeraGraph): void {
  const { db } = store;
  db.exec('BEGIN');
  db.exec('PRAGMA defer_foreign_keys = ON');
  try {
    const insertOperation = db.prepare(
      `INSERT INTO operations (
         id, graph_id, origin_id, sequence, participant_id, change_kind, change_payload,
         subject_id, channel, evidence_reference, evidence_captured_at, submitted_at, applied_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertRevision = db.prepare(
      `INSERT INTO revisions (id, operation_id, graph_id, page_id, block_id, crossing_id, authored_by, channel, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const revisions = graph.revisions();
    // Por su lugar y no por su número, como en recordOperation: los números
    // pueden tener huecos y los lugares no.
    for (const [at, operation] of graph.operations().entries()) {
      const submission = operation.submission;
      insertOperation.run(
        operation.id,
        store.graphId,
        operation.originId,
        operation.sequence,
        submission.submittedBy,
        submission.change.kind,
        JSON.stringify(submission.change),
        operation.subjectId,
        submission.channel,
        submission.evidence?.reference ?? null,
        submission.evidence?.capturedAt ?? null,
        submission.submittedAt,
        operation.appliedAt,
      );
      const revision = revisions[at];
      if (revision !== undefined) {
        insertRevision.run(
          `rev:${operation.sequence}`,
          operation.id,
          store.graphId,
          revision.page,
          revision.block,
          revision.crossing,
          revision.authoredBy,
          revision.channel,
          revision.recordedAt,
        );
      }
    }

    db.prepare('UPDATE change_logs SET last_sequence = ? WHERE graph_id = ?').run(
      graph.log().lastSequence,
      store.graphId,
    );

    materialiseAll(store, graph);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Vuelca el estado actual del grafo sobre las tablas materializadas. */
export function materialiseAll(store: Store, graph: VeraGraph): void {
  const { db } = store;
  for (const table of [
    'crossings',
    'unported_queries',
    'block_tags',
    'page_links',
    'property_assignments',
    'block_authorship',
    'blocks',
    'pages',
  ]) {
    db.exec(`DELETE FROM ${table}`);
  }

  const insertPage = db.prepare(
    `INSERT INTO pages (id, graph_id, title, title_key, visibility, created_at, origin_created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const page of graph.pages()) {
    insertPage.run(
      page.id,
      store.graphId,
      page.title,
      titleKey(page.title),
      page.visibility,
      page.createdAt,
      page.originCreatedAt,
    );
  }

  const insertCrossing = db.prepare(`INSERT INTO crossings
    (id,graph_id,from_page,to_page,content,term,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`);
  for (const crossing of graph.declaredCrossings()) {
    insertCrossing.run(crossing.stableId, store.graphId, crossing.fromPage, crossing.toPage,
      crossing.said, crossing.term, crossing.createdAt, crossing.updatedAt);
  }

  const insertBlock = db.prepare(
    `INSERT INTO blocks (id, page_id, crossing_id, parent_id, position, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const block of graph.allBlocks()) {
    insertBlock.run(
      block.stableId,
      block.crossing == null ? block.page : null,
      block.crossing ?? null,
      block.parent,
      block.position,
      block.content,
      block.createdAt,
    );
  }

  // La autoría va después de los bloques porque la referencia por clave ajena.
  const insertHand = db.prepare(
    `INSERT INTO block_authorship (block_id, participant_id, channel, written_at)
     VALUES (?, ?, ?, ?)`,
  );
  for (const hand of graph.authorships()) {
    // Un bloque que ya no existe deja atrás su autoría: la eliminación en
    // cascada la limpia en la ruta incremental, y aquí sencillamente no se
    // inserta lo que no tiene bloque al que colgarse.
    if (graph.block(hand.block) === undefined) continue;
    insertHand.run(hand.block, hand.participant, hand.channel, hand.writtenAt);
  }

  const insertProperty = db.prepare(
    `INSERT INTO property_assignments (id, graph_id, page_id, block_id, key, value)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  let propertyCounter = 0;
  for (const page of graph.pages()) {
    for (const property of graph.propertiesOf(page.id)) {
      propertyCounter += 1;
      insertProperty.run(
        `prop:${propertyCounter}`,
        store.graphId,
        property.page,
        property.block,
        property.key,
        property.value,
      );
    }
  }
  for (const block of graph.allBlocks()) {
    for (const property of graph.propertiesOf(block.stableId)) {
      propertyCounter += 1;
      insertProperty.run(
        `prop:${propertyCounter}`,
        store.graphId,
        property.page,
        property.block,
        property.key,
        property.value,
      );
    }
  }

  const insertLink = db.prepare(
    `INSERT INTO page_links (id, graph_id, source_page, source_block, target_title, target_key, target_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertTag = db.prepare(
    'INSERT OR IGNORE INTO block_tags (block_id, page_id, tag) VALUES (?, ?, ?)',
  );
  for (const block of graph.allBlocks()) {
    for (const link of graph.linksOf(block.stableId)) {
      insertLink.run(
        link.id,
        store.graphId,
        link.sourcePage,
        link.sourceBlock,
        link.targetTitle,
        titleKey(link.targetTitle),
        link.target,
      );
    }
    for (const tag of graph.tagsOf(block.stableId)) {
      insertTag.run(block.stableId, block.page, tag);
    }
  }

  const insertUnported = db.prepare(
    `INSERT INTO unported_queries (id, graph_id, block_id, source_text, ported_to, ported_by, ported_at)
     VALUES (?, ?, ?, ?, NULL, NULL, NULL)`,
  );
  for (const unported of graph.unportedQueries()) {
    insertUnported.run(unported.id, store.graphId, unported.block, unported.sourceText);
  }
}

/**
 * De qué mano salió el texto de un bloque, llevado a SQL.
 *
 * @invariant GeneratedContentIsAlwaysDistinguishable. El grafo en memoria ya lo
 * sabe; se materializa para que una consulta SQL pueda preguntar «qué escribió
 * el bibliotecario» sin recorrer el registro, y para que la copia del cliente lo tenga.
 *
 * Sólo escribir cambia la mano: `move_block` no está y es rule
 * MovingLeavesTheHandAlone. Un bibliotecario que archiva no firma.
 */
function materialiseAuthorship(
  store: Store,
  graph: VeraGraph,
  change: Change,
  subjectId: string,
): void {
  let block = subjectId;
  if (change.kind === 'create_crossing' || change.kind === 'edit_crossing') {
    block = graph.blocksOfCrossing(subjectId)
      .filter((one) => one.parent === null)
      .sort((a, b) => a.position - b.position)[0]?.stableId ?? '';
  } else if (change.kind !== 'create_block' && change.kind !== 'edit_block') return;
  const hand = graph.authorship(block);
  if (hand === undefined) return;
  store.db
    .prepare(
      `INSERT INTO block_authorship (block_id, participant_id, channel, written_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (block_id) DO UPDATE SET
         participant_id = excluded.participant_id,
         channel = excluded.channel,
         written_at = excluded.written_at`,
    )
    .run(hand.block, hand.participant, hand.channel, hand.writtenAt);
}

function materialise(store: Store, graph: VeraGraph, change: Change, subjectId: string): void {
  const { db } = store;

  switch (change.kind) {
    case 'create_page':
    case 'rename_page':
    case 'set_page_visibility':
    case 'recover_page_origin': {
      const page = graph.page(subjectId);
      if (page === undefined) return;
      db.prepare(
        `INSERT INTO pages (id, graph_id, title, title_key, visibility, created_at, origin_created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           title = excluded.title, title_key = excluded.title_key,
           visibility = excluded.visibility,
           origin_created_at = excluded.origin_created_at`,
      ).run(
        page.id,
        store.graphId,
        page.title,
        titleKey(page.title),
        page.visibility,
        page.createdAt,
        page.originCreatedAt,
      );
      // Renombrar reconecta enlaces en toda la base, no sólo en esta página.
      if (change.kind === 'rename_page') resyncAllLinks(store, graph);
      else resolveWaitingLinks(store, graph);
      return;
    }

    case 'remove_page': {
      // Igual que con el bloque: una página sólo se puede quitar cuando ya no
      // quedan bloques suyos, pero la página misma puede llevar propiedades, y
      // esas sí impiden borrarla.
      db.prepare('DELETE FROM property_assignments WHERE page_id = ?').run(subjectId);
      db.prepare('UPDATE page_links SET target_id = NULL WHERE target_id = ?').run(subjectId);
      db.prepare('DELETE FROM pages WHERE id = ?').run(subjectId);
      return;
    }

    case 'create_block':
    case 'edit_block':
    case 'move_block': {
      const block = graph.block(subjectId);
      if (block === undefined) return;

      // Dónde estaba antes, leído de la base mientras la fila todavía lo dice.
      // Mover deja un hueco en el grupo de origen, y sin esto ese grupo se
      // quedaría con las posiciones viejas.
      const before = db
        .prepare('SELECT page_id AS page, crossing_id AS crossing, parent_id AS parent FROM blocks WHERE id = ?')
        .get(subjectId) as { page: string | null; crossing: string | null; parent: string | null } | undefined;

      db.prepare(
        `INSERT INTO blocks (id, page_id, crossing_id, parent_id, position, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           page_id = excluded.page_id, crossing_id = excluded.crossing_id, parent_id = excluded.parent_id,
           position = excluded.position, content = excluded.content`,
      ).run(
        block.stableId,
        block.crossing == null ? block.page : null,
        block.crossing ?? null,
        block.parent,
        block.position,
        block.content,
        block.createdAt,
      );
      syncBlockRelations(store, graph, block.stableId);

      // Crear o mover sienta el bloque en un índice y renumera a sus hermanos.
      // Esa renumeración es parte de aplicar la operación, así que también tiene
      // que bajar a disco: si no, la memoria y la base contarían dos órdenes
      // distintos hasta el siguiente arranque.
      if (change.kind !== 'edit_block') {
        writeSiblingOrder(store, graph, block.page, block.crossing ?? null, block.parent);
        if (before !== undefined && (before.page !== (block.crossing == null ? block.page : null) || before.crossing !== (block.crossing ?? null) || before.parent !== block.parent)) {
          writeSiblingOrder(store, graph, before.page, before.crossing, before.parent);
        }
      }

      // Mover arrastra el subárbol, y con él la página que registran sus enlaces.
      if (change.kind === 'move_block') {
        for (const descendant of graph.descendantsOf(subjectId)) {
          db.prepare('UPDATE blocks SET page_id = ?, crossing_id = ? WHERE id = ?').run(
            descendant.crossing == null ? descendant.page : null,
            descendant.crossing ?? null,
            descendant.stableId,
          );
          syncBlockRelations(store, graph, descendant.stableId);
        }
      }
      return;
    }

    case 'remove_block': {
      // Dónde vivía, para poder cerrar el hueco en su grupo después de quitarlo.
      const home = db
        .prepare('SELECT page_id AS page, crossing_id AS crossing, parent_id AS parent FROM blocks WHERE id = ?')
        .get(subjectId) as { page: string | null; crossing: string | null; parent: string | null } | undefined;

      // Las propiedades del bloque van primero. Su clave foránea no declara
      // ON DELETE, así que mientras exista una el borrado del bloque falla; y
      // como el bloque en memoria ya se había quitado, el fallo llegaba después
      // de que el dominio hubiera aceptado la operación.
      db.prepare('DELETE FROM property_assignments WHERE block_id = ?').run(subjectId);
      db.prepare('DELETE FROM page_links WHERE source_block = ?').run(subjectId);
      db.prepare('DELETE FROM block_tags WHERE block_id = ?').run(subjectId);
      db.prepare('DELETE FROM unported_queries WHERE block_id = ?').run(subjectId);

      /*
       * La grabación se va con su bloque.
       *
       * Antes no: la clave ajena declara `ON DELETE SET NULL`, así que borrar el
       * bloque dejaba la grabación viva y sin sitio. Y como nada podía borrar una
       * grabación, esa fila era permanente —reaparecía en «voz sin lugar» en cada
       * recarga, sin ninguna forma de quitarla.
       *
       * Que un audio pueda existir sin bloque no es un caso raro que haya que
       * saber reparar: es un estado que no debería poder darse. Un bloque de voz
       * es el audio y su texto juntos, y borrarlo es borrar la nota de voz. Lo que
       * queda es el objeto en el almacén, que se recoge aparte.
       */
      for (const orphan of db
        .prepare('SELECT id FROM recordings WHERE placed_in_block = ?')
        .all(subjectId) as { id: string }[]) {
        removeRecording(store, orphan.id);
      }

      db.prepare('DELETE FROM blocks WHERE id = ?').run(subjectId);
      if (home !== undefined) writeSiblingOrder(store, graph, home.page, home.crossing, home.parent);
      return;
    }

    case 'create_crossing':
    case 'edit_crossing': {
      const crossing = graph.crossing(subjectId);
      if (crossing === undefined) return;
      db.prepare(`INSERT INTO crossings
        (id,graph_id,from_page,to_page,content,term,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT (id) DO UPDATE SET content=excluded.content,term=excluded.term,
          updated_at=excluded.updated_at`)
        .run(crossing.stableId, store.graphId, crossing.fromPage, crossing.toPage,
          crossing.said, crossing.term, crossing.createdAt, crossing.updatedAt);
      for (const block of crossing.blocks) {
        db.prepare(
          `INSERT INTO blocks (id, page_id, crossing_id, parent_id, position, content, created_at)
           VALUES (?, NULL, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET parent_id=excluded.parent_id,
             position=excluded.position,content=excluded.content`,
        ).run(block.stableId, crossing.stableId, block.parent, block.position, block.content, block.createdAt);
      }
      return;
    }

    case 'set_block_gloss': {
      const gloss = graph.gloss(change.block);
      if (gloss === undefined) return;
      db.prepare(
        `INSERT INTO block_glosses (block_id, content, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (block_id) DO UPDATE SET
           content = excluded.content, updated_at = excluded.updated_at`,
      ).run(gloss.block, gloss.content, gloss.createdAt, gloss.updatedAt);
      return;
    }

    case 'set_property':
    case 'remove_property': {
      /*
       * El sujeto son las dos columnas a la vez, no una o la otra.
       *
       * Decía `page_id IS ? OR block_id IS ?`, y como toda propiedad de página
       * lleva `block_id` nulo, ese `OR` casaba con **todas** las propiedades de
       * página del corpus: poner `type` en una página borraba `type` de las mil
       * novecientas restantes. En memoria no se notaba —el grafo lo hace bien y
       * se reconstruye del registro al arrancar—, así que la tabla se vaciaba en
       * silencio y sólo mentía a quien mirase la base por fuera.
       *
       * `IS` en las dos y unidas por `AND`: `IS` porque una de ellas es nula
       * siempre y `=` no compara nulos.
       */
      db.prepare(
        `DELETE FROM property_assignments
         WHERE key = ? AND page_id IS ? AND block_id IS ?`,
      ).run(change.propertyKey, change.page ?? null, change.block ?? null);
      if (change.kind === 'set_property') {
        db.prepare(
          `INSERT INTO property_assignments (id, graph_id, page_id, block_id, key, value)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          `prop:${subjectId}:${change.propertyKey}`,
          store.graphId,
          change.page ?? null,
          change.block ?? null,
          change.propertyKey,
          change.propertyValue,
        );
      }
      return;
    }
  }
}

/** Reescribe enlaces, etiquetas y query preservada de un bloque. */
/**
 * Baja a disco el orden de un grupo de hermanos tal como lo dejó el dominio.
 *
 * Insertar entre hermanos es una sola operación, y renumerar al resto es parte
 * de aplicarla. El dominio ya lo hizo en memoria; esto lo hace persistente, que
 * es lo único que evita que la base y el grafo cuenten dos órdenes distintos.
 */
function writeSiblingOrder(
  store: Store,
  graph: VeraGraph,
  page: string | null,
  crossing: string | null,
  parent: string | null,
): void {
  const siblings =
    parent === null
      ? (crossing === null ? graph.blocksOf(page!) : graph.blocksOfCrossing(crossing))
          .filter((block) => block.parent === null)
      : graph.childrenOf(parent);

  const statement = store.db.prepare('UPDATE blocks SET position = ? WHERE id = ?');
  for (const sibling of siblings) statement.run(sibling.position, sibling.stableId);
}

function syncBlockRelations(store: Store, graph: VeraGraph, blockId: string): void {
  const { db } = store;
  db.prepare('DELETE FROM page_links WHERE source_block = ?').run(blockId);
  db.prepare('DELETE FROM block_tags WHERE block_id = ?').run(blockId);
  db.prepare('DELETE FROM unported_queries WHERE block_id = ?').run(blockId);

  const block = graph.block(blockId);
  if (block === undefined) return;

  for (const link of graph.linksOf(blockId)) {
    db.prepare(
      `INSERT INTO page_links (id, graph_id, source_page, source_block, target_title, target_key, target_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      link.id,
      store.graphId,
      link.sourcePage,
      link.sourceBlock,
      link.targetTitle,
      titleKey(link.targetTitle),
      link.target,
    );
  }

  for (const tag of graph.tagsOf(blockId)) {
    db.prepare(
      'INSERT OR IGNORE INTO block_tags (block_id, page_id, tag) VALUES (?, ?, ?)',
    ).run(blockId, block.page, tag);
  }

  const unported = graph.unportedQueries().find((u) => u.block === blockId);
  void block;
  if (unported !== undefined) {
    db.prepare(
      `INSERT INTO unported_queries (id, graph_id, block_id, source_text, ported_to, ported_by, ported_at)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL)`,
    ).run(unported.id, store.graphId, blockId, unported.sourceText);
  }
}

/** Conecta los enlaces que esperaban una página recién escrita. */
function resolveWaitingLinks(store: Store, graph: VeraGraph): void {
  const rows = store.db
    .prepare('SELECT id FROM page_links WHERE graph_id = ? AND target_id IS NULL')
    .all(store.graphId) as { id: string }[];
  if (rows.length === 0) return;
  const live = new Map(graph.links().map((l) => [l.id, l.target]));
  for (const row of rows) {
    const target = live.get(row.id);
    if (target != null) {
      store.db.prepare('UPDATE page_links SET target_id = ? WHERE id = ?').run(target, row.id);
    }
  }
}

/** Tras renombrar, la resolución de cualquier enlace pudo cambiar. */
function resyncAllLinks(store: Store, graph: VeraGraph): void {
  for (const link of graph.links()) {
    store.db
      .prepare('UPDATE page_links SET target_id = ? WHERE id = ?')
      .run(link.target, link.id);
  }
}

// ---------------------------------------------------------------------------
// Lectura: reproducir el log
// ---------------------------------------------------------------------------

interface OperationRow {
  id: string;
  origin_id: string;
  sequence: number;
  participant_id: string;
  change_payload: string;
  subject_id: string;
  channel: string;
  evidence_reference: string | null;
  evidence_captured_at: number | null;
  submitted_at: number;
}

/**
 * Reconstruye el grafo desde el registro de operaciones. El estado
 * materializado no se lee para esto a propósito: si el log y las tablas
 * discreparan, manda el log.
 */
export function loadGraph(store: Store, graphName = 'mind'): VeraGraph {
  const graph = VeraGraph.create({ name: graphName, id: store.graphId });

  const participants = store.db
    .prepare('SELECT id, name, kind, status FROM participants')
    .all() as { id: string; name: string; kind: string; status: string }[];
  for (const p of participants) {
    graph.addParticipant({ id: p.id, name: p.name, kind: p.kind as ParticipantKind });
    graph.admit(p.id);
  }

  const rows = store.db
    .prepare(
      `SELECT id, origin_id, sequence, participant_id, change_payload, subject_id, channel,
              evidence_reference, evidence_captured_at, submitted_at
       FROM operations WHERE graph_id = ? ORDER BY sequence`,
    )
    .all(store.graphId) as unknown as OperationRow[];

  // Reproducir no es someter: las negativas de política —las que dicen qué se
  // permite hoy— no pueden vetar lo que ya ocurrió, o cada regla nueva dejaría al
  // grafo sin poder levantar. Las estructurales siguen parando más abajo.
  graph.beginReplay();
  try {
    for (const row of rows) {
      const outcome = graph.submitOperation({
        originId: row.origin_id,
        participant: row.participant_id,
        channel: row.channel as
          | 'typed_text'
          | 'authenticated_voice'
          | 'agent_generation'
          | 'import',
        change: JSON.parse(row.change_payload) as Change,
        submittedAt: row.submitted_at,
        // El número y la identidad de la operación salen del registro, como el
        // sujeto y por la misma razón: reproducir es rehacer lo que ocurrió, no
        // volver a decidirlo. Contarlo otra vez desplazaba todo lo posterior en
        // cuanto el registro tuviera un hueco.
        sequence: row.sequence,
        operationId: row.id,
        // El sujeto sale del registro y no se vuelve a derivar. Ver `subjectId`
        // en OperationInput: derivarlo ataba la legibilidad del registro a que
        // ninguna regla cambiara jamás cuántos identificadores consume.
        ...(row.subject_id === null ? {} : { subjectId: row.subject_id }),
        ...(row.evidence_reference === null
          ? {}
          : {
              evidence: {
                reference: row.evidence_reference,
                capturedAt: row.evidence_captured_at ?? 0,
              },
            }),
      });

      // @invariant ReplayReconstructsState: reproducir tiene que devolver el
      // mismo grafo. Una operación estructuralmente imposible —no existe esa
      // página, no existe ese bloque— significa que el registro y las reglas
      // dejaron de concordar, y seguir adelante levantaría un grafo al que le
      // faltan cosas sin que nadie se entere. Antes esto se descartaba en
      // silencio: el contenido se perdía al reiniciar y el único síntoma era
      // una página más corta.
      if (outcome.status === 'rejected') {
        throw new Error(
          `el registro no se puede reproducir: la operación ${row.sequence} ` +
            `(${row.origin_id}) fue rechazada por «${outcome.reason}»`,
        );
      }
    }
  } finally {
    graph.endReplay();
  }

  // Sitios y publicaciones no salen del log —publicar no cambia el corpus, así
  // que no es una operación del registro de cambios— y por eso se cargan aparte,
  // después de reproducir y antes de suspender a nadie: quien publicó en su día
  // tenía que estar activo entonces, no ahora.
  loadSitesAndPublications(store, graph);

  // Los participantes suspendidos vuelven a serlo después de reproducir: durante
  // la reproducción deben poder aplicar lo que aplicaron en su día.
  for (const p of participants) {
    if (p.status === 'suspended' && p.id !== graph.owner) graph.suspend(p.id);
  }

  return graph;
}

// ---------------------------------------------------------------------------
// Sitios y publicaciones (core.allium)
//
// La única tabla de Vera que no es materialización del registro de cambios.
// Publicar no edita el corpus: dice qué de lo escrito quedó en un sitio, y eso
// es un hecho aparte con su propia autoría y su propia fecha.
// ---------------------------------------------------------------------------

export function saveSite(store: Store, site: PersonalSite): void {
  store.db
    .prepare(
      `INSERT INTO personal_sites (id, graph_id, owner_id, title, canonical_domain, entry_point, transparent_block_traceability)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET title = excluded.title,
                                      canonical_domain = excluded.canonical_domain,
                                      entry_point = excluded.entry_point,
                                      transparent_block_traceability = excluded.transparent_block_traceability`,
    )
    .run(site.id, site.graph, site.owner, site.title, site.canonicalDomain, site.entryPoint,
      site.transparentBlockTraceability ? 1 : 0);
}

export function savePublication(store: Store, publication: Publication): void {
  // Republicar la misma dirección la reemplaza: el sitio enseña una revisión por
  // dirección. @invariant PublicationPathIsUniqueWithinSite.
  store.db
    .prepare('DELETE FROM publications WHERE site_id = ? AND path = ?')
    .run(publication.site, publication.path);
  store.db
    .prepare(
      `INSERT INTO publications
         (id, site_id, page_id, revision_operation_id, path, published_at, published_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      publication.id,
      publication.site,
      publication.page,
      publication.firstRevision,
      publication.path,
      publication.publishedAt,
      publication.publishedBy,
    );
}

export function removePublication(store: Store, site: string, path: string): void {
  store.db.prepare('DELETE FROM publications WHERE site_id = ? AND path = ?').run(site, path);
}

function loadSitesAndPublications(store: Store, graph: VeraGraph): void {
  const sites = store.db
    .prepare(
      'SELECT id, graph_id, owner_id, title, canonical_domain, entry_point, transparent_block_traceability FROM personal_sites WHERE graph_id = ?',
    )
    .all(store.graphId) as {
    id: string;
    graph_id: string;
    owner_id: string;
    title: string;
    canonical_domain: string;
    entry_point: string | null;
    transparent_block_traceability: number;
  }[];
  for (const site of sites) {
    graph.createSite({
      id: site.id,
      owner: site.owner_id,
      title: site.title,
      canonicalDomain: site.canonical_domain,
      transparentBlockTraceability: site.transparent_block_traceability === 1,
    });
  }

  const known = new Set(sites.map((site) => site.id));
  const publications = store.db
    .prepare(
      `SELECT id, site_id, page_id, revision_operation_id, path, published_at, published_by
       FROM publications ORDER BY published_at`,
    )
    .all() as {
    id: string;
    site_id: string;
    page_id: string;
    revision_operation_id: string;
    path: string;
    published_at: number;
    published_by: string;
  }[];
  for (const row of publications) {
    if (!known.has(row.site_id)) continue;
    graph.publish({
      id: row.id,
      site: row.site_id,
      page: row.page_id,
      path: row.path,
      participant: row.published_by,
      firstRevision: row.revision_operation_id,
      at: row.published_at,
    });
  }
  for (const site of sites) {
    if (site.entry_point === null) continue;
    graph.setSiteEntryPoint({
      site: site.id,
      page: site.entry_point,
      participant: site.owner_id,
    });
  }
}

// ---------------------------------------------------------------------------
// Búsqueda por FTS5
// ---------------------------------------------------------------------------

export interface StoredHit {
  page: string;
  block: string | null;
  field: 'page_title' | 'block_content' | 'gloss_content';
  excerpt: string;
  rank: number;
}

/**
 * Búsqueda respaldada por el índice de texto completo de SQLite. Existe para
 * demostrar que la ruta SQL responde lo mismo que el grafo en memoria; el
 * plegado de diacríticos lo aporta el tokenizador declarado en el esquema.
 */
export function searchStore(store: Store, text: string, limit = 50): StoredHit[] {
  if (text.trim() === '') return [];
  const term = `"${text.replace(/"/g, '""')}"`;

  const pages = store.db
    .prepare(
      `SELECT p.id AS page, p.title AS excerpt
       FROM pages_fts f JOIN pages p ON p.rowid = f.rowid
       WHERE pages_fts MATCH ? AND p.graph_id = ?
       ORDER BY p.id LIMIT ?`,
    )
    .all(term, store.graphId, limit) as { page: string; excerpt: string }[];

  const blocks = store.db
    .prepare(
      `SELECT b.page_id AS page, b.id AS block, substr(b.content, 1, 120) AS excerpt
       FROM blocks_fts f JOIN blocks b ON b.rowid = f.rowid
       WHERE blocks_fts MATCH ?
       ORDER BY b.id LIMIT ?`,
    )
    .all(term, limit) as { page: string; block: string; excerpt: string }[];

  const glosses = store.db
    .prepare(
      `SELECT b.page_id AS page, g.block_id AS block, substr(g.content, 1, 120) AS excerpt
       FROM glosses_fts f
       JOIN block_glosses g ON g.rowid = f.rowid
       JOIN blocks b ON b.id = g.block_id
       WHERE glosses_fts MATCH ?
       ORDER BY g.block_id LIMIT ?`,
    )
    .all(term, limit) as { page: string; block: string; excerpt: string }[];

  return [
    ...pages.map((row) => ({ ...row, block: null, field: 'page_title' as const })),
    ...blocks.map((row) => ({ ...row, field: 'block_content' as const })),
    ...glosses.map((row) => ({ ...row, field: 'gloss_content' as const })),
  ].map((hit, at) => ({ ...hit, rank: at + 1 }));
}

/** Vecindad resuelta con una consulta recursiva, no con un recorrido en JS. */
export function neighbourhoodFromStore(
  store: Store,
  centre: string,
  depth: number,
): { page: string; distance: number }[] {
  return store.db
    .prepare(
      `WITH RECURSIVE edges(a, b) AS (
         SELECT source_page, target_id FROM page_links
          WHERE target_id IS NOT NULL AND graph_id = ?1 AND source_page <> target_id
         UNION
         SELECT target_id, source_page FROM page_links
          WHERE target_id IS NOT NULL AND graph_id = ?1 AND source_page <> target_id
       ),
       reach(page, distance) AS (
         SELECT ?2, 0
         UNION
         SELECT edges.b, reach.distance + 1
           FROM edges JOIN reach ON edges.a = reach.page
          WHERE reach.distance < ?3
       )
       SELECT page, min(distance) AS distance FROM reach GROUP BY page ORDER BY distance, page`,
    )
    .all(store.graphId, centre, depth) as { page: string; distance: number }[];
}

// ---------------------------------------------------------------------------
// Medios
// ---------------------------------------------------------------------------

export interface MediaRecord {
  hash: string;
  mediaType: string;
  byteSize: number;
  originalName: string | null;
  description: string | null;
  alternativeText: string | null;
}

export interface MediaUsage {
  block: string;
  page: string;
  pageTitle: string;
}

/**
 * Registra un objeto ya guardado y la ruta por la que el Markdown lo nombra.
 *
 * `media` está indexada por contenido, así que dos rutas con los mismos bytes
 * comparten fila: el `INSERT OR IGNORE` es la deduplicación, no un descuido.
 */
export function recordMedia(
  store: Store,
  reference: { path: string; hash: string; mediaType: string; byteSize: number; at: number; originalName?: string },
): void {
  store.db
    .prepare(
      `INSERT OR IGNORE INTO media (hash, media_type, byte_size, custody, original_name, created_at)
       VALUES (?, ?, ?, 'internal', ?, ?)`,
    )
    .run(
      reference.hash,
      reference.mediaType,
      reference.byteSize,
      reference.originalName ?? reference.path,
      reference.at,
    );

  store.db
    .prepare(
      'INSERT OR REPLACE INTO media_references (graph_id, path, hash) VALUES (?, ?, ?)',
    )
    .run(store.graphId, reference.path, reference.hash);
}

export function mediaByHash(store: Store, hash: string): MediaRecord | null {
  const row = store.db
    .prepare('SELECT hash, media_type, byte_size, original_name, description, alternative_text FROM media WHERE hash = ?')
    .get(hash) as
    | { hash: string; media_type: string; byte_size: number; original_name: string | null; description: string | null; alternative_text: string | null }
    | undefined;

  if (row === undefined) return null;
  return {
    hash: row.hash,
    mediaType: row.media_type,
    byteSize: row.byte_size,
    originalName: row.original_name,
    description: row.description,
    alternativeText: row.alternative_text,
  };
}

/** El catálogo del almacén, una fila por contenido y con una ruta portable. */
export function mediaUsages(store: Store, hash: string): MediaUsage[] {
  const paths = store.db
    .prepare('SELECT path FROM media_references WHERE graph_id = ? AND hash = ?')
    .all(store.graphId, hash) as { path: string }[];
  const found = new Map<string, MediaUsage>();

  for (const { path } of paths) {
    const spellings = new Set([path, path.replace(/ /g, '%20')]);
    for (const spelling of spellings) {
      const rows = store.db
        .prepare(
          `SELECT b.id AS block, p.id AS page, p.title AS pageTitle
             FROM blocks b JOIN pages p ON p.id = b.page_id
            WHERE p.graph_id = ? AND instr(b.content, ?) > 0`,
        )
        .all(store.graphId, spelling) as unknown as MediaUsage[];
      for (const row of rows) found.set(row.block, row);
    }
  }

  /*
   * El reproductor de una grabación no necesita escribir una referencia
   * Markdown en el bloque: la relación canónica es recordings.audio_hash →
   * recordings.placed_in_block. Si sólo miramos texto, el catálogo llama
   * «huérfano» a un audio que se oye perfectamente dentro de una página y
   * luego ofrece una eliminación que la integridad referencial debe rechazar.
   */
  const recordings = store.db
    .prepare(
      `SELECT b.id AS block, p.id AS page, p.title AS pageTitle
         FROM recordings r
         JOIN blocks b ON b.id = r.placed_in_block
         JOIN pages p ON p.id = b.page_id
        WHERE r.graph_id = ? AND r.audio_hash = ?`,
    )
    .all(store.graphId, hash) as unknown as MediaUsage[];
  for (const row of recordings) found.set(row.block, row);

  return [...found.values()].sort((a, b) => a.pageTitle.localeCompare(b.pageTitle, 'es'));
}

export function listedMedia(store: Store): (MediaRecord & { path: string; createdAt: number; usages: MediaUsage[] })[] {
  const rows = store.db
    .prepare(
      `SELECT m.hash, m.media_type AS mediaType, m.byte_size AS byteSize,
              m.original_name AS originalName, m.description,
              m.alternative_text AS alternativeText, m.created_at AS createdAt,
              MIN(r.path) AS path
         FROM media m
         JOIN media_references r ON r.hash = m.hash AND r.graph_id = ?
        GROUP BY m.hash
        ORDER BY m.created_at DESC`,
    )
    .all(store.graphId) as unknown as (MediaRecord & { path: string; createdAt: number })[];
  return rows.map((row) => ({ ...row, usages: mediaUsages(store, row.hash) }));
}

/**
 * Quita del catálogo un archivo que ningún bloque usa.
 *
 * Los bytes sólo se pueden retirar cuando tampoco otro grafo ni una grabación
 * conservan el hash. Devuelve `deleteObject` para que el servidor, dueño del
 * filesystem, haga esa última parte.
 */
export function deleteOrphanMedia(store: Store, hash: string): { deleted: boolean; deleteObject: boolean } {
  if (mediaUsages(store, hash).length > 0) return { deleted: false, deleteObject: false };

  const recording = store.db.prepare('SELECT 1 FROM recordings WHERE audio_hash = ? LIMIT 1').get(hash);
  if (recording !== undefined) return { deleted: false, deleteObject: false };

  store.db.exec('BEGIN');
  try {
    const removed = store.db
      .prepare('DELETE FROM media_references WHERE graph_id = ? AND hash = ?')
      .run(store.graphId, hash);
    if (removed.changes === 0) {
      store.db.exec('ROLLBACK');
      return { deleted: false, deleteObject: false };
    }

    const remaining = store.db.prepare('SELECT 1 FROM media_references WHERE hash = ? LIMIT 1').get(hash);
    if (remaining !== undefined) {
      store.db.exec('COMMIT');
      return { deleted: true, deleteObject: false };
    }
    store.db.prepare('DELETE FROM media WHERE hash = ?').run(hash);
    store.db.exec('COMMIT');
    return { deleted: true, deleteObject: true };
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
}

export function describeMedia(
  store: Store,
  hash: string,
  metadata: { description: string | null; alternativeText: string | null },
): MediaRecord | null {
  const changed = store.db
    .prepare('UPDATE media SET description = ?, alternative_text = ? WHERE hash = ?')
    .run(metadata.description, metadata.alternativeText, hash);
  return changed.changes === 0 ? null : mediaByHash(store, hash);
}

/** Resolución de las rutas de este grafo: lo que la presentación necesita. */
export function mediaReferences(store: Store): { path: string; hash: string; mediaType: string; description: string | null; alternativeText: string | null }[] {
  return store.db
    .prepare(
      `SELECT r.path AS path, r.hash AS hash, m.media_type AS mediaType,
              m.description AS description, m.alternative_text AS alternativeText
         FROM media_references r JOIN media m ON m.hash = r.hash
        WHERE r.graph_id = ?
        ORDER BY r.path`,
    )
    .all(store.graphId) as { path: string; hash: string; mediaType: string; description: string | null; alternativeText: string | null }[];
}

// ---------------------------------------------------------------------------
// Estado de plegado
// ---------------------------------------------------------------------------
//
// @invariant FoldingIsNotAChange: plegar es lo que una persona está mirando, no
// lo que dice el grafo. No pasa por `submitOperation`, no genera revisión y no
// aparece en el registro. Por eso vive en su propia tabla, indexada por
// participante: dos personas pueden tener el mismo bloque abierto y cerrado.

export function setFold(
  store: Store,
  participant: string,
  block: string,
  folded: boolean,
): void {
  if (!folded) {
    // Lo desplegado es el estado por omisión, así que se representa por ausencia
    // en vez de guardar un cero por cada bloque que alguien abrió alguna vez.
    store.db
      .prepare('DELETE FROM block_collapse_state WHERE participant_id = ? AND block_id = ?')
      .run(participant, block);
    return;
  }

  store.db
    .prepare(
      `INSERT INTO block_collapse_state (participant_id, block_id, collapsed) VALUES (?, ?, 1)
       ON CONFLICT (participant_id, block_id) DO UPDATE SET collapsed = 1`,
    )
    .run(participant, block);
}

/** Los bloques que este participante tiene plegados en una página. */
export function foldedOnPage(store: Store, participant: string, page: string): string[] {
  return (
    store.db
      .prepare(
        `SELECT s.block_id AS block
           FROM block_collapse_state s JOIN blocks b ON b.id = s.block_id
          WHERE s.participant_id = ? AND b.page_id = ? AND s.collapsed = 1`,
      )
      .all(participant, page) as { block: string }[]
  ).map((row) => row.block);
}

// ---------------------------------------------------------------------------
// La cascada de validación desde la voz
// ---------------------------------------------------------------------------
//
// Lo canónico es la cadena: grabación → transcripción validada → contenido
// validado. Cada eslabón lo confirma una persona, y cada uno nombra al anterior.
// Eso es lo que permite que una frase editada meses después siga pudiendo
// responder de dónde vino.

export type CascadeStage =
  | 'captured'
  | 'transcribed'
  | 'transcript_validated'
  | 'content_settled';

export interface Recording {
  id: string;
  audioHash: string | null;
  mediaType: string;
  durationMs: number | null;
  stage: CascadeStage;
  transcript: string | null;
  /** El bloque que le guarda el lugar en la escritura, si se habló dentro de una. */
  placedInBlock: string | null;
  /**
   * La página de ese bloque.
   *
   * Se deriva, no se guarda: el bloque ya sabe en qué página está y repetirlo
   * sería tener dos versiones de lo mismo. Viaja con la grabación para que quien
   * la lea pueda llegar a ella sin una petición más.
   */
  placedInPage: string | null;
  evidence: { reference: string; capturedAt: number };
  capturedBy: string;
  capturedAt: number;
  validatedBy: string | null;
  validatedAt: number | null;
}

interface RecordingRow {
  id: string;
  audio_hash: string | null;
  media_type: string;
  duration_ms: number | null;
  stage: CascadeStage;
  transcript: string | null;
  placed_in_block: string | null;
  placed_in_page: string | null;
  evidence_reference: string;
  evidence_captured_at: number;
  captured_by: string;
  captured_at: number;
  validated_by: string | null;
  validated_at: number | null;
}

/**
 * Toda grabación se lee con la página de su bloque al lado.
 *
 * Un `LEFT JOIN`, no uno normal: una grabación sin lugar sigue existiendo, y con
 * un join estricto desaparecería de las listas justo cuando más falta hace verla.
 */
const WITH_PAGE =
  'SELECT r.*, b.page_id AS placed_in_page FROM recordings r ' +
  'LEFT JOIN blocks b ON b.id = r.placed_in_block';

function toRecording(row: RecordingRow): Recording {
  return {
    id: row.id,
    audioHash: row.audio_hash,
    mediaType: row.media_type,
    durationMs: row.duration_ms,
    stage: row.stage,
    transcript: row.transcript,
    placedInBlock: row.placed_in_block,
    placedInPage: row.placed_in_page ?? null,
    evidence: { reference: row.evidence_reference, capturedAt: row.evidence_captured_at },
    capturedBy: row.captured_by,
    capturedAt: row.captured_at,
    validatedBy: row.validated_by,
    validatedAt: row.validated_at,
  };
}

export function createRecording(
  store: Store,
  input: {
    audioHash: string;
    mediaType: string;
    durationMs: number | null;
    evidence: { reference: string; capturedAt: number };
    capturedBy: string;
    /**
     * El bloque que le guarda el lugar, cuando se habló dentro de un documento.
     * Sin él la grabación existe por sí sola y se asentará donde se decida.
     */
    placedInBlock?: string | null;
  },
): Recording | { error: string } {
  const id = `recording:${input.audioHash.slice(0, 16)}`;
  const at = Date.now();
  const place = input.placedInBlock ?? null;

  if (place !== null) {
    // @invariant APlaceIsHeldOnce: dos grabaciones en un bloque dejarían sin
    // respuesta de cuál de las dos vino su contenido.
    const taken = store.db
      .prepare('SELECT id FROM recordings WHERE placed_in_block = ?')
      .get(place) as { id: string } | undefined;
    if (taken !== undefined && taken.id !== id) {
      return { error: 'ese bloque ya le guarda el lugar a otra grabación' };
    }
    const block = store.db.prepare('SELECT content FROM blocks WHERE id = ?').get(place) as
      | { content: string }
      | undefined;
    if (block === undefined) return { error: 'no such block' };
  }

  store.db
    .prepare(
      `INSERT INTO recordings (
         id, graph_id, audio_hash, media_type, duration_ms, stage, transcript,
         placed_in_block, evidence_reference, evidence_captured_at, captured_by, captured_at
       ) VALUES (?, ?, ?, ?, ?, 'captured', NULL, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
    )
    .run(
      id,
      store.graphId,
      input.audioHash,
      input.mediaType,
      input.durationMs,
      place,
      input.evidence.reference,
      input.evidence.capturedAt,
      input.capturedBy,
      at,
    );
  return recordingById(store, id) as Recording;
}

/**
 * Borra el audio, dejando en pie todo lo demás.
 *
 * La grabación no se borra: pierde su audio y lo dice. Lo que quedaba escrito
 * sigue escrito, sigue nombrando de dónde vino, y la evidencia sigue ahí. La fila
 * declara que el audio ya no está en vez de fingir que nunca existió.
 */
/*
 * Quitar una grabación entera, y no sólo su audio.
 *
 * Faltaba, y su ausencia era el fallo. `discardAudio` suelta los bytes y deja la
 * fila; nada en todo el repositorio borraba una grabación. Si además desaparecía
 * el bloque que la sostenía, la clave ajena ponía `placed_in_block` en nulo y la
 * grabación quedaba huérfana: visible en la lista de voz sin lugar, imposible de
 * quitar, y de vuelta en cada recarga. No era un fantasma, era una fila que nadie
 * podía borrar.
 *
 * `recordings` no vive en el registro de operaciones —nace por createRecording y
 * no por submitOperation—, así que quitarla aquí es quitarla de verdad y no
 * reaparece al reproducir el log.
 *
 * El objeto de audio no se toca: vive en un almacén direccionado por contenido
 * que puede estar compartido con otra grabación, y recogerlo es cosa de un
 * barrido aparte. Lo que se suelta es la referencia.
 */
export function removeRecording(store: Store, id: string): { removed: string } | { error: string } {
  const held = recordingById(store, id);
  if (held === null) return { error: 'no such recording' };

  if (held.audioHash !== null) {
    store.db
      .prepare('DELETE FROM media_references WHERE graph_id = ? AND path = ?')
      .run(store.graphId, `recording/${held.audioHash}`);
  }
  // La procedencia hablada de un bloque apunta aquí; sin quitarla primero, la
  // clave ajena impediría el borrado y el fantasma seguiría en pie.
  store.db.prepare('DELETE FROM spoken_origins WHERE recording_id = ?').run(id);
  store.db.prepare('DELETE FROM recordings WHERE id = ?').run(id);
  return { removed: id };
}

export function discardAudio(store: Store, id: string): Recording | { error: string } {
  const held = recordingById(store, id);
  if (held === null) return { error: 'no such recording' };
  // @invariant DiscardingIsAlwaysAvailableAndNeverImplied: en cualquier momento,
  // transcrito o no. Exigir haber recorrido una cascada hacía a Vera dueña de una
  // grabación que no es suya; lo que corresponde es decir qué se va a perder, y
  // eso lo dice la interfaz antes de llamar aquí.
  if (held.audioHash === null) return held;
  // Sólo se suelta la referencia. El objeto vive en un almacén direccionado por
  // contenido que puede estar compartido, y recogerlo es cosa de otro barrido.
  store.db.prepare('UPDATE recordings SET audio_hash = NULL WHERE id = ?').run(id);
  store.db
    .prepare('DELETE FROM media_references WHERE graph_id = ? AND path = ?')
    .run(store.graphId, `recording/${held.audioHash}`);
  return recordingById(store, id) as Recording;
}

/**
 * Recupera un audio soltado mientras sus bytes sigan en el almacén.
 *
 * `discardAudio` quita la referencia pero no destruye el objeto compartible. El
 * identificador de la grabación conserva los primeros dieciséis caracteres del
 * hash; la fila de media permite resolver el único objeto completo sin adivinar.
 */
export function restoreAudio(store: Store, id: string): Recording | { error: string } {
  const held = recordingById(store, id);
  if (held === null) return { error: 'no such recording' };
  if (held.audioHash !== null) return held;
  const prefix = id.startsWith('recording:') ? id.slice('recording:'.length) : '';
  if (prefix.length !== 16) return { error: 'esa grabación no conserva una referencia recuperable' };
  const matches = store.db
    .prepare("SELECT hash FROM media WHERE hash LIKE ? AND original_name LIKE 'recording/%'")
    .all(`${prefix}%`) as { hash: string }[];
  if (matches.length !== 1) return { error: 'no se encontró un único audio recuperable' };
  const hash = matches[0]?.hash;
  if (hash === undefined) return { error: 'el audio ya no está en el almacén' };
  store.db.prepare('UPDATE recordings SET audio_hash = ? WHERE id = ?').run(hash, id);
  store.db
    .prepare('INSERT OR REPLACE INTO media_references (graph_id, path, hash) VALUES (?, ?, ?)')
    .run(store.graphId, `recording/${hash}`, hash);
  return recordingById(store, id) as Recording;
}

/** La grabación que le guarda el lugar a un bloque, si alguna. */
export function recordingByBlock(store: Store, block: string): Recording | null {
  const row = store.db.prepare(`${WITH_PAGE} WHERE r.placed_in_block = ?`).get(block) as
    | RecordingRow
    | undefined;
  return row === undefined ? null : toRecording(row);
}

/**
 * Las grabaciones que tienen lugar en una página, para que quien la lee vea el
 * audio donde se habló y no en un limbo aparte.
 */
export function recordingsInPage(store: Store, page: string): Recording[] {
  return (
    store.db
      .prepare(`${WITH_PAGE} WHERE b.page_id = ? AND r.graph_id = ?`)
      .all(page, store.graphId) as unknown as RecordingRow[]
  ).map(toRecording);
}

/**
 * Le da lugar a una grabación que no lo tenía, o se lo cambia.
 *
 * Es lo que repara una grabación que quedó suelta: existe, se puede oír, y no
 * había dónde encontrarla mientras se lee la página de la que habla.
 *
 * El bloque puede tener texto: desde que el audio convive con lo escrito en vez
 * de reemplazarlo, pegarle una grabación a un bloque que ya dice algo es
 * perfectamente sensato.
 */
export function placeRecording(
  store: Store,
  id: string,
  block: string | null,
): Recording | { error: string } {
  const held = recordingById(store, id);
  if (held === null) return { error: 'no such recording' };
  if (block !== null) {
    const taken = recordingByBlock(store, block);
    if (taken !== null && taken.id !== id) {
      return { error: 'ese bloque ya le guarda el lugar a otra grabación' };
    }
    const found = store.db.prepare('SELECT content FROM blocks WHERE id = ?').get(block) as
      | { content: string }
      | undefined;
    if (found === undefined) return { error: 'no such block' };
  }
  store.db.prepare('UPDATE recordings SET placed_in_block = ? WHERE id = ?').run(block, id);
  return recordingById(store, id) as Recording;
}

export function recordingById(store: Store, id: string): Recording | null {
  const row = store.db.prepare(`${WITH_PAGE} WHERE r.id = ?`).get(id) as
    | RecordingRow
    | undefined;
  return row === undefined ? null : toRecording(row);
}

export function recordings(store: Store, limit = 50): Recording[] {
  return (
    store.db
      .prepare(`${WITH_PAGE} WHERE r.graph_id = ? ORDER BY r.captured_at DESC LIMIT ?`)
      .all(store.graphId, limit) as unknown as RecordingRow[]
  ).map(toRecording);
}

/**
 * Guarda lo que la máquina dijo.
 *
 * El texto del bloque es lo que el texto es ahora; esto es lo que la máquina
 * produjo la última vez que se le preguntó. La diferencia entre los dos es
 * exactamente lo que una persona cambió, y merece poder verse.
 *
 * `stage` se mantiene al día porque la columna todavía existe en el esquema, pero
 * ya no gobierna nada: una grabación tiene transcripción o no la tiene.
 */
export function setTranscript(store: Store, id: string, text: string): Recording | { error: string } {
  const held = recordingById(store, id);
  if (held === null) return { error: 'no such recording' };
  store.db
    .prepare("UPDATE recordings SET transcript = ?, stage = 'transcribed' WHERE id = ?")
    .run(text, id);
  return recordingById(store, id) as Recording;
}

/**
 * La denominación de origen de un bloque.
 *
 * @invariant OriginIsNeverAsserted: sólo se escribe al asentar contenido de una
 * transcripción validada y al seguir una partición. No hay ruta que permita
 * declarar que un bloque vino de una grabación de la que no vino.
 */
export function setSpokenOrigin(store: Store, block: string, recording: string): void {
  store.db
    .prepare(
      `INSERT INTO spoken_origins (block_id, recording_id) VALUES (?, ?)
       ON CONFLICT (block_id) DO NOTHING`,
    )
    .run(block, recording);
}

export function spokenOriginOf(store: Store, block: string): string | null {
  const row = store.db
    .prepare('SELECT recording_id AS recording FROM spoken_origins WHERE block_id = ?')
    .get(block) as { recording: string } | undefined;
  return row?.recording ?? null;
}

/** Los orígenes de los bloques de una página, para poder decirlo al presentar. */
export function spokenOriginsOnPage(
  store: Store,
  page: string,
): { block: string; recording: string }[] {
  return store.db
    .prepare(
      `SELECT o.block_id AS block, o.recording_id AS recording
         FROM spoken_origins o JOIN blocks b ON b.id = o.block_id
        WHERE b.page_id = ?`,
    )
    .all(page) as { block: string; recording: string }[];
}

// ---------------------------------------------------------------------------
// Presentación recordada
// ---------------------------------------------------------------------------
//
// @guarantee RememberedSessionPresentation, de workspace-interface.allium.
//
// La tabla `workspaces` estaba en el esquema desde el principio y no la usaba
// nadie: la presentación vivía entera en el `localStorage` del navegador, así
// que era de un aparato y no de una persona. Cambiar de máquina era empezar de
// cero, y la garantía decía otra cosa.
//
// Va por participante y grafo, no por dispositivo. Un sistema de diseño ajustado
// es de quien lo ajustó.

export interface Workspace {
  layout: 'text_only' | 'graph_only' | 'split';
  dividerPosition: number;
  graphView: 'graph_2d' | 'graph_3d' | 'graph_d4';
  colourScheme: 'light' | 'dark';
  /** Los tokens de diseño tal como se guardaron, o null si nunca se tocaron. */
  designTokens: string | null;
  /** Cuántos saltos alcanza el mapa desde la página en foco. */
  graphReach: number;
}

interface WorkspaceRow {
  layout: Workspace['layout'];
  split_divider_position: number;
  graph_view: Workspace['graphView'];
  colour_scheme: Workspace['colourScheme'];
  design_tokens: string | null;
  graph_reach: number | null;
}

/** Lo recordado de este participante, o los valores de partida si no hay nada. */
export function workspaceOf(store: Store, participant: string): Workspace {
  const row = store.db
    .prepare('SELECT * FROM workspaces WHERE participant_id = ? AND graph_id = ?')
    .get(participant, store.graphId) as WorkspaceRow | undefined;

  // Una vista dividida empieza por la mitad para quien no ha ajustado nada.
  if (row === undefined) {
    return {
      layout: 'split',
      dividerPosition: 0.5,
      graphView: 'graph_2d',
      colourScheme: 'dark',
      designTokens: null,
      graphReach: 2,
    };
  }
  return {
    layout: row.layout,
    dividerPosition: row.split_divider_position,
    graphView: row.graph_view,
    colourScheme: row.colour_scheme,
    designTokens: row.design_tokens,
    graphReach: row.graph_reach ?? 2,
  };
}

/**
 * Guarda lo que cambió y deja lo demás como estaba.
 *
 * Parcial a propósito: mover el divisor no puede pisar el esquema de color que
 * se eligió en otro momento, y el cliente no tiene por qué mandar el estado
 * entero cada vez que toca una cosa.
 */
export function saveWorkspace(
  store: Store,
  participant: string,
  patch: Partial<Workspace>,
): Workspace {
  const now = workspaceOf(store, participant);
  const next: Workspace = { ...now, ...patch };
  store.db
    .prepare(
      `INSERT INTO workspaces (
         participant_id, graph_id, layout, split_divider_position, graph_view,
         colour_scheme, design_tokens, graph_reach
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (participant_id, graph_id) DO UPDATE SET
         layout = excluded.layout,
         split_divider_position = excluded.split_divider_position,
         graph_view = excluded.graph_view,
         colour_scheme = excluded.colour_scheme,
         design_tokens = excluded.design_tokens,
         graph_reach = excluded.graph_reach`,
    )
    .run(
      participant,
      store.graphId,
      next.layout,
      next.dividerPosition,
      next.graphView,
      next.colourScheme,
      next.designTokens,
      next.graphReach,
    );
  return next;
}
