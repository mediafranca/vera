import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const outliner = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');

describe('participación desde un espacio compartido', () => {
  it('seguir un enlace inexistente crea la página cuando la sesión puede editar', () => {
    const opening = main.slice(main.indexOf('async function openTitle('), main.indexOf('/** Una página recién nacida'));
    assert.match(opening, /if \(isReadOnly\(\)\)/);
    assert.doesNotMatch(opening, /if \(isAnybody\(\)\)/);
    assert.match(opening, /created = await createPage\(title\)/);
  });

  it('una invitación identificada de sólo lectura conserva la conversación', () => {
    assert.match(main, /canAskLibrarian: corpus\?\.canAskLibrarian === true/);
    assert.match(outliner, /callbacks\.canAskLibrarian === true[\s\S]*Solicitar al bibliotecario/);
  });
});
