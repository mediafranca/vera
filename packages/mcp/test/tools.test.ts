// Las herramientas de la puerta MCP.
//
// Se prueban contra una Vera de mentira: lo que se fija aquí es qué le pide cada
// herramienta a la API y cómo presenta lo que recibe. Que la API conteste bien
// es cosa de las pruebas del servidor; que un modelo pueda leer esto y citarlo
// es cosa de aquí.
//
// Ver specs/mcp-server.allium.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { connectionFrom } from '../src/client.ts';
import {
  TOOLS, outline, toolNamed, type Action, type Ask, type Context, type Propose, type Query, type Write, type WriteBatch,
} from '../src/tools.ts';

/** Una Vera de mentira que anota lo que le preguntan. */
function fakeVera(answers: Record<string, unknown>) {
  const asked: { path: string; parameters: unknown }[] = [];
  const ask: Ask = async (path, parameters) => {
    asked.push({ path, parameters: parameters ?? {} });
    const answer = answers[path];
    if (answer === undefined) return { error: 'no such route', status: 404 };
    return answer as never;
  };
  return { ask, asked };
}

const run = async (
  name: string,
  args: Record<string, unknown>,
  ask: Ask,
  write?: Write,
  query?: Query,
  propose?: Propose,
  action?: Action,
): Promise<string> => {
  const tool = toolNamed(name);
  assert.ok(tool !== undefined, `no existe la herramienta ${name}`);
  const result = await tool.run(args, ask, write, undefined, query, propose, action);
  return typeof result === 'string' ? result : result.text;
};

describe('el catálogo', () => {
  it('ofrece escritura, propuesta y descarte explícitamente destructivo', () => {
    assert.deepEqual(TOOLS.filter((tool) => tool.readOnly === false).map((tool) => tool.name), [
      'vera_reclamar_solicitud_bibliotecaria',
      'vera_progreso_solicitud_bibliotecaria',
      'vera_responder_solicitud_bibliotecaria',
      'vera_escribir',
      'vera_editar_bloque_propio',
      'vera_mover_bloque_propio',
      'vera_proponer_edicion',
      'vera_escribir_lote',
      'vera_descartar',
    ]);
    assert.deepEqual(TOOLS.filter((tool) => tool.destructive === true).map((tool) => tool.name), [
      'vera_responder_solicitud_bibliotecaria',
      'vera_descartar',
    ]);
    assert.deepEqual(
      TOOLS.map((tool) => tool.name).sort(),
      [
        'vera_buscar',
        'vera_consultar',
        'vera_contexto',
        'vera_descartar',
        'vera_editar_bloque_propio',
        'vera_escribir',
        'vera_escribir_lote',
        'vera_historia_bloque',
        'vera_indice',
        'vera_leer_pagina',
        'vera_mi_constitucion',
        'vera_mover_bloque_propio',
        'vera_ontologia',
        'vera_preparar_escritura',
        'vera_progreso_solicitud_bibliotecaria',
        'vera_proponer_edicion',
        'vera_quien_soy',
        'vera_reclamar_solicitud_bibliotecaria',
        'vera_responder_solicitud_bibliotecaria',
        'vera_solicitud_bibliotecaria',
        'vera_vecindario',
      ],
    );
  });

  it('cada herramienta se explica, porque de eso depende que se use bien', () => {
    for (const tool of TOOLS) {
      assert.ok(tool.description.length > 120, `${tool.name} se explica de menos`);
      assert.equal(tool.inputSchema.type, 'object');
      assert.equal(tool.inputSchema.additionalProperties, false);
    }
  });

  it('publica la gramática completa de cambios bibliotecarios en vez de Array<object>', () => {
    const tool = toolNamed('vera_responder_solicitud_bibliotecaria')!;
    const properties = tool.inputSchema['properties'] as Record<string, Record<string, unknown>>;
    const changes = properties['cambios']!;
    const variants = (changes['items'] as Record<string, unknown>)['oneOf'] as unknown[];
    assert.equal(variants.length, 14);
    assert.match(JSON.stringify(variants), /mover_bloque/);
    assert.match(JSON.stringify(variants), /definir_propiedad/);
    assert.match(JSON.stringify(variants), /crear_conectiva/);
  });
});

describe('ciclo de la bibliotecaria residente', () => {
  it('lee, reclama, informa y responde por rutas explícitas', async () => {
    const { ask, asked } = fakeVera({
      '/librarian/requests/agent-request%3A1': { id: 'agent-request:1', text: 'Investiga PICTOS' },
    });
    const actions: { path: string; body: Record<string, unknown> }[] = [];
    const action: Action = async (path, body = {}) => { actions.push({ path, body }); return { ok: true }; };
    assert.match(await run('vera_solicitud_bibliotecaria', { solicitud: 'agent-request:1' }, ask), /Investiga PICTOS/);
    assert.match(await run('vera_reclamar_solicitud_bibliotecaria', { solicitud: 'agent-request:1' }, ask,
      undefined, undefined, undefined, action), /reclamada/);
    assert.match(await run('vera_progreso_solicitud_bibliotecaria', {
      solicitud: 'agent-request:1', tipo: 'tool', texto: 'Leí la ontología',
    }, ask, undefined, undefined, undefined, action), /registrado/);
    assert.match(await run('vera_responder_solicitud_bibliotecaria', {
      solicitud: 'agent-request:1', texto: 'Síntesis fundada', relacion: 'derivada_de_la_persona',
      bloques: [
        { clave: 'sintesis', pagina: 'bitacora_hoy', contenido: 'PICTOS articula doctorado y talleres.' },
        { clave: 'talleres', padre: 'sintesis', contenido: 'Los talleres organizan tres frentes.' },
      ],
      cambios: [
        { tipo: 'mover_bloque', bloque: 'block:uno', pagina: 'page:uno', padre: null, posicion: 3 },
      ],
      revisiones: { 'block:uno': 'op:vigente' }, retiros: [],
    }, ask, undefined, undefined, undefined, action), /depositada/);
    assert.equal(asked[0]?.path, '/librarian/requests/agent-request%3A1');
    assert.deepEqual(actions.map((one) => one.path), [
      '/librarian/requests/agent-request%3A1/claim',
      '/librarian/requests/agent-request%3A1/progress',
      '/librarian/requests/agent-request%3A1/reply',
    ]);
    assert.deepEqual(actions.at(-1)?.body, {
      text: 'Síntesis fundada',
      blocks: [
        { key: 'sintesis', page: 'bitacora_hoy', content: 'PICTOS articula doctorado y talleres.' },
        { key: 'talleres', parent: 'sintesis', content: 'Los talleres organizan tres frentes.' },
      ],
      changes: [
        { kind: 'move_block', block: 'block:uno', page: 'page:uno', parent: null, position: 3 },
      ],
      ifRevisions: { 'block:uno': 'op:vigente' }, removals: [], lineageRelation: 'derived',
    });
  });
});

describe('quién soy', () => {
  it('dice con qué identidad se entró y con qué alcances', async () => {
    const { ask } = fakeVera({
      '/agents/whoami': {
        participant: 'participant:cotito',
        kind: 'agent',
        scopes: ['read', 'write'],
        label: 'Cotito · OpenClaw',
      },
      '/health': { graph: 'mind', libraryName: 'Biblioteca de Herbert', pages: 900, blocks: 40000, lastSequence: 123 },
    });
    const said = await run('vera_quien_soy', {}, ask);
    assert.match(said, /participant:cotito/);
    assert.match(said, /read, write/);
    assert.match(said, /900 páginas/);
    assert.match(said, /Biblioteca «Biblioteca de Herbert»/);
    assert.doesNotMatch(said, /mind/);
    // Se le dice al modelo lo que no puede hacer, o lo intenta.
    assert.match(said, /puede escribir/);
  });

  it('sin Vera, lo dice en vez de callarse', async () => {
    const { ask } = fakeVera({});
    const said = await run('vera_quien_soy', {}, ask);
    assert.match(said, /No pude leer eso/);
  });
});

describe('constitución propia', () => {
  it('lee sólo la puerta ligada a la credencial actual y presenta su digest', async () => {
    const { ask, asked } = fakeVera({
      '/agent-manifest': {
        summary: { version: 3, digest: 'abc123' },
        document: { agent: { id: 'participant:cotito', human: { id: 'participant:herbert' } }, constitution: [] },
      },
    });
    const said = await run('vera_mi_constitucion', {}, ask);
    assert.deepEqual(asked, [{ path: '/agent-manifest', parameters: {} }]);
    assert.match(said, /Constitución activa v3/);
    assert.match(said, /participant:herbert/);
  });
});

describe('escribir', () => {
  it('envía una operación canónica con una clave de idempotencia', async () => {
    const { ask } = fakeVera({});
    const written: { origin: string; change: Record<string, unknown> }[] = [];
    const write: Write = async (origin, change) => {
      written.push({ origin, change });
      return { status: 'applied', sequence: 77, subjectId: 'block:77' };
    };
    const said = await run('vera_escribir', {
      origen: 'codex:tarea:1',
      cambio: { kind: 'create_block', page: 'page:1', parent: null, position: 0, content: 'Texto' },
    }, ask, write);
    assert.deepEqual(written, [{
      origin: 'codex:tarea:1',
      change: { kind: 'create_block', page: 'page:1', parent: null, position: 0, content: 'Texto' },
    }]);
    assert.match(said, /Cambio aplicado/);
    assert.match(said, /operación 77/);
  });

  it('escribe frontmatter como propiedad canónica', async () => {
    const { ask } = fakeVera({});
    const written: Record<string, unknown>[] = [];
    const write: Write = async (_origin, change) => {
      written.push(change);
      return { status: 'applied', sequence: 78, subjectId: 'page:1' };
    };
    const said = await run('vera_escribir', {
      origen: 'codex:tarea:propiedad',
      cambio: {
        kind: 'set_property',
        page: 'page:1',
        propertyKey: 'concepto',
        propertyValue: 'AUT Legal Case',
      },
    }, ask, write);
    assert.deepEqual(written, [
      { kind: 'set_property', page: 'page:1', propertyKey: 'concepto', propertyValue: 'AUT Legal Case' },
    ]);
    assert.match(said, /Cambio aplicado/);
  });

  it('retira una propiedad obsoleta por la misma puerta auditable', async () => {
    const { ask } = fakeVera({});
    const written: Record<string, unknown>[] = [];
    const write: Write = async (_origin, change) => {
      written.push(change);
      return { status: 'applied', sequence: 79, subjectId: 'page:1' };
    };
    await run('vera_escribir', {
      origen: 'codex:tarea:retirar-propiedad',
      cambio: { kind: 'remove_property', page: 'page:1', propertyKey: 'conceptos' },
    }, ask, write);
    assert.deepEqual(written, [
      { kind: 'remove_property', page: 'page:1', propertyKey: 'conceptos' },
    ]);
  });

  it('rechaza edición y borrado antes de llamar a Vera', async () => {
    const { ask } = fakeVera({});
    let called = false;
    const write: Write = async () => {
      called = true;
      return { status: 'applied', sequence: 1, subjectId: 'block:1' };
    };
    const said = await run('vera_escribir', {
      origen: 'codex:tarea:2',
      cambio: { kind: 'edit_block', block: 'block:1', content: 'Pisado' },
    }, ask, write);
    assert.equal(called, false);
    assert.match(said, /sólo crea páginas y bloques o corrige propiedades/);
  });
});

describe('escribir por lote', () => {
  it('envía muchos cambios como un solo gesto idempotente', async () => {
    const { ask } = fakeVera({});
    const calls: { origin: string; changes: readonly Record<string, unknown>[] }[] = [];
    const batch: WriteBatch = async (origin, changes) => {
      calls.push({ origin, changes });
      return {
        status: 'applied',
        operations: [
          { sequence: 80, subjectId: 'page:lote' },
          { sequence: 81, subjectId: 'block:lote' },
        ],
      };
    };
    const changes = [
      { kind: 'create_page', stableId: 'page:lote', title: 'Lote', visibility: 'private' },
      { kind: 'create_block', stableId: 'block:lote', page: 'page:lote', parent: null, position: 0, content: 'Texto' },
    ];
    const tool = toolNamed('vera_escribir_lote');
    assert.ok(tool !== undefined);
    const said = await tool.run({ origen: 'claude:lote:1', cambios: changes }, ask, undefined, batch);
    assert.deepEqual(calls, [{ origin: 'claude:lote:1', changes }]);
    assert.match(said, /2 cambios/);
    assert.match(said, /80–81/);
  });
});

describe('preparar una escritura', () => {
  it('entrega juntas la guía viva y la ontología vigente', async () => {
    const page = {
      id: 'page:guide',
      title: 'VERA — Escritura por agentes',
      visibility: 'private',
      createdAt: 0,
      lastEditedAt: 0,
      properties: [],
      blocks: [{ stableId: 'block:rule', parent: null, position: 0, content: 'Una idea por bloque.' }],
      backlinks: [],
      references: [],
      authorship: {},
    };
    const { ask, asked } = fakeVera({
      '/pages/VERA%20%E2%80%94%20Escritura%20por%20agentes': page,
      '/ontology': { names: { kind: 'tipo', topic: 'concepto' } },
    });
    const said = await run('vera_preparar_escritura', {}, ask);
    assert.deepEqual(asked.map((one) => one.path).sort(), [
      '/ontology',
      '/pages/VERA%20%E2%80%94%20Escritura%20por%20agentes',
    ]);
    assert.match(said, /Una idea por bloque/);
    assert.match(said, /"topic": "concepto"/);
  });
});

describe('descartar', () => {
  const page = {
    id: 'page:limpieza', title: 'Limpieza', visibility: 'private', createdAt: 0, lastEditedAt: 0,
    properties: [], backlinks: [], references: [], authorship: {},
    blocks: [
      { stableId: 'block:root', parent: null, position: 0, content: 'Viejo', revision: 'operation:root' },
      { stableId: 'block:child', parent: 'block:root', position: 0, content: 'Más viejo', revision: 'operation:child' },
      { stableId: 'block:keep', parent: null, position: 1, content: 'Conservar', revision: 'operation:keep' },
    ],
  };

  it('retira un subárbol de hojas a raíz en un lote auditable', async () => {
    const { ask } = fakeVera({ '/pages/page%3Alimpieza': page });
    const calls: {
      origin: string;
      changes: readonly Record<string, unknown>[];
      ifRevisions?: Readonly<Record<string, string>>;
    }[] = [];
    const batch: WriteBatch = async (origin, changes, ifRevisions) => {
      calls.push({ origin, changes, ifRevisions });
      return { status: 'applied', operations: changes.map((_, at) => ({ sequence: 90 + at, subjectId: `gone:${at}` })) };
    };
    const tool = toolNamed('vera_descartar');
    assert.ok(tool !== undefined);
    const said = await tool.run({
      origen: 'agente:limpieza:1', pagina: 'page:limpieza', bloque: 'block:root', bloques_confirmados: 2,
    }, ask, undefined, batch);
    assert.deepEqual(calls, [{
      origin: 'agente:limpieza:1',
      changes: [
        { kind: 'remove_block', block: 'block:child' },
        { kind: 'remove_block', block: 'block:root' },
      ],
      ifRevisions: {
        'block:child': 'operation:child',
        'block:root': 'operation:root',
      },
    }]);
    assert.match(typeof said === 'string' ? said : said.text, /2 bloques/);
  });

  it('si cambió la cantidad no aplica nada', async () => {
    const { ask } = fakeVera({ '/pages/page%3Alimpieza': page });
    let called = false;
    const batch: WriteBatch = async () => {
      called = true;
      return { status: 'applied', operations: [] };
    };
    const tool = toolNamed('vera_descartar');
    assert.ok(tool !== undefined);
    const said = await tool.run({
      origen: 'agente:limpieza:2', pagina: 'page:limpieza', bloque: 'block:root', bloques_confirmados: 1,
    }, ask, undefined, batch);
    assert.equal(called, false);
    assert.match(typeof said === 'string' ? said : said.text, /No se borró nada/);
  });
});

describe('buscar', () => {
  it('cada extracto viaja con su página y su bloque, para poder citarlo', async () => {
    const { ask, asked } = fakeVera({
      '/search': [
        { page: 'page:1', block: 'block:9', field: 'content', excerpt: 'la memoria es del dueño',
          score: 410, signals: [{ kind: 'coverage', contribution: 300, detail: '1/1' },
            { kind: 'field_class', contribution: 110, detail: 'contenido' }], rank: 1 },
      ],
    });
    const said = await run('vera_buscar', { consulta: 'memoria' }, ask);
    assert.deepEqual(asked[0], { path: '/search', parameters: { q: 'memoria' } });
    assert.match(said, /page:1/);
    assert.match(said, /block:9/);
    assert.match(said, /la memoria es del dueño/);
    assert.match(said, /score 410/);
    assert.match(said, /coverage \+300/);
  });

  it('cuando hay más de lo que cabe, dice cuánto no enseñó', async () => {
    // Un tope callado se lee como «esto es todo lo que hay».
    const many = Array.from({ length: 30 }, (_, at) => ({
      page: `page:${at}`,
      block: null,
      field: 'title',
      excerpt: `resultado ${at}`,
      score: 100 - at,
      signals: [{ kind: 'coverage', contribution: 100 - at, detail: '1/1' }],
      rank: at + 1,
    }));
    const { ask } = fakeVera({ '/search': many });
    const said = await run('vera_buscar', { consulta: 'x', cuantos: 5 }, ask);
    assert.match(said, /25 más sin mostrar/);
  });

  it('nada encontrado no es un fallo', async () => {
    const { ask } = fakeVera({ '/search': [] });
    assert.match(await run('vera_buscar', { consulta: 'zzz' }, ask), /Nada en el corpus/);
  });
});

describe('consultar', () => {
  it('entrega la respuesta estructurada y conserva el cursor', async () => {
    const calls: unknown[] = [];
    const query: Query = async (input) => {
      calls.push(input);
      return {
        view: 'table',
        asked: '? tipo=proyecto ; tabla',
        count: 3,
        cursor: 0,
        limit: 2,
        nextCursor: 2,
        more: 1,
        pages: [{ id: 'page:1', title: 'Uno' }, { id: 'page:2', title: 'Dos' }],
      };
    };
    const said = await run(
      'vera_consultar',
      { consulta: '? tipo=proyecto ; tabla', cuantos: 2 },
      fakeVera({}).ask,
      undefined,
      query,
    );
    assert.deepEqual(calls, [{ source: '? tipo=proyecto ; tabla', cursor: 0, limit: 2 }]);
    assert.match(said, /3 resultados/);
    assert.match(said, /cursor_siguiente: 2/);
  });
});

describe('contexto verificable', () => {
  it('delega en la API canónica y conserva el recibo estructurado', async () => {
    const calls: Array<{ path: string; body?: Record<string, unknown> }> = [];
    const context: Context = async (body) => {
      calls.push({ path: '/context', body });
      return {
        version: 3,
        participant: 'participant:alumnus-exemplar',
        request: '¿Qué sostiene esta idea?',
        within: ['page:axis'],
        page: { id: 'page:axis', title: 'Axis Mundae' },
        items: [{ kind: 'block', id: 'block:1' }],
        relations: [],
        used: { characters: 900, identities: 2 },
        omitted: { pageBlocks: 0, libraryPages: 0 },
        warnings: [],
        continuation: null,
        selection: { budgetCharacters: 8000 },
      };
    };
    const tool = toolNamed('vera_contexto')!;
    const result = await tool.run({
      pagina: 'Axis Mundae', pregunta: '¿Qué sostiene esta idea?', presupuesto: 8000,
    }, fakeVera({}).ask, undefined, undefined, undefined, undefined, undefined, context);
    assert.deepEqual(calls, [{
      path: '/context',
      body: { page: 'Axis Mundae', request: '¿Qué sostiene esta idea?', budgetCharacters: 8000 },
    }]);
    assert.equal(typeof result, 'object');
    assert.equal(typeof result === 'string' ? null : result.structured.participant, 'participant:alumnus-exemplar');
  });
});

describe('leer una página', () => {
  const page = {
    id: 'page:7',
    title: 'Vera',
    visibility: 'private',
    createdAt: 0,
    lastEditedAt: 1_700_000_000_000,
    properties: [{ key: 'tipo', value: 'proyecto' }],
    blocks: [
      { stableId: 'b1', parent: null, position: 1, content: 'Primero' },
      { stableId: 'b2', parent: 'b1', position: 1, content: 'Dentro del primero' },
      { stableId: 'b3', parent: null, position: 2, content: 'Segundo' },
    ],
    backlinks: [{ page: 'page:8', block: null, title: 'Otra', excerpt: 'habla de Vera' }],
    references: [{ page: null, title: 'Sin escribir', block: 'b1', excerpt: '' }],
    authorship: {
      b3: { participant: 'participant:cotito', kind: 'agent', channel: 'agent_generation' },
      b1: { participant: 'participant:claude', kind: 'agent', channel: 'agent_generation' },
    },
  };

  it('conserva la sangría, que es lo que dice de quién es hijo qué', async () => {
    const { ask } = fakeVera({ '/pages/Vera': page });
    const said = await run('vera_leer_pagina', { pagina: 'Vera' }, ask);
    assert.match(said, /- \[b1\] Primero\n {2}- \[b2\] Dentro del primero\n- \[b3\] Segundo/);
  });

  it('pone cada identidad junto al bloque en orden de lectura', async () => {
    const { ask } = fakeVera({ '/pages/Vera': page });
    const said = await run('vera_leer_pagina', { pagina: 'Vera' }, ask);
    assert.ok(said.indexOf('[b1]') < said.indexOf('[b2]'));
    assert.ok(said.indexOf('[b2]') < said.indexOf('[b3]'));
  });

  it('dice qué bloques escribió una máquina', async () => {
    // @invariant GeneratedContentIsAlwaysDistinguishable: distinguir lo escrito
    // de lo generado tiene que costar lo mismo que leer.
    const { ask } = fakeVera({ '/pages/Vera': page });
    const said = await run('vera_leer_pagina', { pagina: 'Vera' }, ask);
    assert.match(said, /Escrito por agentes/);
    assert.match(said, /b3 · participant:cotito/);
  });

  it('ordena también el pie de autoría según la lectura y no según la creación', async () => {
    const { ask } = fakeVera({ '/pages/Vera': page });
    const said = await run('vera_leer_pagina', { pagina: 'Vera' }, ask);
    assert.ok(said.lastIndexOf('b1 · participant:claude') < said.lastIndexOf('b3 · participant:cotito'));
  });

  it('una página que no existe se contesta con qué hacer en su lugar', async () => {
    const { ask } = fakeVera({});
    const said = await run('vera_leer_pagina', { pagina: 'Nada' }, ask);
    assert.match(said, /vera_buscar/);
  });

  it('un enlace a una página aún sin escribir se dice como lo que es', async () => {
    const { ask } = fakeVera({ '/pages/Vera': page });
    const said = await run('vera_leer_pagina', { pagina: 'Vera', con_vecinos: true }, ask);
    assert.match(said, /Sin escribir \(aún sin escribir\)/);
  });

  it('pide un tramo o subárbol y comunica cómo continuar', async () => {
    const paged = {
      ...page,
      blocks: [{ ...page.blocks[1], depth: 1, revision: 'operation:2' }],
      window: { root: 'b1', cursor: 1, limit: 1, total: 2, nextCursor: null },
    };
    const { ask, asked } = fakeVera({ '/pages/Vera': paged });
    const said = await run(
      'vera_leer_pagina',
      { pagina: 'Vera', desde_bloque: 'b1', cursor: 1, cuantos: 1 },
      ask,
    );
    assert.deepEqual(asked[0], {
      path: '/pages/Vera',
      parameters: { stage: 'readable', root: 'b1', cursor: 1, limit: 1 },
    });
    assert.match(said, /\[b2 @ operation:2\]/);
    assert.match(said, /1 de 2 bloques/);
  });
});

describe('corregir un bloque propio', () => {
  it('envía texto y revisión por la puerta canónica', async () => {
    const calls: unknown[] = [];
    const write: Write = async (origin, change, revision, ownOnly) => {
      calls.push({ origin, change, revision, ownOnly });
      return { status: 'applied', sequence: 99, subjectId: 'block:mine' };
    };
    const said = await run('vera_editar_bloque_propio', {
      origen: 'claude:edit:1',
      bloque: 'block:mine',
      revision: 'operation:8',
      contenido: 'Texto corregido',
    }, fakeVera({}).ask, write);
    assert.deepEqual(calls, [{
      origin: 'claude:edit:1',
      revision: 'operation:8',
      ownOnly: true,
      change: { kind: 'edit_block', block: 'block:mine', content: 'Texto corregido' },
    }]);
    assert.match(said, /Bloque corregido/);
  });
});

describe('mover un bloque propio', () => {
  it('envía estructura y revisión sin cambiar palabras', async () => {
    const calls: unknown[] = [];
    const write: Write = async (origin, change, revision, ownOnly) => {
      calls.push({ origin, change, revision, ownOnly });
      return { status: 'applied', sequence: 100, subjectId: 'block:mine' };
    };
    const said = await run('vera_mover_bloque_propio', {
      origen: 'claude:move:1', bloque: 'block:mine', revision: 'operation:9',
      pagina: 'page:2', padre: null, posicion: 3,
    }, fakeVera({}).ask, write);
    assert.deepEqual(calls, [{
      origin: 'claude:move:1', revision: 'operation:9', ownOnly: true,
      change: { kind: 'move_block', block: 'block:mine', page: 'page:2', parent: null, position: 3 },
    }]);
    assert.match(said, /Bloque movido/);
  });
});

describe('proponer una edición', () => {
  it('deja una intención revisable sin usar la puerta de escritura', async () => {
    const calls: unknown[] = [];
    const propose: Propose = async (input) => {
      calls.push(input);
      return { status: 'awaiting_review', proposal: 'review-proposal:1', page: 'page:1', block: input.block };
    };
    const said = await run('vera_proponer_edicion', {
      origen: 'claude:proposal:1', bloque: 'block:human', revision: 'operation:8',
      contenido: 'Texto sugerido', proposito: 'Corregir una fecha',
    }, fakeVera({}).ask, undefined, undefined, propose);
    assert.deepEqual(calls, [{
      originId: 'claude:proposal:1', block: 'block:human', revision: 'operation:8',
      content: 'Texto sugerido', purpose: 'Corregir una fecha',
    }]);
    assert.match(said, /Propuesta enviada a revisión/);
    assert.match(said, /corpus no cambió/);
  });
});

describe('la historia de un bloque', () => {
  it('trae también lo que ya no está en la página', async () => {
    const { ask } = fakeVera({
      '/blocks/block%3A3/history': {
        block: 'block:3',
        alive: false,
        now: null,
        states: [
          { sequence: 1, at: 0, by: 'Herbert', channel: 'typed_text', what: 'nació', content: 'lo primero' },
          { sequence: 2, at: 1000, by: 'Herbert', channel: 'typed_text', what: 'se borró', content: null },
        ],
      },
    });
    const said = await run('vera_historia_bloque', { bloque: 'block:3' }, ask);
    assert.match(said, /está borrado/);
    assert.match(said, /lo primero/);
  });
});

describe('el vecindario', () => {
  it('viene ordenado por cercanía, que es el orden en que se lee un mapa', async () => {
    const { ask, asked } = fakeVera({
      '/graph/Vera': {
        nodes: [
          { id: 'page:3', title: 'Lejos', distance: 2, degree: 1 },
          { id: 'page:2', title: 'Cerca', distance: 1, degree: 9 },
        ],
      },
    });
    const said = await run('vera_vecindario', { pagina: 'Vera', profundidad: 3 }, ask);
    assert.deepEqual(asked[0]?.parameters, { depth: 3 });
    assert.ok(said.indexOf('Cerca') < said.indexOf('Lejos'));
  });

  it('la profundidad se acota: pedir 40 saltos es pedir el corpus entero', async () => {
    const { ask, asked } = fakeVera({ '/graph/Vera': { nodes: [] } });
    await run('vera_vecindario', { pagina: 'Vera', profundidad: 40 }, ask);
    assert.deepEqual(asked[0]?.parameters, { depth: 4 });
  });
});

describe('la sangría', () => {
  it('un bloque de varias líneas se sangra entero', () => {
    const said = outline([
      { stableId: 'a', parent: null, position: 1, content: 'uno\ndos' },
      { stableId: 'b', parent: 'a', position: 1, content: 'dentro' },
    ]);
    assert.equal(said, '- uno\n- dos\n  - dentro');
  });

  it('el orden lo da la posición y no el orden en que llegaron', () => {
    const said = outline([
      { stableId: 'b', parent: null, position: 2, content: 'segundo' },
      { stableId: 'a', parent: null, position: 1, content: 'primero' },
    ]);
    assert.equal(said, '- primero\n- segundo');
  });
});

describe('de dónde sale la credencial', () => {
  it('puede descifrar una credencial de systemd sin poner el secreto en la configuración', () => {
    const connection = connectionFrom(
      {
        VERA_SYSTEMD_CREDENTIAL_FILE: '/credenciales/vera-codex.cred',
        VERA_SYSTEMD_CREDENTIAL_NAME: 'vera-codex',
        VERA_TOKEN: 'del-entorno',
      },
      () => '',
      (file, name) => {
        assert.equal(file, '/credenciales/vera-codex.cred');
        assert.equal(name, 'vera-codex');
        return '  descifrado\n';
      },
    );
    assert.equal(connection.token, 'descifrado');
  });

  it('una credencial cifrada rota falla cerrada y nunca cae al dueño por loopback', () => {
    assert.throws(
      () =>
        connectionFrom(
          {
            VERA_SYSTEMD_CREDENTIAL_FILE: '/credenciales/rota.cred',
            VERA_SYSTEMD_CREDENTIAL_NAME: 'rota',
            VERA_TOKEN: 'no debe usarse',
          },
          () => '',
          () => {
            throw new Error('no abre');
          },
        ),
      /no se pudo abrir la credencial cifrada/,
    );
  });

  it('de un archivo antes que del entorno', () => {
    // Una variable de entorno se hereda a todo lo que el proceso lance; un
    // archivo con permisos, no.
    const connection = connectionFrom(
      { VERA_TOKEN_FILE: '/donde/sea', VERA_TOKEN: 'del-entorno' },
      () => '  del-archivo\n',
    );
    assert.equal(connection.token, 'del-archivo');
  });

  it('si el archivo no está, se usa el entorno', () => {
    const connection = connectionFrom({ VERA_TOKEN_FILE: '/no/existe', VERA_TOKEN: 'del-entorno' }, () => {
      throw new Error('nope');
    });
    assert.equal(connection.token, 'del-entorno');
  });

  it('sin credencial se entra igual, que es lo que pasa en casa', () => {
    const connection = connectionFrom({}, () => '');
    assert.equal(connection.token, null);
    assert.equal(connection.url, 'http://127.0.0.1:4173');
  });
});
