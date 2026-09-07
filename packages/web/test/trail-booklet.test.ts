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
    assert.match(main, /endpoint = `\/booklet\/pdf\?\$\{query\.toString\(\)\}`/);
  });

  it('conserva la activación del gesto en iOS y no revoca prematuramente el blob en escritorio', () => {
    assert.match(main, /iosWebKit[\s\S]*?link\.href = endpoint;[\s\S]*?document\.body\.append\(link\);[\s\S]*?link\.click\(\)/);
    assert.match(main, /fetch\(endpoint\)[\s\S]*?document\.body\.append\(link\);[\s\S]*?setTimeout\(\(\) => \{[\s\S]*?URL\.revokeObjectURL/);
  });
});
