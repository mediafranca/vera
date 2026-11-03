import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('custodia Desktop del secreto de Lucienne', () => {
  it('cifra el valor y sólo expone estado y reemplazo al cliente', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    const preload = readFileSync(new URL('../src/preload.ts', import.meta.url), 'utf8');
    assert.match(main, /safeStorage\.encryptString\(JSON\.stringify\(state\)\)/);
    assert.match(main, /VERA_LIBRARIAN_API_KEY/);
    assert.match(preload, /veraLibrarianSecret/);
    assert.doesNotMatch(preload, /readLibrarianSecret|apiKey:\s*\(\)/);
  });
});
