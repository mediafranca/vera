// Pruebas de specs/confined-writing.allium contra HTTP real.
//
// Lo que se comprueba no es que las rutas contesten, sino que el cerco aguante
// bajo intento: que una credencial cercada plante donde debe, que no salga, que
// no borre ni con el alcance puesto, y que lo que planta nazca marcado por Vera
// y no por ella.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { listen } from '../src/server.ts';

const PORT = 4281;
const OWNER = 'participant:herbert';
const MACHINE = 'participant:chatgpt';

let base: string;
let running: ReturnType<typeof listen>;

before(() => {
  running = listen({ port: PORT, databasePath: ':memory:', owner: { id: OWNER, name: 'Dueño' } });
  base = `http://localhost:${PORT}`;
});

after(async () => {
  await running.close();
});

let counter = 0;

interface Reply {
  status: number;
  json: Record<string, unknown>;
}

async function call(
  path: string,
  options: { method?: string; body?: unknown; secret?: string } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.secret !== undefined) headers['authorization'] = `Bearer ${options.secret}`;
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  return { status: response.status, json: text === '' ? {} : (JSON.parse(text) as Reply['json']) };
}

const submit = async (change: unknown, secret?: string): Promise<Reply> => {
  counter += 1;
  return call('/operations', {
    method: 'POST',
    body: { originId: `prueba:${counter}`, channel: 'typed_text', change },
    ...(secret === undefined ? {} : { secret }),
  });
};

/** Una credencial cercada a una clase, con su procedencia. */
async function fenced(
  scopes: string[],
  kind = 'Nota de máquina',
  source: string | null = 'chatgpt',
): Promise<string> {
  await call('/agents', { method: 'POST', body: { id: MACHINE, name: 'ChatGPT' } });
  const issued = await call('/agents/credentials', {
    method: 'POST',
    body: { participant: MACHINE, scopes, label: `cercada ${counter}` },
  });
  const id = issued.json['id'] as string;
  const granted = await call(`/agents/credentials/${id}/confinement`, {
    method: 'POST',
    body: { kind, source },
  });
  assert.equal(granted.status, 200, JSON.stringify(granted.json));
  return issued.json['secret'] as string;
}

describe('una credencial cercada planta lo suyo', () => {
  it('crea una página, y nace con la clase y la procedencia que el cerco dice', async () => {
    const secret = await fenced(['read', 'write']);
    const born = await submit(
      { kind: 'create_page', title: `Plantada ${Date.now()}`, visibility: 'private' },
      secret,
    );
    assert.equal(born.status, 201, JSON.stringify(born.json));

    // @invariant TheKindAndTheSourceComeFromTheFence: las pone Vera, no el agente.
    const page = born.json['subjectId'] as string;
    const view = await call(`/pages/${encodeURIComponent(page)}`);
    const properties = view.json['properties'] as { key: string; value: string }[];
    assert.equal(properties.find((one) => one.key === 'tipo')?.value, 'Nota de máquina');
    assert.equal(properties.find((one) => one.key === 'fuente')?.value, 'chatgpt');
  });

  it('escribe dentro de la que plantó', async () => {
    const secret = await fenced(['read', 'write']);
    const born = await submit(
      { kind: 'create_page', title: `Propia ${Date.now()}`, visibility: 'private' },
      secret,
    );
    const page = born.json['subjectId'] as string;
    const wrote = await submit(
      { kind: 'create_block', page, parent: null, position: 0, content: 'lo que averigüé' },
      secret,
    );
    assert.equal(wrote.status, 201, JSON.stringify(wrote.json));
  });
});

describe('y no sale de ahí', () => {
  it('no escribe en una página que escribió una persona', async () => {
    const secret = await fenced(['read', 'write']);
    const mine = await submit({
      kind: 'create_page',
      title: `Mía ${Date.now()}`,
      visibility: 'private',
    });
    const page = mine.json['subjectId'] as string;

    const tried = await submit(
      { kind: 'create_block', page, parent: null, position: 0, content: 'me meto' },
      secret,
    );
    assert.equal(tried.status, 403, JSON.stringify(tried.json));
    // @guarantee RefusalsSayWhy: la negativa nombra el cerco.
    assert.match(String(tried.json['reason']), /cerco/);
  });

  it('no edita un bloque de una página ajena, aunque nombre el bloque y no la página', async () => {
    const secret = await fenced(['read', 'write']);
    const mine = await submit({
      kind: 'create_page',
      title: `Ajena ${Date.now()}`,
      visibility: 'private',
    });
    const page = mine.json['subjectId'] as string;
    const block = await submit({
      kind: 'create_block',
      page,
      parent: null,
      position: 0,
      content: 'mío',
    });

    const tried = await submit(
      { kind: 'edit_block', block: block.json['subjectId'], content: 'pisado' },
      secret,
    );
    assert.equal(tried.status, 403, JSON.stringify(tried.json));
  });
});

describe('borrar no, ni con el alcance puesto', () => {
  it('rechaza remove_page teniendo discard, y ofrece la marca', async () => {
    // @invariant TheFenceOutranksTheScope: el cerco manda sobre el alcance.
    const secret = await fenced(['read', 'write', 'discard']);
    const born = await submit(
      { kind: 'create_page', title: `Para borrar ${Date.now()}`, visibility: 'private' },
      secret,
    );
    const page = born.json['subjectId'] as string;

    const tried = await submit({ kind: 'remove_page', page }, secret);
    assert.equal(tried.status, 403, JSON.stringify(tried.json));
    // @invariant TheRefusalOffersTheMark
    assert.match(String(tried.json['reason']), /marca|marcar/);
  });

  it('rechaza remove_block en su propia página', async () => {
    const secret = await fenced(['read', 'write', 'discard']);
    const born = await submit(
      { kind: 'create_page', title: `Con bloque ${Date.now()}`, visibility: 'private' },
      secret,
    );
    const page = born.json['subjectId'] as string;
    const block = await submit(
      { kind: 'create_block', page, parent: null, position: 0, content: 'sobra' },
      secret,
    );

    const tried = await submit({ kind: 'remove_block', block: block.json['subjectId'] }, secret);
    assert.equal(tried.status, 403, JSON.stringify(tried.json));
  });

  it('en cambio marca su propia página, con su motivo', async () => {
    const secret = await fenced(['read', 'write']);
    const born = await submit(
      { kind: 'create_page', title: `Marcable ${Date.now()}`, visibility: 'private' },
      secret,
    );
    const page = born.json['subjectId'] as string;

    const marked = await submit(
      {
        kind: 'set_property',
        page,
        propertyKey: 'por borrar',
        propertyValue: 'ya está integrado en la página del proyecto',
      },
      secret,
    );
    assert.equal(marked.status, 201, JSON.stringify(marked.json));

    // @invariant AMarkDecidesNothing: la página sigue entera.
    const view = await call(`/pages/${encodeURIComponent(page)}`);
    assert.equal(view.status, 200);
    const properties = view.json['properties'] as { key: string; value: string }[];
    assert.match(
      String(properties.find((one) => one.key === 'por borrar')?.value),
      /integrado/,
    );
  });

  it('no marca una página ajena: marcar es escribir, y escribir está cercado', async () => {
    // @invariant AMarkOnlyReachesItsOwnPages
    const secret = await fenced(['read', 'write']);
    const mine = await submit({
      kind: 'create_page',
      title: `No marcable ${Date.now()}`,
      visibility: 'private',
    });
    const tried = await submit(
      {
        kind: 'set_property',
        page: mine.json['subjectId'],
        propertyKey: 'por borrar',
        propertyValue: 'esto no es suyo',
      },
      secret,
    );
    assert.equal(tried.status, 403, JSON.stringify(tried.json));
  });
});

describe('el cerco es de la credencial y no del participante', () => {
  it('sin cerco se sigue escribiendo donde sea', async () => {
    // @invariant AnUnfencedCredentialIsUnchanged: Cotito no pierde nada.
    await call('/agents', { method: 'POST', body: { id: 'participant:cotito', name: 'Cotito' } });
    const issued = await call('/agents/credentials', {
      method: 'POST',
      body: { participant: 'participant:cotito', scopes: ['read', 'write'], label: 'sin cerco' },
    });
    const secret = issued.json['secret'] as string;

    const mine = await submit({
      kind: 'create_page',
      title: `De la casa ${Date.now()}`,
      visibility: 'private',
    });
    const wrote = await submit(
      {
        kind: 'create_block',
        page: mine.json['subjectId'],
        parent: null,
        position: 0,
        content: 'escribo donde quiera',
      },
      secret,
    );
    assert.equal(wrote.status, 201, JSON.stringify(wrote.json));
  });

  it('quitar el cerco amplía: la misma credencial pasa a escribir fuera', async () => {
    const secret = await fenced(['read', 'write']);
    const mine = await submit({
      kind: 'create_page',
      title: `Antes vedada ${Date.now()}`,
      visibility: 'private',
    });
    const page = mine.json['subjectId'] as string;

    const before = await submit(
      { kind: 'create_block', page, parent: null, position: 0, content: 'no' },
      secret,
    );
    assert.equal(before.status, 403);

    const credentials = await call('/agents/credentials');
    const list = credentials.json as unknown as { id: string; confinement: unknown }[];
    const fence = list.find((one) => one.confinement !== null);
    assert.ok(fence !== undefined, 'el cerco viaja con su credencial');
    await call(`/agents/credentials/${fence.id}/confinement`, { method: 'DELETE' });

    const after = await submit(
      { kind: 'create_block', page, parent: null, position: 1, content: 'ahora sí' },
      secret,
    );
    assert.equal(after.status, 201, JSON.stringify(after.json));
  });
});

describe('cercar es cosa del dueño', () => {
  it('una credencial no se cerca ni se descerca a sí misma', async () => {
    const secret = await fenced(['read', 'write']);
    const credentials = await call('/agents/credentials');
    const list = credentials.json as unknown as { id: string }[];
    const any = list[0];
    assert.ok(any !== undefined);

    const tried = await call(`/agents/credentials/${any.id}/confinement`, {
      method: 'DELETE',
      secret,
    });
    assert.equal(tried.status, 403, JSON.stringify(tried.json));
  });
});

describe('conectar una IA es un solo acto', () => {
  /** La página que gobierna la puerta, sin la cual una conexión no tiene dónde vivir. */
  async function door(): Promise<string> {
    const born = await submit({
      kind: 'create_page',
      title: `Puerta ${Date.now()}`,
      visibility: 'private',
    });
    const page = born.json['subjectId'] as string;
    await submit({
      kind: 'set_property',
      page,
      propertyKey: 'special-kind',
      propertyValue: 'connections',
    });
    await submit({
      kind: 'create_block',
      page,
      parent: null,
      position: 0,
      content: '# Conexiones',
    });
    return page;
  }

  it('deja identidad, credencial, cerco y fila, y entrega el secreto una vez', async () => {
    await door();
    const made = await call('/mcp/connections', {
      method: 'POST',
      body: { name: 'ChatGPT', client: 'chatgpt', deal: 'propio', kind: 'Nota de máquina' },
    });
    assert.equal(made.status, 201, JSON.stringify(made.json));

    // La identidad se deriva de cómo se declara: no se pide dos veces lo mismo.
    assert.equal(made.json['participant'], 'participant:chatgpt');
    assert.match(String(made.json['secret']), /^vera_ag_/);

    // Y el secreto sirve, con el cerco puesto: escribe lo suyo y no borra.
    const secret = made.json['secret'] as string;
    const born = await submit(
      { kind: 'create_page', title: `Suya ${Date.now()}`, visibility: 'private' },
      secret,
    );
    assert.equal(born.status, 201, JSON.stringify(born.json));
    const dropped = await submit({ kind: 'remove_page', page: born.json['subjectId'] }, secret);
    assert.equal(dropped.status, 403);

    // La fila quedó escrita, con lo que la declara.
    const listed = await call('/mcp');
    const connections = listed.json['connections'] as Record<string, unknown>[];
    const row = connections.find((one) => one['client'] === 'chatgpt');
    assert.ok(row !== undefined, 'la conexión tiene fila en la página de la puerta');
    assert.equal(row['participant'], 'participant:chatgpt');
    assert.equal(row['permission'], 'escribe en lo suyo');
  });

  it('lo que se rechaza no deja media conexión detrás', async () => {
    /*
     * Un cerco sin clase se rechaza, y se rechaza antes de emitir nada.
     *
     * Es lo que hace que este acto compuesto se pueda reintentar: si la negativa
     * llegara después de emitir, cada intento fallido dejaría una credencial
     * viva que nadie pidió y que nadie sabe que existe.
     */
    await door();
    const before = ((await call('/agents/credentials')).json as unknown as unknown[]).length;
    const tried = await call('/mcp/connections', {
      method: 'POST',
      body: { name: 'Sin clase', client: 'sin-clase', deal: 'propio' },
    });
    assert.equal(tried.status, 400, JSON.stringify(tried.json));
    const after = ((await call('/agents/credentials')).json as unknown as unknown[]).length;
    assert.equal(after, before, 'no quedó ninguna credencial huérfana');
  });

  it('un trato que no existe se rechaza en vez de interpretarse', async () => {
    await door();
    const tried = await call('/mcp/connections', {
      method: 'POST',
      body: { name: 'Raro', client: 'raro', deal: 'lo que sea' },
    });
    assert.equal(tried.status, 400, JSON.stringify(tried.json));
  });
});
