import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { readDrawing, writeDrawing } from '@vera/core';

import {
  ERASER_RADIUS,
  canvasPointerIntent,
  eraseStrokesAt,
  eraseStrokesBetween,
  extendStroke,
} from '../src/canvas.ts';

const point = (x: number, y: number, pressure = 0.5) => ({ x, y, pressure });

describe('la recta del lienzo', () => {
  it('conserva sólo comienzo y extremo aunque la mano siga moviéndose', () => {
    const stroke = [point(10, 20, 0.2)];
    extendStroke(stroke, point(30, 40, 0.4), true);
    extendStroke(stroke, point(50, 60, 0.8), true);
    assert.deepEqual(stroke, [point(10, 20, 0.2), point(50, 60, 0.8)]);
  });

  it('al entrar Shift a mitad de un trazo descarta las muestras intermedias', () => {
    const stroke = [point(0, 0), point(3, 2), point(8, 7)];
    extendStroke(stroke, point(20, 20, 0.9), true);
    assert.deepEqual(stroke, [point(0, 0), point(20, 20, 0.9)]);
  });

  it('sin Shift sigue siendo un trazo a mano alzada', () => {
    const stroke = [point(0, 0)];
    extendStroke(stroke, point(3, 2), false);
    extendStroke(stroke, point(8, 7), false);
    assert.equal(stroke.length, 3);
  });
});

describe('la goma del lienzo', () => {
  it('recorta un segmento aunque ninguna muestra caiga dentro del radio', () => {
    const crossed = [point(0, 0, 0), point(100, 0, 1)];
    const far = [point(0, 100), point(100, 100)];
    const strokes = [crossed, far];
    assert.equal(eraseStrokesAt(strokes, point(50, 0), 10), true);
    assert.equal(strokes.length, 3);
    assert.deepEqual(strokes[2], far);
    assert.ok(Math.abs(strokes[0]!.at(-1)!.x - 40) < 0.001);
    assert.ok(Math.abs(strokes[1]![0]!.x - 60) < 0.001);
    assert.ok(Math.abs(strokes[0]!.at(-1)!.pressure - 0.4) < 0.001);
    assert.ok(Math.abs(strokes[1]![0]!.pressure - 0.6) < 0.001);
  });

  it('no borra un trazo fuera de su radio mayor', () => {
    const stroke = [point(0, 0), point(100, 0)];
    const strokes = [stroke];
    assert.equal(eraseStrokesAt(strokes, point(50, ERASER_RADIUS + 1), ERASER_RADIUS), false);
    assert.deepEqual(strokes, [stroke]);
  });

  it('borra el corredor entre eventos y no sólo sus extremos', () => {
    const crossed = [point(50, -20), point(50, 20)];
    const strokes = [crossed];
    assert.equal(
      eraseStrokesBetween(strokes, point(0, 0), point(100, 0), 5),
      true,
    );
    assert.equal(strokes.length, 2);
    assert.ok(Math.abs(strokes[0]!.at(-1)!.y + 5) < 0.001);
    assert.ok(Math.abs(strokes[1]![0]!.y - 5) < 0.001);
  });

  it('los fragmentos sobreviven a escritura y lectura sin cambiar el formato', () => {
    const strokes = [[point(0, 0, 0), point(100, 0, 1)]];
    eraseStrokesAt(strokes, point(50, 0), 10);
    const restored = readDrawing(writeDrawing(strokes));
    assert.equal(restored.length, 2);
    assert.deepEqual(restored[0]!.at(-1), point(40, 0, 0.4));
    assert.deepEqual(restored[1]![0], point(60, 0, 0.6));
  });
});

describe('la política de lápiz, tacto y palma', () => {
  it('un dedo dibuja mientras el lienzo sea sólo táctil', () => {
    assert.equal(canvasPointerIntent('touch', false, 1, false), 'ink');
  });

  it('un contacto aislado no altera tinta después de detectar lápiz', () => {
    assert.equal(canvasPointerIntent('touch', true, 1, false), 'ignore');
  });

  it('dos dedos todavía gobiernan la lente fuera de la guarda', () => {
    assert.equal(canvasPointerIntent('touch', true, 2, false), 'navigate');
  });

  it('la guarda posterior al lápiz ignora incluso dos contactos', () => {
    assert.equal(canvasPointerIntent('touch', true, 2, true), 'ignore');
  });

  it('lápiz y ratón siempre llegan como tinta o goma deliberada', () => {
    assert.equal(canvasPointerIntent('pen', true, 0, true), 'ink');
    assert.equal(canvasPointerIntent('mouse', false, 0, false), 'ink');
  });
});

describe('los controles del lienzo', () => {
  it('forman una sola barra y usan la familia de iconos de Vera', () => {
    const source = readFileSync(new URL('../src/canvas.ts', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    assert.match(source, /controls\.setAttribute\('role', 'toolbar'\)/);
    assert.match(source, /undo\.innerHTML = icon\('arrow-back-up'\)/);
    assert.match(source, /redo\.innerHTML = icon\('arrow-forward-up'\)/);
    assert.match(source, /controls\.append\(pencil, eraser, undo, redo, done\)/);
    assert.doesNotMatch(source, /undo\.textContent = '↶'|redo\.textContent = '↷'/);
    assert.match(styles, /\.canvas-tool \{[\s\S]*?width: 2\.75rem;[\s\S]*?height: 2\.75rem;/);
    assert.match(styles, /\.canvas-controls > \.canvas-tool \+ \.canvas-tool \{\s*border-left:/);
  });
});
