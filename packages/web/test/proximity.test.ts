import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { proximityExplanation } from '../src/graph/proximity.ts';
import type { GraphNode } from '../src/graph/types.ts';

const page = (id: string, concepts: string[]): GraphNode => ({
  id, name: id, central: id === 'focus', degree: 0, concepts,
});

describe('explicación de cercanía', () => {
  const focus = page('focus', ['memoria', 'soberanía']);
  const neighbour = page('neighbour', ['memoria']);
  const links = [{ source: focus.id, target: neighbour.id }];

  it('nombra sólo lo que gobierna cada lente', () => {
    assert.equal(proximityExplanation(neighbour, focus, links, 'links'), 'Cercanía: enlace directo');
    assert.equal(proximityExplanation(neighbour, focus, links, 'concepts'), 'Cercanía: conceptos «memoria»');
    assert.equal(
      proximityExplanation(neighbour, focus, links, 'hybrid'),
      'Cercanía: enlace directo + conceptos «memoria»',
    );
  });

  it('no inventa una razón cuando no la hay', () => {
    assert.equal(proximityExplanation(page('other', ['otra']), focus, links, 'hybrid'), null);
  });
});
