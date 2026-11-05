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

test('ofrece inferencia remota sólo mediante el almacén seguro', () => {
  assert.match(source, /Inferencia de la bibliotecaria/);
  assert.match(source, /name="inference" value="later" checked/);
  assert.match(source, /name="inference" value="configure"/);
  assert.match(source, /id="api-key"[^>]+type="password"/);
  assert.match(source, /window\.veraSetup\.capabilities\(\)/);
  assert.match(source, /remote\.disabled = true/);
  assert.match(source, /Nunca se escribe en la base ni en la bitácora/);
});

test('pide permiso explícito para preparar voz y admite dejarla pendiente', () => {
  assert.match(source, /Escuchar y hablar/);
  assert.match(source, /name="voice" value="later" checked/);
  assert.match(source, /name="voice" value="install"/);
  assert.match(source, /Preparar voz local ahora/);
  assert.match(source, /Vera comprobará lo que realmente quedó instalado/);
});

test('anticipa el corpus inicial y la bitácora de instalación', () => {
  assert.match(source, /Ontología editable, manual, primeros pasos/);
  assert.match(source, /una bitácora privada de hoy/);
});

test('el identificador histórico del grafo no aparece en la constitución', () => {
  assert.doesNotMatch(source, /mind/i);
});
