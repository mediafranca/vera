import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = readFileSync(new URL('../src/setup.html', import.meta.url), 'utf8');

test('la primera ejecución pregunta por la biblioteca y su gobierno', () => {
  assert.match(source, /Nombre de la biblioteca/);
  assert.match(source, /value="personal" checked/);
  assert.match(source, /value="collective"/);
  assert.match(source, /Primera superficie compartida/);
  assert.match(source, /value="Superficie colectiva"/);
});

test('Lucienne es un nombre editable para la bibliotecaria de la persona', () => {
  assert.match(source, /Nombre de tu bibliotecaria/);
  assert.match(source, /id="librarian"[^>]+value="Lucienne"/);
  assert.match(source, /ownerLibrarianName: librarian\.value/);
});

test('el identificador histórico del grafo no aparece en la constitución', () => {
  assert.doesNotMatch(source, /mind/i);
});
