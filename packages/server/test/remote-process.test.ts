import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';

import { runRemoteProcess } from '../src/remote-process.ts';

describe('ejecutor HTTP declarativo', () => {
  let baseUrl = '';
  let server: ReturnType<typeof createServer>;
  let seenAuthorization: string | undefined;
  let seenBody: unknown;

  before(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        seenAuthorization = request.headers.authorization;
        seenBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ output: { accepted: true } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address !== null && typeof address !== 'string');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => new Promise<void>((resolve) => server.close(() => resolve())));

  it('combina una declaración editable con la credencial de la conexión', async () => {
    const result = await runRemoteProcess(
      { baseUrl, key: 'pk_test' },
      { path: '/api/v1/componer', method: 'POST', body: { nlu: { utterance: 'Beber agua' } } },
    );
    assert.deepEqual(result, { response: { output: { accepted: true } } });
    assert.equal(seenAuthorization, 'Bearer pk_test');
    assert.deepEqual(seenBody, { nlu: { utterance: 'Beber agua' } });
  });

  it('no permite que la fuente cambie el host de la conexión', async () => {
    assert.deepEqual(
      await runRemoteProcess(
        { baseUrl, key: 'pk_test' },
        { path: '//otro.example/robar', method: 'POST', body: {} },
      ),
      { error: 'la ruta remota debe ser relativa a la conexión' },
    );
  });
});
