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
    assert.doesNotMatch(outline, /border-radius|background:/);
    const declared = rule('.reference:is(.relation-declared, .relation-editing)');
    assert.match(declared, /border-left: 1px/);
    assert.doesNotMatch(declared, /border-radius|background:/);
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
    assert.match(outliner, /item\.classList\.add\('relation-declared'\)/);
    assert.match(outliner, /className = 'relation-add'/);
    assert.match(outliner, /add\.textContent = '\+ Relacionar otra página'/);
    assert.doesNotMatch(outliner, /reference-explain|concept-formalize/);
  });

  it('hace que el filete contenga la relación completa y no sólo su explicación', () => {
    assert.match(styles, /\.reference:is\(\.relation-declared, \.relation-editing\)\s*\{[^}]*border-left:/s);
    assert.doesNotMatch(styles, /\.relation-outline\s*\{[^}]*border-left:/s);
    assert.doesNotMatch(styles, /\.relation-ask\s*\{[^}]*border-left:/s);
  });

  it('la pluma alterna abrir y cerrar el mismo editor', () => {
    const editor = outliner.slice(outliner.indexOf('async function editRelation'));
    assert.match(outliner, /edit\.setAttribute\('aria-expanded', 'false'\)/);
    assert.match(editor, /host\.classList\.add\('relation-editing'\)/);
    assert.match(editor, /open\.remove\(\)/);
    assert.match(editor, /host\.classList\.remove\('relation-editing'\)/);
    assert.match(editor, /toggle\?\.setAttribute\('aria-expanded', 'false'\)/);
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
