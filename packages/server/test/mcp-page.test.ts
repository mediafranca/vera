// La página de la puerta MCP.
//
// Lo que se prueba aquí no es que la tabla se dibuje, sino lo que la tabla
// necesita para decir la verdad: que una conexión se declare en un bloque, que
// lo declarado y lo observado se junten en la misma fila aunque uno diga «Claude
// Code» y el otro mande `claude-code`, y que quien entra sin tener fila aparezca
// igual —que es lo que uno abre esta página a mirar—.
//
// Ver specs/mcp-server.allium.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { VeraGraph } from '@vera/core';
import type { Change } from '@vera/core';
import type { SeenClient } from '@vera/store/exposures';

import { connectionsPage } from '../src/mcp-page.ts';

const OWNER = 'participant:herbert';
const COTITO = 'participant:cotito';
const SPECIAL = 'special-kind';

/** Un grafo con la página de la puerta y las conexiones que se le pidan. */
function corpus(
  connections: readonly { name: string; properties: Record<string, string> }[],
  extra: readonly { name: string; properties: Record<string, string> }[] = [],
) {
  const graph = VeraGraph.create({ name: 'mind', id: 'graph:1' });
  graph.addParticipant({ id: OWNER, name: 'Herbert', kind: 'human' });
  graph.addParticipant({ id: COTITO, name: 'Cotito', kind: 'agent' });
  graph.admit(OWNER);

  let n = 0;
  const write = (change: Change): string => {
    n += 1;
    const done = graph.submitOperation({
      originId: `o${n}`,
      participant: OWNER,
      channel: 'typed_text',
      change,
    });
    assert.equal(done.status, 'applied', JSON.stringify(done));
    return done.subjectId;
  };

  const page = write({ kind: 'create_page', title: 'La puerta', visibility: 'private' });
  write({ kind: 'set_property', page, propertyKey: SPECIAL, propertyValue: 'connections' });
  write({ kind: 'set_property', page, propertyKey: 'etapa', propertyValue: 'M1' });

  let at = 0;
  for (const one of [...connections, ...extra]) {
    at += 1;
    const block = write({
      kind: 'create_block',
      page,
      parent: null,
      position: at,
      content: one.name,
    });
    for (const [key, value] of Object.entries(one.properties)) {
      write({ kind: 'set_property', block, propertyKey: key, propertyValue: value });
    }
  }
  return graph;
}

const seenBy = (client: string | null, participant: string, at: number, n = 1): SeenClient => ({
  client,
  participant,
  deliveries: n,
  volume: n * 100,
  firstAt: at,
  lastAt: at,
});

describe('la página de la puerta', () => {
  it('declara una conexión el bloque que lleva cliente, y sólo ése', () => {
    const graph = corpus(
      [{ name: 'Claude Code', properties: { cliente: 'claude-code', permiso: 'leer' } }],
      [{ name: 'Esto es prosa y no declara nada', properties: {} }],
    );
    const door = connectionsPage(graph, SPECIAL, []);
    assert.equal(door?.connections.length, 1);
    assert.equal(door?.connections[0]?.name, 'Claude Code');
    assert.equal(door?.stage, 'M1');
  });

  it('junta lo declarado con lo observado aunque no coincidan las mayúsculas', () => {
    // Quien escribe «Claude Code» en la página y quien manda `claude-code` en la
    // cabecera hablan de lo mismo; una fila que no casara por eso se leería como
    // una conexión que nunca ha leído nada.
    const graph = corpus([{ name: 'Claude Code', properties: { cliente: 'Claude-Code' } }]);
    const door = connectionsPage(graph, SPECIAL, [seenBy('claude-code', OWNER, 100, 3)]);
    assert.equal(door?.connections[0]?.seen?.deliveries, 3);
    assert.deepEqual(door?.undeclared, []);
  });

  it('enseña el nombre del participante y conserva su identificador', () => {
    // «Herbert» es lo que se lee; `participant:herbert` es lo que se declara y lo
    // que se compara con el registro. Poner el identificador en la celda la haría
    // ilegible; poner el nombre en la propiedad rompería la comparación.
    const graph = corpus([
      { name: 'Cotito', properties: { cliente: 'openclaw', participante: COTITO } },
    ]);
    const door = connectionsPage(graph, SPECIAL, [seenBy('openclaw', COTITO, 1)]);
    assert.equal(door?.connections[0]?.participant, COTITO);
    assert.equal(door?.connections[0]?.participantName, 'Cotito');
    assert.equal(door?.connections[0]?.seen?.name, 'Cotito');
  });

  it('de dos identidades para un mismo cliente, la fila enseña la última', () => {
    // Un cliente que leyó sin credencial un rato y con ella después: lo que hay
    // que ver es cómo está entrando ahora.
    const graph = corpus([{ name: 'Cotito', properties: { cliente: 'openclaw' } }]);
    const door = connectionsPage(graph, SPECIAL, [
      seenBy('openclaw', OWNER, 100),
      seenBy('openclaw', COTITO, 900),
    ]);
    assert.equal(door?.connections[0]?.seen?.participant, COTITO);
    // Y ninguna de las dos queda además abajo: las dos son de esa conexión.
    assert.deepEqual(door?.undeclared, []);
  });

  it('quien leyó sin tener fila aparece igual', () => {
    // @invariant WhatWasReadIsRecorded no sirve de nada si la página sólo enseña
    // lo declarado: lo que hay que mirar primero es justo lo que nadie declaró.
    const graph = corpus([{ name: 'Claude Code', properties: { cliente: 'claude-code' } }]);
    const door = connectionsPage(graph, SPECIAL, [
      seenBy('claude-code', OWNER, 100),
      seenBy('curl/8.14.1', OWNER, 200),
      seenBy(null, OWNER, 300),
    ]);
    assert.deepEqual(
      door?.undeclared.map((one) => one.client),
      ['curl/8.14.1', null],
    );
  });

  it('sin página de puerta no hay puerta que gobernar', () => {
    const graph = VeraGraph.create({ name: 'mind', id: 'graph:2' });
    graph.addParticipant({ id: OWNER, name: 'Herbert', kind: 'human' });
    graph.admit(OWNER);
    assert.equal(connectionsPage(graph, SPECIAL, []), null);
  });

  it('la antigua puerta MCP ya no compite como segunda fuente de verdad', () => {
    const graph = corpus([]);
    const page = graph.pages()[0];
    assert.ok(page);
    const changed = graph.submitOperation({
      originId: 'legacy-kind',
      participant: OWNER,
      channel: 'typed_text',
      change: {
        kind: 'set_property',
        page: page.id,
        propertyKey: SPECIAL,
        propertyValue: 'mcp',
      },
    });
    assert.equal(changed.status, 'applied');
    assert.equal(connectionsPage(graph, SPECIAL, []), null);
  });
});
