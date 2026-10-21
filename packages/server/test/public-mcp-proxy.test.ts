import { createServer, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createVeraServer } from '../src/server.ts';

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') reject(new Error('sin puerto de prueba'));
      else resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}

describe('el proxy MCP del origen público', () => {
  let upstream: Server;
  let proxy: Server;
  let upstreamPort: number;
  let proxyPort: number;
  let seen: Record<string, string | string[] | undefined> = {};

  before(async () => {
    upstream = createServer((request, response) => {
      seen = request.headers;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18"}}');
    });
    upstreamPort = await listen(upstream);

    const vera = createVeraServer({
      databasePath: ':memory:',
      owner: { id: 'participant:herbert', name: 'Herbert' },
      publicMcpOrigin: `http://127.0.0.1:${upstreamPort}`,
    });
    proxy = createServer((request, response) => vera.handlePublic(request, response));
    proxy.once('close', () => vera.close());
    proxyPort = await listen(proxy);
  });

  after(async () => {
    await Promise.all([close(proxy), close(upstream)]);
  });

  it('conserva x-auth-token hasta la puerta que valida la credencial', async () => {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-auth-token': 'secreto-claude',
      },
      body: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
    });

    assert.equal(response.status, 200);
    assert.equal(seen['x-auth-token'], 'secreto-claude');
    assert.equal(seen.authorization, undefined);
  });
});
