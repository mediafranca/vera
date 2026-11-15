import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const outliner = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped} \\{[\\s\\S]*?\\n\\}`).exec(styles)?.[0] ?? '';
}

describe('superficie para crear y editar relaciones entre páginas', () => {
  it('usa una estructura lineal en vez de otra tarjeta redondeada', () => {
    const outline = rule('.relation-outline');
    assert.match(outline, /border-left: 1px/);
    assert.doesNotMatch(outline, /border-radius|background:/);
  });

  it('da a la explicación el ancho de la columna y no una ranura', () => {
    const field = rule('.relation-field');
    assert.match(field, /width: min\(100%, 46rem\)/);
    assert.match(field, /border-radius: 0/);
  });

  it('no ofrece pluma ni formalización en una proyección de sólo lectura', () => {
    const referenceStart = outliner.indexOf('const held = row.relation ?? undefined');
    const referenceEnd = outliner.indexOf("const link = document.createElement('div')", referenceStart);
    const referenceAuthoring = outliner.slice(referenceStart, referenceEnd);
    assert.match(referenceAuthoring, /if \(!readOnly\) \{/);
    assert.match(referenceAuthoring, /className = 'reference-explain'/);
    assert.match(
      outliner,
      /if \(!readOnly && member\.mentioned && !member\.linked && member\.formalization !== null\)/,
    );
    assert.doesNotMatch(outliner, /item\.append\(quill, link\)/);
  });
});
