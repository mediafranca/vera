// La conexión entera, sin mentiras en medio.
//
// Un cliente MCP de verdad —el del SDK oficial— lanza vera-mcp como proceso,
// habla con él por tuberías, y vera-mcp le pregunta a una Vera de verdad, con su
// HTTP y su base de datos. Lo único que no es real aquí es que la base está en
// memoria y el corpus tiene una página.
//
// Existe porque las piezas por separado ya estaban probadas y eso no dice nada
// sobre si se conectan: el protocolo negocia versión, el proceso hereda el
// entorno, la salida estándar lleva JSON-RPC y basta un `console.log` suelto
// para que la conversación no arranque. Eso sólo se ve arrancándola.
//
// Ver specs/mcp-server.allium.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { listen } from '@vera/server';

const OWNER = 'participant:herbert';
const HERE = fileURLToPath(new URL('../src/main.ts', import.meta.url));

let vera: ReturnType<typeof listen>;
let client: Client;
let PORT: number;
let PAGE: string;

/*
 * Un puerto libre de verdad y no uno elegido a ojo.
 *
 * Con un número fijo, esta prueba falla cuando otra la adelanta o cuando queda
 * un proceso de la vez anterior: se conecta a la Vera equivocada y contesta
 * cosas que nadie escribió, que es la peor forma de fallar —parece un error del
 * adaptador y es del arnés—.
 */
const freePort = async (): Promise<number> =>
  new Promise((settle) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as { port: number }).port;
      probe.close(() => settle(port));
    });
  });

const said = (out: unknown): string =>
  ((out as { content: { type: string; text?: string }[] }).content ?? [])
    .map((one) => one.text ?? '')
    .join('');

const call = async (name: string, args: Record<string, unknown> = {}): Promise<string> =>
  said(await client.callTool({ name, arguments: args }));

before(async () => {
  PORT = await freePort();
  vera = listen({ port: PORT, databasePath: ':memory:', owner: { id: OWNER, name: 'Dueña' } });

  let n = 0;
  const write = async (change: unknown): Promise<string> => {
    n += 1;
    const response = await fetch(`http://127.0.0.1:${PORT}/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ originId: `mcp:${n}`, participant: OWNER, channel: 'typed_text', change }),
    });
    const json = (await response.json()) as { subjectId: string };
    assert.equal(response.status, 201, JSON.stringify(json));
    return json.subjectId;
  };

  PAGE = await write({ kind: 'create_page', title: 'La bitácora', visibility: 'private' });
  const first = await write({ kind: 'create_block', page: PAGE, parent: null, content: 'Un pensamiento' });
  await write({ kind: 'create_block', page: PAGE, parent: first, content: 'Y su matiz' });

  const agent = await fetch(`http://127.0.0.1:${PORT}/agents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'participant:mcp-test', name: 'MCP de prueba' }),
  });
  assert.equal(agent.status, 201, await agent.text());
  const issued = await fetch(`http://127.0.0.1:${PORT}/agents/credentials`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      participant: 'participant:mcp-test',
      scopes: ['read', 'write'],
      label: 'MCP de prueba',
    }),
  });
  const credential = (await issued.json()) as { secret?: string; error?: string };
  assert.equal(issued.status, 201, credential.error);
  assert.ok(credential.secret !== undefined);

  client = new Client({ name: 'la prueba', version: '0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['--experimental-strip-types', '--no-warnings', HERE],
      env: {
        ...process.env,
        VERA_URL: `http://127.0.0.1:${PORT}`,
        VERA_CLIENT: 'la prueba',
        VERA_TOKEN: credential.secret,
      },
    }),
  );
});

after(async () => {
  await client.close();
  await vera.close();
});

describe('vera-mcp por stdio', () => {
  it('arranca y ofrece su catálogo', async () => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 10);
    assert.ok(tools.some((tool) => tool.name === 'vera_preparar_escritura'));
    assert.equal(tools.find((tool) => tool.name === 'vera_escribir')?.annotations?.readOnlyHint, false);
    assert.ok(tools.filter((tool) => !tool.name.startsWith('vera_escribir')).every((tool) => tool.annotations?.readOnlyHint === true));
  });

  it('lo primero que contesta es quién eres y qué tamaño tiene esto', async () => {
    const answer = await call('vera_quien_soy');
    assert.match(answer, /Conectado a Vera/);
    assert.match(answer, /participant:mcp-test/);
    assert.match(answer, /read, write/);
    assert.match(answer, /1 páginas, 2 bloques/);
  });

  it('busca en el corpus y devuelve de dónde salió cada cosa', async () => {
    const answer = await call('vera_buscar', { consulta: 'matiz' });
    assert.match(answer, /Y su matiz/);
    assert.match(answer, /block:/);
  });

  it('lee una página con su sangría', async () => {
    const answer = await call('vera_leer_pagina', { pagina: 'La bitácora' });
    assert.match(answer, /# La bitácora/);
    assert.match(answer, /- \[block:\d+\] Un pensamiento\n {2}- \[block:\d+\] Y su matiz/);
  });

  it('escribe por la API y el cambio queda inmediatamente legible', async () => {
    const answer = await call('vera_escribir', {
      origen: 'mcp:connection:test:write',
      cambio: {
        kind: 'create_block',
        page: PAGE,
        parent: null,
        position: 1,
        content: 'Escrito por la puerta MCP',
      },
    });
    assert.match(answer, /Cambio aplicado/);
    assert.match(await call('vera_leer_pagina', { pagina: PAGE }), /Escrito por la puerta MCP/);
  });

  it('lo que no existe se contesta sin romper el turno', async () => {
    // Un error de protocolo corta al modelo; un resultado le deja corregir.
    const out = await client.callTool({
      name: 'vera_leer_pagina',
      arguments: { pagina: 'No escrita' },
    });
    assert.notEqual(out.isError, true);
    assert.match(said(out), /No hay ninguna página/);
  });

  it('una herramienta que no existe se dice, y no se inventa', async () => {
    const out = await client.callTool({ name: 'vera_borrar_todo', arguments: {} });
    assert.equal(out.isError, true);
    assert.match(said(out), /no tiene una herramienta/);
  });

  it('leer por MCP queda anotado en el registro de exposición', async () => {
    // @invariant NoDeliveryWithoutItsRecord, mirado desde el otro extremo del
    // cable: lo que un modelo se llevó tiene que poder verlo el dueño.
    await call('vera_leer_pagina', { pagina: 'La bitácora' });
    const found = (await (
      await fetch(`http://127.0.0.1:${PORT}/exposures?most=20`)
    ).json()) as { exposures: { surface: string; client: string | null; deliveredCount: number }[] };
    const mine = found.exposures.find((one) => one.surface === 'GET /pages/:id');
    assert.ok(mine !== undefined, 'la lectura no quedó anotada');
    assert.equal(mine.client, 'la prueba');
    assert.ok(mine.deliveredCount >= 3, 'la página y sus bloques tienen que quedar contados');
  });
});
