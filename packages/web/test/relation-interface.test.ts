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
    const reference = rule('.reference');
    assert.match(reference, /border-left: 1px solid transparent/);
    const declared = rule('.reference:is(.relation-declared, .relation-editing)');
    assert.match(declared, /border-left-color:/);
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
    assert.match(styles, /\.reference\s*\{[^}]*border-left: 1px solid transparent/s);
    assert.match(styles, /\.reference:is\(\.relation-declared, \.relation-editing\)\s*\{[^}]*border-left-color:/s);
    assert.match(styles, /\.reference \.backlink\s*\{[^}]*border-left: 0/s);
    assert.doesNotMatch(styles, /\.relation-outline\s*\{[^}]*border-left:/s);
    assert.doesNotMatch(styles, /\.relation-ask\s*\{[^}]*border-left:/s);
  });

  it('reserva margen, padding y ancho del filete antes de activarlo', () => {
    const reference = rule('.reference');
    const active = rule('.reference:is(.relation-declared, .relation-editing)');
    assert.match(reference, /margin: \.35rem 0/);
    assert.match(reference, /padding: \.15rem 0 \.3rem \.9rem/);
    assert.match(reference, /border-left: 1px solid transparent/);
    assert.doesNotMatch(active, /margin:|padding:|border-left:/);
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

  it('no repite el destino contextual ni usa botones genéricos de guardar o cancelar', () => {
    const editor = outliner.slice(outliner.indexOf('async function editRelation'));
    assert.match(editor, /if \(row === null\) asking\.append\(destination\)/);
    assert.match(editor, /'Declarar relación'/);
    assert.match(editor, /'Actualizar relación'/);
    assert.doesNotMatch(editor, /'Guardar relación'|'Guardar cambios'|cancel\.textContent = 'Cancelar'/);
  });

  it('cierra también el compositor global desde la misma acción que lo abre', () => {
    const editor = outliner.slice(outliner.indexOf('async function editRelation'));
    assert.match(outliner, /add\.setAttribute\('aria-expanded', 'false'\)/);
    assert.match(editor, /querySelector<HTMLButtonElement>\('\.relation-edit, \.relation-add'\)/);
  });

  it('pone relación y su selector en una fila sin una regla divisoria', () => {
    const type = rule('.relation-ask-type');
    assert.match(outliner, /caption\.textContent = 'Relación'/);
    assert.match(type, /display: flex/);
    assert.match(type, /align-items: baseline/);
    assert.doesNotMatch(type, /border-(?:top|bottom):/);
    assert.match(styles, /\.relation-ask-type input\s*\{[^}]*font: \.85rem\/1\.45 var\(--font-body\)/s);
  });

  it('precalienta y comparte el vocabulario antes de abrir el selector', () => {
    assert.match(outliner, /if \(typeof document !== 'undefined'\)/);
    assert.match(outliner, /void knownRelationTypes\(\)\.catch/);
    assert.match(outliner, /if \(relationTypeOptionsPending !== null\) return relationTypeOptionsPending/);
    assert.match(outliner, /document\.addEventListener\('vera:ontology-local-change', invalidateRelationTypes\)/);
  });
});
