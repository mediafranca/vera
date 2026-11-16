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

  it('concentra la autoría en un editor saliente y la oculta en sólo lectura', () => {
    assert.match(outliner, /if \(!readOnly && gesture === 'followed_reference'\)/);
    assert.match(outliner, /className = 'relation-edit'/);
    assert.match(outliner, /edit\.innerHTML = icon\('feather'\)/);
    assert.match(outliner, /relationLine\.append\(edit\)/);
    assert.match(outliner, /className = 'relation-add'/);
    assert.match(outliner, /add\.textContent = '\+ Relacionar otra página'/);
    assert.doesNotMatch(outliner, /reference-explain|concept-formalize/);
  });

  it('pide destino, tipo y explicación en un solo formulario', () => {
    const editor = outliner.slice(outliner.indexOf('async function editRelation'));
    assert.match(editor, /className = 'relation-target'/);
    assert.match(editor, /relationTypeField/);
    assert.match(editor, /className = 'relation-field'/);
    assert.match(editor, /kind: 'create_crossing'/);
    assert.match(editor, /submitCanonicalBatch\(changes\)/);
  });
});
