import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { conceptGravity, conceptGroups } from '../src/graph/concept-gravity.ts';
import type { GraphNode } from '../src/graph/types.ts';

const node = (id: string, x: number, concepts: string[]): GraphNode => ({
  id,
  name: id,
  central: false,
  degree: 0,
  concepts,
  x,
  y: 0,
  vx: 0,
  vy: 0,
});

describe('gravedad conceptual', () => {
  it('acerca páginas que comparten un concepto sin inventar nodos', () => {
    const nodes = [node('izquierda', 0, ['memoria']), node('derecha', 100, ['memoria'])];
    const force = conceptGravity(2);
    force.initialize(nodes);
    force(1);

    assert.ok((nodes[0]!.vx ?? 0) > 0);
    assert.ok((nodes[1]!.vx ?? 0) < 0);
    assert.equal(nodes.length, 2);
  });

  it('da más influencia a un concepto raro que a uno amplio', () => {
    const nodes = [
      node('a', 0, ['raro', 'amplio']),
      node('b', 10, ['raro', 'amplio']),
      node('c', 20, ['amplio']),
      node('d', 30, ['amplio']),
    ];
    const groups = conceptGroups(nodes);
    const rare = groups.find((group) => group.key === 'raro');
    const broad = groups.find((group) => group.key === 'amplio');

    assert.ok(rare !== undefined && broad !== undefined);
    assert.ok(rare.attraction > broad.attraction);
  });

  it('separa centros conceptuales que de otro modo coincidirían', () => {
    const nodes = [
      node('a1', 0, ['a']),
      node('a2', 0, ['a']),
      node('b1', 0, ['b']),
      node('b2', 0, ['b']),
    ];
    const force = conceptGravity(2);
    force.initialize(nodes);
    force(1);

    const velocityA = (nodes[0]!.vx ?? 0) + (nodes[0]!.vy ?? 0);
    const velocityB = (nodes[2]!.vx ?? 0) + (nodes[2]!.vy ?? 0);
    assert.notEqual(velocityA, 0);
    assert.ok(velocityA * velocityB < 0);
  });

  it('ignora conceptos que sólo tiene una página visible', () => {
    const nodes = [node('sola', 0, ['singular']), node('otra', 100, [])];
    const force = conceptGravity(2);
    force.initialize(nodes);
    force(1);

    assert.equal(nodes[0]!.vx, 0);
    assert.equal(nodes[1]!.vx, 0);
  });

  it('aplica la misma gravedad a la tercera dimensión', () => {
    const nodes = [
      { ...node('cerca', 0, ['espacio']), z: 0, vz: 0 },
      { ...node('lejos', 0, ['espacio']), z: 100, vz: 0 },
    ];
    const force = conceptGravity(3);
    force.initialize(nodes);
    force(1);

    assert.ok(nodes[0]!.vz > 0);
    assert.ok(nodes[1]!.vz < 0);
  });
});
