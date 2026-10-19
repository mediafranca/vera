import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderMarkdown } from '../src/markdown.ts';
import { readMarkdownTable, writeMarkdownTable } from '../src/markdown-table.ts';

describe('tabla Markdown portable', () => {
  it('lee encabezado, cuerpo y alineación por columna', () => {
    assert.deepEqual(
      readMarkdownTable('| Nombre | Cuenta |\n| :--- | ---: |\n| **Ada** | `3` |'),
      {
        header: ['Nombre', 'Cuenta'],
        alignments: ['left', 'right'],
        rows: [['**Ada**', '`3`']],
      },
    );
  });

  it('no toma prosa ni una tabla irregular por el editor visual', () => {
    assert.equal(readMarkdownTable('antes\n| a | b |\n| --- | --- |'), null);
    assert.equal(readMarkdownTable('| a | b |\n| --- | --- |\n| sólo una |'), null);
  });

  it('conserva una barra escapada dentro de la celda', () => {
    const table = readMarkdownTable('| A | B |\n| --- | --- |\n| uno \\| dos | tres |');
    assert.deepEqual(table?.rows, [['uno \\| dos', 'tres']]);
  });

  it('serializa una tabla rectangular con Markdown en las celdas', () => {
    assert.equal(
      writeMarkdownTable({
        header: ['Nombre', 'Enlace'],
        alignments: ['center', 'right'],
        rows: [['**Ada**', '[sitio](https://example.com?a=1|2)']],
      }),
      '| Nombre | Enlace |\n| :---: | ---: |\n| **Ada** | [sitio](https://example.com?a=1\\|2) |',
    );
  });

  it('proyecta la alineación declarada sin inventar ancho persistente', () => {
    const html = renderMarkdown('| A | B | C |\n| --- | :---: | ---: |\n| 1 | 2 | 3 |');
    assert.match(html, /<th scope="col">A<\/th><th scope="col" data-align="center">B<\/th><th scope="col" data-align="right">C<\/th>/);
    assert.doesNotMatch(html, /width=/);
  });
});
