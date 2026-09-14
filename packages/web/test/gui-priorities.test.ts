import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { compactDisconnectedComponents } from '../src/graph/render.ts';

const graph = readFileSync(new URL('../src/graph/render.ts', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');
const outliner = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');

describe('prioridades de interfaz posteriores al móvil', () => {
  it('encuadra las cajas completas de los nombres del mapa', () => {
    assert.match(graph, /const bounds = data\.nodes\.map/);
    assert.match(graph, /dims\.get\(item\.id\)/);
    assert.match(graph, /if \(!allPlaced && heldTransform === null\)/);
  });

  it('acerca componentes desconectados sin inventar aristas', () => {
    const nodes = [
      { id: '1', name: '1', central: false, degree: 1, x: 0, y: 0 },
      { id: '2', name: '2', central: false, degree: 1, x: 120, y: 0 },
      { id: '0', name: '0', central: true, degree: 0, x: 1800, y: 1400 },
    ];
    const links = [{ source: '1', target: '2' }];
    const count = compactDisconnectedComponents(
      nodes,
      links,
      new Map(nodes.map((node) => [node.id, { w: 60, h: 20 }])),
    );

    assert.equal(count, 2);
    assert.equal(links.length, 1);
    const verticalSpan = Math.max(...nodes.map((node) => node.y!))
      - Math.min(...nodes.map((node) => node.y!));
    assert.ok(verticalSpan < 100);
  });

  it('expone pertenencia efectiva, personas y espacios inicialmente vacíos', () => {
    assert.match(settings, /Pertenencia efectiva/);
    assert.match(settings, /peopleDirectory\(spaces\)/);
    assert.match(settings, /Propiedad inicial \(opcional\)/);
    assert.match(settings, /drawPageSharing/);
  });

  it('separa ajustes comunes y avanzados y distingue controles repetidos', () => {
    assert.match(settings, /Apariencia avanzada/);
    assert.match(settings, /simpleTokens/);
    assert.match(graph, /Visualización del grafo de conocimiento/);
    assert.match(outliner, /acciones del bloque: \$\{blockSummary\}/);
  });

  it('aplica la trazabilidad pública al cambiar el switch, sin un segundo gesto oculto', () => {
    assert.match(settings, /traceabilityInput\.addEventListener\('change', \(\) => void persistSite\(true\)\)/);
    assert.match(settings, /Aplicando y reconstruyendo el sitio/);
    assert.match(settings, /traceabilityInput\.checked = site\.transparentBlockTraceability/);
  });

  it('deja inequívoco en la cabecera cuándo terminó de procesar una página', () => {
    assert.match(outliner, /Procesamiento terminado · «\$\{page\.title\}»/);
    assert.match(outliner, /Procesamiento finalizado con pendientes · «\$\{page\.title\}»/);
    assert.match(outliner, /Procesamiento interrumpido · «\$\{page\.title\}»/);
  });
});
