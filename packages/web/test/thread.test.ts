import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { threadSettings } from '../src/graph/thread.ts';
import type { Trail } from '@vera/core';

describe('proyección de un recorrido sobre el mapa', () => {
  it('convierte la lectura enriquecida en el hilo completo de la misma página', () => {
    const trail = {
      page: 'trail',
      intent: null,
      opening: '',
      route: [
        { ordinal: 1, block: 'uno', title: 'A', page: 'a' },
        { ordinal: 2, block: 'dos', title: 'B', page: 'b' },
      ],
      crossings: [{ kind: 'across_open_ground' }],
      conclusion: '',
      broken: [],
      argues: true,
    } as unknown as Trail;
    assert.deepEqual(threadSettings('trail', trail), {
      page: 'trail',
      stops: [{ page: 'a', ordinal: 1 }, { page: 'b', ordinal: 2 }],
      kinds: ['across_open_ground'],
    });
    assert.equal(threadSettings('trail', { ...trail, route: [trail.route[0]!] }), null);
  });
});
