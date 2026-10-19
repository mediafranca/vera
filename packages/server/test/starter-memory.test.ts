import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadGraph, openStore } from '@vera/store';
import {
  DISTRIBUTION_PARTICIPANT,
  initializeStarterMemory,
  STARTER_CHANGES,
  STARTER_MEMORY_VERSION,
} from '../src/starter-memory.ts';

describe('memoria inicial distribuida', () => {
  it('crea una memoria útil, atribuida e idempotente', () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), 'vera-starter-')), 'vera.sqlite');
    const owner = { id: 'participant:nueva', name: 'Persona Nueva' };

    const first = initializeStarterMemory({ databasePath, owner });
    assert.equal(first.version, STARTER_MEMORY_VERSION);
    assert.equal(first.applied, STARTER_CHANGES.length);
    assert.equal(first.duplicates, 0);
    assert.equal(first.pages, 9);
    assert.ok(first.blocks > 30);

    const store = openStore({ path: databasePath, graphName: 'mind' });
    const graph = loadGraph(store, 'mind');
    assert.equal(graph.owner, owner.id);
    assert.deepEqual(
      graph.pages().map((one) => one.title).sort(),
      [
        'Vera',
        'VERA — Acceder desde tus otros dispositivos',
        'VERA — Conectar una inteligencia artificial',
        'VERA — Manual',
        'VERA — Página de ejemplo',
        'VERA — Primeros pasos',
        'VERA — Principios',
        'VERA — Teclado y atajos',
        'VERA: Conexiones',
      ].sort(),
    );
    const connections = graph.pages().find((page) => page.title === 'VERA: Conexiones');
    assert.ok(connections);
    assert.ok(graph.propertiesOf(connections.id).some((property) =>
      property.key === 'special-kind' && property.value === 'connections'
    ));
    assert.ok(graph.blocksOf(connections.id).some((block) =>
      /^## Conexiones/.test(block.content)
    ));
    const authored = graph.operations().filter((operation) =>
      operation.originId.startsWith(`starter-memory:v${STARTER_MEMORY_VERSION}:`)
    );
    assert.equal(authored.length, STARTER_CHANGES.length);
    assert.ok(authored.every((operation) => operation.submission.submittedBy === DISTRIBUTION_PARTICIPANT));
    assert.ok(authored.every((operation) => operation.submission.channel === 'agent_generation'));
    store.close();

    const second = initializeStarterMemory({ databasePath, owner });
    assert.equal(second.applied, 0);
    assert.equal(second.duplicates, STARTER_CHANGES.length);
    assert.equal(second.pages, first.pages);
    assert.equal(second.blocks, first.blocks);
  });

  it('no cambia la persona propietaria de una memoria existente', () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), 'vera-starter-owner-')), 'vera.sqlite');
    initializeStarterMemory({
      databasePath,
      owner: { id: 'participant:primera', name: 'Primera' },
    });
    assert.throws(
      () => initializeStarterMemory({
        databasePath,
        owner: { id: 'participant:segunda', name: 'Segunda' },
      }),
      /ya pertenece a participant:primera/,
    );
  });
});
