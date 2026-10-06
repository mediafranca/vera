import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('las tablas conservan columnas legibles y desbordan dentro de su marco', () => {
  assert.match(
    styles,
    /\.table-scroll\s*\{[^}]*overflow-x:\s*auto/s,
    'una tabla ancha debe desplazarse sin ensanchar la página',
  );
  assert.match(
    styles,
    /\.body table\s*\{[^}]*width:\s*100%[^}]*table-layout:\s*auto/s,
    'las columnas deben distribuirse según su contenido',
  );
  assert.match(
    styles,
    /\.body th,\s*\.body td\s*\{[^}]*min-width:\s*7rem[^}]*overflow-wrap:\s*normal[^}]*word-break:\s*normal/s,
    'cada columna conserva un mínimo y las palabras no se parten letra por letra',
  );
});
