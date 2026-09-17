import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('edición dentro de la bitácora continua', () => {
  it('un hoy todavía vacío continúa hacia el último día que sí existe', () => {
    const provisional = main.slice(
      main.indexOf('function drawUnstartedDay'),
      main.indexOf('/**\n * Hace nacer el día', main.indexOf('function drawUnstartedDay')),
    );
    assert.match(provisional, /continueBackwards\(date, 0\)/);

    const continuation = main.slice(
      main.indexOf('function continueBackwards'),
      main.indexOf('/**\n * Un día anterior', main.indexOf('function continueBackwards')),
    );
    assert.match(continuation, /days\.findIndex\(\(candidate\) => candidate\.title < from\)/);
    assert.doesNotMatch(continuation, /if \(here < 0/);
  });

  it('cada día anterior se redibuja por su propia identidad sin navegar al día activo', () => {
    assert.match(main, /renderOutliner\(slice, older, callbacksForJournalSlice\(older, slice\)/);
    const local = main.slice(
      main.indexOf('function callbacksForJournalSlice'),
      main.indexOf('/**\n * Lo que el outliner puede pedirle', main.indexOf('function callbacksForJournalSlice')),
    );
    assert.match(local, /api\.page\(page\.id\)/);
    assert.doesNotMatch(local, /openPage\(workspace\.activePage/);
  });
});
