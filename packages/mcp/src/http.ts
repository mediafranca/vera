#!/usr/bin/env -S node --experimental-strip-types --no-warnings
// Puerta MCP pública de VERA: Streamable HTTP, sin sesión y cerrada por bearer.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { connectionFrom } from './client.ts';
import { mcpServer } from './main.ts';

const PORT = Number(process.env.VERA_MCP_HTTP_PORT ?? '4180');
const HOST = process.env.VERA_MCP_HTTP_HOST ?? '127.0.0.1';
const MAX_BODY = Number(process.env.VERA_MCP_HTTP_MAX_BODY ?? String(1024 * 1024));

function bearer(request: IncomingMessage): string | null {
  const authorization = request.headers.authorization;
  if (authorization === undefined) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (match === null) return null;
  const token = match[1].trim();
  return token === '' ? null : token;
}

function answer(response: ServerResponse, status: number, body: unknown, headers = {}): void {
  const json = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(json),
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(json);
}

async function bodyOf(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const held = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += held.length;
    if (size > MAX_BODY) throw new RangeError('request body too large');
    chunks.push(held);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function handleMCP(
  request: IncomingMessage,
  response: ServerResponse,
  veraUrl: string,
): Promise<void> {
  if (request.url !== '/mcp') {
    answer(response, 404, { error: 'not found' });
    return;
  }
  if (request.method !== 'POST') {
    answer(response, 405, { error: 'method not allowed' }, { allow: 'POST' });
    return;
  }
  const token = bearer(request);
  if (token === null) {
    answer(response, 401, { error: 'una credencial bearer válida es obligatoria' }, {
      'www-authenticate': 'Bearer realm="vera-mcp"',
    });
    return;
  }

  const clientHeader = request.headers['x-vera-client'];
  const client = typeof clientHeader === 'string' && clientHeader.trim() !== ''
    ? clientHeader.trim()
    : 'mcp-http';
  const connection = connectionFrom({
    VERA_URL: veraUrl,
    VERA_CLIENT: client,
    VERA_TOKEN: token,
  });

  // Se valida la credencial antes de inicializar MCP. Una credencial rota no
  // alcanza siquiera el catálogo y jamás cae a la identidad del loopback.
  const identity = await fetch(`${connection.url}/agents/whoami`, {
    headers: { authorization: `Bearer ${token}`, 'x-vera-client': client },
  });
  if (!identity.ok) {
    answer(response, 401, { error: 'credencial inválida o retirada' }, {
      'www-authenticate': 'Bearer realm="vera-mcp", error="invalid_token"',
    });
    return;
  }

  let body: unknown;
  try {
    body = await bodyOf(request);
  } catch (error) {
    answer(response, error instanceof RangeError ? 413 : 400, {
      error: error instanceof RangeError ? 'request too large' : 'invalid JSON',
    });
    return;
  }

  // Algunos conectores remotos (entre ellos el verificador web de Claude)
  // anuncian sólo application/json aunque esta puerta responda en JSON y no
  // necesite abrir un stream SSE. El transporte del SDK exige que Accept
  // enumere también text/event-stream antes de atender siquiera initialize.
  // Normalizamos esa variante interoperable sin aceptar tipos arbitrarios.
  const accept = request.headers.accept ?? '';
  if (accept.includes('application/json') && !accept.includes('text/event-stream')) {
    const compatibleAccept = `${accept}, text/event-stream`;
    request.headers.accept = compatibleAccept;
    const rawAccept = request.rawHeaders.findIndex((header) => header.toLowerCase() === 'accept');
    if (rawAccept >= 0) request.rawHeaders[rawAccept + 1] = compatibleAccept;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = mcpServer(connection);
  await server.connect(transport);
  try {
    await transport.handleRequest(request, response, body);
  } finally {
    await transport.close();
  }
}

/** Crea una puerta MCP ligada a una Vera local concreta. */
export function createMCPHandler(
  veraUrl: string,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return (request, response) => handleMCP(request, response, veraUrl);
}

export async function handlePublicMCP(request: IncomingMessage, response: ServerResponse): Promise<void> {
  return handleMCP(request, response, process.env.VERA_URL ?? 'http://127.0.0.1:4173');
}

if (process.argv[1] !== undefined && import.meta.url === new URL(process.argv[1], 'file:').href) {
  createServer((request, response) => {
    void handlePublicMCP(request, response).catch(() => {
      if (!response.headersSent) answer(response, 500, { error: 'internal server error' });
      else response.end();
    });
  }).listen(PORT, HOST, () => {
    process.stderr.write(`vera-mcp HTTPS origin escuchando en http://${HOST}:${PORT}/mcp\n`);
  });
}
