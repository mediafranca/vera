import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const outliner = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('glosas de bloque', () => {
  it('conserva la marca Feather junto a la primera línea en vistas compactas', () => {
    assert.match(outliner, /toggle\.innerHTML = icon\('align-left'\)/);
    assert.match(styles, /\.gloss-toggle\s*\{[^}]*align-self:\s*flex-start/s);
    assert.match(styles, /\.gloss-toggle\s*\{[^}]*margin-top:\s*calc\(var\(--thread-y\) - 0\.75rem\)/s);
  });

  it('muestra bajo el medio la glosa de un bloque ancho en página completa', () => {
    assert.match(
      styles,
      /#vera-root\[data-layout='text_only'\] \.block\.wide-content > \.block-gloss:not\(\.empty\)\s*\{[^}]*display:\s*block/s,
    );
    assert.match(
      styles,
      /#vera-root\[data-layout='text_only'\] \.block\.wide-content:has\(> \.block-gloss:not\(\.empty\)\)\s*\{[^}]*flex-wrap:\s*wrap/s,
    );
  });

  it('pinta la glosa como Markdown y conserva sus enlaces antes de editar', () => {
    assert.match(outliner, /text\.innerHTML = renderMarkdown\(content, options\)/);
    assert.match(outliner, /decorateCodeBlocks\(text\)/);
    assert.match(outliner, /void renderMermaid\(text\)/);
    assert.match(outliner, /link\.classList\.contains\('wiki'\)/);
    assert.match(outliner, /link\.classList\.contains\('block-ref'\)/);
  });
});
