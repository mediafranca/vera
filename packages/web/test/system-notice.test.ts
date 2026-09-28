import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const outliner = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('avisos y trabajo sin interrumpir la lectura', () => {
  it('lleva los avisos del espacio y del outliner al mismo componente', () => {
    assert.match(outliner, /systemNotice as toast/);
    assert.match(main, /function notice\(message: string\)[\s\S]*?systemNotice\(message\)/);
  });

  it('sondea al bibliotecario sin recomponer la página cada tres segundos', () => {
    const polling = outliner.match(/if \(active\.length > 0\)[\s\S]*?\n  }, 3_000\);/)?.[0] ?? '';
    assert.match(polling, /showLibrarianTurns\(container, page, callbacks\)/);
    assert.doesNotMatch(polling, /callbacks\.onReload/);
  });

  it('pide dentro de Vera y reduce el trabajo activo a su marca pulsable', () => {
    const asking = outliner.slice(outliner.indexOf('async function askLibrarian('), outliner.indexOf('function librarianDialogHeader('));
    assert.doesNotMatch(asking, /window\.prompt/);
    assert.match(outliner, /dialog\.className = 'librarian-dialog librarian-request-dialog'/);
    assert.match(outliner, /activity\.className = 'librarian-activity'/);
    assert.match(outliner, /activity\.onclick = \(\) => openLibrarianProgress\(requests\)/);
    assert.match(outliner, /Tiempo transcurrido:/);
    assert.doesNotMatch(outliner, /librarianOverlayCorners|Reubicar/);
    assert.match(styles, /\.librarian-activity \.icon/);
    assert.match(styles, /\.librarian-activity \.icon[\s\S]*?animation: librarian-mark-pulse/);
    assert.match(styles, /@keyframes librarian-mark-pulse/);
    assert.match(styles, /prefers-reduced-motion[\s\S]*?\.librarian-activity \.icon \{ animation: none; \}/);
  });

  it('deja las respuestas terminadas como bloques editables y no monta una copia auxiliar', () => {
    assert.doesNotMatch(outliner, /function librarianTurn\(/);
    assert.doesNotMatch(outliner, /className = 'librarian-reply'/);
    assert.doesNotMatch(styles, /\.librarian-turn\b|\.librarian-reply\b/);
    assert.match(outliner, /Las respuestas terminadas son contenido del grafo/);
  });

  it('hace respirar el perímetro completo de los renders pendientes', () => {
    const pending = styles.match(/\.block:is\(\.rich-pending, \.rich-native-pending\)[\s\S]*?@media \(prefers-reduced-motion/)?.[0] ?? '';
    assert.match(pending, /border: 2px solid var\(--warm\)/);
    assert.match(pending, /border-color:/);
    assert.doesNotMatch(pending, /border-inline-start/);
  });
});
