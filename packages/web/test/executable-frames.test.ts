import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

describe('protocolo de recintos ejecutables', () => {
  it('sincroniza apariencia al cargar y no responde a cada talla con otro mensaje', () => {
    const source = readFileSync(new URL('../src/executable-frames.ts', import.meta.url), 'utf8');
    assert.match(source, /frame\.addEventListener\('load', \(\) => send\(frame\)\)/);
    assert.match(source, /if \(frame\.style\.height !== height\) frame\.style\.height = height/);
    const heightHandler = /addEventListener\('message',[\s\S]*?\n\}\);/.exec(source)?.[0] ?? '';
    assert.ok(heightHandler !== '');
    assert.doesNotMatch(heightHandler, /send\(frame\)/);
  });
});
