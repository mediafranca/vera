import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { speechParts } from '../src/read-aloud.ts';

describe('fragmentos de lectura', () => {
  it('conserva el orden y prefiere límites de oración', () => {
    const parts = speechParts('block:uno', 'Primera frase. Segunda frase.', 18);
    assert.deepEqual(parts, [
      { key: 'block:uno:0', text: 'Primera frase.' },
      { key: 'block:uno:1', text: 'Segunda frase.' },
    ]);
  });

  it('parte una oración larga sin exceder el límite del sintetizador', () => {
    const parts = speechParts('block:dos', 'uno dos tres cuatro cinco seis', 12);
    assert.equal(parts.map((part) => part.text).join(' '), 'uno dos tres cuatro cinco seis');
    assert.equal(parts.every((part) => part.text.length <= 12), true);
  });

  it('no pierde una palabra excepcionalmente larga al partirla', () => {
    const word = 'a'.repeat(641);
    const parts = speechParts('long-word', word, 280);
    assert.ok(parts.every((part) => part.text.length <= 280));
    assert.equal(parts.map((part) => part.text).join(''), word);
  });

  it('no inventa voz para un bloque vacío', () => {
    assert.deepEqual(speechParts('block:vacio', '   '), []);
  });
});
