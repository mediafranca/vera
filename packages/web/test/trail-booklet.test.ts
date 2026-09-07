import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('el rastro hecho librillo', () => {
  it('pone el libro inmediatamente antes de limpiar y conserva el orden de las páginas', () => {
    assert.match(main, /className = 'trail-booklet'[\s\S]*?trail\.append\(booklet\);[\s\S]*?className = 'trail-clear'/);
    assert.match(main, /booklet\.innerHTML = icon\('book'\)/);
    assert.match(main, /workspace\.trace\.map\(\(step\) => step\.page\)/);
    assert.match(main, /query\.append\('page', id\)/);
    assert.match(main, /fetch\(`\/booklet\/pdf\?\$\{query\.toString\(\)\}`\)/);
  });
});
