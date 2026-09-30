// El registro de exposición.
//
// Lo que se prueba aquí no es que la tabla guarde filas, sino que el registro
// conserve una señal útil sin duplicar una fila por cada bloque entregado.
// Ver specs/mcp-server.allium, contrato WhatWasReadIsRecorded.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { openStore, saveParticipant } from '../src/store.ts';
import { clientsSeen, exposuresOf, recordExposure } from '../src/exposures.ts';

const OWNER = 'participant:herbert';
const COTITO = 'participant:cotito';

function freshStore() {
  const store = openStore({ path: ':memory:', graphName: 'mind' });
  saveParticipant(store, { id: OWNER, name: 'Herbert', kind: 'human' });
  saveParticipant(store, { id: COTITO, name: 'Cotito', kind: 'agent' });
  return store;
}

describe('el registro de exposición', () => {
  it('anota quién leyó y cuánto contexto recibió, pero no duplica sus identidades', () => {
    const store = freshStore();
    recordExposure(store, {
      participant: COTITO,
      client: 'openclaw',
      surface: 'GET /pages/:id',
      subject: 'page:1',
      delivered: ['page:1', 'block:1', 'block:2'],
      volume: 4096,
      at: 1000,
    });
    const [only] = exposuresOf(store);
    assert.equal(only?.participant, COTITO);
    assert.equal(only?.client, 'openclaw');
    assert.equal(only?.volume, 4096);
    assert.equal(only?.deliveredCount, 3);
    // El texto entregado no está en ninguna parte: guardarlo dejaría una
    // segunda copia del corpus dentro del registro que existe para vigilarlo.
    assert.ok(!JSON.stringify(only).includes('content'));
  });

  it('contesta qué se llevó alguien, lo último primero', () => {
    const store = freshStore();
    for (const at of [10, 30, 20]) {
      recordExposure(store, {
        participant: at === 30 ? OWNER : COTITO,
        surface: 'GET /search',
        subject: `busca ${at}`,
        at,
      });
    }
    assert.deepEqual(
      exposuresOf(store).map((one) => one.at),
      [30, 20, 10],
    );
    assert.deepEqual(
      exposuresOf(store, { participant: COTITO }).map((one) => one.at),
      [20, 10],
    );
  });

  it('resume cuánto contexto recibió cada cliente', () => {
    const store = freshStore();
    recordExposure(store, {
      participant: COTITO,
      client: 'openclaw',
      surface: 'GET /search',
      subject: 'memoria',
      delivered: ['page:1', 'page:2'],
      volume: 100,
      at: 10,
    });
    recordExposure(store, {
      participant: COTITO,
      client: 'openclaw',
      surface: 'GET /pages/:id',
      subject: 'page:2',
      delivered: ['page:2', 'block:1', 'block:2'],
      volume: 200,
      at: 20,
    });
    assert.deepEqual(clientsSeen(store), [{
      client: 'openclaw',
      participant: COTITO,
      deliveries: 2,
      volume: 300,
      deliveredCount: 5,
      firstAt: 10,
      lastAt: 20,
    }]);
  });

  it('una lectura sin credencial se anota como lo que es, sin credencial', () => {
    // Hoy el cliente web entra sin credencial y se le supone el dueño. Eso es
    // cierto y se registra tal cual, en vez de disimular la ausencia inventando
    // una credencial que no hubo.
    const store = freshStore();
    recordExposure(store, { participant: OWNER, surface: 'GET /pages', subject: '', at: 1 });
    assert.equal(exposuresOf(store)[0]?.credential, null);
  });

  it('lo mismo entregado dos veces en una llamada es una cosa entregada', () => {
    const store = freshStore();
    recordExposure(store, {
      participant: COTITO,
      surface: 'GET /search',
      subject: 'vera',
      delivered: ['page:1', 'page:1', 'page:1'],
      at: 1,
    });
    assert.equal(exposuresOf(store)[0]?.deliveredCount, 1);
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name = 'exposed_subjects'").get()?.n,
      0,
    );
  });
});
