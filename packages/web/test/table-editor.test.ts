import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { tabularClipboard } from '../src/table-editor.ts';

const editor = readFileSync(new URL('../src/table-editor.ts', import.meta.url), 'utf8');
const outliner = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('editor visual de tablas', () => {
  it('distingue texto ordinario de una matriz pegada', () => {
    assert.equal(tabularClipboard('una celda'), null);
    assert.deepEqual(tabularClipboard('a\tb\nc\td\n'), [['a', 'b'], ['c', 'd']]);
  });

  it('ofrece estructura, alineación y Markdown pequeño sin estado rico paralelo', () => {
    for (const action of ['add-row', 'remove-row', 'add-column', 'remove-column']) {
      assert.match(editor, new RegExp(`tableAction.*${action}|action: '${action}'`));
    }
    for (const alignment of ['left', 'center', 'right']) {
      assert.match(editor, new RegExp(`\\['${alignment}'`));
    }
    assert.match(editor, /resolveFormat\(\s*marker/);
    assert.match(editor, /resolveLink\(/);
    assert.match(editor, /writeMarkdownTable\(table\)/);
  });

  it('navega con Tab y Enter, guarda con Escape y admite pegado tabular', () => {
    assert.match(editor, /event\.key !== 'Tab' && event\.key !== 'Enter'/);
    assert.match(editor, /event\.key === 'Escape'/);
    assert.match(editor, /tabularClipboard\(event\.clipboardData/);
  });

  it('mantiene rutas distintas para editar la cuadrícula y la fuente', () => {
    assert.match(outliner, /openTableVisualEditor\(node, body, markdownTable\)/);
    assert.match(outliner, /derivedSourceFoot\('source', \(\) => openDerivedSourceEditor/);
    assert.match(outliner, /className = 'table-visual-edit'/);
    assert.match(outliner, /\.table-scroll th, \.table-scroll td/);
  });

  it('conserva una cuadrícula desplazable y una celda táctil enfocada', () => {
    assert.match(styles, /\.table-editor-scroll\s*\{[^}]*overflow:\s*auto/s);
    assert.match(styles, /\.table-cell-input\s*\{[^}]*min-height:\s*2\.45rem/s);
    assert.match(styles, /\.table-cell-input:focus\s*\{[^}]*var\(--accent\)/s);
  });
});
