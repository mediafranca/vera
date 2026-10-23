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
let OWNER_BLOCK: string;
let AGENT_SECRET: string;

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
  OWNER_BLOCK = first;
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
  AGENT_SECRET = credential.secret;

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
    assert.equal(tools.length, 12);
    assert.ok(tools.some((tool) => tool.name === 'vera_preparar_escritura'));
    assert.ok(tools.some((tool) => tool.name === 'vera_consultar'));
    assert.equal(tools.find((tool) => tool.name === 'vera_escribir')?.annotations?.readOnlyHint, false);
    assert.equal(tools.find((tool) => tool.name === 'vera_editar_bloque_propio')?.annotations?.readOnlyHint, false);
    assert.ok(
      tools
        .filter((tool) => !['vera_escribir', 'vera_escribir_lote', 'vera_editar_bloque_propio'].includes(tool.name))
        .every((tool) => tool.annotations?.readOnlyHint === true),
    );
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
    assert.match(answer, /- \[block:\d+ @ op:\d+\] Un pensamiento\n {2}- \[block:\d+ @ op:\d+\] Y su matiz/);
  });

  it('continúa una página desde el cursor sin repetir el bloque anterior', async () => {
    const first = await client.callTool({
      name: 'vera_leer_pagina',
      arguments: { pagina: 'La bitácora', cuantos: 1 },
    });
    const firstStructured = first.structuredContent as {
      blocks?: { stableId: string; depth: number }[];
      window?: { nextCursor: number | null };
    };
    assert.equal(firstStructured.blocks?.length, 1);
    assert.equal(firstStructured.window?.nextCursor, 1);

    const second = await client.callTool({
      name: 'vera_leer_pagina',
      arguments: { pagina: 'La bitácora', cursor: 1, cuantos: 1 },
    });
    const secondStructured = second.structuredContent as {
      blocks?: { stableId: string; depth: number }[];
      window?: { nextCursor: number | null };
    };
    assert.equal(secondStructured.blocks?.length, 1);
    assert.notEqual(secondStructured.blocks?.[0]?.stableId, firstStructured.blocks?.[0]?.stableId);
    assert.equal(secondStructured.blocks?.[0]?.depth, 1);
    assert.equal(secondStructured.window?.nextCursor, null);
  });

  it('consulta la estructura y entrega contenido estructurado paginado', async () => {
    const out = await client.callTool({
      name: 'vera_consultar',
      arguments: { consulta: '? ~pensamiento ; bloques', cuantos: 1 },
    });
    const structured = out.structuredContent as {
      view?: string;
      count?: number;
      blocks?: { id: string }[];
      nextCursor?: number | null;
    };
    assert.equal(structured.view, 'blocks');
    assert.equal(structured.count, 1);
    assert.equal(structured.blocks?.[0]?.id, OWNER_BLOCK);
    assert.equal(structured.nextCursor ?? null, null);
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

  it('corrige sólo palabras propias con la revisión exacta y falla cerrado ante conflicto', async () => {
    const created = await call('vera_escribir', {
      origen: 'mcp:connection:test:editable',
      cambio: {
        kind: 'create_block',
        page: PAGE,
        parent: null,
        position: 2,
        content: 'Borrador del agente',
      },
    });
    const id = /(?:block:[^,\s]+)/.exec(created)?.[0];
    assert.ok(id !== undefined, created);

    const read = await client.callTool({
      name: 'vera_leer_pagina',
      arguments: { pagina: PAGE, cuantos: 20 },
    });
    const blocks = (read.structuredContent as {
      blocks?: { stableId: string; revision: string | null; content: string }[];
    }).blocks ?? [];
    const mine = blocks.find((block) => block.stableId === id);
    const owner = blocks.find((block) => block.stableId === OWNER_BLOCK);
    assert.ok(mine?.revision !== null && mine?.revision !== undefined, JSON.stringify(blocks));
    assert.ok(owner?.revision !== null && owner?.revision !== undefined, JSON.stringify(blocks));

    const changed = await call('vera_editar_bloque_propio', {
      origen: 'mcp:connection:test:edit-own',
      bloque: id,
      revision: mine.revision,
      contenido: 'Versión corregida del agente',
    });
    assert.match(changed, /Bloque corregido/);

    const stale = await call('vera_editar_bloque_propio', {
      origen: 'mcp:connection:test:edit-stale',
      bloque: id,
      revision: mine.revision,
      contenido: 'No debe aplicarse',
    });
    assert.match(stale, /conflicto de revisión/);

    const foreign = await call('vera_editar_bloque_propio', {
      origen: 'mcp:connection:test:edit-foreign',
      bloque: OWNER_BLOCK,
      revision: owner.revision,
      contenido: 'No debe tocar palabras humanas',
    });
    assert.match(foreign, /sólo permite a un agente corregir sus propias palabras/);

    const final = await call('vera_leer_pagina', { pagina: PAGE, cuantos: 20 });
    assert.match(final, /Versión corregida del agente/);
    assert.doesNotMatch(final, /No debe aplicarse/);
    assert.match(final, /Un pensamiento/);
  });

  it('una credencial administrativa conserva escritura amplia, pero nunca sin revisión', async () => {
    const read = await client.callTool({
      name: 'vera_leer_pagina',
      arguments: { pagina: PAGE, cuantos: 20 },
    });
    const owner = ((read.structuredContent as {
      blocks?: { stableId: string; revision: string | null }[];
    }).blocks ?? []).find((block) => block.stableId === OWNER_BLOCK);
    assert.ok(owner?.revision !== null && owner?.revision !== undefined);

    const withoutRevision = await fetch(`http://127.0.0.1:${PORT}/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${AGENT_SECRET}` },
      body: JSON.stringify({
        originId: 'mcp:connection:test:admin-no-revision',
        change: { kind: 'edit_block', block: OWNER_BLOCK, content: 'No debe entrar' },
      }),
    });
    assert.equal(withoutRevision.status, 428, await withoutRevision.text());

    const withRevision = await fetch(`http://127.0.0.1:${PORT}/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${AGENT_SECRET}` },
      body: JSON.stringify({
        originId: 'mcp:connection:test:admin-with-revision',
        ifRevision: owner.revision,
        change: { kind: 'edit_block', block: OWNER_BLOCK, content: 'Edición administrativa versionada' },
      }),
    });
    assert.equal(withRevision.status, 201, await withRevision.text());
    assert.match(await call('vera_leer_pagina', { pagina: PAGE }), /Edición administrativa versionada/);
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
    const mine = found.exposures.find((one) => one.surface === 'GET /pages/:id?stage=readable');
    assert.ok(mine !== undefined, 'la lectura no quedó anotada');
    assert.equal(mine.client, 'la prueba');
    assert.ok(mine.deliveredCount >= 3, 'la página y sus bloques tienen que quedar contados');
  });
});
