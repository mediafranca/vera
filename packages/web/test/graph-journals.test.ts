import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { journalsInMap } from '../src/graph/journals.ts';
import type { GraphData } from '../src/graph/types.ts';

const graph: GraphData = {
  nodes: [
    { id: 'idea', name: 'Idea', central: true, degree: 2 },
    { id: 'today', name: '2026-09-01', central: false, degree: 1 },
    { id: 'other', name: 'Otra página', central: false, degree: 1 },
  ],
  links: [
    { source: 'idea', target: 'today' },
    { source: 'idea', target: 'other' },
  ],
};

describe('el interruptor de diarios en el mapa', () => {
  it('no muestra diarios vecinos aunque esté encendido', () => {
    const shown = journalsInMap(graph, 'idea', true);
    assert.deepEqual(shown.nodes.map((node) => node.id), ['idea', 'other']);
    assert.deepEqual(shown.links, [{ source: 'idea', target: 'other' }]);
  });

  it('muestra un diario cuando es el foco aunque el interruptor esté apagado', () => {
    const focused: GraphData = {
      ...graph,
      nodes: graph.nodes.map((node) => ({ ...node, central: node.id === 'today' })),
    };
    const shown = journalsInMap(focused, 'today', false);
    assert.deepEqual(shown.nodes.map((node) => node.id), ['idea', 'today', 'other']);
    assert.deepEqual(shown.links, graph.links);
  });
});
