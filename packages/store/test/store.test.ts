// Pruebas de la persistencia. Se ejercitan sobre SQLite real, en memoria.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { VeraGraph, checkInvariants } from '@vera/core';
import type { Change } from '@vera/core';
import {
  createRecording,
  discardAudio,
  loadGraph,
  listedMedia,
  neighbourhoodFromStore,
  openStore,
  placeRecording,
  recordMedia,
  recordOperation,
  recordingByBlock,
  recordingById,
  removeRecording,
  recordingsInPage,
  savePublication,
  saveParticipant,
  saveSite,
  searchStore,
} from '../src/store.ts';

const OWNER = 'participant:herbert';

function freshStore() {
  const store = openStore({ path: ':memory:', graphName: 'mind' });
  saveParticipant(store, { id: OWNER, name: 'Herbert', kind: 'human' });
  const graph = VeraGraph.create({ name: 'mind', id: store.graphId });
  graph.addParticipant({ id: OWNER, name: 'Herbert', kind: 'human' });
  graph.admit(OWNER);
  let n = 0;
  const write = (change: Change): string => {
    n += 1;
    const outcome = graph.submitOperation({
      originId: `o${n}`,
      participant: OWNER,
      channel: 'typed_text',
      change,
    });
    if (outcome.status !== 'applied') throw new Error(`rechazada: ${JSON.stringify(outcome)}`);
    recordOperation(store, graph, outcome.operation);
    return outcome.subjectId;
  };
  return { store, graph, write };
}

const count = (store: ReturnType<typeof openStore>, table: string): number =>
  (store.db.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n;

describe('persistencia', () => {
  it('aplica el esquema completo', () => {
    const store = openStore({ path: ':memory:' });
    const tables = store.db
      .prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'")
      .get() as { n: number };
    assert.ok(tables.n > 15);
    store.close();
  });

  it('guarda la operación y su revisión', () => {
    const { store, write } = freshStore();
    write({ kind: 'create_page', title: 'Amereida', visibility: 'private' });
    assert.equal(count(store, 'operations'), 1);
    assert.equal(count(store, 'revisions'), 1);
    store.close();
  });

  it('rechaza en la base un origin_id repetido', () => {
    const { store } = freshStore();
    const insert = () =>
      store.db.prepare(
        `INSERT INTO operations (id, graph_id, origin_id, sequence, participant_id, change_kind,
           change_payload, subject_id, channel, submitted_at, applied_at)
         VALUES (?, ?, 'mismo', ?, ?, 'edit_block', '{}', 'b', 'typed_text', 0, 0)`,
      );
    insert().run('op:1', store.graphId, 1, OWNER);
    assert.throws(() => insert().run('op:2', store.graphId, 2, OWNER), /UNIQUE/);
    store.close();
  });

  it('rechaza voz autenticada sin evidencia', () => {
    const { store } = freshStore();
    assert.throws(
      () =>
        store.db
          .prepare(
            `INSERT INTO operations (id, graph_id, origin_id, sequence, participant_id, change_kind,
               change_payload, subject_id, channel, submitted_at, applied_at)
             VALUES ('op:x', ?, 'x', 1, ?, 'edit_block', '{}', 'b', 'authenticated_voice', 0, 0)`,
          )
          .run(store.graphId, OWNER),
      /CHECK/,
    );
    store.close();
  });

  it('materializa páginas, bloques, enlaces y etiquetas', () => {
    const { store, write } = freshStore();
    const page = write({ kind: 'create_page', title: 'Amereida', visibility: 'private' });
    write({ kind: 'create_page', title: 'Travesia', visibility: 'private' });
    write({
      kind: 'create_block',
      page,
      parent: null,
      position: 0,
      content: 'ver [[Travesia]] #ead',
    });

    assert.equal(count(store, 'pages'), 2);
    assert.equal(count(store, 'blocks'), 1);
    assert.equal(count(store, 'page_links'), 1);
    assert.equal(count(store, 'block_tags'), 1);

    const link = store.db.prepare('SELECT target_id FROM page_links').get() as {
      target_id: string | null;
    };
    assert.notEqual(link.target_id, null);
    store.close();
  });

  it('materializa, revisa y reproduce una conectiva como outline de bloques', () => {
    const { store, write } = freshStore();
    const from = write({ kind: 'create_page', title: 'Uno', visibility: 'private' });
    const to = write({ kind: 'create_page', title: 'Dos', visibility: 'private' });
    const crossing = write({ kind: 'create_crossing', fromPage: from, toPage: to, content: 'salta' });
    write({ kind: 'edit_crossing', crossing, content: 'salta y se transforma' });

    assert.equal(count(store, 'crossings'), 1);
    assert.equal(count(store, 'blocks'), 1);
    const root = store.db.prepare(
      'SELECT page_id AS page, crossing_id AS crossing, parent_id AS parent, content FROM blocks WHERE crossing_id = ?',
    ).get(crossing) as { page: string | null; crossing: string; parent: string | null; content: string };
    assert.equal(root.page, null);
    assert.equal(root.crossing, crossing);
    assert.equal(root.parent, null);
    assert.equal(root.content, 'salta y se transforma');
    assert.equal((store.db.prepare('SELECT count(*) n FROM revisions WHERE crossing_id=?')
      .get(crossing) as { n: number }).n, 2);
    const loaded = loadGraph(store);
    assert.equal(loaded.crossing(crossing)?.said, 'salta y se transforma');
    assert.equal(loaded.crossing(crossing)?.fromPage, from);
    assert.equal(loaded.crossing(crossing)?.toPage, to);
    assert.equal(loaded.crossing(crossing)?.blocks.length, 1);
    store.close();
  });

  it('reproduce el grafo desde el log y no desde las tablas de estado', () => {
    const { store, graph, write } = freshStore();
    const page = write({ kind: 'create_page', title: 'Amereida', visibility: 'private' });
    const block = write({ kind: 'create_block', page, parent: null, position: 0, content: 'uno' });
    write({ kind: 'edit_block', block, content: 'dos' });

    const loaded = loadGraph(store);
    assert.equal(loaded.pages().length, graph.pages().length);
    assert.equal(loaded.block(block)?.content, 'dos');
    assert.equal(loaded.block(block)?.stableId, block, 'la identidad sobrevive al viaje por disco');
    assert.deepEqual(checkInvariants(loaded), []);
    store.close();
  });

  it('conserva el sitio, sus publicaciones y su portada', () => {
    const { store, graph, write } = freshStore();
    const page = write({ kind: 'create_page', title: 'Portada', visibility: 'public' });
    const site = graph.createSite({
      owner: OWNER,
      title: 'Vera',
      canonicalDomain: 'https://vera.mediafranca.net',
      transparentBlockTraceability: true,
    });
    const publication = graph.publish({
      site: site.id,
      page,
      path: 'portada',
      participant: OWNER,
    });
    graph.setSiteEntryPoint({ site: site.id, page, participant: OWNER });

    saveSite(store, graph.site(site.id)!);
    savePublication(store, publication);
    saveSite(store, graph.site(site.id)!);

    const loaded = loadGraph(store);
    assert.equal(loaded.site(site.id)?.entryPoint, page);
    assert.equal(loaded.site(site.id)?.transparentBlockTraceability, true);
    assert.equal(loaded.publicationsOf(site.id)[0]?.path, 'portada');
    assert.deepEqual(checkInvariants(loaded), []);
    store.close();
  });

  it('materializa, busca y reproduce la glosa canónica de un bloque', () => {
    const { store, write } = freshStore();
    const page = write({ kind: 'create_page', title: 'Lectura', visibility: 'private' });
    const block = write({ kind: 'create_block', page, parent: null, position: 0, content: 'pasaje' });
    write({ kind: 'set_block_gloss', block, content: 'correspondencia hospitalaria' });

    assert.equal(count(store, 'block_glosses'), 1);
    assert.equal(searchStore(store, 'hospitalaria')[0]?.field, 'gloss_content');
    assert.equal(loadGraph(store).gloss(block)?.content, 'correspondencia hospitalaria');
    store.close();
  });

  it('reproduce una operación que hoy estaría prohibida', () => {
    // rule ADayKeepsItsKind llegó después de que alguien ya hubiera quitado el
    // tipo a un día. Si la prohibición se aplicara también al reproducir, esa
    // operación pasada volvería el registro irreproducible y el grafo no
    // levantaría: cada regla nueva invalidaría la historia anterior a ella.
    const { store, write, graph } = freshStore();
    const day = write({ kind: 'create_page', title: '2026-08-06', visibility: 'private' });
    write({ kind: 'set_property', page: day, propertyKey: 'type', propertyValue: 'bitácora' });

    // Se cuela por la puerta de la reproducción, que es exactamente por donde
    // entró en su día: antes de que la regla existiera.
    graph.beginReplay();
    const removed = graph.submitOperation({
      originId: 'antes-de-la-regla',
      participant: OWNER,
      change: { kind: 'remove_property', page: day, propertyKey: 'type' },
    });
    graph.endReplay();
    assert.equal(removed.status, 'applied', 'reproducir no aplica prohibiciones de política');

    // Y sometida ahora, la misma operación se niega.
    const refused = graph.submitOperation({
      originId: 'despues-de-la-regla',
      participant: OWNER,
      change: { kind: 'remove_property', page: day, propertyKey: 'type' },
    });
    assert.equal(refused.status, 'rejected');
    store.close();
  });

  it('un día no se queda sin su tipo, y una página cualquiera sí', () => {
    const { store, graph, write } = freshStore();
    const day = write({ kind: 'create_page', title: '2026-08-06', visibility: 'private' });
    const page = write({ kind: 'create_page', title: 'Amereida', visibility: 'private' });
    // La clave la nombra el corpus; aquí rige la que Vera trae. Ver
    // property-names.ts: lo que el dominio conoce es el papel, no la palabra.
    const kind = graph.propertyNames.kind;
    for (const subject of [day, page]) {
      write({ kind: 'set_property', page: subject, propertyKey: kind, propertyValue: 'x' });
    }

    assert.equal(
      graph.submitOperation({
        originId: 'quitar-al-dia',
        participant: OWNER,
        change: { kind: 'remove_property', page: day, propertyKey: kind },
      }).status,
      'rejected',
    );
    assert.equal(
      graph.submitOperation({
        originId: 'quitar-a-la-pagina',
        participant: OWNER,
        change: { kind: 'remove_property', page, propertyKey: kind },
      }).status,
      'applied',
    );
    // @invariant OtherPropertiesOfADayAreOrdinary: lo protegido es la clase, no
    // el front matter entero.
    write({ kind: 'set_property', page: day, propertyKey: 'concepto', propertyValue: 'ceremonia' });
    assert.equal(
      graph.submitOperation({
        originId: 'quitar-otra-del-dia',
        participant: OWNER,
        change: { kind: 'remove_property', page: day, propertyKey: 'concepto' },
      }).status,
      'applied',
    );
    store.close();
  });

  it('conserva la procedencia al reproducir', () => {
    const { store, write } = freshStore();
    write({ kind: 'create_page', title: 'Amereida', visibility: 'private' });
    const loaded = loadGraph(store);
    assert.equal(loaded.revisions().at(-1)?.authoredBy, OWNER);
    assert.equal(loaded.revisions().at(-1)?.channel, 'typed_text');
    store.close();
  });

  it('encuentra por FTS5 plegando los diacríticos', () => {
    const { store, write } = freshStore();
    const page = write({ kind: 'create_page', title: 'Travesía', visibility: 'private' });
    write({
      kind: 'create_block',
      page,
      parent: null,
      position: 0,
      content: 'el desierto de Atacama',
    });

    assert.equal(searchStore(store, 'travesia').length, 1, 'travesia encuentra Travesía');
    assert.equal(searchStore(store, 'desierto').length, 1);
    assert.equal(searchStore(store, 'inexistente').length, 0);
    assert.equal(searchStore(store, '').length, 0);
    store.close();
  });

  it('deja de encontrar lo que se borró', () => {
    const { store, write } = freshStore();
    const page = write({ kind: 'create_page', title: 'P', visibility: 'private' });
    const block = write({
      kind: 'create_block',
      page,
      parent: null,
      position: 0,
      content: 'borrable',
    });
    assert.equal(searchStore(store, 'borrable').length, 1);
    write({ kind: 'remove_block', block });
    assert.equal(searchStore(store, 'borrable').length, 0);
    store.close();
  });

  // Este caso tumbaba el servidor. La clave foránea de property_assignments no
  // declara ON DELETE, así que mientras quedara una propiedad el borrado del
  // bloque fallaba; y en el corpus real casi ningún bloque de bibliografía está
  // sin propiedades. El test anterior no lo veía porque su bloque no tenía.
  it('borra un bloque que lleva propiedades', () => {
    const { store, write } = freshStore();
    const page = write({ kind: 'create_page', title: 'P', visibility: 'private' });
    const block = write({
      kind: 'create_block',
      page,
      parent: null,
      position: 0,
      content: 'con propiedades',
    });
    write({ kind: 'set_property', block, propertyKey: 'tipo', propertyValue: 'nota' });
    write({ kind: 'set_property', block, propertyKey: 'año', propertyValue: '2001' });

    const cuenta = (): number =>
      (
        store.db
          .prepare('SELECT count(*) c FROM property_assignments WHERE block_id = ?')
          .get(block) as { c: number }
      ).c;
    assert.equal(cuenta(), 2);

    write({ kind: 'remove_block', block });

    assert.equal(cuenta(), 0, 'las propiedades del bloque se van con él');
    assert.equal(searchStore(store, 'propiedades').length, 0);
    store.close();
  });

  // Insertar entre hermanos renumera al grupo, y esa renumeración es parte de
  // aplicar la operación. Si sólo bajara a disco el bloque sujeto, el grafo en
  // memoria y la base contarían dos órdenes distintos hasta el siguiente
  // arranque, que es la clase de divergencia que este proyecto no admite.
  it('persiste el orden de los hermanos, no sólo el bloque insertado', () => {
    const { store, write } = freshStore();
    const page = write({ kind: 'create_page', title: 'P', visibility: 'private' });
    const a = write({ kind: 'create_block', page, parent: null, position: 0, content: 'a' });
    const b = write({ kind: 'create_block', page, parent: null, position: 1, content: 'b' });
    const medio = write({ kind: 'create_block', page, parent: null, position: 1, content: 'medio' });

    const enDisco = (): string[] =>
      (
        store.db
          .prepare('SELECT content FROM blocks WHERE page_id = ? ORDER BY position')
          .all(page) as { content: string }[]
      ).map((row) => row.content);

    assert.deepEqual(enDisco(), ['a', 'medio', 'b']);

    write({ kind: 'move_block', block: a, page, parent: null, position: 2 });
    assert.deepEqual(enDisco(), ['medio', 'b', 'a']);

    write({ kind: 'remove_block', block: b });
    assert.deepEqual(enDisco(), ['medio', 'a']);

    const posiciones = (
      store.db
        .prepare('SELECT position FROM blocks WHERE page_id = ? ORDER BY position')
        .all(page) as { position: number }[]
    ).map((row) => row.position);
    assert.deepEqual(posiciones, [0, 1], 'sin huecos ni repetidos en disco');

    // Y lo definitivo: reproducir el log desde cero da el mismo orden.
    const reproducido = loadGraph(store, 'mind');
    assert.deepEqual(
      reproducido
        .blocksOf(page)
        .sort((x, y) => x.position - y.position)
        .map((block) => block.content),
      ['medio', 'a'],
    );
    assert.deepEqual(checkInvariants(reproducido), []);
    store.close();
  });

  it('borra una página que lleva propiedades', () => {
    const { store, write } = freshStore();
    const page = write({ kind: 'create_page', title: 'P', visibility: 'private' });
    write({ kind: 'set_property', page, propertyKey: 'estado', propertyValue: 'borrador' });

    write({ kind: 'remove_page', page });

    const quedan = (
      store.db
        .prepare('SELECT count(*) c FROM property_assignments WHERE page_id = ?')
        .get(page) as { c: number }
    ).c;
    assert.equal(quedan, 0, 'las propiedades de la página se van con ella');
    store.close();
  });

  it('recorre la vecindad con una consulta recursiva', () => {
    const { store, write } = freshStore();
    const a = write({ kind: 'create_page', title: 'A', visibility: 'private' });
    const b = write({ kind: 'create_page', title: 'B', visibility: 'private' });
    write({ kind: 'create_page', title: 'C', visibility: 'private' });
    write({ kind: 'create_block', page: a, parent: null, position: 0, content: 'ver [[B]]' });
    write({ kind: 'create_block', page: b, parent: null, position: 0, content: 'ver [[C]]' });

    const near = neighbourhoodFromStore(store, a, 1);
    assert.deepEqual(
      near.map((n) => n.distance),
      [0, 1],
    );
    const far = neighbourhoodFromStore(store, a, 2);
    assert.equal(far.length, 3, 'a dos saltos alcanza C');
    store.close();
  });

  it('deshace la operación entera si algo falla a mitad', () => {
    const { store, graph } = freshStore();
    const before = count(store, 'operations');
    const outcome = graph.submitOperation({
      originId: 'x',
      participant: OWNER,
      channel: 'typed_text',
      change: { kind: 'create_page', title: 'X', visibility: 'private' },
    });
    assert.equal(outcome.status, 'applied');
    if (outcome.status !== 'applied') return;
    // Voz autenticada sin evidencia viola el CHECK del esquema a mitad de la
    // transacción: lo ya escrito debe deshacerse.
    const corrupted = {
      ...outcome.operation,
      submission: { ...outcome.operation.submission, channel: 'authenticated_voice' as const },
    };
    assert.throws(() => recordOperation(store, graph, corrupted));
    assert.equal(count(store, 'operations'), before, 'no queda media operación escrita');
    store.close();
  });

  it('reconstruir del log tras un fallo de persistencia devuelve un grafo consistente con el disco', () => {
    // `packages/server/src/server.ts` (`persist`, todos los sitios que llaman
    // `recordOperation`) reacciona a este mismo fallo reconstruyendo `graph`
    // desde el log en vez de seguir sirviendo la mutación en memoria que el
    // disco nunca guardó. Esto prueba que ese mecanismo de recuperación es
    // sólido: el grafo reconstruido no arrastra la operación que falló, y una
    // escritura legítima posterior sigue funcionando con normalidad — no queda
    // el dominio en un estado del que no se pueda seguir escribiendo.
    const { store, graph } = freshStore();
    const outcome = graph.submitOperation({
      originId: 'ok-antes-del-fallo',
      participant: OWNER,
      channel: 'typed_text',
      change: { kind: 'create_page', title: 'Antes del fallo', visibility: 'private' },
    });
    assert.equal(outcome.status, 'applied');
    if (outcome.status !== 'applied') return;
    recordOperation(store, graph, outcome.operation);

    const failing = graph.submitOperation({
      originId: 'esto-no-se-va-a-guardar',
      participant: OWNER,
      channel: 'typed_text',
      change: { kind: 'create_page', title: 'Nunca llega al disco', visibility: 'private' },
    });
    assert.equal(failing.status, 'applied');
    if (failing.status !== 'applied') return;
    // El dominio ya mutó `graph` en memoria: existe antes de que la escritura
    // falle, que es justo la ventana que vuelve peligroso no reconstruir.
    assert.ok(graph.pageTitled('Nunca llega al disco') !== undefined);

    const corrupted = {
      ...failing.operation,
      submission: { ...failing.operation.submission, channel: 'authenticated_voice' as const },
    };
    assert.throws(() => recordOperation(store, graph, corrupted));

    // Reconstruir del log — lo que `persist` hace en cuanto `recordOperation`
    // lanza — es la única forma de que memoria y disco vuelvan a decir lo
    // mismo.
    const reconstructed = loadGraph(store, graph.id);
    assert.ok(
      reconstructed.pageTitled('Antes del fallo') !== undefined,
      'lo que sí se guardó antes del fallo sigue ahí',
    );
    assert.equal(
      reconstructed.pageTitled('Nunca llega al disco'),
      undefined,
      'la mutación en memoria que nunca llegó al disco no sobrevive a la reconstrucción',
    );

    // Y el dominio reconstruido sigue aceptando escritura normal: el fallo no
    // deja el grafo en un estado del que no se pueda seguir trabajando.
    const after = reconstructed.submitOperation({
      originId: 'sigue-funcionando-despues',
      participant: OWNER,
      channel: 'typed_text',
      change: { kind: 'create_page', title: 'Después de reconstruir', visibility: 'private' },
    });
    assert.equal(after.status, 'applied');
    store.close();
  });
});

// ---------------------------------------------------------------------------
// Hablar dentro de la escritura
// ---------------------------------------------------------------------------
//
// Una grabación puede nacer con lugar: un bloque le guarda el sitio mientras se
// recorre la cascada, y su contenido aterriza ahí en vez de al final de una
// página. Lo que se prueba aquí es que ese lugar no se pueda tomar a la fuerza.

/** El audio tiene que existir en `media` antes de que una grabación lo nombre. */
function withAudio(store: ReturnType<typeof freshStore>['store'], hash: string): void {
  recordMedia(store, {
    path: `recording/${hash}`,
    hash,
    mediaType: 'audio/webm',
    byteSize: 10,
    at: 1,
  });
}

describe('una grabación con lugar en la escritura', () => {
  function withPage() {
    const kit = freshStore();
    const page = kit.write({ kind: 'create_page', title: 'P', visibility: 'private' });
    withAudio(kit.store, 'a'.repeat(64));
    withAudio(kit.store, 'b'.repeat(64));
    return { ...kit, page };
  }

  const spoken = {
    audioHash: 'a'.repeat(64),
    mediaType: 'audio/webm',
    durationMs: 1000,
    evidence: { reference: 'speaker:x (asumido)', capturedAt: 1 },
    capturedBy: OWNER,
  };

  it('nace atada al bloque que le guarda el sitio', () => {
    const { store, write, page } = withPage();
    const block = write({ kind: 'create_block', page, parent: null, position: 0, content: '' });
    const recording = createRecording(store, { ...spoken, placedInBlock: block });
    assert.ok(!('error' in recording));
    if ('error' in recording) return;
    assert.equal(recording.placedInBlock, block);
    assert.equal(recordingByBlock(store, block)?.id, recording.id);
    store.close();
  });

  it('el catálogo no llama huérfano al audio colocado en un bloque', () => {
    const { store, write, page } = withPage();
    const block = write({ kind: 'create_block', page, parent: null, position: 0, content: '' });
    const recording = createRecording(store, { ...spoken, placedInBlock: block });
    assert.ok(!('error' in recording));

    const audio = listedMedia(store).find((file) => file.hash === spoken.audioHash);
    assert.deepEqual(
      audio?.usages.map((usage) => ({ ...usage })),
      [{ block, page, pageTitle: 'P' }],
    );
    store.close();
  });

  it('una grabación se va con el bloque que la sostenía', () => {
    // El fallo que esto cierra: la clave ajena declaraba ON DELETE SET NULL, así
    // que borrar el bloque dejaba viva a la grabación y sin sitio. Y como nada en
    // todo el repositorio borraba una grabación, esa fila era permanente:
    // reaparecía en «voz sin lugar» en cada recarga sin forma alguna de quitarla.
    const { store, write, page } = withPage();
    const block = write({ kind: 'create_block', page, parent: null, position: 0, content: '' });
    const made = createRecording(store, { ...spoken, placedInBlock: block });
    assert.ok(!('error' in made));
    if ('error' in made) return;

    write({ kind: 'remove_block', block });

    assert.equal(recordingById(store, made.id), null, 'la grabación se fue con su bloque');
    assert.equal(
      (store.db.prepare('SELECT count(*) n FROM recordings WHERE placed_in_block IS NULL').get() as {
        n: number;
      }).n,
      0,
      'y no quedó ninguna sin lugar',
    );
    store.close();
  });

  it('quitar una grabación la quita de verdad', () => {
    const { store, write, page } = withPage();
    const block = write({ kind: 'create_block', page, parent: null, position: 0, content: '' });
    const made = createRecording(store, { ...spoken, placedInBlock: block });
    if ('error' in made) return;

    assert.ok('removed' in removeRecording(store, made.id));
    assert.equal(recordingById(store, made.id), null);
    // `recordings` no vive en el registro de operaciones, así que quitarla es
    // quitarla: no vuelve al reproducir el log.
    assert.ok('error' in removeRecording(store, made.id));
    store.close();
  });

  it('se puede pegar a un bloque que ya tiene texto', () => {
    // Antes se rechazaba, porque la transcripción reemplazaba al bloque entero y
    // habría caído encima de palabras que nadie aceptó perder. Desde que el
    // audio convive con lo escrito en vez de sustituirlo, pegarle una grabación
    // a un bloque que ya dice algo es perfectamente sensato: el audio va arriba
    // y el texto sigue donde estaba.
    const { store, write, page } = withPage();
    const block = write({ kind: 'create_block', page, parent: null, position: 0, content: 'ya escrito' });
    const outcome = createRecording(store, { ...spoken, placedInBlock: block });
    assert.ok(!('error' in outcome));
    if ('error' in outcome) return;
    assert.equal(outcome.placedInBlock, block);
    store.close();
  });

  it('no le quita el lugar a otra grabación', () => {
    // @invariant APlaceIsHeldOnce: con dos, el bloque no podría decir de cuál
    // de las dos vino su contenido.
    const { store, write, page } = withPage();
    const block = write({ kind: 'create_block', page, parent: null, position: 0, content: '' });
    createRecording(store, { ...spoken, placedInBlock: block });
    const second = createRecording(store, {
      ...spoken,
      audioHash: 'b'.repeat(64),
      placedInBlock: block,
    });
    assert.ok('error' in second);
    store.close();
  });

  it('sobrevive a que le borren el bloque', () => {
    // Borrar el sitio donde se iba a hablar no puede destruir lo ya dicho.
    const { store, write, page } = withPage();
    const block = write({ kind: 'create_block', page, parent: null, position: 0, content: '' });
    const recording = createRecording(store, { ...spoken, placedInBlock: block });
    assert.ok(!('error' in recording));
    if ('error' in recording) return;
    store.db.prepare('DELETE FROM blocks WHERE id = ?').run(block);
    const after = recordingById(store, recording.id);
    assert.equal(after?.placedInBlock, null, 'la grabación queda sin lugar, no borrada');
    assert.equal(after?.audioHash, spoken.audioHash);
    store.close();
  });

  it('se puede reparar dándole lugar después', () => {
    const { store, write, page } = withPage();
    const recording = createRecording(store, spoken);
    assert.ok(!('error' in recording));
    if ('error' in recording) return;
    assert.equal(recording.placedInBlock, null);
    const block = write({ kind: 'create_block', page, parent: null, position: 0, content: '' });
    const placed = placeRecording(store, recording.id, block);
    assert.ok(!('error' in placed));
    assert.equal(recordingsInPage(store, page).length, 1);
    store.close();
  });
});

describe('borrar el audio', () => {
  const spoken = {
    audioHash: 'c'.repeat(64),
    mediaType: 'audio/webm',
    durationMs: 1000,
    evidence: { reference: 'speaker:x (asumido)', capturedAt: 1 },
    capturedBy: OWNER,
  };

  it('se puede en cualquier momento, transcrita o no', () => {
    // @invariant DiscardingIsAlwaysAvailableAndNeverImplied. Antes esto exigía
    // haber recorrido una cascada entera, lo que hacía a Vera dueña de una
    // grabación que no es suya. Lo que corresponde es advertir qué se pierde
    // —cosa de la interfaz— y obedecer.
    const { store } = freshStore();
    withAudio(store, spoken.audioHash);
    const recording = createRecording(store, spoken);
    assert.ok(!('error' in recording));
    if ('error' in recording) return;

    const sinTranscribir = discardAudio(store, recording.id);
    assert.ok(!('error' in sinTranscribir), 'sin transcripción también se puede');
    if ('error' in sinTranscribir) return;
    assert.equal(sinTranscribir.audioHash, null);
    store.close();
  });

  it('borrar dos veces no es un error', () => {
    // Pulsar dos veces, o reenviar la petición, no puede fallar por algo que ya
    // está como se pidió.
    const { store } = freshStore();
    withAudio(store, spoken.audioHash);
    const recording = createRecording(store, spoken);
    if ('error' in recording) return;
    discardAudio(store, recording.id);
    const otra = discardAudio(store, recording.id);
    assert.ok(!('error' in otra));
    store.close();
  });

  it('deja en pie lo que dice y de dónde vino', () => {
    const { store } = freshStore();
    withAudio(store, spoken.audioHash);
    const recording = createRecording(store, spoken);
    assert.ok(!('error' in recording));
    if ('error' in recording) return;
    store.db
      .prepare('UPDATE recordings SET transcript = ? WHERE id = ?')
      .run('lo que se dijo', recording.id);
    const after = discardAudio(store, recording.id);
    assert.ok(!('error' in after));
    if ('error' in after) return;
    assert.equal(after.audioHash, null);
    assert.equal(after.transcript, 'lo que se dijo');
    assert.equal(after.evidence.reference, spoken.evidence.reference);
    store.close();
  });
});

/*
 * Un hueco en el registro no puede envenenar lo que venga después.
 *
 * Una operación aceptada por el dominio puede fallar al guardarse —la
 * transacción revierte el disco y la memoria se queda con el cambio—, y eso deja
 * un número de secuencia escrito y sin fila. Al arrancar de nuevo, contar las
 * operaciones reproducidas dejaba el contador por detrás de ese número: la
 * siguiente escritura reclamaba uno que ya existía, la base la rechazaba, y el
 * hueco se hacía más grande. Un corpus que se estropea más cuanto más se usa.
 */
/** Deja el registro sin esa operación, como la deja una transacción revertida. */
function hollow(store: ReturnType<typeof openStore>, sequence: number): void {
  const held = store.db.prepare('SELECT id FROM operations WHERE sequence = ?').get(sequence) as
    | { id: string }
    | undefined;
  if (held === undefined) return;
  store.db.prepare('DELETE FROM revisions WHERE operation_id = ?').run(held.id);
  store.db.prepare('DELETE FROM operations WHERE id = ?').run(held.id);
}

describe('reproducir un registro con huecos', () => {
  it('la siguiente operación no reclama un número ya escrito', () => {
    const { store, write } = freshStore();
    const page = write({ kind: 'create_page', title: 'Con hueco', visibility: 'private' });
    write({ kind: 'create_block', page, parent: null, position: 0, content: 'uno' });
    write({ kind: 'create_block', page, parent: null, position: 1, content: 'dos' });

    // El hueco, tal como ocurre: la transacción entera revertida, así que ni la
    // operación ni su revisión llegaron a escribirse.
    hollow(store, 2);

    const vuelto = loadGraph(store, 'mind');
    assert.equal(vuelto.log().lastSequence, 3, 'el contador sigue al último número escrito');

    const outcome = vuelto.submitOperation({
      originId: 'después-del-hueco',
      participant: OWNER,
      channel: 'typed_text',
      change: { kind: 'create_block', page, parent: null, position: 2, content: 'tres' },
    });
    assert.equal(outcome.status, 'applied');
    if (outcome.status !== 'applied') return;
    assert.equal(outcome.operation.sequence, 4);
    // Y se puede guardar: es la prueba entera, porque el síntoma era una clave
    // única rechazando la escritura.
    recordOperation(store, vuelto, outcome.operation);
    // Tres filas: las dos que quedaron y la nueva. El hueco no se rellena —lo que
    // no ocurrió no ocurrió— y por eso el número no vuelve a usarse.
    assert.equal(count(store, 'operations'), 3);
  });

  it('una operación reproducida conserva su identidad', () => {
    const { store, write } = freshStore();
    write({ kind: 'create_page', title: 'Identidad', visibility: 'private' });
    const escritas = store.db
      .prepare('SELECT id FROM operations ORDER BY sequence')
      .all()
      .map((row) => (row as { id: string }).id);

    const vuelto = loadGraph(store, 'mind');
    assert.deepEqual(
      vuelto.operations().map((one) => one.id),
      escritas,
      'reproducir no reinventa los identificadores de las operaciones',
    );
  });

  it('y la operación siguiente no reclama una identidad ya escrita', () => {
    const { store, write } = freshStore();
    const page = write({ kind: 'create_page', title: 'Sin choque', visibility: 'private' });
    write({ kind: 'create_block', page, parent: null, position: 0, content: 'uno' });

    const vuelto = loadGraph(store, 'mind');
    const outcome = vuelto.submitOperation({
      originId: 'nueva',
      participant: OWNER,
      channel: 'typed_text',
      change: { kind: 'create_block', page, parent: null, position: 1, content: 'dos' },
    });
    assert.equal(outcome.status, 'applied');
    if (outcome.status !== 'applied') return;
    const held = store.db
      .prepare('SELECT 1 FROM operations WHERE id = ?')
      .get(outcome.operation.id);
    assert.equal(held, undefined, 'la identidad de la operación nueva no estaba escrita');
    recordOperation(store, vuelto, outcome.operation);
  });

  it('lo escrito después de un hueco conserva su revisión', () => {
    // Buscar la revisión por el número de la operación dejaba sin revisión a
    // todo lo posterior a un hueco, y nada lo decía.
    const { store, write } = freshStore();
    const page = write({ kind: 'create_page', title: 'Con revisión', visibility: 'private' });
    write({ kind: 'create_block', page, parent: null, position: 0, content: 'uno' });
    hollow(store, 2);

    const vuelto = loadGraph(store, 'mind');
    const outcome = vuelto.submitOperation({
      originId: 'con-revisión',
      participant: OWNER,
      channel: 'typed_text',
      change: { kind: 'create_block', page, parent: null, position: 1, content: 'dos' },
    });
    if (outcome.status !== 'applied') throw new Error('no se aplicó');
    recordOperation(store, vuelto, outcome.operation);

    const held = store.db
      .prepare('SELECT operation_id FROM revisions WHERE operation_id = ?')
      .get(outcome.operation.id);
    assert.notEqual(held, undefined, 'la operación nueva dejó su revisión');
  });
});

/*
 * Una propiedad es de su sujeto y de ningún otro.
 *
 * El borrado previo a escribir decía `page_id IS ? OR block_id IS ?`, y como
 * toda propiedad de página lleva el bloque nulo, ese `OR` casaba con las
 * propiedades de página de **todo** el corpus: poner `type` en una página
 * borraba `type` de las mil novecientas restantes. En memoria no se veía —el
 * grafo lo hace bien y se reconstruye del registro—, así que la tabla se vaciaba
 * en silencio y sólo mentía a quien mirase la base por fuera.
 */
describe('materializar una propiedad', () => {
  it('poner una propiedad en una página no toca la de otra', () => {
    const { store, write } = freshStore();
    const una = write({ kind: 'create_page', title: 'Una', visibility: 'private' });
    const otra = write({ kind: 'create_page', title: 'Otra', visibility: 'private' });

    write({ kind: 'set_property', page: una, propertyKey: 'type', propertyValue: 'nota' });
    write({ kind: 'set_property', page: otra, propertyKey: 'type', propertyValue: 'proyecto' });

    assert.equal(count(store, 'property_assignments'), 2);
    const held = (
      store.db
        .prepare('SELECT page_id, value FROM property_assignments WHERE key = ? ORDER BY value')
        .all('type') as { page_id: string; value: string }[]
      // node:sqlite devuelve filas sin prototipo, y `deepEqual` estricto lo nota.
    ).map((row) => ({ page_id: row.page_id, value: row.value }));
    assert.deepEqual(held, [
      { page_id: una, value: 'nota' },
      { page_id: otra, value: 'proyecto' },
    ]);
  });

  it('ni la de un bloque de la misma página', () => {
    const { store, write } = freshStore();
    const page = write({ kind: 'create_page', title: 'Con bloque', visibility: 'private' });
    const block = write({ kind: 'create_block', page, parent: null, position: 0, content: 'algo' });

    write({ kind: 'set_property', page, propertyKey: 'explica', propertyValue: '[[X]]' });
    write({ kind: 'set_property', block, propertyKey: 'explica', propertyValue: '[[Y]]' });

    assert.equal(count(store, 'property_assignments'), 2);
  });

  it('y volver a ponerla la reemplaza en vez de duplicarla', () => {
    const { store, write } = freshStore();
    const page = write({ kind: 'create_page', title: 'Repetida', visibility: 'private' });
    write({ kind: 'set_property', page, propertyKey: 'status', propertyValue: 'draft' });
    write({ kind: 'set_property', page, propertyKey: 'status', propertyValue: 'vigente' });

    assert.equal(count(store, 'property_assignments'), 1);
    const held = store.db.prepare('SELECT value FROM property_assignments').get() as { value: string };
    assert.equal(held.value, 'vigente');
  });
});
