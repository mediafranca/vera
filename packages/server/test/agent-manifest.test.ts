import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { listen } from '../src/server.ts';

const PORT = 4336;
const OWNER = 'participant:herbert';
const COTITO = 'participant:cotito';
let base: string;
let running: ReturnType<typeof listen>;
let counter = 0;

before(() => {
  running = listen({ port: PORT, databasePath: ':memory:', owner: { id: OWNER, name: 'Herbert' } });
  base = `http://localhost:${PORT}`;
});

after(async () => running.close());

async function call(path: string, options: { method?: string; body?: unknown; secret?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.secret !== undefined) headers['authorization'] = `Bearer ${options.secret}`;
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET', headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  return { status: response.status, json: await response.json() as Record<string, unknown> };
}

async function submit(change: unknown) {
  counter += 1;
  return call('/operations', { method: 'POST', body: { originId: `manifest-test:${counter}`, change } });
}

async function page(title: string, content: string): Promise<string> {
  const born = await submit({ kind: 'create_page', title, visibility: 'private' });
  assert.equal(born.status, 201, JSON.stringify(born.json));
  const id = born.json['subjectId'] as string;
  const block = await submit({ kind: 'create_block', page: id, parent: null, position: 0, content });
  assert.equal(block.status, 201, JSON.stringify(block.json));
  return id;
}

describe('constitución portable del agente', () => {
  let identity: string;
  let practice: string;
  let secret: string;
  let first: string;

  it('admitir un agente lo vincula a la persona soberana, no a su credencial', async () => {
    const agent = await call('/agents', { method: 'POST', body: { id: COTITO, name: 'Cotito' } });
    assert.equal(agent.status, 201, JSON.stringify(agent.json));
    const administration = await call('/agent-administration');
    const rows = administration.json['agents'] as Array<Record<string, unknown>>;
    const cotito = rows.find((row) => (row['agent'] as Record<string, unknown>)['id'] === COTITO);
    assert.equal((cotito?.['human'] as Record<string, unknown>)['id'], OWNER);
  });

  it('elige páginas reales y construye un borrador versionado', async () => {
    identity = await page('Cotito', 'Bibliotecario, investigador y escritor.');
    practice = await page('Oficio del bibliotecario', 'Leer, relacionar, preservar procedencia y proponer.');
    const chosen = await call(`/agents/${encodeURIComponent(COTITO)}/constitution`, {
      method: 'PUT', body: { sources: [{ page: identity, role: 'identity' }, { page: practice, role: 'practice' }] },
    });
    assert.equal(chosen.status, 200, JSON.stringify(chosen.json));
    const built = await call(`/agents/${encodeURIComponent(COTITO)}/manifests`, { method: 'POST' });
    assert.equal(built.status, 201, JSON.stringify(built.json));
    const manifest = built.json['manifest'] as Record<string, unknown>;
    assert.equal(manifest['version'], 1);
    assert.equal(manifest['status'], 'draft');
    assert.match(String(manifest['digest']), /^[a-f0-9]{64}$/);
    first = manifest['id'] as string;
  });

  it('el runtime sólo lee la revisión activa de su propia identidad', async () => {
    const activated = await call(`/agents/${encodeURIComponent(COTITO)}/manifests/${encodeURIComponent(first)}/activate`, { method: 'POST' });
    assert.equal(activated.status, 200, JSON.stringify(activated.json));
    const issued = await call('/agents/credentials', {
      method: 'POST', body: { participant: COTITO, scopes: ['read'], label: 'runtime' },
    });
    secret = issued.json['secret'] as string;
    const read = await call('/agent-manifest', { secret });
    assert.equal(read.status, 200, JSON.stringify(read.json));
    const document = read.json['document'] as Record<string, unknown>;
    assert.equal((document['agent'] as Record<string, unknown>)['id'], COTITO);
    assert.equal((document['constitution'] as unknown[]).length, 2);
    assert.equal((document['guarantees'] as Record<string, unknown>)['secrets'], 'references-only');
  });

  it('conserva revisiones anteriores y permite volver a una', async () => {
    const revised = await submit({ kind: 'edit_block', block: (await call(`/pages/${encodeURIComponent(practice)}`)).json['blocks'] instanceof Array
      ? ((await call(`/pages/${encodeURIComponent(practice)}`)).json['blocks'] as Array<Record<string, unknown>>)[0]?.['stableId']
      : '', content: 'Leer, relacionar y cuidar la soberanía del grafo.' });
    assert.equal(revised.status, 201, JSON.stringify(revised.json));
    const built = await call(`/agents/${encodeURIComponent(COTITO)}/manifests`, { method: 'POST' });
    const second = (built.json['manifest'] as Record<string, unknown>)['id'] as string;
    await call(`/agents/${encodeURIComponent(COTITO)}/manifests/${encodeURIComponent(second)}/activate`, { method: 'POST' });
    const rolled = await call(`/agents/${encodeURIComponent(COTITO)}/manifests/${encodeURIComponent(first)}/activate`, { method: 'POST' });
    assert.equal(rolled.status, 200, JSON.stringify(rolled.json));
    assert.equal(((await call('/agent-manifest', { secret })).json['summary'] as Record<string, unknown>)['version'], 1);
  });

  it('rechaza una página que parece contener un secreto', async () => {
    const unsafe = await page('No es constitución', 'token = abcdefghijklmnopqrstuvwxyz123456');
    const chosen = await call(`/agents/${encodeURIComponent(COTITO)}/constitution`, {
      method: 'PUT', body: { sources: [{ page: unsafe, role: 'memory' }] },
    });
    assert.equal(chosen.status, 409);
    assert.match(String(chosen.json['error']), /secreto/);
  });
});
