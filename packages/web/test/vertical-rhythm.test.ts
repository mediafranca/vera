import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('los objetos de página reservan una línea tipográfica antes y después', () => {
  assert.match(
    styles,
    /\.body > :is\(\.table-scroll, img, \.mermaid-figure, \.executable, \.embed\),\s*\.body-text > :is\(\.table-scroll, img, \.mermaid-figure, \.executable, \.embed\)\s*\{[^}]*margin-block: calc\(var\(--text-size, 16px\) \* var\(--line-height\)\)/s,
  );
  assert.match(
    styles,
    /:first-child:not\(:is\([^)]*\.table-scroll, img, \.mermaid-figure, \.executable, \.embed\)\)/,
  );
  assert.match(
    styles,
    /:last-child:not\(:is\(\.table-scroll, img, \.mermaid-figure, \.executable, \.embed\)\)/,
  );
});

test('el ritmo vertical abraza el dibujo completo y no separa su pie', () => {
  assert.match(
    styles,
    /\.body\.drawn-body\s*\{[^}]*margin-block: calc\(var\(--text-size, 16px\) \* var\(--line-height\)\)/s,
  );
  assert.match(
    styles,
    /\.body\.drawn-body > \.body-text > \.drawn,\s*\.body\.drawn-body > \.drawn-foot\s*\{[^}]*margin-block: 0/s,
  );
});
