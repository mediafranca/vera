import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { createMCPHandler, handlePublicMCP } from '../src/http.ts';

let api = '';
let door = '';
const backend = createServer((request, response) => {
  if (request.url === '/agents/whoami' && request.headers.authorization === 'Bearer bueno') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ participant: 'participant:codex', scopes: ['read', 'write'] }));
    return;
  }
  response.writeHead(401, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'no' }));
});
const publicDoor = createServer((request, response) => void handlePublicMCP(request, response));

before(async () => {
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  const apiAddress = backend.address();
  assert(apiAddress !== null && typeof apiAddress !== 'string');
  api = `http://127.0.0.1:${apiAddress.port}`;
  process.env.VERA_URL = api;

  await new Promise<void>((resolve) => publicDoor.listen(0, '127.0.0.1', resolve));
  const doorAddress = publicDoor.address();
  assert(doorAddress !== null && typeof doorAddress !== 'string');
  door = `http://127.0.0.1:${doorAddress.port}/mcp`;
});

after(async () => {
  await Promise.all([
    new Promise<void>((resolve, reject) => backend.close((error) => error ? reject(error) : resolve())),
    new Promise<void>((resolve, reject) => publicDoor.close((error) => error ? reject(error) : resolve())),
  ]);
});

const initialize = {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
};

describe('la puerta MCP pública', () => {
  it('puede ligarse explícitamente a la Vera local que hospeda Desktop', async () => {
    const handler = createMCPHandler(api);
    const embedded = createServer((request, response) => void handler(request, response));
    await new Promise<void>((resolve) => embedded.listen(0, '127.0.0.1', resolve));
    try {
      const address = embedded.address();
      assert(address !== null && typeof address !== 'string');
      const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: 'Bearer bueno',
          'content-type': 'application/json',
        },
        body: JSON.stringify(initialize),
      });
      assert.equal(response.status, 200);
      const payload = await response.json() as { result?: { serverInfo?: { name?: string } } };
      assert.equal(payload.result?.serverInfo?.name, 'vera');
    } finally {
      await new Promise<void>((resolve, reject) => embedded.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('rechaza antes del protocolo una petición sin credencial', async () => {
    const response = await fetch(door, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(initialize),
    });
    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate') ?? '', /^Bearer/);
  });

  it('rechaza una credencial inventada sin caer al dueño', async () => {
    const response = await fetch(door, {
      method: 'POST',
      headers: { authorization: 'Bearer inventada', 'content-type': 'application/json' },
      body: JSON.stringify(initialize),
    });
    assert.equal(response.status, 401);
  });

  it('habla Streamable HTTP con una credencial válida', async () => {
    const client = new Client({ name: 'test', version: '1' });
    const transport = new StreamableHTTPClientTransport(new URL(door), {
      requestInit: { headers: { authorization: 'Bearer bueno', 'x-vera-client': 'codex-public-test' } },
    });
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 10);
    await client.close();
  });

  it('tolera clientes JSON que omiten text/event-stream en Accept', async () => {
    const response = await fetch(door, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: 'Bearer bueno',
        'content-type': 'application/json',
      },
      body: JSON.stringify(initialize),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json');
    const payload = await response.json() as { result?: { serverInfo?: { name?: string } } };
    assert.equal(payload.result?.serverInfo?.name, 'vera');
  });

  it('acepta el esquema bearer sin distinguir mayúsculas', async () => {
    const response = await fetch(door, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: 'bearer bueno',
        'content-type': 'application/json',
      },
      body: JSON.stringify(initialize),
    });
    assert.equal(response.status, 200);
  });
});
