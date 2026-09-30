import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { firstReadable } from '../src/page-delivery.ts';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('entrega legible de una página', () => {
  it('no deja que IndexedDB demore una entrega canónica disponible', async () => {
    const local = deferred<string | null>();
    const delivered = await firstReadable(local.promise, Promise.resolve('corpus'));
    assert.deepEqual(delivered, { page: 'corpus', source: 'canonical', validation: null });
  });

  it('muestra la copia local sin esperar al corpus y lo conserva como validación', async () => {
    const remote = deferred<string>();
    const delivered = await firstReadable(Promise.resolve('aparato'), remote.promise);
    assert.equal(delivered.page, 'aparato');
    assert.equal(delivered.source, 'retained');
    assert.ok(delivered.validation);
    remote.resolve('corpus');
    assert.equal(await delivered.validation, 'corpus');
  });

  it('cae al aparato si el corpus falla', async () => {
    const delivered = await firstReadable(
      Promise.resolve('aparato'),
      Promise.reject(new Error('sin red')),
    );
    assert.equal(delivered.page, 'aparato');
    assert.equal(delivered.source, 'retained');
    await assert.rejects(delivered.validation, /sin red/);
  });

  it('enciende el hilo cuando el enriquecimiento revela que la página es un recorrido', () => {
    const enrichment = main.match(/void api\.pageEnrichment[\s\S]*?\n  }\n\n  \/\/ Un día/)?.[0] ?? '';
    assert.match(enrichment, /openView\.trail = complete\.trail \?\? null;/);
    assert.match(enrichment, /openTrail = threadSettings\(complete\.id, openView\.trail\);/);
    assert.match(enrichment, /hadThread \|\| openTrail !== null[\s\S]*?void drawGraph\(\);/);
  });
});
