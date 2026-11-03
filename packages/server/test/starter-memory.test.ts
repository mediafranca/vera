import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { readObjectDeclarations, readPropertyDeclarations, readRelationDeclarations } from '@vera/core';
import { loadGraph, openStore } from '@vera/store';
import {
  DISTRIBUTION_PARTICIPANT,
  initializeStarterMemory,
  STARTER_CHANGES,
  STARTER_MEMORY_VERSION,
} from '../src/starter-memory.ts';
import {
  STARTER_OBJECT_DEFINITIONS,
  STARTER_PROPERTY_DEFINITIONS,
  STARTER_RELATION_DEFINITIONS,
} from '../src/starter-governance.ts';

describe('memoria inicial distribuida', () => {
  it('crea una memoria útil, atribuida e idempotente', () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), 'vera-starter-')), 'vera.sqlite');
    const owner = { id: 'participant:nueva', name: 'Persona Nueva' };

    const first = initializeStarterMemory({
      databasePath,
      owner,
      libraryName: 'Biblioteca de prueba',
      ownerLibrarianName: 'Aurelia',
    });
    assert.equal(first.version, STARTER_MEMORY_VERSION);
    assert.equal(first.applied, STARTER_CHANGES.length);
    assert.equal(first.duplicates, 0);
    assert.equal(first.pages, 13);
    assert.ok(first.blocks > 90);

    const store = openStore({ path: databasePath, graphName: 'mind' });
    const graph = loadGraph(store, 'mind');
    assert.equal(graph.owner, owner.id);
    const instance = store.db.prepare('SELECT owner_id,library_name,profile FROM instances').get() as any;
    assert.deepEqual({ ...instance }, {
      owner_id: owner.id,
      library_name: 'Biblioteca de prueba',
      profile: 'personal',
    });
    const librarian = store.db.prepare(`SELECT l.owner_id,l.agent_id,p.name,h.version
      FROM owner_librarians l
      JOIN participants p ON p.id=l.agent_id
      JOIN librarian_harnesses h ON h.librarian_id=l.id
      WHERE l.status='active' AND h.status='active'`).get() as any;
    assert.equal(librarian.owner_id, owner.id);
    assert.equal(librarian.name, 'Aurelia');
    assert.equal(librarian.version, 'vera-librarian-harness:1');
    assert.deepEqual(
      { ...(store.db.prepare("SELECT human_id,status FROM agent_principals WHERE agent_id=?")
        .get(librarian.agent_id) as any) },
      { human_id: owner.id, status: 'active' },
    );
    assert.equal(Number((store.db.prepare('SELECT COUNT(*) AS n FROM shared_spaces').get() as any).n), 0);
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
        'VERA: Gobierno',
        'VERA: Objetos',
        'VERA: Propiedades',
        'VERA: Relaciones',
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
    const governance = graph.pages().find((page) => page.title === 'VERA: Gobierno');
    assert.ok(governance);
    assert.ok(graph.propertiesOf(governance.id).some((property) =>
      property.key === 'special-kind' && property.value === 'governance'
    ));
    const declared = (title: string) => {
      const page = graph.pages().find((candidate) => candidate.title === title);
      assert.ok(page);
      return graph.blocksOf(page.id).map((block) => ({
        block: block.stableId,
        content: block.content,
        properties: graph.propertiesOf(block.stableId),
      })).filter((block) => block.properties.length > 0);
    };
    assert.equal(readPropertyDeclarations(declared('VERA: Propiedades')).length, STARTER_PROPERTY_DEFINITIONS.length);
    assert.equal(readObjectDeclarations(declared('VERA: Objetos')).length, STARTER_OBJECT_DEFINITIONS.length);
    assert.equal(readRelationDeclarations(declared('VERA: Relaciones')).length, STARTER_RELATION_DEFINITIONS.length);
    assert.equal(
      readObjectDeclarations(declared('VERA: Objetos')).find((one) => one.name === 'Bitácora')?.role,
      'day',
    );
    assert.equal(
      readRelationDeclarations(declared('VERA: Relaciones')).find((one) => one.name === 'forma parte de')?.role,
      'membership',
    );
    const authored = graph.operations().filter((operation) =>
      operation.originId.startsWith('starter-memory:v')
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

    const reopenedByDesktop = initializeStarterMemory({ databasePath });
    assert.equal(reopenedByDesktop.applied, 0);
    assert.equal(reopenedByDesktop.duplicates, STARTER_CHANGES.length);
    assert.equal(reopenedByDesktop.pages, first.pages);
  });

  it('no inventa una persona propietaria al abrir una base nueva', () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), 'vera-starter-ownerless-')), 'vera.sqlite');
    assert.throws(() => initializeStarterMemory({ databasePath }), /necesita una persona propietaria/);
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

  it('una memoria colectiva se presenta como colectiva desde el primer bloque', () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), 'vera-starter-collective-')), 'vera.sqlite');
    initializeStarterMemory({
      databasePath,
      owner: { id: 'participant:custodia', name: 'Custodia' },
      profile: 'collective',
      libraryName: 'Postgrado de Diseño',
      ownerLibrarianName: 'Lucienne',
      initialCollectiveSurfaceName: 'Taller doctoral',
    });
    const store = openStore({ path: databasePath, graphName: 'mind' });
    const graph = loadGraph(store, 'mind');
    const firstSteps = graph.pages().find((page) => page.title === 'VERA — Primeros pasos');
    const principles = graph.pages().find((page) => page.title === 'VERA — Principios');
    assert.ok(firstSteps && principles);
    assert.ok(graph.blocksOf(firstSteps.id).some((block) => /cada persona entra con su propia passkey/.test(block.content)));
    assert.ok(graph.blocksOf(principles.id).some((block) => /pertenece a su comunidad gobernada/.test(block.content)));
    assert.ok(!graph.blocksOf(firstSteps.id).some((block) => /única persona propietaria/.test(block.content)));
    assert.deepEqual(
      { ...(store.db.prepare('SELECT name,slug,owner_id,audience,status FROM shared_spaces').get() as any) },
      {
        name: 'Taller doctoral',
        slug: 'taller-doctoral',
        owner_id: 'participant:custodia',
        audience: 'restricted',
        status: 'active',
      },
    );
    const collectiveLibrarian = store.db.prepare(`SELECT p.name,l.owner_id,ap.human_id
      FROM owner_librarians l JOIN participants p ON p.id=l.agent_id
      JOIN agent_principals ap ON ap.agent_id=l.agent_id WHERE l.status='active'`).get() as any;
    assert.deepEqual({ ...collectiveLibrarian }, {
      name: 'Lucienne',
      owner_id: 'participant:custodia',
      human_id: 'participant:custodia',
    });
    store.close();
  });
});
