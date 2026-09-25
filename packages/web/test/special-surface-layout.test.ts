import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');
const mcp = readFileSync(new URL('../src/mcp-page.ts', import.meta.url), 'utf8');
const governing = readFileSync(new URL('../src/governing-table.ts', import.meta.url), 'utf8');
const graph3d = readFileSync(new URL('../src/graph/render3d.ts', import.meta.url), 'utf8');
const embeddedMap = readFileSync(new URL('../src/map-frame.ts', import.meta.url), 'utf8');
const executableFrames = readFileSync(new URL('../src/executable-frames.ts', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('superficies especiales', () => {
  it('reemplazan las áreas del mapa y ocupan la columna completa', () => {
    const rule = styles.match(/#vera-root\.special-surface\s*\{([^}]+)\}/)?.[1] ?? '';
    assert.match(rule, /grid-template-columns:\s*1fr/);
    assert.match(rule, /grid-template-areas:\s*'bar'\s*'text'/);
  });

  it('administra los espacios compartidos en una ruta completa desde configuración', () => {
    assert.match(main, /pathname === '\/compartir'/);
    assert.match(settings, /onOpenSharing/);
    assert.match(settings, /renderSharingAdministration/);
    assert.doesNotMatch(settings, /id: 'compartir', label: 'Compartir'/);
  });

  it('vincula desde la propia puerta las cuatro guías de conexión por proveedor', () => {
    assert.match(mcp, /VERA — conectar OpenAI por MCP/);
    assert.match(mcp, /VERA — conectar Claude por MCP/);
    assert.match(mcp, /VERA — conectar LM Studio por MCP/);
    assert.match(mcp, /VERA — conectar Gemini por MCP/);
    assert.match(mcp, /aria-label', 'guías para conectar inteligencias artificiales'/);
  });

  it('distingue gobierno efectivo, superficies, proyecciones y documentación', () => {
    assert.match(main, /Gobierno de Vera/);
    assert.match(main, /conocida.*known\.mode/s);
    assert.match(governing, /'rectora' \| 'superficie' \| 'derivada' \| 'documentación'/);
    assert.match(governing, /key: 'activity'.*mode: 'derivada'/);
    assert.match(governing, /key: 'presentation'.*mode: 'documentación'/);
    assert.match(governing, /key: 'instructions'.*mode: 'documentación'/);
  });

  it('cuenta la espera de una búsqueda comprometida y la cierra en éxito o fallo', () => {
    assert.match(main, /countInto\(status, `Buscando “\$\{query\}”…`, 'search:corpus'\)/);
    assert.match(main, /counting\.close\('failed'\)/);
    assert.match(main, /counting\.close\(\)/);
  });

  it('hace visible el trabajo global sin tapar la interfaz y respeta movimiento reducido', () => {
    assert.match(styles, /html\[data-working='true'\]::after/);
    assert.match(styles, /pointer-events:\s*none/);
    assert.match(styles, /html\[data-working-slow='true'\]::after/);
    assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  });

  it('mantiene legibles los nombres del mapa 3D sin dejar que cubran el vecindario', () => {
    assert.match(graph3d, /const SCREEN_FONT_MIN = 11;/);
    assert.match(graph3d, /const SCREEN_FONT_MAX = 31;/);
  });

  it('ofrece rotación automática sólo en 3D y gobierna la cámara sin recargar el grafo', () => {
    assert.match(html, /id="map-auto-rotate-field" hidden/);
    assert.match(html, /id="map-auto-rotate"[^>]+role="switch"[^>]+aria-checked="false"/);
    assert.match(main, /map-auto-rotate-field'\)\.hidden = workspace\.graphView !== 'graph_3d'/);
    assert.match(main, /prefers-reduced-motion: reduce/);
    assert.match(main, /setGraph3DAutoRotate\(workspace\.graphAutoRotate\)/);
    const toggle = main.match(/autoRotateSwitch\.addEventListener\('click',[\s\S]*?\n  \}\);/)?.[0] ?? '';
    assert.doesNotMatch(toggle, /applyLayout|drawGraph/);
    assert.match(graph3d, /governAutoRotation\?\.\(enabled\)/);
    assert.match(graph3d, /setAutoRotation\(false\)/);
  });

  it('entrega el mapa por alcances crecientes sin retirar el que ya llegó', () => {
    assert.match(main, /requestedDepth = Math\.min\(targetDepth, Math\.max\(1, reach\)\)/);
    assert.match(main, /requestedDepth < targetDepth/);
    assert.match(main, /drawGraph\(requestedDepth \+ 1\)/);
    assert.match(main, /preserveDirection: requestedDepth > 1/);
  });

  it('entrega también los mapas incrustados por alcance y deja rotar la primera entrega', () => {
    assert.match(embeddedMap, /fetch\('\/pages'\)/);
    assert.match(embeddedMap, /one\.title\.toLocaleLowerCase\(\) === wanted/);
    assert.match(embeddedMap, /void draw\(1\)/);
    assert.match(embeddedMap, /reach < config\.reach/);
    assert.match(embeddedMap, /requestAnimationFrame\(\(\) => void draw\(reach \+ 1\)\)/);
    assert.match(embeddedMap, /autoRotate: config\.view === '3d' && config\.rotate/);
    assert.match(embeddedMap, /preserveDirection: reach > 1/);
  });

  it('reserva al menos 640 píxeles cuando un p5 pide windowHeight', () => {
    assert.match(styles, /\.executable-window-height iframe[\s\S]*?height:\s*max\(640px, 100dvh\)/);
    assert.match(executableFrames, /Math\.max\(640, window\.innerHeight\)/);
  });
});
