import { createServer as createHttpServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { initializeStarterMemory } from '../src/starter-memory.ts';
import { listen } from '../src/server.ts';

const directories: string[] = [];

afterEach(() => {
  delete process.env['VERA_TEST_LIBRARIAN_KEY'];
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe('runtime embebido de la bibliotecaria', () => {
  it('se constituye, responde una solicitud y ejecuta una ronda con recibos', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vera-librarian-runtime-'));
    directories.push(directory);
    const databasePath = join(directory, 'vera.sqlite');
    const owner = { id: 'participant:owner-runtime', name: 'Dueña' };
    initializeStarterMemory({ databasePath, owner, libraryName: 'Biblioteca de prueba', ownerLibrarianName: 'Lucienne' });

    let inferenceCalls = 0;
    const inference = createHttpServer(async (request, response) => {
      assert.equal(request.url, '/v1/responses');
      assert.equal(request.headers.authorization, 'Bearer test-secret');
      for await (const _chunk of request) { /* consume body */ }
      inferenceCalls += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        output_text: inferenceCalls === 1 ? 'Respuesta de Lucienne.' : 'SIN_NOVEDAD',
      }));
    });
    await new Promise<void>((resolve) => inference.listen(4399, '127.0.0.1', resolve));
    process.env['VERA_TEST_LIBRARIAN_KEY'] = 'test-secret';
    const running = listen({ port: 4398, databasePath });
    const base = 'http://127.0.0.1:4398';
    const call = async (path: string, options: { method?: string; body?: unknown } = {}) => {
      const response = await fetch(`${base}${path}`, {
        method: options.method ?? 'GET', headers: { 'content-type': 'application/json' },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      return { status: response.status, json: await response.json() as Record<string, unknown> };
    };
    try {
      const constituted = await call('/librarian/runtime/constitute', { method: 'POST', body: { name: 'Lucienne' } });
      assert.equal(constituted.status, 201, JSON.stringify(constituted.json));
      const librarian = constituted.json['librarian'] as Record<string, string>;
      assert.equal(librarian.name, 'Lucienne');

      const configured = await call('/librarian/runtime', {
        method: 'PUT', body: {
          enabled: true,
          model: 'openai:test-model',
          endpoint: 'http://127.0.0.1:4399/v1',
          secretReference: 'VERA_TEST_LIBRARIAN_KEY',
          permissions: ['read_request_context', 'reply', 'daily_round'],
          routine: { enabled: false, hour: 9, timezone: 'local' },
        },
      });
      assert.equal(configured.status, 200, JSON.stringify(configured.json));
      assert.equal(configured.json['status'], 'ready');

      const made = await call('/operations', { method: 'POST', body: {
        originId: 'runtime-test:page', participant: owner.id,
        change: { kind: 'create_page', title: 'Consulta a Lucienne', visibility: 'private' },
      } });
      assert.equal(made.status, 201, JSON.stringify(made.json));
      const page = made.json['subjectId'] as string;
      const requested = await call('/librarian/requests', {
        method: 'POST', body: { pageId: page, text: '¿Qué ves aquí?' },
      });
      assert.equal(requested.status, 201, JSON.stringify(requested.json));
      const requestId = requested.json['id'] as string;

      let answered: Record<string, unknown> | null = null;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = await call(`/librarian/requests/${encodeURIComponent(requestId)}`);
        if (current.json['status'] === 'answered') { answered = current.json; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(answered, 'Lucienne no respondió la solicitud');
      assert.equal((answered['reply'] as Record<string, unknown>)['answeredBy'], librarian.agent);
      const pageView = await call(`/pages/${encodeURIComponent(page)}`);
      assert.match(JSON.stringify(pageView.json), /Respuesta de Lucienne/);

      const routine = await call('/librarian/runtime/routine', { method: 'POST' });
      assert.equal(routine.status, 202, JSON.stringify(routine.json));
      let finalView: Record<string, unknown> | null = null;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = await call('/librarian/runtime');
        const runs = current.json['runs'] as Array<Record<string, unknown>>;
        if (runs.some((run) => run.kind === 'routine' && run.status === 'completed')) {
          finalView = current.json; break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(finalView, 'la ronda no dejó recibo completo');
      const runs = finalView['runs'] as Array<Record<string, unknown>>;
      assert.ok(runs.some((run) => run.kind === 'request' && run.status === 'completed'));
      assert.ok(runs.some((run) => run.kind === 'routine' && run.output === 'SIN_NOVEDAD'));
      assert.equal(inferenceCalls, 2);
    } finally {
      await running.close();
      await new Promise<void>((resolve, reject) => inference.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it('rechaza activar un runtime sin permisos mínimos', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vera-librarian-runtime-permissions-'));
    directories.push(directory);
    const databasePath = join(directory, 'vera.sqlite');
    initializeStarterMemory({
      databasePath,
      owner: { id: 'participant:permissions', name: 'Persona' },
      ownerLibrarianName: 'Lucienne',
    });
    const running = listen({ port: 4397, databasePath });
    try {
      await fetch('http://127.0.0.1:4397/librarian/runtime/constitute', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      });
      const response = await fetch('http://127.0.0.1:4397/librarian/runtime', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: true, model: 'openai:test', secretReference: 'VERA_TEST_LIBRARIAN_KEY',
          permissions: ['reply'], routine: { enabled: false, hour: 9, timezone: 'local' },
        }),
      });
      assert.equal(response.status, 409);
      assert.match(JSON.stringify(await response.json()), /leer el contexto/);
    } finally {
      await running.close();
    }
  });

  it('coexiste con Cotito sin prestarle la identidad de Lucienne', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vera-librarian-runtime-bridge-'));
    directories.push(directory);
    const databasePath = join(directory, 'vera.sqlite');
    const owner = { id: 'participant:bridge-owner', name: 'Persona' };
    initializeStarterMemory({ databasePath, owner, ownerLibrarianName: 'Lucienne' });
    let wake = '';
    const hook = createHttpServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk.toString();
      wake = (JSON.parse(body) as { requestId: string }).requestId;
      response.writeHead(202).end();
    });
    await new Promise<void>((resolve) => hook.listen(4396, '127.0.0.1', resolve));
    const running = listen({
      port: 4395, databasePath,
      librarianHook: { url: 'http://127.0.0.1:4396/wake', token: 'hook-token' },
    });
    const call = async (path: string, options: { method?: string; body?: unknown; secret?: string } = {}) => {
      const response = await fetch(`http://127.0.0.1:4395${path}`, {
        method: options.method ?? 'GET', headers: {
          'content-type': 'application/json',
          ...(options.secret === undefined ? {} : { authorization: `Bearer ${options.secret}` }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      return { status: response.status, json: await response.json() as Record<string, unknown> };
    };
    try {
      const constituted = await call('/librarian/runtime/constitute', { method: 'POST', body: {} });
      const lucienne = (constituted.json['librarian'] as Record<string, string>).agent;
      assert.equal((await call('/agents', {
        method: 'POST', body: { id: 'participant:cotito', name: 'Cotito' },
      })).status, 201);
      const issued = await call('/agents/credentials', {
        method: 'POST', body: { participant: 'participant:cotito', scopes: ['read', 'write'], label: 'puente' },
      });
      const secret = issued.json['secret'] as string;
      const made = await call('/operations', { method: 'POST', body: {
        originId: 'bridge-test:page', participant: owner.id,
        change: { kind: 'create_page', title: 'Puente transparente', visibility: 'private' },
      } });
      const requested = await call('/librarian/requests', { method: 'POST', body: {
        pageId: made.json['subjectId'], text: 'Responde por el puente',
      } });
      const requestId = requested.json['id'] as string;
      for (let attempt = 0; attempt < 50 && wake === ''; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(wake, requestId);
      assert.equal((await call(`/librarian/requests/${encodeURIComponent(requestId)}/claim`, {
        method: 'POST', secret,
      })).status, 200);
      const answered = await call(`/librarian/requests/${encodeURIComponent(requestId)}/reply`, {
        method: 'POST', secret, body: { text: 'Respondió Cotito como puente.', changes: [] },
      });
      assert.equal(answered.status, 201, JSON.stringify(answered.json));
      assert.equal((answered.json['reply'] as Record<string, unknown>)['answeredBy'], 'participant:cotito');
      const conversation = await call('/librarian/conversation');
      assert.equal((conversation.json['agent'] as Record<string, unknown>)['id'], lucienne);
    } finally {
      await running.close();
      await new Promise<void>((resolve, reject) => hook.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });
});
