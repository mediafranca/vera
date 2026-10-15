import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('carga progresiva del mapa', () => {
  it('pide frases sólo cuando la vista D4 las necesita', () => {
    assert.match(api, /detail: 'spatial' \| 'd4' = 'spatial'/);
    assert.match(api, /detail === 'd4' \? '&detail=d4' : ''/);
    assert.match(main, /workspace\.graphView === 'graph_d4' \? 'd4' : 'spatial'/);
  });

  it('no aparta el ojo mientras D4 espera la ontología', () => {
    const draw = main.slice(
      main.indexOf('async function drawGraph('),
      main.indexOf('/**\n * Por dónde se ha pasado'),
    );
    const ontology = draw.indexOf('await api.ontology()');
    const removeControls = draw.indexOf("const controls = $('#map-controls')");
    const settings = draw.indexOf('const settings = {');
    const restoreControls = draw.indexOf('container.append(controls, trail)');

    assert.ok(ontology >= 0, 'D4 debe pedir la ontología');
    assert.ok(
      ontology < removeControls,
      'el ojo debe permanecer en el DOM mientras llega la ontología',
    );
    assert.ok(removeControls < restoreControls, 'los controles retirados deben restaurarse');
    assert.doesNotMatch(
      draw.slice(removeControls, settings),
      /\bawait\b/,
      'ninguna espera puede intercalarse mientras los controles están apartados',
    );
  });

  it('inicia el mapa público conocido antes de esperar el índice', () => {
    const start = main.slice(main.indexOf('async function start()'), main.indexOf('/**\n * Arrancar puede fallar'));
    const eager = start.indexOf('const eagerPublicCentre');
    const pages = start.indexOf('await loadPages()');
    assert.ok(eager >= 0 && eager < pages, 'el centro público debe resolverse antes de esperar /pages');
    assert.match(start, /workspace\.activePage = eagerPublicCentre;[\s\S]*applyLayout\(\);[\s\S]*await loadPages\(\)/);
    assert.match(start, /publicationPath === asked[\s\S]*workspace\.activePage = resolvedPublicCentre/);
    assert.ok(
      start.indexOf('if (eagerPublicCentre === null) applyLayout();') < start.indexOf('await applyRoute()'),
      'una ruta amistosa debe iniciar el mapa antes de pedir la página legible',
    );
  });
});
