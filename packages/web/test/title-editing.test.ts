import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const fields = readFileSync(new URL('../src/fields.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const outliner = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('edición del título de una página', () => {
  it('usa una superficie multilínea sólo para el título', () => {
    assert.match(outliner, /editWrappedInPlace\(title, page\.title/);
    assert.match(fields, /document\.createElement\('textarea'\)/);
    assert.match(fields, /field\.className = 'inline-edit inline-edit-wrapped'/);
    assert.match(fields, /event\.key === 'Enter'[\s\S]+finish\(true\)/);
    assert.match(fields, /event\.key === 'Escape'[\s\S]+finish\(false\)/);
  });

  it('crece con el contenido y con el ancho disponible', () => {
    assert.match(fields, /field\.style\.height = 'auto'[\s\S]+field\.scrollHeight \+ border/);
    assert.match(fields, /field\.addEventListener\('input', fit\)/);
    assert.match(fields, /new ResizeObserver[\s\S]+observer\?\.observe\(host\)/);
    assert.match(styles, /\.inline-edit-wrapped\s*\{[^}]*overflow:\s*hidden[^}]*resize:\s*none[^}]*overflow-wrap:\s*anywhere/s);
  });

  it('mantiene visible el estado de edición y protege el borrador al reanudar', () => {
    assert.match(styles, /\.page-title \.inline-edit-wrapped\s*\{[^}]*background:\s*color-mix/s);
    assert.match(main, /'#text \.inline-edit, #text \.inline-boolean input, '/);
  });
});
