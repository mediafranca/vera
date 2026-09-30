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
