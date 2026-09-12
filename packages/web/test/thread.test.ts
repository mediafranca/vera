import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { graphOfThread } from '../src/graph/thread.ts';
import type { GraphData } from '../src/graph/types.ts';

describe('proyección de un recorrido sobre el mapa', () => {
  const graph: GraphData = {
    nodes: [
      { id: 'trail', name: 'Recorrido', central: true, degree: 3 },
      { id: 'a', name: 'A', central: false, degree: 2 },
      { id: 'b', name: 'B', central: false, degree: 2 },
      { id: 'neighbour', name: 'Vecina', central: false, degree: 1 },
    ],
    links: [
      { source: 'trail', target: 'a' },
      { source: 'trail', target: 'b' },
      { source: 'a', target: 'b' },
      { source: 'a', target: 'neighbour' },
    ],
  };
  const thread = {
    page: 'trail',
    stops: [{ page: 'a', ordinal: 1 }, { page: 'b', ordinal: 2 }],
    kinds: ['by_path' as const],
  };

  it('deja exclusivamente las paradas y los vínculos existentes entre ellas', () => {
    const projected = graphOfThread(graph, thread);
    assert.deepEqual(projected.nodes.map((node) => node.id), ['a', 'b']);
    assert.deepEqual(projected.links, [{ source: 'a', target: 'b' }]);
  });

  it('no altera un mapa ordinario', () => {
    assert.equal(graphOfThread(graph, null), graph);
  });
});
