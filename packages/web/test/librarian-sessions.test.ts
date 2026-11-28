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
    assert.match(source, /api\.createLibrarianConversation\(current\)/);
    assert.match(source, /archiveSession\.textContent = 'Archivar'/);
    assert.match(source, /api\.closeLibrarianConversation\(selected\.id\)/);
  });

  it('nombra y conserva separado el alcance elegido', () => {
    assert.match(source, /conversation\.status === 'closed'[\s\S]*`Archivado · \$\{conversation\.title\}/);
    assert.match(source, /selected\?\.scopeKind === 'page'/);
    assert.match(source, /selected\?\.scopeKind === 'block'/);
    assert.match(source, /return \{ kind: 'library', pageId: page\.id \}/);
  });

  it('mueve el envío al hilo antes de esperar la respuesta', () => {
    assert.match(source, /optimistic\.push\(pending\)/);
    assert.match(source, /composer\.value = ''[\s\S]*renderTurns\(view, true\)[\s\S]*api\.askLibrarian/);
    assert.match(source, /working\.classList\.add\('pending'\)/);
  });
});
