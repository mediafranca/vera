import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  insertFootnote,
  insertMarkdownFragment,
  nextFootnoteId,
  pageTableOfContents,
} from '../src/editorial.ts';

describe('notas al pie editoriales', () => {
  it('elige un identificador libre en toda la página', () => {
    assert.equal(nextFootnoteId(['Uno[^1]', '[^2]: Dos', 'Código [^4]']), '3');
  });

  it('conserva la prosa, pone la referencia y abre su definición', () => {
    assert.deepEqual(insertFootnote('Una frase', 3, 9, ['Otra[^1]']), {
      buffer: 'Una frase[^2]\n\n[^2]: ',
      selectionStart: 21,
      selectionEnd: 21,
    });
  });
});

describe('índice de página', () => {
  it('sigue orden, jerarquía, formato visible y encabezados repetidos', () => {
    assert.equal(pageTableOfContents([
      '# **Entrada**',
      '## Detalle\n```md\n# No es sección\n```',
      '# Entrada',
    ]), [
      '- [Entrada](#entrada)',
      '  - [Detalle](#detalle)',
      '- [Entrada](#entrada-1)',
    ].join('\n'));
  });

  it('no inventa un índice sin encabezados', () => {
    assert.equal(pageTableOfContents(['prosa', '- lista']), null);
  });

  it('separa el índice de la prosa vecina', () => {
    assert.deepEqual(insertMarkdownFragment('Antes después', 5, '- [Uno](#uno)'), {
      buffer: 'Antes\n- [Uno](#uno)\n después',
      selectionStart: 19,
      selectionEnd: 19,
    });
  });
});
