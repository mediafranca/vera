import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resourceOrbit, resourceScreenPosition } from '../src/graph/render.ts';
import { EXTERNAL_RESOURCES_VISIBLE, externalResourcesForMap } from '../src/graph/external-resources.ts';

describe('visibilidad temporal de recursos externos', () => {
  it('conserva el dato pero no entrega satélites a ninguna proyección', () => {
    const resource = {
      id: 'resource:example', url: 'https://example.org/',
      domain: 'example.org', page: 'page:focus',
    };
    const data = { nodes: [], links: [], resources: [resource] };
    assert.equal(EXTERNAL_RESOURCES_VISIBLE, false);
    assert.deepEqual(externalResourcesForMap(data), []);
    assert.deepEqual(data.resources, [resource]);
  });
});

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

  it('conserva tamaño y distancia de pantalla aunque el mapa se aleje', () => {
    const normal = resourceScreenPosition(0, 4, { x: 120, y: 80 }, { x: 0, y: 0, k: 1 });
    const far = resourceScreenPosition(0, 4, { x: 120, y: 80 }, { x: 30, y: 15, k: 0.2 });
    assert.equal(Math.hypot(normal.x - normal.focusX, normal.y - normal.focusY), 82);
    assert.equal(Math.hypot(far.x - far.focusX, far.y - far.focusY), 82);
  });

  it('usa tinta de texto en reposo, acento sólo al interactuar y 80 % del diámetro anterior', () => {
    const planar = readFileSync(new URL('../src/graph/render.ts', import.meta.url), 'utf8');
    const spatial = readFileSync(new URL('../src/graph/render3d.ts', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    for (const source of [planar, spatial]) {
      assert.match(source, /setAttribute\('r', '4\.8'\)|\.attr\('r', 4\.8\)/);
      assert.match(source, /stroke['"], ['"]var\(--text\)/);
    }
    assert.match(styles, /\.map-resource:is\(:hover, :active, :focus-visible\)[\s\S]*?stroke: var\(--accent\)/);
    assert.match(styles, /\.map3d-resource:is\(:hover, :active, :focus-visible\)[\s\S]*?fill: var\(--accent\)/);
  });
});
