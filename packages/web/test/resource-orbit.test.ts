import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resourceOrbit } from '../src/graph/render.ts';

describe('órbita de recursos externos', () => {
  it('reparte cuatro destinos alrededor de toda la página y fuera de su rótulo', () => {
    const points = Array.from({ length: 4 }, (_, index) => resourceOrbit(index, 4));
    const rounded = (value: number): number => Math.abs(value) < 0.5 ? 0 : Math.round(value);
    assert.deepEqual(points.map((point) => rounded(point.x)), [82, 0, -82, 0]);
    assert.deepEqual(points.map((point) => rounded(point.y)), [0, 82, 0, -82]);
  });

  it('abre un segundo anillo después de doce destinos', () => {
    const first = resourceOrbit(0, 13);
    const thirteenth = resourceOrbit(12, 13);
    assert.ok(Math.hypot(thirteenth.x, thirteenth.y) > Math.hypot(first.x, first.y));
  });
});
