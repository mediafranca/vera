import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');

describe('selector de conversaciones bibliotecarias', () => {
  it('es un rótulo cuando no existe una elección real', () => {
    assert.match(source, /const only = conversations\.length <= 1/);
    assert.match(source, /sessionSelect\.hidden = only/);
    assert.match(source, /sessionLabel\.hidden = !only/);
    assert.match(source, /sessionLabel\.textContent = view\.conversation\?\.title/);
  });

  it('mantiene disponible iniciar una conversación nueva', () => {
    assert.match(source, /newSession\.textContent = 'Nueva'/);
    assert.match(source, /api\.createLibrarianConversation\(\)/);
  });
});
