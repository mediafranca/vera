import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { observeServiceStatuses } from '../src/service-status.ts';

const clock = (...times: number[]) => {
  let at = 0;
  return () => times[Math.min(at++, times.length - 1)]!;
};

describe('salud observable de MCP y Vera Conecta', () => {
  it('exige el desafío Bearer de MCP y la identidad completa de Conecta', async () => {
    const called: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input);
      called.push(url);
      return url.endsWith('/mcp')
        ? new Response('{}', { status: 401, headers: { 'www-authenticate': 'Bearer realm="vera-mcp"' } })
        : Response.json({ service: 'vera-conecta', status: 'ok', protocol: 1 });
    }) as typeof fetch;

    const statuses = await observeServiceStatuses({
      mcpOrigin: 'http://127.0.0.1:4180',
      conectaHealthUrl: 'https://conecta.example/health',
      fetcher,
      now: clock(100, 108, 110, 124),
    });

    assert.deepEqual(statuses.map((one) => one.condition), ['available', 'available']);
    assert.deepEqual(called, ['http://127.0.0.1:4180/mcp', 'https://conecta.example/health']);
  });

  it('no confunde cualquier respuesta HTTP con un servicio sano', async () => {
    const statuses = await observeServiceStatuses({
      mcpOrigin: 'http://127.0.0.1:4180',
      conectaHealthUrl: 'https://conecta.example/health',
      fetcher: (async (input: string | URL | Request) => String(input).endsWith('/mcp')
        ? new Response('{}', { status: 200 })
        : Response.json({ status: 'ok' })) as typeof fetch,
      now: clock(100, 101, 102, 103),
    });

    assert.deepEqual(statuses.map((one) => one.condition), ['degraded', 'degraded']);
  });

  it('nombra la ausencia de configuración sin hacer una petición', async () => {
    let calls = 0;
    const statuses = await observeServiceStatuses({
      fetcher: (async () => { calls += 1; throw new Error('no debía llamarse'); }) as typeof fetch,
      now: () => 100,
    });
    assert.equal(calls, 0);
    assert.deepEqual(statuses.map((one) => one.condition), ['unknown', 'unknown']);
  });

  it('degrada una caída a estado visible sin filtrar el error de red', async () => {
    const statuses = await observeServiceStatuses({
      mcpOrigin: 'http://127.0.0.1:4180',
      conectaHealthUrl: 'https://conecta.example/health',
      fetcher: (async () => { throw new Error('ECONNREFUSED 127.0.0.1:4180'); }) as typeof fetch,
      now: () => 100,
    });
    assert.deepEqual(statuses.map((one) => one.condition), ['unavailable', 'unavailable']);
    assert.ok(statuses.every((one) => !one.detail.includes('4180')));
  });
});
