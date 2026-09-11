import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const outliner = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');

describe('autoría navegable en el historial de un bloque', () => {
  it('enlaza el nombre con el registro del participante estable', () => {
    assert.match(outliner, /author\.href = participantActivityPath\(state\.participant\)/);
    assert.match(outliner, /author\.textContent = state\.by/);
  });

  it('explica la acción pública antes de abrir y permite cerrar sin reabrir', () => {
    assert.match(outliner, /label: 'Ver historial del bloque'/);
    assert.match(outliner, /icon: 'clock'/);
    assert.match(outliner, /run: \(\) => showHistory\(node\.block\.stableId, row, toast, bullet\)/);
    assert.match(outliner, /shut\.addEventListener\('click', \(event\) => \{[\s\S]*?event\.stopPropagation\(\);[\s\S]*?panel\.remove\(\);[\s\S]*?returnFocus\?\.focus\(\)/);
  });

  it('permite copiar el bloque público aun cuando la superficie oculte su historial', () => {
    assert.match(outliner, /if \(target\.closest\('\.bullet'\) !== null\) return/);
    assert.match(outliner, /label: 'Copiar',[\s\S]*?icon: 'copy',[\s\S]*?copyText\(node\.block\.content, toast\)/);
    assert.match(outliner, /\.\.\.\(transparentBlockTraceability \? \[\{/);
  });
});
