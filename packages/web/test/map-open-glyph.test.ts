import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inlineOpenGlyph } from '../src/graph/open-glyph.ts';

describe('icono que abre una página desde el mapa', () => {
  it('mide exactamente 1em y sigue al final real del título', () => {
    const glyph = inlineOpenGlyph(20, 73, 15);
    assert.equal(glyph.size, 20);
    assert.equal(glyph.x, 74.6);
    assert.equal(glyph.y, -2.5);
  });

  it('conserva la misma regla al cambiar escala y línea de base', () => {
    const small = inlineOpenGlyph(10, 21, 8);
    const large = inlineOpenGlyph(30, 21, 8);
    assert.equal(small.size, 10);
    assert.equal(large.size, 30);
    assert.ok(Math.abs((small.x - 21) - 0.8) < 1e-9);
    assert.ok(Math.abs((large.x - 21) - 2.4) < 1e-9);
  });

  it('incluye el avance desde el texto dentro del blanco interactivo', () => {
    const glyph = inlineOpenGlyph(12, 50, 10);
    assert.ok(glyph.hitX <= 50);
    assert.ok(glyph.hitWidth >= 16);
    assert.ok(glyph.hitHeight >= 16);
  });
});
