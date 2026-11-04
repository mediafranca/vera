import { createServer as createHttpServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { initializeStarterMemory } from '../src/starter-memory.ts';
import { listen } from '../src/server.ts';
import { formativePracticeFor } from '../src/librarian-runtime.ts';

const directories: string[] = [];

describe('frontera formativa de la dialéctica', () => {
  it('reconoce las seis prácticas y deja fluidas las tareas operativas', () => {
    assert.equal(formativePracticeFor('Lee este texto por mí.'), 'reading');
    assert.equal(formativePracticeFor('Elige los pasajes más importantes.'), 'selection');
    assert.equal(formativePracticeFor('Interpreta este argumento.'), 'interpretation');
    assert.equal(formativePracticeFor('Compara estas dos posiciones.'), 'comparison');
    assert.equal(formativePracticeFor('Hazme una síntesis completa.'), 'synthesis');
    assert.equal(formativePracticeFor('Saca una conclusión.'), 'conclusion');
    assert.equal(formativePracticeFor('Ordena alfabéticamente estas referencias.'), null);
  });

  it('reconoce una primera posición explícita y permite contrastarla directamente', () => {
    assert.equal(formativePracticeFor('Mi lectura es que la soberanía exige límites; contrástala.'), null);
    assert.equal(formativePracticeFor('Creo que el texto concluye otra cosa. Compara mi hipótesis con el corpus.'), null);
  });
});

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
    let inferencePrompt = '';
    const inference = createHttpServer(async (request, response) => {
      assert.equal(request.url, '/v1/responses');
      assert.equal(request.headers.authorization, 'Bearer test-secret');
      for await (const chunk of request) inferencePrompt += chunk.toString();
      inferenceCalls += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ output_text: 'Respuesta de Aster.' }));
    });
    await new Promise<void>((resolve) => inference.listen(4399, '127.0.0.1', resolve));
    process.env['VERA_TEST_LIBRARIAN_KEY'] = 'test-secret';
    const running = listen({ port: 4398, databasePath });
    const base = 'http://127.0.0.1:4398';
    const call = async (path: string, options: { method?: string; body?: unknown; secret?: string } = {}) => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (options.secret !== undefined) headers['authorization'] = `Bearer ${options.secret}`;
      const response = await fetch(`${base}${path}`, {
        method: options.method ?? 'GET', headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      return { status: response.status, json: await response.json() as Record<string, unknown> };
    };
    try {
      const constituted = await call('/librarian/runtime/constitute', { method: 'POST', body: { name: 'Lucienne' } });
      assert.equal(constituted.status, 201, JSON.stringify(constituted.json));
      const librarian = constituted.json['librarian'] as Record<string, string>;
      assert.equal(librarian.name, 'Lucienne');
      const librarianAgent = librarian.agent;
      assert.ok(librarianAgent);

      const renamed = await call(`/participants/${encodeURIComponent(librarianAgent)}`, {
        method: 'PATCH', body: { name: 'Aster' },
      });
      assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
      const renamedRuntime = await call('/librarian/runtime');
      assert.equal((renamedRuntime.json['librarian'] as Record<string, string>).name, 'Aster');
      assert.equal((renamedRuntime.json['librarian'] as Record<string, string>).agent, librarianAgent);
      const renamedConversation = await call('/librarian/conversation');
      assert.equal((renamedConversation.json['agent'] as Record<string, string>).name, 'Aster');

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
      assert.equal((configured.json['harness'] as any).version, 'vera-librarian-harness:2');
      assert.deepEqual((configured.json['harness'] as any).capabilities.map((one: any) => one.name), [
        'search_memory', 'read_page', 'query_graph', 'inspect_relations', 'check_invariants',
        'reply_to_request', 'propose_edit', 'apply_approved_edit',
      ]);

      const made = await call('/operations', { method: 'POST', body: {
        originId: 'runtime-test:page', participant: owner.id,
        change: { kind: 'create_page', title: 'Consulta a Aster', visibility: 'private' },
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
      assert.ok(answered, 'Aster no respondió la solicitud');
      assert.equal((answered['reply'] as Record<string, unknown>)['answeredBy'], librarianAgent);
      assert.ok((answered['events'] as Array<Record<string, string>>)
        .some((event) => event.text === 'Aster leyó la solicitud'));
      assert.match(inferencePrompt, /Eres Aster, agente de biblioteca de esta Vera/);
      const pageView = await call(`/pages/${encodeURIComponent(page)}`);
      assert.match(JSON.stringify(pageView.json), /Respuesta de Aster/);

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
      assert.equal(inferenceCalls, 1, 'una ronda sin evidencia no consulta al modelo ni le permite inventarla');

      const priorConversation = await call('/librarian/conversation');
      const priorConversationId = (priorConversation.json['conversation'] as Record<string, string>).id;
      assert.ok(priorConversationId);
      const admitted = await call('/agents', { method: 'POST', body: {
        id: 'participant:successor-runtime', name: 'Archivista', principal: owner.id,
      } });
      assert.equal(admitted.status, 201, JSON.stringify(admitted.json));
      const chosen = await call('/agents/participant%3Asuccessor-runtime/constitution', {
        method: 'PUT', body: { sources: [{ page, role: 'identity' }] },
      });
      assert.equal(chosen.status, 200, JSON.stringify(chosen.json));
      const built = await call('/agents/participant%3Asuccessor-runtime/manifests', { method: 'POST' });
      assert.equal(built.status, 201, JSON.stringify(built.json));
      const successorManifest = (built.json['manifest'] as Record<string, string>).id;
      assert.ok(successorManifest);
      const activated = await call(`/agents/participant%3Asuccessor-runtime/manifests/${encodeURIComponent(successorManifest)}/activate`, { method: 'POST' });
      assert.equal(activated.status, 200, JSON.stringify(activated.json));

      const eligible = await call('/librarian/runtime');
      assert.deepEqual(eligible.json['eligible'], [{ agent: 'participant:successor-runtime', name: 'Archivista' }]);
      const outsider = await call('/participants', {
        method: 'POST', body: { name: 'Otra persona', kind: 'human' },
      });
      assert.equal(outsider.status, 201, JSON.stringify(outsider.json));
      const outsiderId = (outsider.json['participant'] as Record<string, string>).id;
      assert.ok(outsiderId);
      const outsiderAgent = await call('/agents', { method: 'POST', body: {
        id: 'participant:outsider-agent', name: 'Agente ajeno', principal: outsiderId,
      } });
      assert.equal(outsiderAgent.status, 201, JSON.stringify(outsiderAgent.json));
      const credential = await call('/agents/credentials', {
        method: 'POST', body: { participant: 'participant:outsider-agent', scopes: ['read', 'write'], label: 'agente ajeno' },
      });
      assert.equal(credential.status, 201, JSON.stringify(credential.json));
      const outsiderSecret = credential.json['secret'] as string | undefined;
      assert.ok(outsiderSecret);
      const forbidden = await call('/librarian/runtime/designate', {
        method: 'POST', secret: outsiderSecret, body: { agent: 'participant:successor-runtime' },
      });
      assert.equal(forbidden.status, 403);
      const designated = await call('/librarian/runtime/designate', {
        method: 'POST', body: { agent: 'participant:successor-runtime' },
      });
      assert.equal(designated.status, 200, JSON.stringify(designated.json));
      assert.equal((designated.json['librarian'] as Record<string, string>).name, 'Archivista');
      assert.equal((designated.json['configuration'] as Record<string, unknown>)['model'], 'openai:test-model');
      assert.equal(designated.json['territory'], null, 'designar no concede el territorio del ocupante anterior');
      assert.deepEqual((designated.json['history'] as Array<Record<string, unknown>>).map((entry) => entry.status),
        ['active', 'replaced']);
      assert.ok((designated.json['runs'] as Array<Record<string, any>>)
        .every((run) => run.agent.id === librarianAgent), 'las ejecuciones anteriores conservan su agente');
      const successorConversation = await call('/librarian/conversation');
      assert.equal(successorConversation.json['conversation'], null, 'el sucesor comienza una conversación propia');
      const inheritedConversation = await call(`/librarian/conversation?id=${encodeURIComponent(priorConversationId)}`);
      assert.equal(inheritedConversation.status, 404, 'la conversación anterior no se transfiere al sucesor');

      const withoutManifest = await call('/agents', { method: 'POST', body: {
        id: 'participant:unconstituted-successor', name: 'Sin manifiesto', principal: owner.id,
      } });
      assert.equal(withoutManifest.status, 201, JSON.stringify(withoutManifest.json));
      const refused = await call('/librarian/runtime/designate', {
        method: 'POST', body: { agent: 'participant:unconstituted-successor' },
      });
      assert.equal(refused.status, 409);
      assert.match(String(refused.json['error']), /manifiesto activo/);

      const granted = await call('/territories/participant%3Asuccessor-runtime', {
        method: 'PUT', body: { mode: 'all', includeGeneral: true, rules: [] },
      });
      assert.equal(granted.status, 200, JSON.stringify(granted.json));
      const formative = await call('/librarian/requests', {
        method: 'POST', body: { pageId: page, text: 'Hazme una síntesis completa.' },
      });
      assert.equal(formative.status, 201, JSON.stringify(formative.json));
      let challenged = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = await call(`/librarian/requests/${encodeURIComponent(String(formative.json['id']))}`);
        if (current.json['status'] === 'answered') { challenged = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(challenged, true, 'el umbral formativo no llegó a abrirse');
      const busy = await call('/librarian/runtime/designate', {
        method: 'POST', body: { agent: librarianAgent },
      });
      assert.equal(busy.status, 409);
      assert.match(String(busy.json['error']), /trabajo abierto/);
    } finally {
      await running.close();
      await new Promise<void>((resolve, reject) => inference.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it('usa una herramienta de lectura, observa su resultado y recién entonces responde', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vera-librarian-tools-'));
    directories.push(directory);
    const databasePath = join(directory, 'vera.sqlite');
    const owner = { id: 'participant:tool-owner', name: 'Dueña' };
    initializeStarterMemory({ databasePath, owner, ownerLibrarianName: 'Lucienne' });
    const prompts: string[] = [];
    const inference = createHttpServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk.toString();
      prompts.push(body);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ output_text: prompts.length === 1
        ? '{"tool":"search_memory","arguments":{"query":"aguja bibliográfica"}}'
        : 'Encontré la aguja bibliográfica en la página consultada.' }));
    });
    await new Promise<void>((resolve) => inference.listen(4394, '127.0.0.1', resolve));
    process.env['VERA_TEST_LIBRARIAN_KEY'] = 'test-secret';
    const running = listen({ port: 4393, databasePath });
    const call = async (path: string, options: { method?: string; body?: unknown } = {}) => {
      const response = await fetch(`http://127.0.0.1:4393${path}`, {
        method: options.method ?? 'GET', headers: { 'content-type': 'application/json' },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      return { status: response.status, json: await response.json() as Record<string, any> };
    };
    try {
      await call('/librarian/runtime/constitute', { method: 'POST', body: {} });
      await call('/librarian/runtime', { method: 'PUT', body: {
        enabled: true, model: 'openai:test', endpoint: 'http://127.0.0.1:4394/v1',
        secretReference: 'VERA_TEST_LIBRARIAN_KEY', permissions: ['read_request_context', 'reply'],
        routine: { enabled: false, hour: 9, timezone: 'local' },
      } });
      const made = await call('/operations', { method: 'POST', body: {
        originId: 'tool-test:page', change: { kind: 'create_page', title: 'Aguja', visibility: 'private' },
      } });
      const page = made.json.subjectId as string;
      await call('/operations', { method: 'POST', body: {
        originId: 'tool-test:block', change: { kind: 'create_block', page, parent: null, position: 0,
          content: 'Aquí está la aguja bibliográfica.' },
      } });
      const requested = await call('/librarian/requests', { method: 'POST', body: {
        pageId: page, text: 'Busca la aguja bibliográfica y dime si existe.',
      } });
      let answered: Record<string, any> | null = null;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = await call(`/librarian/requests/${encodeURIComponent(requested.json.id)}`);
        if (current.json.status === 'answered') { answered = current.json; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(answered, 'Lucienne no cerró el turno después de usar la herramienta');
      assert.equal(prompts.length, 2);
      assert.match(prompts[1] ?? '', /Observación:.*Aguja/s);
      assert.ok(answered.events.some((one: any) => one.kind === 'tool' && /search_memory/.test(one.text)));
      assert.match(answered.reply.text, /Encontré la aguja bibliográfica/);
    } finally {
      await running.close();
      await new Promise<void>((resolve, reject) => inference.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it('abre un umbral formativo, espera la tentativa y permite un bypass explícito', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vera-librarian-dialectic-'));
    directories.push(directory);
    const databasePath = join(directory, 'vera.sqlite');
    const owner = { id: 'participant:dialectic-owner', name: 'Dueña' };
    initializeStarterMemory({ databasePath, owner, ownerLibrarianName: 'Lucienne' });
    const outputs = [
      JSON.stringify({ dialectic: 'answer', text: 'Tu lectura distingue tres ideas; el corpus añade una cuarta tensión.' }),
      JSON.stringify({ dialectic: 'answer', text: 'Selección directa preparada esta vez.' }),
      'Ordené las referencias alfabéticamente.',
    ];
    const inference = createHttpServer(async (_request, response) => {
      for await (const _chunk of _request) { /* consume body */ }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ output_text: outputs.shift() ?? 'Respuesta inesperada.' }));
    });
    await new Promise<void>((resolve) => inference.listen(4392, '127.0.0.1', resolve));
    process.env['VERA_TEST_LIBRARIAN_KEY'] = 'test-secret';
    const running = listen({ port: 4391, databasePath });
    const call = async (path: string, options: { method?: string; body?: unknown } = {}) => {
      const response = await fetch(`http://127.0.0.1:4391${path}`, {
        method: options.method ?? 'GET', headers: { 'content-type': 'application/json' },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      return { status: response.status, json: await response.json() as Record<string, any> };
    };
    const waitAnswered = async (id: string): Promise<Record<string, any>> => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = await call(`/librarian/requests/${encodeURIComponent(id)}`);
        if (current.json.status === 'answered') return current.json;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`Lucienne no respondió ${id}`);
    };
    try {
      await call('/librarian/runtime/constitute', { method: 'POST', body: {} });
      await call('/librarian/runtime', { method: 'PUT', body: {
        enabled: true, model: 'openai:test', endpoint: 'http://127.0.0.1:4392/v1',
        secretReference: 'VERA_TEST_LIBRARIAN_KEY', permissions: ['read_request_context', 'reply'],
        dialectic: { enabled: true }, routine: { enabled: false, hour: 9, timezone: 'local' },
      } });
      const made = await call('/operations', { method: 'POST', body: {
        originId: 'dialectic-test:page', change: { kind: 'create_page', title: 'Lectura formativa', visibility: 'private' },
      } });
      const page = made.json.subjectId as string;

      const opened = await call('/librarian/requests', { method: 'POST', body: {
        pageId: page, text: 'Hazme una síntesis completa.',
      } });
      const challenge = await waitAnswered(opened.json.id);
      assert.match(challenge.reply.text, /tres ideas centrales/);
      assert.equal(challenge.dialectic.status, 'open');
      assert.equal(challenge.dialectic.practice, 'synthesis');
      const beforeContribution = await call(`/pages/${encodeURIComponent(page)}`);
      assert.doesNotMatch(JSON.stringify(beforeContribution.json), /tres ideas centrales/,
        'el desafío conversacional no se deposita como respuesta final en la página');

      const contribution = await call('/librarian/requests', { method: 'POST', body: {
        pageId: page, conversationId: challenge.conversationId,
        text: 'Veo soberanía, autoría y una tensión entre fluidez y formación.',
      } });
      const completed = await waitAnswered(contribution.json.id);
      assert.match(completed.reply.text, /cuarta tensión/);
      assert.equal(completed.dialectic.status, 'fulfilled');
      assert.equal(completed.dialectic.closingMode, 'contribution');

      const second = await call('/librarian/requests', { method: 'POST', body: {
        pageId: page, conversationId: challenge.conversationId, text: 'Elige los pasajes más importantes.',
      } });
      const secondChallenge = await waitAnswered(second.json.id);
      assert.equal(secondChallenge.dialectic.status, 'open');
      const bypass = await call('/librarian/requests', { method: 'POST', body: {
        pageId: page, conversationId: challenge.conversationId,
        text: 'Esta vez necesito resolver la tarea directamente.', dialecticBypass: true,
      } });
      const bypassed = await waitAnswered(bypass.json.id);
      assert.match(bypassed.reply.text, /Selección directa/);
      assert.equal(bypassed.dialectic.status, 'bypassed');
      assert.equal(bypassed.dialectic.closingMode, 'bypass');

      const operational = await call('/librarian/requests', { method: 'POST', body: {
        pageId: page, conversationId: challenge.conversationId, text: 'Ordena alfabéticamente estas referencias.',
      } });
      const direct = await waitAnswered(operational.json.id);
      assert.match(direct.reply.text, /Ordené/);
      assert.equal(direct.dialectic, null);
      assert.equal(outputs.length, 0);
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
    const inference = createHttpServer(async (request, response) => {
      for await (const _chunk of request) { /* consume body */ }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ output_text: 'Respondió Lucienne desde el runtime residente.' }));
    });
    await new Promise<void>((resolve) => hook.listen(4396, '127.0.0.1', resolve));
    await new Promise<void>((resolve) => inference.listen(4389, '127.0.0.1', resolve));
    process.env['VERA_TEST_LIBRARIAN_KEY'] = 'test-secret';
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
      const page = made.json['subjectId'] as string;
      const requested = await call('/librarian/requests', { method: 'POST', body: {
        pageId: page, text: 'Responde por el puente',
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

      const configured = await call('/librarian/runtime', { method: 'PUT', body: {
        enabled: true, model: 'openai:test', endpoint: 'http://127.0.0.1:4389/v1',
        secretReference: 'VERA_TEST_LIBRARIAN_KEY', permissions: ['read_request_context', 'reply'],
        dialectic: { enabled: true }, routine: { enabled: false, hour: 9, timezone: 'local' },
      } });
      assert.equal(configured.status, 200, JSON.stringify(configured.json));
      wake = '';
      const resident = await call('/librarian/requests', { method: 'POST', body: {
        pageId: page, text: 'Ordena esta referencia.',
      } });
      const residentId = resident.json['id'] as string;
      let residentAnswer: Record<string, any> | null = null;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = await call(`/librarian/requests/${encodeURIComponent(residentId)}`);
        if (current.json['status'] === 'answered') { residentAnswer = current.json; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(residentAnswer, 'Lucienne no atendió la solicitud cuando su runtime estaba listo');
      assert.equal(wake, '', 'el puente no compite con el runtime residente');
      assert.equal(residentAnswer.reply.answeredBy, lucienne);
    } finally {
      await running.close();
      await new Promise<void>((resolve, reject) => hook.close((error) => error === undefined ? resolve() : reject(error)));
      await new Promise<void>((resolve, reject) => inference.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });
});
