import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';

import { runPictosApi } from '../src/pictos-api.ts';

describe('cliente servidor→servidor de PICTOS', () => {
  let baseUrl = '';
  let server: ReturnType<typeof createServer>;
  const seen: {
    url: string | undefined;
    authorization: string | undefined;
    body: unknown;
  } = { url: undefined, authorization: undefined, body: undefined };

  before(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        seen.url = request.url;
        seen.authorization = request.headers.authorization;
        seen.body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          executor: 'pictos.net', request_id: 'request-1',
          process: { version: request.url?.endsWith('comprender') ? 'nlu-1.1.0' : 'composition-0.1.0' },
          schema: { id: 'https://pictos.net/schema.json', version: '1.1.0' },
          model: { actual: 'claude-haiku' }, output: { accepted: true },
        }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address !== null && typeof address !== 'string');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => new Promise<void>((resolve) => server.close(() => resolve())));

  it('manda texto y credencial sólo desde el servidor y conserva el envelope', async () => {
    const result = await runPictosApi({ baseUrl, key: 'pk_test' }, 'comprender', 'Beber agua');
    assert.ok(!('error' in result));
    if ('error' in result) return;
    assert.equal(seen.url, '/api/v1/comprender');
    assert.equal(seen.authorization, 'Bearer pk_test');
    assert.deepEqual(seen.body, {
      utterance: 'Beber agua',
      config: { lang: 'es-419', geoContext: { region: 'Chile' }, domainContext: 'hogar' },
    });
    assert.match(result.content, /"accepted": true/);
    assert.equal(result.executor, 'pictos.net');
    assert.equal(result.requestId, 'request-1');
  });

  it('entrega a Componer exactamente el JSON aceptado anterior', async () => {
    const result = await runPictosApi(
      { baseUrl, key: 'pk_test' },
      'componer',
      '```json\n{"utterance":"Beber agua"}\n```',
    );
    assert.ok(!('error' in result));
    assert.equal(seen.url, '/api/v1/componer');
    assert.deepEqual(seen.body, {
      nlu: { utterance: 'Beber agua' },
      config: { domainContext: 'hogar' },
    });
  });

  it('rechaza una entrada que no sea la salida JSON de Comprender', async () => {
    assert.deepEqual(
      await runPictosApi({ baseUrl, key: 'pk_test' }, 'componer', 'texto'),
      { error: 'Componer necesita la salida JSON aceptada de Comprender' },
    );
  });
});
