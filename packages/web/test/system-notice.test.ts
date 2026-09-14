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

  it('hace respirar el perímetro completo de los renders pendientes', () => {
    const pending = styles.match(/\.block:is\(\.rich-pending, \.rich-native-pending\)[\s\S]*?@media \(prefers-reduced-motion/)?.[0] ?? '';
    assert.match(pending, /border: 2px solid var\(--warm\)/);
    assert.match(pending, /border-color:/);
    assert.doesNotMatch(pending, /border-inline-start/);
  });
});
