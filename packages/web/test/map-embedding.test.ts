import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mapEmbeddingSource, portableMapCamera } from '../src/map-embedding.ts';

describe('copiar una vista del mapa como incrustación', () => {
  it('escribe la cámara 3D exacta, la rotación y una altura ordinaria de 400', () => {
    const source = mapEmbeddingSource('VERA', '3d', 2, true, {
      kind: '3d',
      centre: { x: 1.123456789, y: -2, z: 3 },
      distance: 456.7654321,
      azimuth: 0.123456789,
      elevation: -0.5,
    });
    assert.match(source, /^```mapa\npágina: \[\[VERA\]\]\nvista: 3D\nalcance: 2\nrotación: sí\n/);
    assert.match(source, /"centre":\{"x":1\.123457,"y":-2,"z":3\}/);
    assert.match(source, /"distance":456\.765432/);
    assert.match(source, /\nalto: 400\n```$/);
  });

  it('redondea una cámara plana sin cambiar su clase', () => {
    assert.deepEqual(portableMapCamera({ kind: '2d', x: 1 / 3, y: -2 / 3, k: 1.25 }), {
      kind: '2d', x: 0.333333, y: -0.666667, k: 1.25,
    });
  });
});
