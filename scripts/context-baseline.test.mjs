import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createServer } from 'node:http';

import { parseArguments, runBaseline, scoreCase, validateManifest } from './context-baseline.mjs';

const manifest = {
  schemaVersion: 1,
  name: 'Fixture de contexto',
  corpus: { sequence: 12 },
  defaults: { budgetCharacters: 5_000 },
  cases: [
    {
      id: 'finds-evidence', class: 'direct', question: '¿Dónde está la evidencia?',
      calls: [{ tool: 'search', query: 'evidencia', limit: 2 }],
      expected: {
        requiredIds: ['page:evidence', 'block:evidence'],
        relevantIds: ['page:evidence', 'block:evidence'],
        forbiddenIds: ['page:hidden'],
        textIncludes: ['evidencia'],
      },
    },
    {
      id: 'abstains', class: 'absence', question: '¿Existe lo que no existe?',
      calls: [{ tool: 'search', query: 'nada' }],
      expected: { abstain: true },
    },
  ],
};

let server;
let baseUrl;

before(async () => {
  server = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/health') {
      response.end(JSON.stringify({ lastSequence: 12 }));
      return;
    }
    const url = new URL(request.url ?? '/', 'http://fixture');
    if (url.pathname === '/search' && url.searchParams.get('q') === 'evidencia') {
      response.end(JSON.stringify([
        { page: 'page:evidence', block: 'block:evidence', excerpt: 'evidencia comprobable' },
        { page: 'page:other', block: null, excerpt: 'ruido' },
      ]));
      return;
    }
    if (url.pathname === '/search') {
      response.end('[]');
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'no existe' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe('context baseline', () => {
  it('requires an explicit manifest', () => {
    assert.throws(() => parseArguments([]), /falta --manifest/);
  });

  it('rejects duplicate case identities', () => {
    assert.throws(
      () => validateManifest({ ...manifest, cases: [manifest.cases[0], manifest.cases[0]] }),
      /repetido/,
    );
  });

  it('measures evidence, noise, budget and abstention without copying response text', async () => {
    const report = await runBaseline(manifest, { baseUrl });
    assert.equal(report.summary.cases, 2);
    assert.equal(report.summary.passed, 2);
    assert.equal(report.summary.evidenceRecall, 1);
    assert.equal(report.summary.evidencePrecision, 2 / 3);
    assert.equal(report.summary.leakChecks, 1);
    assert.equal(report.summary.leaked, 0);
    assert.equal('text' in report.results[0].calls[0], false);
  });

  it('fails closed when the corpus sequence drifted', async () => {
    await assert.rejects(
      () => runBaseline({ ...manifest, corpus: { sequence: 11 } }, { baseUrl }),
      /snapshot correcto/,
    );
  });

  it('reports forbidden identities and budget overruns', () => {
    const scored = scoreCase({
      id: 'leak', question: 'private', budgetCharacters: 2,
      expected: { forbiddenIds: ['page:hidden'] },
    }, [{
      tool: 'search', ok: true, status: 200, error: null,
      identities: ['page:hidden'], characters: 20, latencyMs: 1, text: 'secret',
    }], 100);
    assert.equal(scored.passed, false);
    assert.deepEqual(scored.leaked, ['page:hidden']);
    assert.equal(scored.characters, 20);
  });

  it('excludes cases without an exhaustive relevant set from aggregate precision', async () => {
    const withUnscoredNoise = {
      ...manifest,
      cases: [
        ...manifest.cases,
        {
          id: 'unscored-precision', class: 'exploratory', question: '¿Qué ruido aparece?',
          calls: [{ tool: 'search', query: 'evidencia' }],
          expected: {},
        },
      ],
    };
    const report = await runBaseline(withUnscoredNoise, { baseUrl });
    assert.equal(report.summary.evidencePrecision, 2 / 3);
  });
});
