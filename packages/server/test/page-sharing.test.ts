import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listen } from '../src/server.ts';

const PORT = 4316;
const OWNER = 'participant:herbert';
let running: ReturnType<typeof listen>;
let base: string;
let publicBase: string;
let sequence = 0;

before(() => {
  running = listen({
    port: PORT,
    publicPreviewPort: PORT + 1,
    databasePath: ':memory:',
    owner: { id: OWNER, name: 'Herbert' },
    webRoot: new URL('../../web/dist', import.meta.url).pathname,
    publicSite: { title: 'Vera', canonicalDomain: 'https://vera.example' },
  });
  base = `http://localhost:${PORT}`;
  publicBase = `http://localhost:${PORT + 1}`;
});

after(async () => running.close());

async function call(origin: string, path: string, method = 'GET', body?: unknown,
  headers: Record<string, string> = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    headers: response.headers,
    json: await response.json().catch(() => null) as Record<string, any> | null,
  };
}

async function write(change: unknown): Promise<string> {
  sequence += 1;
  const reply = await call(base, '/operations', 'POST', { originId: `page-share:${sequence}`, change });
  assert.equal(reply.status, 201, JSON.stringify(reply.json));
  return String(reply.json?.['subjectId']);
}

describe('destinos de una página', () => {
  it('abre una página privada por capacidad y la revocación corta la lectura', async () => {
    const page = await write({ kind: 'create_page', title: 'Sólo por enlace', visibility: 'private' });
    const outside = await write({ kind: 'create_page', title: 'Fuera de la capacidad', visibility: 'private' });
    const made = await call(base, `/pages/${encodeURIComponent(page)}/shares`, 'POST', { lifetimeMs: null });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const link = new URL(String(made.json?.['url']));
    assert.equal(link.origin, 'https://vera.example');
    assert.match(link.pathname, /^\/share\/page-share%3A/);
    const proof = new URLSearchParams(link.hash.slice(1)).get('secret');
    assert.match(proof ?? '', /^vera_page_/);
    assert.equal(running.vera.store.db.prepare('SELECT secret_digest FROM page_shares WHERE id=?')
      .get(made.json?.['id'])?.['secret_digest'] === proof, false);

    const shell = await fetch(`${publicBase}${link.pathname}`);
    assert.equal(shell.status, 200);
    assert.match(shell.headers.get('content-type') ?? '', /text\/html/);

    const opened = await call(publicBase, `/page-shares/${encodeURIComponent(String(made.json?.['id']))}/open`,
      'POST', { secret: proof });
    assert.equal(opened.status, 200, JSON.stringify(opened.json));
    const cookie = (opened.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    assert.match(cookie, /^vera_page_share=/);
    const shareHeaders = { cookie, referer: `${publicBase}${link.pathname}` };
    const health = await call(publicBase, '/health', 'GET', undefined, shareHeaders);
    assert.equal(health.json?.['entryPoint'], page);
    assert.equal(health.json?.['pages'], 1);
    assert.equal((await call(publicBase, `/pages/${encodeURIComponent(page)}`, 'GET', undefined, shareHeaders)).status, 200);
    assert.equal((await call(publicBase, `/pages/${encodeURIComponent(outside)}`, 'GET', undefined, shareHeaders)).status, 404);
    assert.notEqual((await call(publicBase, '/health', 'GET', undefined, { cookie })).json?.['entryPoint'], page);

    assert.equal((await call(base, `/page-shares/${encodeURIComponent(String(made.json?.['id']))}`, 'DELETE')).status, 200);
    assert.equal((await call(publicBase, `/pages/${encodeURIComponent(page)}`, 'GET', undefined, shareHeaders)).status, 404);
  });

  it('publicar abre la visibilidad y retirar el último destino vuelve a cerrarla', async () => {
    const page = await write({ kind: 'create_page', title: 'Publicación contextual', visibility: 'private' });
    const published = await call(base, `/publications/${encodeURIComponent(page)}`, 'POST', { path: 'contextual' });
    assert.equal(published.status, 201, JSON.stringify(published.json));
    assert.equal((await call(base, `/pages/${encodeURIComponent(page)}`)).json?.['visibility'], 'public');
    assert.equal((await call(base, `/publications/${encodeURIComponent(page)}`, 'DELETE')).status, 200);
    assert.equal((await call(base, `/pages/${encodeURIComponent(page)}`)).json?.['visibility'], 'private');
  });
});
