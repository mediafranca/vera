// Pruebas del servidor contra HTTP real, no contra el manejador en aislamiento.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { listen } from '../src/server.ts';

let base: string;
let running: ReturnType<typeof listen>;

const PORT = 4271;
const OWNER = 'participant:herbert';

before(() => {
  running = listen({ port: PORT, databasePath: ':memory:', owner: { id: OWNER, name: 'Dueña' } });
  base = `http://localhost:${PORT}`;
});

after(async () => {
  await running.close();
});

let counter = 0;
async function post(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${base}/operations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

async function postBatch(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${base}/operations/batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

async function write(change: unknown, origin?: string): Promise<string> {
  counter += 1;
  const { status, json } = await post({
    originId: origin ?? `http:${counter}`,
    participant: OWNER,
    channel: 'typed_text',
    change,
  });
  assert.equal(status, 201, `esperaba 201, fue ${status}: ${JSON.stringify(json)}`);
  return json['subjectId'] as string;
}

async function get(path: string): Promise<unknown> {
  const response = await fetch(`${base}${path}`);
  return response.json();
}

describe('ontología rectora de relaciones', () => {
  it('lee tipos estructurados desde VERA: Relaciones sin exigir restricciones', async () => {
    const page = await write({
      kind: 'create_page',
      stableId: 'page:test-relations-governing',
      title: 'VERA: Relaciones',
      visibility: 'private',
    });
    await write({ kind: 'set_property', page, propertyKey: 'special-kind', propertyValue: 'relations' });
    const block = await write({
      kind: 'create_block',
      stableId: 'block:test-relation-contradice',
      page,
      parent: null,
      position: 0,
      content: 'contradice',
    });
    await write({ kind: 'set_property', block, propertyKey: 'inversa', propertyValue: 'es contradicha por' });
    await write({ kind: 'set_property', block, propertyKey: 'dominio', propertyValue: 'Afirmación, Publicación' });
    await write({ kind: 'set_property', block, propertyKey: 'estado', propertyValue: 'aprobada' });
    const starter = await write({
      kind: 'create_block',
      stableId: 'block:test-relation-profundiza',
      page,
      parent: null,
      position: 1,
      content: 'profundiza',
    });
    await write({ kind: 'set_property', block: starter, propertyKey: 'inversa', propertyValue: 'es profundizada por' });

    const ontology = await get('/ontology') as {
      relations: { name: string; inverse: string; domain: string[]; range: string[] }[];
    };
    const contradice = ontology.relations.find((relation) => relation.name === 'contradice');
    assert.deepEqual(contradice, {
      block,
      name: 'contradice',
      inverse: 'es contradicha por',
      domain: ['Afirmación', 'Publicación'],
      range: [],
      symmetric: null,
      transitive: null,
      status: 'aprobada',
      says: null,
      external: [],
    });
  });
});

describe('modelos de procesamiento', () => {
  it('ofrece sólo identidades presentables y nunca rutas ni secretos', async () => {
    const result = await get('/processing/models') as {
      models: { id: string; name: string; provider: string; location: string; path?: string; key?: string }[];
    };
    assert.ok(Array.isArray(result.models));
    for (const model of result.models) {
      assert.match(model.id, /^(local|openai):/);
      assert.ok(model.name.length > 0);
      assert.ok(['local', 'openai'].includes(model.provider));
      assert.ok(['this_device', 'external'].includes(model.location));
      assert.equal(model.path, undefined);
      assert.equal(model.key, undefined);
    }
  });
});

describe('POST /operations', () => {
  it('aplica una operación válida y devuelve su secuencia', async () => {
    const { status, json } = await post({
      originId: 'op-uno',
      participant: OWNER,
      change: { kind: 'create_page', title: 'Amereida', visibility: 'private' },
    });
    assert.equal(status, 201);
    assert.equal(json['status'], 'applied');
    assert.equal(typeof json['sequence'], 'number');
  });

  it('devuelve duplicate al reenviar el mismo origin_id, sin aplicar dos veces', async () => {
    const change = { kind: 'create_page', title: 'Idempotente', visibility: 'private' };
    const first = await post({ originId: 'op-fijo', participant: OWNER, change });
    const second = await post({ originId: 'op-fijo', participant: OWNER, change });

    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.json['status'], 'duplicate');
    assert.equal(second.json['sequence'], first.json['sequence']);

    const pages = (await get('/pages')) as { title: string }[];
    assert.equal(pages.filter((p) => p.title === 'Idempotente').length, 1);
  });

  it('rechaza con 422 lo que el dominio no acepta', async () => {
    const { status, json } = await post({
      originId: 'op-sin-pagina',
      participant: OWNER,
      change: { kind: 'edit_block', block: 'no-existe', content: 'x' },
    });
    assert.equal(status, 422);
    assert.equal(json['status'], 'rejected');
  });

  it('rechaza con 400 un cuerpo malformado', async () => {
    assert.equal((await post({ participant: OWNER })).status, 400);
    assert.equal((await post({ originId: 'x', participant: OWNER })).status, 400);
    assert.equal(
      (await post({ originId: 'x', participant: OWNER, change: { kind: 'link_pages' } })).status,
      400,
      'link_pages ya no es parte del vocabulario',
    );
  });

  it('protege una página especial de borrado, recorrido y procesamiento', async () => {
    const page = await write({
      kind: 'create_page',
      title: 'VERA: Configuración protegida',
      visibility: 'private',
    });
    await write({
      kind: 'set_property',
      page,
      propertyKey: 'tipo',
      propertyValue: 'página especial',
    });

    const remove = await post({
      originId: 'special:remove',
      participant: OWNER,
      channel: 'typed_text',
      change: { kind: 'remove_page', page },
    });
    assert.equal(remove.status, 422);
    assert.match(String(remove.json['reason']), /no se puede eliminar/);

    const trail = await post({
      originId: 'special:trail',
      participant: OWNER,
      channel: 'typed_text',
      change: { kind: 'set_property', page, propertyKey: 'tipo', propertyValue: 'argumento' },
    });
    assert.equal(trail.status, 422);
    assert.match(String(trail.json['reason']), /no se puede leer como recorrido/);

    const processed = await fetch(`${base}/pages/${encodeURIComponent(page)}/process`, {
      method: 'POST',
    });
    assert.equal(processed.status, 422);
    assert.match(String(((await processed.json()) as { error: string }).error), /no se procesa/);
  });

  it('rechaza voz autenticada sin evidencia', async () => {
    const { status } = await post({
      originId: 'op-voz',
      participant: OWNER,
      channel: 'authenticated_voice',
      change: { kind: 'create_page', title: 'Dicha', visibility: 'private' },
    });
    assert.equal(status, 422);
  });

  it('acepta voz autenticada con evidencia', async () => {
    const { status } = await post({
      originId: 'op-voz-ok',
      participant: OWNER,
      channel: 'authenticated_voice',
      evidence: { reference: 'audio:sha256-abc', capturedAt: 1_754_000_000_000 },
      change: { kind: 'create_page', title: 'Dicha con prueba', visibility: 'private' },
    });
    assert.equal(status, 201);
  });

  // Antes esto llegaba al dominio y volvía 422 por falta de membresía. Ahora ni
  // llega: sin credencial sólo se escribe como el dueño, así que nombrar a otro
  // es un intento de suplantación y se rechaza en la frontera
  // (@invariant IdentityComesFromTheCredential). Que un desconocido no pueda
  // escribir sigue siendo cierto; lo que cambia es dónde se le dice que no.
  it('rechaza a quien dice ser otro participante', async () => {
    const { status, json } = await post({
      originId: 'op-ajeno',
      participant: 'participant:desconocido',
      change: { kind: 'create_page', title: 'Ajena', visibility: 'private' },
    });
    assert.equal(status, 403, JSON.stringify(json));
    assert.match(json['reason'] as string, /credencial/);
  });
});

describe('POST /operations/batch', () => {
  it('crea una página estructurada en una sola transacción y se reintenta entera', async () => {
    const body = {
      originId: 'batch:structured',
      participant: OWNER,
      changes: [
        { kind: 'create_page', stableId: 'page:batch-structured', title: 'Página por lote', visibility: 'private' },
        { kind: 'set_property', page: 'page:batch-structured', propertyKey: 'tipo', propertyValue: 'Nota' },
        { kind: 'create_block', stableId: 'block:batch-root', page: 'page:batch-structured', parent: null, position: 0, content: 'Raíz' },
        { kind: 'create_block', stableId: 'block:batch-child', page: 'page:batch-structured', parent: 'block:batch-root', position: 0, content: 'Hijo' },
      ],
    };
    const first = await postBatch(body);
    const second = await postBatch(body);
    assert.equal(first.status, 201, JSON.stringify(first.json));
    assert.equal(second.status, 200, JSON.stringify(second.json));
    assert.equal(first.json['status'], 'applied');
    assert.equal(second.json['status'], 'duplicate');
    assert.equal((first.json['operations'] as unknown[]).length, 4);
    const page = (await get('/pages/page%3Abatch-structured')) as { blocks: { stableId: string; parent: string | null }[] };
    assert.deepEqual(page.blocks.map((block) => [block.stableId, block.parent]), [
      ['block:batch-root', null],
      ['block:batch-child', 'block:batch-root'],
    ]);
  });

  it('no aplica el prefijo cuando un cambio posterior falla', async () => {
    const result = await postBatch({
      originId: 'batch:rejected',
      participant: OWNER,
      changes: [
        { kind: 'create_page', stableId: 'page:batch-never', title: 'No debe quedar', visibility: 'private' },
        { kind: 'create_page', stableId: 'page:batch-duplicate', title: 'Amereida', visibility: 'private' },
      ],
    });
    assert.equal(result.status, 422);
    const pages = (await get('/pages')) as { title: string }[];
    assert.equal(pages.some((page) => page.title === 'No debe quedar'), false);
  });
});

describe('GET /activity', () => {
  it('conserva una tumba restaurable con la identidad y el árbol borrados', async () => {
    const page = await write({
      kind: 'create_page', title: 'Página que vuelve', visibility: 'private', stableId: 'page:returns',
    });
    const root = await write({
      kind: 'create_block', page, parent: null, position: 0, content: 'raíz', stableId: 'block:returns-root',
    });
    const child = await write({
      kind: 'create_block', page, parent: root, position: 0, content: 'hijo', stableId: 'block:returns-child',
    });
    await write({ kind: 'set_property', page, propertyKey: 'estado', propertyValue: 'recordada' });
    await write({ kind: 'set_block_gloss', block: child, content: 'una glosa' });
    await write({ kind: 'remove_block', block: child });
    await write({ kind: 'remove_block', block: root });
    await write({ kind: 'remove_page', page });

    const view = (await get('/activity')) as {
      activity: { summary: string; excerpt: string | null; page: { id: string; title: string } | null }[];
      deletedPages: { page: string; restorable: boolean; changes: unknown[] }[];
    };
    const tomb = view.deletedPages.find((one) => one.page === page);
    assert.ok(tomb);
    assert.equal(tomb.restorable, true);
    assert.equal(
      view.activity.some((one) => one.page?.id === page),
      false,
      'la página borrada vive sólo en la pestaña de eliminaciones',
    );

    for (const change of tomb.changes) await write(change);
    const restored = (await get(`/pages/${encodeURIComponent(page)}`)) as {
      title: string;
      blocks: { stableId: string; parent: string | null; content: string }[];
      properties: { key: string; value: string }[];
      blockProperties: { block: string; key: string; value: string }[];
    };
    assert.equal(restored.title, 'Página que vuelve');
    assert.deepEqual(
      restored.blocks.map((one) => [one.stableId, one.parent, one.content]),
      [[root, null, 'raíz'], [child, root, 'hijo']],
    );
    assert.ok(restored.properties.some((one) => one.key === 'estado' && one.value === 'recordada'));

    await write({ kind: 'edit_block', block: child, content: 'contenido renovado para el registro' });
    const after = (await get('/activity')) as {
      activity: { excerpt: string | null; page: { id: string; title: string } | null }[];
    };
    assert.equal(after.activity[0]?.excerpt, 'contenido renovado para el registro');
    assert.deepEqual(after.activity[0]?.page, { id: page, title: 'Página que vuelve' });

    const mine = (await get(`/activity?participant=${encodeURIComponent(OWNER)}`)) as {
      participant: { id: string; name: string; kind: string } | null;
      activity: { participant: string; block: string | null }[];
      deletedPages: { participant: string }[];
    };
    assert.deepEqual(mine.participant, { id: OWNER, name: 'Dueña', kind: 'human' });
    assert.ok(mine.activity.length > 0);
    assert.ok(mine.activity.every((one) => one.participant === OWNER));
    assert.equal(mine.activity[0]?.block, child);
    assert.ok(mine.deletedPages.every((one) => one.participant === OWNER));
  });
});

describe('POST /mcp/discards', () => {
  it('aplica en una petición decisiones distintas sobre páginas marcadas', async () => {
    const gone = await write({
      kind: 'create_page',
      title: `Marcada para borrar ${Date.now()}`,
      visibility: 'private',
    });
    const parent = await write({
      kind: 'create_block',
      page: gone,
      parent: null,
      position: 0,
      content: 'padre',
    });
    await write({ kind: 'create_block', page: gone, parent, position: 0, content: 'hijo' });
    await write({
      kind: 'set_property',
      page: gone,
      propertyKey: 'por borrar',
      propertyValue: 'duplicada',
    });

    const kept = await write({
      kind: 'create_page',
      title: `Marcada para quedarse ${Date.now()}`,
      visibility: 'private',
    });
    await write({
      kind: 'set_property',
      page: kept,
      propertyKey: 'por borrar',
      propertyValue: 'duda resuelta',
    });

    const response = await fetch(`${base}/mcp/discards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        decisions: [
          { page: gone, decision: 'delete' },
          { page: kept, decision: 'keep' },
        ],
      }),
    });
    assert.equal(response.status, 200, await response.text());

    const pages = (await get('/pages')) as { id: string }[];
    assert.equal(pages.some((page) => page.id === gone), false);
    const keptView = (await get(`/pages/${encodeURIComponent(kept)}`)) as {
      properties: { key: string }[];
    };
    assert.equal(keptView.properties.some((one) => one.key === 'por borrar'), false);
  });
});

describe('lecturas', () => {
  it('entrega una página con sus bloques, propiedades y backlinks', async () => {
    const page = await write({ kind: 'create_page', title: 'Travesia', visibility: 'private' });
    await write({ kind: 'create_block', page, parent: null, position: 0, content: 'al desierto' });
    await write({ kind: 'set_property', page, propertyKey: 'lang', propertyValue: 'es' });

    const origin = await write({ kind: 'create_page', title: 'Origen', visibility: 'private' });
    await write({
      kind: 'create_block',
      page: origin,
      parent: null,
      position: 0,
      content: 'ver [[Travesia]]',
    });

    const detail = (await get(`/pages/${encodeURIComponent(page)}`)) as {
      title: string;
      blocks: { content: string }[];
      properties: { key: string; value: string }[];
      backlinks: { page: string; block: string }[];
    };

    assert.equal(detail.title, 'Travesia');
    assert.equal(detail.blocks.length, 1);
    assert.deepEqual(detail.properties, [{ key: 'lang', value: 'es' }]);
    assert.equal(detail.backlinks.length, 1);
    assert.equal(detail.backlinks[0]?.page, origin);
  });

  it('entrega la escritura antes que las lecturas derivadas del resto del grafo', async () => {
    const page = await write({ kind: 'create_page', title: 'Legible primero', visibility: 'private' });
    const block = await write({
      kind: 'create_block', page, parent: null, position: 0, content: 'texto que ya se puede editar',
    });
    await write({ kind: 'set_property', page, propertyKey: 'lang', propertyValue: 'es' });
    const origin = await write({ kind: 'create_page', title: 'La nombra', visibility: 'private' });
    await write({
      kind: 'create_block', page: origin, parent: null, position: 0, content: 'ver [[Legible primero]]',
    });

    const readable = (await get(`/pages/${encodeURIComponent(page)}?stage=readable`)) as {
      blocks: { stableId: string; parent: string | null; position: number; content: string }[];
      properties: { key: string; value: string }[];
      authorship: Record<string, unknown>;
      backlinks: unknown[];
      crossingsOut: unknown[];
    };

    assert.deepEqual(readable.blocks, [{
      stableId: block, parent: null, position: 0, content: 'texto que ya se puede editar',
    }]);
    assert.deepEqual(readable.properties, [{ key: 'lang', value: 'es' }]);
    assert.ok(readable.authorship[block], 'la procedencia necesaria para leer viaja en la primera fase');
    assert.deepEqual(readable.backlinks, []);
    assert.deepEqual(readable.crossingsOut, []);

    const complete = (await get(`/pages/${encodeURIComponent(page)}`)) as { backlinks: { page: string }[] };
    assert.ok(complete.backlinks.some((one) => one.page === origin));

    const enrichment = (await get(`/pages/${encodeURIComponent(page)}?stage=enrichment`)) as Record<string, unknown>;
    assert.ok((enrichment['backlinks'] as { page: string }[]).some((one) => one.page === origin));
    assert.equal('blocks' in enrichment, false, 'el enriquecimiento no retransmite la escritura');
    assert.equal('authorship' in enrichment, false, 'la procedencia legible tampoco viaja dos veces');
  });

  it('responde 404 para una página que no existe', async () => {
    const response = await fetch(`${base}/pages/no-existe`);
    assert.equal(response.status, 404);
  });

  it('busca sobre el grafo', async () => {
    await write({ kind: 'create_page', title: 'Buscable', visibility: 'private' });
    const hits = (await get('/search?q=Buscable')) as { page: string; field: string }[];
    assert.ok(hits.length >= 1);
    assert.equal(hits[0]?.field, 'page_title');
  });

  it('escribe, entrega y busca una glosa por la vía canónica', async () => {
    const page = await write({ kind: 'create_page', title: 'Glosada', visibility: 'private' });
    const block = await write({ kind: 'create_block', page, parent: null, position: 0, content: 'pasaje' });
    await write({ kind: 'set_block_gloss', block, content: 'hilván hospitalario' });

    const detail = (await get(`/pages/${encodeURIComponent(page)}`)) as {
      glosses: Record<string, { content: string }>;
    };
    assert.equal(detail.glosses[block]?.content, 'hilván hospitalario');

    const hits = (await get('/search?q=hospitalario')) as { block: string; field: string }[];
    assert.ok(hits.some((hit) => hit.block === block && hit.field === 'gloss_content'));

    const onlyGlosses = (await get('/glosses?q=hilv%C3%A1n')) as {
      count: number;
      matches: { block: string }[];
    };
    assert.ok(onlyGlosses.count >= 1);
    assert.ok(onlyGlosses.matches.some((match) => match.block === block));
  });

  it('deriva una relación cuando la glosa enlaza otra página', async () => {
    const target = await write({ kind: 'create_page', title: 'Destino glosado', visibility: 'private' });
    const source = await write({ kind: 'create_page', title: 'Origen glosado', visibility: 'private' });
    const block = await write({ kind: 'create_block', page: source, parent: null, position: 0, content: 'pasaje fuente' });
    await write({ kind: 'set_block_gloss', block, content: 'esta observación conduce a [[Destino glosado]]' });

    const outgoing = (await get(`/pages/${encodeURIComponent(source)}`)) as {
      crossingsOut: { toPage: string | null; said: string }[];
    };
    const incoming = (await get(`/pages/${encodeURIComponent(target)}`)) as {
      crossingsIn: { fromPage: string; said: string }[];
    };
    assert.ok(outgoing.crossingsOut.some((one) => one.toPage === target && /observación/.test(one.said)));
    assert.ok(incoming.crossingsIn.some((one) => one.fromPage === source && /observación/.test(one.said)));
  });

  it('una página concepto reúne declaraciones, enlaces y menciones potenciales', async () => {
    const concept = await write({ kind: 'create_page', title: 'Hospitalidad radical', visibility: 'private' });
    await write({ kind: 'set_property', page: concept, propertyKey: 'tipo', propertyValue: 'concepto' });

    const declared = await write({ kind: 'create_page', title: 'Declaración conceptual', visibility: 'private' });
    await write({ kind: 'set_property', page: declared, propertyKey: 'concepto', propertyValue: 'Hospitalidad radical' });
    const linked = await write({ kind: 'create_page', title: 'Enlace conceptual', visibility: 'private' });
    await write({ kind: 'create_block', page: linked, parent: null, position: 0, content: 'ver [[Hospitalidad radical]]' });
    const mentioned = await write({ kind: 'create_page', title: 'Mención conceptual', visibility: 'private' });
    await write({ kind: 'create_block', page: mentioned, parent: null, position: 0, content: 'la hospitalidad radical aparece sin enlace' });

    const detail = (await get(`/pages/${encodeURIComponent(concept)}`)) as {
      concept: { members: {
        page: string;
        declared: boolean;
        linked: boolean;
        mentioned: boolean;
        formalization: { block: string; next: string } | null;
      }[] };
    };
    assert.equal(detail.concept.members.find((one) => one.page === declared)?.declared, true);
    assert.equal(detail.concept.members.find((one) => one.page === linked)?.linked, true);
    assert.equal(detail.concept.members.find((one) => one.page === mentioned)?.mentioned, true);
    assert.match(
      detail.concept.members.find((one) => one.page === mentioned)?.formalization?.next ?? '',
      /\[\[hospitalidad radical\]\]/,
    );
    assert.equal(
      detail.concept.members.find((one) => one.page === linked)?.formalization,
      null,
    );
  });

  it('entrega el grafo en la forma que consume constel', async () => {
    const a = await write({ kind: 'create_page', title: 'NodoA', visibility: 'private' });
    await write({ kind: 'set_property', page: a, propertyKey: 'tipo', propertyValue: 'argumento' });
    const b = await write({ kind: 'create_page', title: 'NodoB', visibility: 'private' });
    await write({
      kind: 'create_block',
      page: a,
      parent: null,
      position: 0,
      content: 'ver [[NodoB]]',
    });
    const crossing = await write({
      kind: 'create_crossing', fromPage: a, toPage: b,
      content: 'La relación tiene una raíz.', term: 'desarrolla',
    });
    await write({
      kind: 'create_block', page: a, crossing, parent: null, position: 1,
      content: 'Y puede crecer como outline.',
    });

    const data = (await get(`/graph/${encodeURIComponent(a)}?depth=1`)) as {
      nodes: { id: string; name: string; central: boolean; trail: boolean; degree: number; blockCount: number }[];
      links: {
        source: string; target: string; kind?: string; crossing?: string;
        blocks?: { stableId: string; parent: string | null; position: number; content: string }[];
      }[];
    };

    const centre = data.nodes.find((n) => n.central);
    assert.equal(centre?.id, a);
    assert.equal(centre?.name, 'NodoA');
    assert.equal(centre?.trail, true);
    assert.ok(data.nodes.some((n) => n.name === 'NodoB'));
    assert.equal(data.links.length, 2);
    const explained = data.links.find((link) => link.kind === 'crossing');
    assert.equal(explained?.crossing, crossing);
    assert.deepEqual(explained?.blocks?.map((block) => block.content), [
      'La relación tiene una raíz.',
      'Y puede crecer como outline.',
    ]);
    for (const node of data.nodes) {
      assert.equal(typeof node.degree, 'number');
      assert.equal(typeof node.blockCount, 'number');
    }
  });

  it('entrega el log desde una secuencia', async () => {
    const all = (await get('/ops?since=0')) as { sequence: number }[];
    assert.ok(all.length > 0);
    const tail = (await get(`/ops?since=${all.length - 1}`)) as { sequence: number }[];
    assert.ok(tail.length < all.length);
    assert.ok(tail.every((op) => op.sequence > all.length - 1));
  });

  it('no reporta ninguna violación de invariante', async () => {
    assert.deepEqual(await get('/invariants'), []);
  });

  it('rechaza cualquier método que no sea GET o POST', async () => {
    const response = await fetch(`${base}/pages`, { method: 'DELETE' });
    assert.equal(response.status, 405);
  });
});

describe('persistencia entre arranques', () => {
  it('reconstruye el grafo del log al volver a abrir la base', async () => {
    const path = `${process.env['TMPDIR'] ?? '/tmp'}/vera-restart-${Date.now()}.sqlite`;
    const first = listen({ port: PORT + 1, databasePath: path, owner: { id: OWNER, name: 'Dueña' } });
    const response = await fetch(`http://localhost:${PORT + 1}/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        originId: 'persistente',
        participant: OWNER,
        change: { kind: 'create_page', title: 'Sobrevive', visibility: 'private' },
      }),
    });
    assert.equal(response.status, 201);
    await first.close();

    const second = listen({ port: PORT + 2, databasePath: path, owner: { id: OWNER, name: 'Dueña' } });
    const pages = (await (await fetch(`http://localhost:${PORT + 2}/pages`)).json()) as {
      title: string;
    }[];
    assert.ok(
      pages.some((p) => p.title === 'Sobrevive'),
      'lo escrito antes del cierre sigue ahí',
    );
    await second.close();
  });
});

/*
 * Preguntarle al grafo por HTTP.
 *
 * El evaluador llevaba meses construido y sin puerta; esto es la puerta. Ver
 * query-language.allium: la pregunta viaja en el cuerpo y no en la dirección,
 * porque una dirección se guarda y una consulta puede nombrar a una persona.
 */
describe('POST /query', () => {
  async function ask(source: string): Promise<Record<string, unknown>> {
    const response = await fetch(`${base}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source }),
    });
    assert.equal(response.status, 200, `esperaba 200 para «${source}»`);
    return (await response.json()) as Record<string, unknown>;
  }

  it('contesta con las páginas que la cumplen', async () => {
    const page = await write({ kind: 'create_page', title: 'Consultada', visibility: 'private' });
    // La pregunta usa la clave tal como está escrita en la página: no hay
    // traducción, y por eso un corpus en otra lengua se pregunta en la suya.
    await write({ kind: 'set_property', page, propertyKey: 'tipo', propertyValue: 'proyecto' });

    const answer = await ask('? tipo=proyecto');
    const pages = answer['pages'] as { id: string; title: string }[];
    assert.equal(answer['count'], 1);
    assert.equal(pages[0]?.id, page);
    assert.equal(pages[0]?.title, 'Consultada');
  });

  it('dice cómo se lee la respuesta sin cambiar lo que selecciona', async () => {
    const lista = await ask('? tipo=proyecto');
    const tabla = await ask('? tipo=proyecto ; tabla');
    assert.equal(lista['view'], 'list');
    assert.equal(tabla['view'], 'table');
    assert.equal(lista['count'], tabla['count']);
  });

  it('puede contestar con cada bloque coincidente en vez de agrupar por página', async () => {
    const page = await write({ kind: 'create_page', title: 'Con dos pasajes', visibility: 'private' });
    const first = await write({ kind: 'create_block', page, parent: null, position: 0, content: 'factura uno' });
    const second = await write({ kind: 'create_block', page, parent: null, position: 1, content: 'factura dos' });

    const answer = await ask('? ~factura ; bloques');
    const blocks = answer['blocks'] as { id: string; content: string; page: { id: string } }[];
    assert.equal(answer['view'], 'blocks');
    assert.equal(answer['count'], 2);
    assert.deepEqual(blocks.map((block) => block.id), [first, second]);
    assert.ok(blocks.every((block) => block.page.id === page));
  });

  it('cada página trae su tipo y cuándo se tocó por última vez', async () => {
    const page = await write({ kind: 'create_page', title: 'Fechada', visibility: 'private' });
    // «tipo» y no «type»: la clave la nombra el corpus, y sin ontología que diga
    // otra cosa rige la que Vera trae.
    await write({ kind: 'set_property', page, propertyKey: 'tipo', propertyValue: 'nota' });
    await write({ kind: 'set_property', page, propertyKey: 'sello', propertyValue: 'sí' });

    const answer = await ask('? sello=sí');
    const [first] = answer['pages'] as { type: string; updated: number }[];
    assert.equal(first?.type, 'nota');
    assert.equal(typeof first?.updated, 'number');
    assert.ok((first?.updated ?? 0) > 0);
  });

  it('una pregunta por texto dice dónde lo dice', async () => {
    const page = await write({ kind: 'create_page', title: 'Con pasaje', visibility: 'private' });
    await write({
      kind: 'create_block',
      page,
      parent: null,
      position: 0,
      content: 'hablamos de pictogramas y de otras cosas',
    });

    const answer = await ask('? ~pictogramas');
    const [first] = answer['pages'] as { says: { excerpt: string } | null }[];
    assert.match(first?.says?.excerpt ?? '', /pictogramas/);
  });

  it('una negación no enseña el bloque que niega', async () => {
    const page = await write({ kind: 'create_page', title: 'Sin nada', visibility: 'private' });
    await write({ kind: 'set_property', page, propertyKey: 'mudo', propertyValue: 'sí' });

    const answer = await ask('? mudo=sí + !~pictogramas');
    const [first] = answer['pages'] as { says: unknown }[];
    assert.equal(first?.says, null);
  });

  it('una pregunta que no se entiende dice qué y dónde, y no contesta cero', async () => {
    const answer = await ask('? tipo=a + tipo=b * tipo=c');
    assert.match(String(answer['error']), /paréntesis/);
    assert.equal(answer['count'], undefined);
    assert.equal(typeof answer['at'], 'number');
  });

  it('un texto que no se presenta como pregunta tampoco se contesta', async () => {
    const answer = await ask('tipo=proyecto');
    assert.match(String(answer['error']), /empieza por/);
  });

  it('preguntar no escribe nada', async () => {
    const before = (await get('/health')) as { lastSequence: number };
    await ask('? tipo=proyecto');
    await ask('? no se entiende esto');
    const after = (await get('/health')) as { lastSequence: number };
    assert.equal(after.lastSequence, before.lastSequence);
  });

  it('quien no es de este grafo no pregunta', async () => {
    const response = await fetch(`${base}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: '? tipo=proyecto', participant: 'participant:ajena' }),
    });
    assert.equal(response.status, 403);
  });
});

/*
 * Las dos columnas al pie de una página. Ver «La relación explicada» en
 * specs/trail.allium: entrantes y salientes, y la diferencia entre ellas es
 * quién lo dijo.
 */
describe('relaciones explicadas', () => {
  async function explain(page: string, from: string, said: string, target: string, term?: string) {
    const connective = await write({
      kind: 'create_block',
      page,
      parent: from,
      position: 0,
      content: said,
    });
    await write({
      kind: 'set_property',
      block: connective,
      propertyKey: 'explica',
      propertyValue: `[[${target}]]`,
    });
    if (term !== undefined) {
      await write({
        kind: 'set_property',
        block: connective,
        propertyKey: 'término',
        propertyValue: term,
      });
    }
    return connective;
  }

  it('la página que afirma la lleva como saliente, y la nombrada como entrante', async () => {
    const from = await write({ kind: 'create_page', title: 'PICTOS red', visibility: 'private' });
    const to = await write({ kind: 'create_page', title: 'Guemil red', visibility: 'private' });
    const said = await write({
      kind: 'create_block',
      page: from,
      parent: null,
      position: 0,
      content: 'toma la rejilla y la lleva a generación',
    });
    await explain(from, said, 'profundiza lo que aquél dejó planteado', 'Guemil red', 'profundiza');

    const salen = (await get(`/pages/${encodeURIComponent(from)}`)) as {
      crossingsOut: { title: string; reads: string; says: string }[];
      crossingsIn: unknown[];
    };
    assert.equal(salen.crossingsOut.length, 1);
    assert.equal(salen.crossingsOut[0]?.title, 'Guemil red');
    assert.equal(salen.crossingsOut[0]?.reads, 'profundiza');
    // La fila enseña el bloque desde el que se afirma: una relación sin su frase
    // es una flecha sin sujeto.
    assert.match(salen.crossingsOut[0]?.says ?? '', /rejilla/);
    assert.equal(salen.crossingsIn.length, 0);

    const entran = (await get(`/pages/${encodeURIComponent(to)}`)) as {
      crossingsIn: { title: string; reads: string }[];
    };
    assert.equal(entran.crossingsIn.length, 1);
    assert.equal(entran.crossingsIn[0]?.title, 'PICTOS red');
    // Un entrante se lee con el recíproco: lo que A afirma es que profundiza a
    // B, y lo que B lee es que es profundizada por A.
    assert.equal(entran.crossingsIn[0]?.reads, 'es profundizada por');
  });

  it('explicar es escribir: no hay operación propia', async () => {
    // Todo lo anterior pasó por POST /operations, como cualquier edición. Si
    // hubiera un camino propio, esta cuenta no cuadraría.
    const before = (await get('/health')) as { lastSequence: number };
    const page = await write({ kind: 'create_page', title: 'Cuenta red', visibility: 'private' });
    const said = await write({
      kind: 'create_block',
      page,
      parent: null,
      position: 0,
      content: 'algo',
    });
    await explain(page, said, 'se parece a aquello', 'Guemil red');
    const after = (await get('/health')) as { lastSequence: number };
    assert.equal(after.lastSequence - before.lastSequence, 4);
  });
});

/*
 * La identidad la puede acuñar quien crea, y por eso una mano no espera.
 *
 * Un cliente que aplica un cambio antes de enviarlo necesita saber cómo se llama
 * lo que ese cambio crea. Puede: `change-application.allium:189` admite que el
 * cambio traiga su `stable_id` y el dominio lo hace cumplir. Lo que faltaba era
 * que nada lo fijara: `readOperation` pasa el cambio entero sin mirarlo, así que
 * esto funcionaba por omisión y cualquier validación de forma que se añadiera
 * mañana lo tiraría sin que nadie se enterase.
 *
 * Ver specs/offline-reconciliation.allium y docs/plan-local-first.md.
 */
describe('la identidad que trae quien crea', () => {
  it('el bloque nace con el nombre que se le dio, y la respuesta lo confirma', async () => {
    const page = await write({ kind: 'create_page', title: 'Acuñada', visibility: 'private' });
    const said = await write({
      kind: 'create_block',
      page,
      parent: null,
      position: 0,
      content: 'lo escribí antes de preguntar',
      stableId: 'block:acunado-en-el-cliente',
    });
    assert.equal(said, 'block:acunado-en-el-cliente');

    // Y está donde dice estar: el nombre no es un eco de la petición.
    const view = (await get(`/pages/${page}`)) as { blocks: { stableId: string }[] };
    assert.ok(view.blocks.some((one) => one.stableId === 'block:acunado-en-el-cliente'));
  });

  it('una página también puede traer la suya', async () => {
    const said = await write({
      kind: 'create_page',
      title: 'Página acuñada',
      visibility: 'private',
      stableId: 'page:acunada-en-el-cliente',
    });
    assert.equal(said, 'page:acunada-en-el-cliente');
  });

  it('el nombre de una página tomado también se rechaza', async () => {
    await write({
      kind: 'create_page',
      title: 'Primera acuñada',
      visibility: 'private',
      stableId: 'page:repetida',
    });
    const { status, json } = await post({
      originId: 'http:pagina-repetida',
      channel: 'typed_text',
      change: {
        kind: 'create_page',
        title: 'Segunda acuñada',
        visibility: 'private',
        stableId: 'page:repetida',
      },
    });
    assert.equal(status, 422);
    assert.match(String(json['reason']), /page:repetida/);
  });

  it('sin nombre propio lo pone el servidor, que es lo que pasaba hasta ahora', async () => {
    const page = await write({ kind: 'create_page', title: 'Sin acuñar', visibility: 'private' });
    const said = await write({
      kind: 'create_block',
      page,
      parent: null,
      position: 0,
      content: 'x',
    });
    assert.match(said, /^block:/);
  });

  it('un nombre ya tomado se rechaza, y dice cuál', async () => {
    // @invariant StableIdentityAcrossApplication: ninguna regla asigna identidad
    // a un bloque que ya existe. Aceptar un nombre tomado sería crear escribiendo
    // encima, que es la manera de perder algo sin que quede en el registro.
    const page = await write({ kind: 'create_page', title: 'Repetida', visibility: 'private' });
    await write({
      kind: 'create_block',
      page,
      parent: null,
      position: 0,
      content: 'el primero',
      stableId: 'block:repetido',
    });
    const { status, json } = await post({
      originId: 'http:repetido',
      channel: 'typed_text',
      change: {
        kind: 'create_block',
        page,
        parent: null,
        position: 1,
        content: 'el segundo',
        stableId: 'block:repetido',
      },
    });
    assert.equal(status, 422);
    assert.equal(json['status'], 'rejected');
    assert.match(String(json['reason']), /block:repetido/);
  });

  it('reenviar el mismo origen no crea un segundo bloque con otro nombre', async () => {
    // Es lo que hace segura una bandeja de salida: el cliente puede reintentar
    // sin saber si lo anterior llegó. @invariant OriginIdentityIsTheIdempotencyKey.
    const page = await write({ kind: 'create_page', title: 'Reenviada', visibility: 'private' });
    const change = {
      kind: 'create_block',
      page,
      parent: null,
      position: 0,
      content: 'una sola vez',
      stableId: 'block:reenviado',
    };
    const first = await post({ originId: 'http:reenvio', channel: 'typed_text', change });
    const again = await post({ originId: 'http:reenvio', channel: 'typed_text', change });
    assert.equal(first.json['status'], 'applied');
    assert.equal(again.json['status'], 'duplicate');
    assert.equal(again.json['subjectId'], 'block:reenviado');

    const view = (await get(`/pages/${page}`)) as { blocks: unknown[] };
    assert.equal(view.blocks.length, 1);
  });
});
