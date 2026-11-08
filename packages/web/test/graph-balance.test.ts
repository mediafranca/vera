import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  graphBalance,
  graphBalanceLabel,
  graphBalanceNeedsLayout,
} from '../src/graph/balance.ts';
import { containPlanarNodes } from '../src/graph/render.ts';

describe('calibración continua del mapa', () => {
  it('expone extremos fuertes y un centro realmente híbrido', () => {
    assert.deepEqual(graphBalance(0), { value: 0, links: 4, concepts: 0, lens: 'links' });
    assert.deepEqual(graphBalance(50), { value: 50, links: 2, concepts: 2, lens: 'hybrid' });
    assert.deepEqual(graphBalance(100), { value: 100, links: 0, concepts: 4, lens: 'concepts' });
    assert.equal(graphBalanceLabel(75), 'Enlaces 1.0× · Conceptos 3.0×');
    assert.deepEqual(graphBalance(37), { value: 37, links: 2.52, concepts: 1.48, lens: 'hybrid' });
  });

  it('acota valores persistidos fuera del rango', () => {
    assert.equal(graphBalance(-20).value, 0);
    assert.equal(graphBalance(140).value, 100);
    assert.equal(graphBalance(Number.NaN).value, 50);
  });

  it('al soltar no aplica otra ronda oculta sobre el mismo valor', () => {
    assert.equal(graphBalanceNeedsLayout(73, 73, true), false);
    assert.equal(graphBalanceNeedsLayout(73, 73, false), true);
    assert.equal(graphBalanceNeedsLayout(73, 74, true), true);
  });

  it('mantiene tres recorridos sucesivos dentro del cuadro sin cambiar el zoom', () => {
    const nodes = [
      { id: 'izquierda', name: 'Izquierda', x: 0, y: 0 },
      { id: 'derecha', name: 'Derecha', x: 0, y: 0 },
    ];
    const dims = new Map([
      ['izquierda', { w: 80, h: 20 }],
      ['derecha', { w: 60, h: 20 }],
    ]);
    const transform = { x: 15, y: -10, k: 1.25 };
    const initialZoom = transform.k;
    const viewport = { width: 320, height: 180, padding: 20 };

    for (let journey = 1; journey <= 3; journey += 1) {
      nodes[0]!.x = -500 * journey;
      nodes[0]!.y = -300 * journey;
      nodes[1]!.x = 600 * journey;
      nodes[1]!.y = 400 * journey;
      containPlanarNodes(nodes, dims, viewport, transform);

      for (const node of nodes) {
        const box = dims.get(node.id)!;
        const left = (node.x! - box.w / 2) * transform.k + transform.x;
        const right = (node.x! + box.w / 2) * transform.k + transform.x;
        const top = (node.y! - box.h / 2) * transform.k + transform.y;
        const bottom = (node.y! + box.h / 2) * transform.k + transform.y;
        assert.ok(left >= viewport.padding);
        assert.ok(right <= viewport.width - viewport.padding);
        assert.ok(top >= viewport.padding);
        assert.ok(bottom <= viewport.height - viewport.padding);
      }
      assert.equal(transform.k, initialZoom);
    }
  });
});
