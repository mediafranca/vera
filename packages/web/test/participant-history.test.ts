import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const outliner = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('autoría navegable en el historial de un bloque', () => {
  it('enlaza el nombre con el registro del participante estable', () => {
    assert.match(outliner, /author\.href = participantActivityPath\(state\.participant\)/);
    assert.match(outliner, /author\.textContent = state\.by/);
  });

  it('abre un único inspector modeless fuera del flujo y devuelve el foco al cerrar', () => {
    assert.match(outliner, /label: 'Ver historial del bloque'/);
    assert.match(outliner, /icon: 'clock'/);
    assert.match(outliner, /run: \(\) => showHistory\(node\.block\.stableId, bullet, toast\)/);
    assert.match(outliner, /panel\.setAttribute\('role', 'dialog'\)/);
    assert.match(outliner, /panel\.setAttribute\('aria-modal', 'false'\)/);
    assert.match(outliner, /document\.body\.append\(panel\)/);
    assert.match(outliner, /closeHistoryInspector\(\)/);
    assert.match(outliner, /\.block\[data-id=.*?\.bullet.*?\?\.focus\(\)/s);
    assert.match(outliner, /historyPage !== null && historyPage !== page\.id/);
    assert.match(styles, /\.history-inspector \{[\s\S]*?position: fixed;[\s\S]*?resize: both;/);
  });

  it('permite arrastrar el inspector y lo vuelve hoja inferior en una pantalla estrecha', () => {
    assert.match(outliner, /dragHistoryInspector\(panel, head\)/);
    assert.match(outliner, /handle\.setPointerCapture\(event\.pointerId\)/);
    assert.match(outliner, /event\.key !== 'Escape'/);
    assert.match(styles, /@media \(max-width: 640px\) \{[\s\S]*?\.history-inspector \{[\s\S]*?inset: auto 0 0 0 !important;[\s\S]*?resize: none;/);
  });

  it('permite copiar el bloque público aun cuando la superficie oculte su historial', () => {
    assert.match(outliner, /if \(target\.closest\('\.bullet'\) !== null\) return/);
    assert.match(outliner, /label: 'Copiar',[\s\S]*?icon: 'copy',[\s\S]*?copyText\(node\.block\.content, toast\)/);
    assert.match(outliner, /\.\.\.\(transparentBlockTraceability \? \[\{/);
  });
});

describe('guías de jerarquía del outliner', () => {
  it('marca sólo bloques anidados y deriva la guía del mismo paso de sangría', () => {
    assert.match(outliner, /row\.className = depth === 0 \? 'block' : 'block nested'/);
    assert.match(outliner, /'--block-indent-step'/);
    assert.match(styles, /\.block\.nested::before \{[\s\S]*?width: var\(--block-indent\);[\s\S]*?var\(--block-indent-step\)/);
    assert.match(styles, /color-mix\(in srgb, var\(--text-dim\) 14%, transparent\)/);
  });
});
