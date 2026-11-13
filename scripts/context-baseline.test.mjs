import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createServer } from 'node:http';

import { parseArguments, runBaseline, scoreCase, validateManifest } from './context-baseline.mjs';

const manifest = {
  schemaVersion: 1,
  name: 'Fixture de contexto',
  actor: { participant: 'participant:fixture' },
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
let lastContextRequest;

before(async () => {
  server = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/health') {
      response.end(JSON.stringify({ lastSequence: 12 }));
      return;
    }
    if (request.url === '/agents/whoami') {
      response.end(JSON.stringify({
        participant: 'participant:fixture', kind: 'agent', scopes: ['read'], label: 'Fixture',
      }));
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
    if (url.pathname === '/context' && request.method === 'POST') {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      lastContextRequest = JSON.parse(raw);
      if (lastContextRequest.page === 'page:paged') {
        const continued = lastContextRequest.cursor === 'cursor:second';
        response.end(JSON.stringify({
          version: 5,
          page: { id: 'page:paged' },
          blocks: [{ id: continued ? 'block:second' : 'block:first' }],
          library: { pages: [] },
          items: [{ kind: 'block', id: continued ? 'block:second' : 'block:first' }],
          relations: [],
          continuation: continued ? null : { cursor: 'cursor:second' },
        }));
        return;
      }
      response.end(JSON.stringify({
        version: 5,
        page: { id: 'page:focus' },
        blocks: [{ id: 'block:focus' }],
        library: { pages: [{ id: 'page:near', excerpts: ['pasaje vecino'] }] },
        items: [
          { kind: 'block', id: 'block:focus' },
          { kind: 'page', id: 'page:near', excerpts: [{ block: 'block:near', content: 'pasaje vecino' }] },
        ],
        relations: [{
          source: 'page:focus', target: 'page:near', block: 'block:relation',
          phrase: 'respalda', revision: 'op:12',
        }],
      }));
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

  it('fails closed when the credential does not match the declared actor', async () => {
    await assert.rejects(
      () => runBaseline({ ...manifest, actor: { participant: 'participant:other' } }, { baseUrl }),
      /credencial pertenece a participant:fixture/,
    );
  });

  it('accepts an expected refusal as evidence of an access boundary', () => {
    const scored = scoreCase({
      id: 'refused', question: '¿Puedo leer fuera?',
      calls: [{ tool: 'page', page: 'page:hidden', expectedStatus: 404 }],
      expected: { forbiddenIds: ['page:hidden'], abstain: true },
    }, [{
      tool: 'page', ok: false, status: 404, error: 'no such page',
      identities: [], characters: 24, latencyMs: 1, text: '{"error":"no such page"}',
    }], 100);
    assert.equal(scored.passed, true);
    assert.deepEqual(scored.callErrors, []);
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

  it('measures the identities and authored evidence delivered by a context receipt', async () => {
    const contextual = {
      ...manifest,
      cases: [{
        id: 'context-path', class: 'relational', question: '¿Qué respalda el foco?',
        calls: [{
          tool: 'context', page: 'page:focus', request: '¿Qué respalda el foco?',
          depth: 2, allowedRelations: ['respalda'], maxDegree: 4,
        }],
        expected: {
          requiredIds: ['page:focus', 'page:near', 'block:relation'],
          relevantIds: [
            'page:focus', 'block:focus', 'page:near', 'block:near', 'block:relation',
          ],
          textIncludes: ['"phrase":"respalda"', '"revision":"op:12"'],
        },
      }],
    };
    const report = await runBaseline(contextual, { baseUrl });
    assert.equal(report.summary.passed, 1);
    assert.equal(report.summary.evidenceRecall, 1);
    assert.equal(report.summary.evidencePrecision, 1);
    assert.equal(lastContextRequest.neighbourDepth, 2);
    assert.deepEqual(lastContextRequest.allowedRelations, ['respalda']);
    assert.equal(lastContextRequest.maxDegree, 4);
    assert.equal(lastContextRequest.budgetCharacters, 24_000);
  });

  it('follows an anchored context continuation without losing either semantic unit', async () => {
    const paged = {
      ...manifest,
      cases: [{
        id: 'context-pages', class: 'pagination', question: 'Lee todo.',
        calls: [{
          tool: 'context', page: 'page:paged', request: 'Lee todo.', pages: 2,
          budget: 4_000, depth: 0, allowedRelations: [], maxDegree: 0,
        }],
        expected: {
          requiredIds: ['page:paged', 'block:first', 'block:second'],
          relevantIds: ['page:paged', 'block:first', 'block:second'],
          noDuplicateItems: true,
          textIncludes: ['"continuation":null'],
        },
      }],
    };
    const report = await runBaseline(paged, { baseUrl });
    assert.equal(report.summary.passed, 1);
    assert.equal(report.summary.evidenceRecall, 1);
    assert.equal(report.summary.evidencePrecision, 1);
    assert.deepEqual(report.results[0].duplicateItems, []);
    assert.equal(lastContextRequest.cursor, 'cursor:second');
    assert.equal(lastContextRequest.budgetCharacters, 4_000);
  });
});
