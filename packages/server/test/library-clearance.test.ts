import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { listen } from '../src/server.ts';

const PORT = 4327;
const OWNER = 'participant:territory-owner';
const AGENT = 'participant:territory-agent';
let running: ReturnType<typeof listen>;
let base: string;
let secret = '';
let sequence = 0;
let inside = '';
let outside = '';
let both = '';
let includedSurface = '';
let excludedSurface = '';

async function call(path: string, options: { method?: string; body?: unknown; secret?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.secret !== undefined) headers['authorization'] = `Bearer ${options.secret}`;
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET', headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  return { status: response.status, json: await response.json() as any };
}

async function write(change: unknown, as = '') {
  sequence += 1;
  return call('/operations', { method: 'POST', ...(as === '' ? {} : { secret: as }),
    body: { originId: `territory:${sequence}`, change } });
}

before(async () => {
  running = listen({ port: PORT, databasePath: ':memory:', owner: { id: OWNER, name: 'Dueña' } });
  base = `http://127.0.0.1:${PORT}`;
  assert.equal((await call('/agents', { method: 'POST', body: { id: AGENT, name: 'Agente' } })).status, 201);
  const issued = await call('/agents/credentials', { method: 'POST', body: {
    participant: AGENT, scopes: ['read', 'write'], label: 'territorio de prueba',
  } });
  secret = issued.json.secret;

  const general = await write({ kind: 'create_page', title: 'General reservada', visibility: 'private' });
  outside = general.json.subjectId;
  const one = await write({ kind: 'create_page', title: 'Dentro del taller', visibility: 'private' });
  inside = one.json.subjectId;
  const overlap = await write({ kind: 'create_page', title: 'En dos superficies', visibility: 'private' });
  both = overlap.json.subjectId;
  await write({ kind: 'create_block', page: inside, parent: null, position: 0, content: 'hallazgo visible' });
  await write({ kind: 'create_block', page: outside, parent: null, position: 0, content: 'hallazgo secreto' });

  const included = await call('/shared-spaces', { method: 'POST', body: {
    name: 'Incluida', slug: 'incluida', selectorKey: 'zona', selectorValue: 'incluida',
  } });
  includedSurface = included.json.id;
  const excluded = await call('/shared-spaces', { method: 'POST', body: {
    name: 'Excluida', slug: 'excluida', selectorKey: 'zona', selectorValue: 'excluida',
  } });
  excludedSurface = excluded.json.id;
  await write({ kind: 'set_property', page: inside, propertyKey: 'zona', propertyValue: 'incluida' });
  await write({ kind: 'set_property', page: both, propertyKey: 'zona', propertyValue: 'incluida, excluida' });
  const policy = await call(`/territories/${encodeURIComponent(AGENT)}`, { method: 'PUT', body: {
    mode: 'selected', includeGeneral: false,
    rules: [
      { kind: 'shared', surface: includedSurface, disposition: 'included',
        permissions: ['read', 'contribute', 'edit'] },
      { kind: 'shared', surface: excludedSurface, disposition: 'excluded', permissions: [] },
    ],
  } });
  assert.equal(policy.status, 200, JSON.stringify(policy.json));
});

after(async () => { await running.close(); });

describe('clearance territorial por todas las puertas', () => {
  it('proyecta sólo páginas legibles y una exclusión domina una inclusión', async () => {
    const pages = await call('/pages', { secret });
    assert.equal(pages.status, 200);
    assert.deepEqual(pages.json.map((page: any) => page.id), [inside]);
    assert.equal((await call(`/pages/${encodeURIComponent(outside)}`, { secret })).status, 404);
    assert.equal((await call(`/pages/${encodeURIComponent(both)}`, { secret })).status, 404);
    const search = await call('/search?q=hallazgo', { secret });
    assert.deepEqual(search.json.map((hit: any) => hit.page), [inside]);
  });

  it('aplica la misma frontera a escritura, creación, historia y exportación completa', async () => {
    const allowed = await write({ kind: 'create_block', page: inside, parent: null, position: 1,
      content: 'aporte permitido' }, secret);
    assert.equal(allowed.status, 201, JSON.stringify(allowed.json));
    const refused = await write({ kind: 'create_block', page: outside, parent: null, position: 1,
      content: 'aporte fuera del territorio' }, secret);
    assert.equal(refused.status, 403);
    assert.match(refused.json.reason, /biblioteca general no está incluida/);
    assert.equal((await write({ kind: 'create_page', title: 'No nace', visibility: 'private' }, secret)).status, 403);
    assert.equal((await call('/graph.vera', { secret })).status, 403);
    const ops = await call('/ops', { secret });
    assert.ok(ops.json.length > 0);
    assert.ok(ops.json.every((operation: any) => operation.page === inside));
  });

  it('explica la corrección y reserva el gobierno a la persona dueña', async () => {
    const denied = await call('/territories', { secret });
    assert.equal(denied.status, 403);
    assert.match(denied.json.error, /persona dueña gobierna territorios/);
    const admin = await call('/territories');
    assert.equal(admin.status, 200);
    const policy = admin.json.policies.find((one: any) => one.participant === AGENT);
    assert.equal(policy.mode, 'selected');
    assert.equal(policy.includeGeneral, false);
    assert.equal(policy.rules.length, 2);
    const included = admin.json.surfaces.find((one: any) => one.id === includedSurface);
    const excluded = admin.json.surfaces.find((one: any) => one.id === excludedSurface);
    assert.deepEqual(included.stewards, [{ participant: OWNER, name: 'Dueña' }]);
    assert.deepEqual(excluded.stewards, [{ participant: OWNER, name: 'Dueña' }]);
  });
});
