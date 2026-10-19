import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  changeTableHeaderAxis,
  newMarkdownTable,
  newMarkdownTableSource,
  tableHeaderAxis,
  tabularClipboard,
} from '../src/table-editor.ts';

const editor = readFileSync(new URL('../src/table-editor.ts', import.meta.url), 'utf8');
const outliner = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('editor visual de tablas', () => {
  it('distingue texto ordinario de una matriz pegada', () => {
    assert.equal(tabularClipboard('una celda'), null);
    assert.deepEqual(tabularClipboard('a\tb\nc\td\n'), [['a', 'b'], ['c', 'd']]);
  });

  it('ofrece estructura, alineación y Markdown pequeño sin estado rico paralelo', () => {
    for (const action of [
      'add-row', 'remove-row', 'add-column', 'remove-column', 'header-row', 'header-column',
    ]) {
      assert.match(editor, new RegExp(`tableAction.*${action}|action: '${action}'`));
    }
    for (const alignment of ['left', 'center', 'right']) {
      assert.match(editor, new RegExp(`\\['${alignment}'`));
    }
    assert.match(editor, /resolveFormat\(\s*marker/);
    assert.match(editor, /resolveLink\(/);
    assert.match(editor, /writeMarkdownTable\(table\)/);
  });

  it('crea el tamaño y el eje elegidos por /tabla', () => {
    const row = newMarkdownTable(3, 4, 'row');
    assert.equal(row.header.length, 4);
    assert.equal(row.rows.length, 2);
    assert.equal(tableHeaderAxis(row), 'row');

    const column = newMarkdownTable(3, 4, 'column');
    assert.equal(column.header.length, 4);
    assert.equal(column.rows.length, 3);
    assert.equal(tableHeaderAxis(column), 'column');
    assert.match(newMarkdownTableSource(2, 2, 'column'), /\| Fila 1 \|  \|/);
    assert.match(outliner, /acts === 'tabla'/);
    assert.match(outliner, /acts === 'tabla'[\s\S]*?window\.clearTimeout\(timer\)/);
    assert.match(outliner, /choosingAttachment \|\| choosingTable/);
  });

  it('cambia las cabeceras de fila a columna sin perder ni duplicar celdas', () => {
    const original = {
      header: ['A', 'B'],
      alignments: ['left', 'left'] as const,
      rows: [['C', 'D']],
    };
    const column = changeTableHeaderAxis(original, 'column');
    assert.deepEqual(column.header, ['', '']);
    assert.deepEqual(column.rows, [['A', 'C'], ['B', 'D']]);
    assert.deepEqual(changeTableHeaderAxis(column, 'row'), original);
  });

  it('usa los mismos iconos Lucide que la barra Markdown', () => {
    for (const name of ['bold', 'italic', 'code', 'link']) {
      assert.match(editor, new RegExp(`button\\('${name}'`));
    }
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
