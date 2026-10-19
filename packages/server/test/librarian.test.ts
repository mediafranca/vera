import { createServer as createHttpServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { listen } from '../src/server.ts';

const PORT = 4292;
const OWNER = 'participant:herbert';
const COTITO = 'participant:cotito';
let running: ReturnType<typeof listen>;
let base: string;
let secret = '';
let page = '';
let block = '';
let requestId = '';
let origin = 0;

async function call(path: string, options: { method?: string; body?: unknown; secret?: string } = {}) {
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(options.secret === undefined ? {} : { authorization: `Bearer ${options.secret}` }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  return { status: response.status, json: await response.json() as Record<string, unknown> };
}

async function write(change: unknown): Promise<string> {
  origin += 1;
  const reply = await call('/operations', {
    method: 'POST',
    body: { originId: `librarian:${origin}`, participant: OWNER, change },
  });
  assert.equal(reply.status, 201, JSON.stringify(reply.json));
  return reply.json['subjectId'] as string;
}

before(async () => {
  running = listen({ port: PORT, databasePath: ':memory:', owner: { id: OWNER, name: 'Herbert' } });
  base = `http://127.0.0.1:${PORT}`;
  assert.equal((await call('/agents', { method: 'POST', body: { id: COTITO, name: 'Cotito' } })).status, 201);
  const issued = await call('/agents/credentials', {
    method: 'POST', body: { participant: COTITO, scopes: ['read', 'write'], label: 'bibliotecario' },
  });
  secret = issued.json['secret'] as string;
  page = await write({ kind: 'create_page', title: 'Página para preguntar', visibility: 'private' });
  block = await write({
    kind: 'create_block', stableId: 'block:librarian-focus', page, parent: null,
    content: 'Este bloque necesita contexto', position: 0,
  });
});

after(async () => { await running.close(); });

describe('solicitudes al bibliotecario', () => {
  it('conserva una cola FIFO durable y nunca entrega dos turnos a la vez', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vera-librarian-queue-'));
    const databasePath = join(directory, 'vera.sqlite');
    const queuePort = 4325;
    const hookPort = 4326;
    const wakes: string[] = [];
    const hook = createHttpServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk.toString();
      wakes.push((JSON.parse(body) as { requestId: string }).requestId);
      response.writeHead(202).end();
    });
    await new Promise<void>((resolve) => hook.listen(hookPort, '127.0.0.1', resolve));

    let queued = listen({
      port: queuePort,
      databasePath,
      owner: { id: OWNER, name: 'Herbert' },
      librarianHook: { url: `http://127.0.0.1:${hookPort}/wake`, token: 'test-hook-token' },
    });
    const queueBase = `http://127.0.0.1:${queuePort}`;
    const queueCall = async (path: string, options: { method?: string; body?: unknown; secret?: string } = {}) => {
      const response = await fetch(`${queueBase}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          'content-type': 'application/json',
          ...(options.secret === undefined ? {} : { authorization: `Bearer ${options.secret}` }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      return { status: response.status, json: await response.json() as Record<string, unknown> };
    };
    const waitForWakes = async (count: number): Promise<void> => {
      for (let attempt = 0; attempt < 50 && wakes.length < count; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(wakes.length, count);
    };

    try {
      assert.equal((await queueCall('/agents', {
        method: 'POST', body: { id: COTITO, name: 'Cotito' },
      })).status, 201);
      const issued = await queueCall('/agents/credentials', {
        method: 'POST', body: { participant: COTITO, scopes: ['read', 'write'], label: 'cola' },
      });
      const queueSecret = issued.json['secret'] as string;
      const pageReply = await queueCall('/operations', {
        method: 'POST',
        body: {
          originId: 'queue:page', participant: OWNER,
          change: { kind: 'create_page', title: 'Cola durable', visibility: 'private' },
        },
      });
      const queuePage = pageReply.json['subjectId'] as string;

      const first = await queueCall('/librarian/requests', {
        method: 'POST', body: { pageId: queuePage, text: 'Primera solicitud' },
      });
      const firstId = first.json['id'] as string;
      assert.equal(first.json['dispatchStatus'], 'delivered');
      await waitForWakes(1);

      const second = await queueCall('/librarian/requests', {
        method: 'POST', body: { pageId: queuePage, text: 'Segunda solicitud' },
      });
      const secondId = second.json['id'] as string;
      assert.equal(second.json['dispatchStatus'], 'pending');
      assert.deepEqual(wakes, [firstId]);
      assert.equal((await queueCall(`/librarian/requests/${encodeURIComponent(secondId)}/claim`, {
        method: 'POST', secret: queueSecret,
      })).status, 409);

      await queued.close();
      queued = listen({
        port: queuePort,
        databasePath,
        owner: { id: OWNER, name: 'Herbert' },
        librarianHook: { url: `http://127.0.0.1:${hookPort}/wake`, token: 'test-hook-token' },
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.deepEqual(wakes, [firstId]);

      assert.equal((await queueCall(`/librarian/requests/${encodeURIComponent(firstId)}/claim`, {
        method: 'POST', secret: queueSecret,
      })).status, 200);
      assert.equal((await queueCall(`/librarian/requests/${encodeURIComponent(secondId)}/claim`, {
        method: 'POST', secret: queueSecret,
      })).status, 409);

      assert.equal((await queueCall(`/librarian/requests/${encodeURIComponent(firstId)}/reply`, {
        method: 'POST', secret: queueSecret, body: { text: 'Primera respuesta', changes: [] },
      })).status, 201);
      await waitForWakes(2);
      assert.deepEqual(wakes, [firstId, secondId]);
      assert.equal((await queueCall(`/librarian/requests/${encodeURIComponent(secondId)}/claim`, {
        method: 'POST', secret: queueSecret,
      })).status, 200);
    } finally {
      await queued.close();
      await new Promise<void>((resolve, reject) => hook.close((error) => error === undefined ? resolve() : reject(error)));
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('guarda el pedido y su contexto antes de intentar despertarlo', async () => {
    const created = await call('/librarian/requests', {
      method: 'POST', body: { pageId: page, blockId: block, text: 'Ordénalo sin perder su sentido' },
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    requestId = created.json['id'] as string;
    assert.equal(created.json['status'], 'queued');
    assert.equal(created.json['dispatchStatus'], 'failed');
    assert.match(String(created.json['contextSnapshot']), /Este bloque necesita contexto/);
  });

  it('sólo Cotito autenticado puede reclamar y responder', async () => {
    assert.equal((await call(`/librarian/requests/${encodeURIComponent(requestId)}/claim`, { method: 'POST' })).status, 403);
    const claimed = await call(`/librarian/requests/${encodeURIComponent(requestId)}/claim`, { method: 'POST', secret });
    assert.equal(claimed.status, 200, JSON.stringify(claimed.json));
    assert.equal(claimed.json['status'], 'working');
    const commentary = await call(`/librarian/requests/${encodeURIComponent(requestId)}/reply`, {
      method: 'POST', secret, body: { text: 'Propongo separar evidencia e interpretación.', changes: [] },
    });
    assert.equal(commentary.status, 400);
    const answered = await call(`/librarian/requests/${encodeURIComponent(requestId)}/reply`, {
      method: 'POST', secret, body: {
        text: 'Separé evidencia e interpretación.',
        changes: [{ kind: 'edit_block', block, content: 'Evidencia. Interpretación.' }],
      },
    });
    assert.equal(answered.status, 201, JSON.stringify(answered.json));
    assert.equal(answered.json['status'], 'answered');
    assert.equal((answered.json['reply'] as Record<string, unknown>)['answeredBy'], COTITO);
    const pageView = await call(`/pages/${encodeURIComponent(page)}`);
    assert.match(JSON.stringify(pageView.json), /Evidencia\. Interpretación\./);
  });

  it('permite responder sobre un bloque documental mayor que 64 KiB', async () => {
    const largeBlock = await write({
      kind: 'create_block', page, parent: null, position: 1,
      content: `Transcripción\n${'pasaje documentado '.repeat(4_000)}`,
    });
    const created = await call('/librarian/requests', {
      method: 'POST', body: { pageId: page, blockId: largeBlock, text: 'Añade una lectura editorial' },
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const largeRequestId = created.json['id'] as string;
    assert.equal((await call(`/librarian/requests/${encodeURIComponent(largeRequestId)}/claim`, {
      method: 'POST', secret,
    })).status, 200);
    const content = `Lectura editorial\n${'pasaje documentado '.repeat(4_000)}`;
    const answered = await call(`/librarian/requests/${encodeURIComponent(largeRequestId)}/reply`, {
      method: 'POST', secret,
      body: { text: 'Añadí la lectura.', changes: [{ kind: 'edit_block', block: largeBlock, content }] },
    });
    assert.equal(answered.status, 201, JSON.stringify(answered.json));
    const pageView = await call(`/pages/${encodeURIComponent(page)}`);
    assert.match(JSON.stringify(pageView.json), /Lectura editorial/);
  });

  it('la respuesta vuelve a la página y al bloque de origen', async () => {
    const listed = await call(`/librarian/requests?page=${encodeURIComponent(page)}&block=${encodeURIComponent(block)}`);
    assert.equal(listed.status, 200);
    const requests = listed.json as unknown as Record<string, unknown>[];
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.['id'], requestId);
    assert.equal(requests[0]?.['sourceBlockId'], block);
  });

  it('quien hizo el pedido puede eliminar la conversación auxiliar', async () => {
    assert.equal((await call(`/librarian/requests/${encodeURIComponent(requestId)}`, {
      method: 'DELETE', secret,
    })).status, 403);
    assert.equal((await call(`/librarian/requests/${encodeURIComponent(requestId)}`, {
      method: 'DELETE',
    })).status, 200);
    assert.equal((await call(`/librarian/requests/${encodeURIComponent(requestId)}`)).status, 404);
  });

  it('escribe una respuesta sobre la página como bloque ordinario, editable y atribuido', async () => {
    const created = await call('/librarian/requests', {
      method: 'POST', body: { pageId: page, text: 'Investiga y deja la respuesta en la página' },
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const pageRequest = created.json['id'] as string;
    assert.equal((await call(`/librarian/requests/${encodeURIComponent(pageRequest)}/claim`, {
      method: 'POST', secret,
    })).status, 200);
    const answered = await call(`/librarian/requests/${encodeURIComponent(pageRequest)}/reply`, {
      method: 'POST', secret, body: { text: 'Respuesta extensa del bibliotecario.', changes: [] },
    });
    assert.equal(answered.status, 201, JSON.stringify(answered.json));

    const blockId = `block:librarian-reply:${pageRequest.slice('agent-request:'.length)}`;
    let pageView = await call(`/pages/${encodeURIComponent(page)}`);
    assert.match(JSON.stringify(pageView.json), /Respuesta extensa del bibliotecario\./);
    const authorship = pageView.json['authorship'] as Record<string, Record<string, unknown>>;
    assert.equal(authorship[blockId]?.['participant'], COTITO);
    assert.equal(authorship[blockId]?.['channel'], 'agent_generation');

    const edited = await call('/operations', {
      method: 'POST',
      body: {
        originId: 'librarian:editable-reply', participant: OWNER,
        change: { kind: 'edit_block', block: blockId, content: 'Respuesta corregida por Herbert.' },
      },
    });
    assert.equal(edited.status, 201, JSON.stringify(edited.json));
    pageView = await call(`/pages/${encodeURIComponent(page)}`);
    assert.match(JSON.stringify(pageView.json), /Respuesta corregida por Herbert\./);
  });
});
