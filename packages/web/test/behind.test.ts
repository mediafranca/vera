// Lo que pasó desde el cursor: qué espera, qué toca lo abierto, qué choca.
//
// Ver specs/offline-reconciliation.allium. Lo que se fija aquí es que nada de esto
// decida por su cuenta: la aritmética contesta qué hay, y tomarlo es otro acto.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { behind, disagreements, said, sideBySide, type CanonicalOp } from '../src/behind.ts';

const op = (over: Partial<CanonicalOp> & { sequence: number }): CanonicalOp => ({
  originId: `op:${over.sequence}`,
  kind: 'edit_block',
  subjectId: 'block:1',
  page: 'page:1',
  authoredBy: 'participant:cotito',
  channel: 'agent_generation',
  ...over,
});

const nada = { mine: new Set<string>(), openPage: null, retained: new Set<string>() };

describe('qué espera', () => {
  it('cuenta lo que pasó desde el cursor y hasta dónde llegaría', () => {
    const state = behind([op({ sequence: 10 }), op({ sequence: 11 })], nada);
    assert.equal(state.waiting.length, 2);
    assert.equal(state.upTo, 11);
  });

  it('lo propio no espera: volvió por donde salió', () => {
    /*
     * El registro canónico es uno solo, así que lo que este aparato mandó vuelve
     * en la misma respuesta. Anunciárselo a quien lo escribió sería pedirle que
     * tome lo que acaba de dar. @invariant OriginIdentityIsTheIdempotencyKey.
     */
    const state = behind([op({ sequence: 10, originId: 'web:mío' }), op({ sequence: 11 })], {
      ...nada,
      mine: new Set(['web:mío']),
    });
    assert.equal(state.waiting.length, 1);
    assert.equal(state.waiting[0]?.op.sequence, 11);
  });

  it('pero el cursor avanza igual por lo propio', () => {
    // Si no, lo propio se preguntaría para siempre.
    const state = behind([op({ sequence: 10, originId: 'web:mío' })], {
      ...nada,
      mine: new Set(['web:mío']),
    });
    assert.equal(state.waiting.length, 0);
    assert.equal(state.upTo, 10);
  });

  it('distingue lo que tocó la página abierta', () => {
    const state = behind(
      [op({ sequence: 10, page: 'page:1' }), op({ sequence: 11, page: 'page:otra' })],
      { ...nada, openPage: 'page:1' },
    );
    assert.equal(state.here, 1);
    assert.equal(state.waiting.length, 2);
  });

  it('sin página abierta, nada toca aquí', () => {
    const state = behind([op({ sequence: 10 })], nada);
    assert.equal(state.here, 0);
  });

  it('una operación de la que no se sabe la página no se cuenta como de aquí', () => {
    // `remove_block` preguntado cuando el bloque ya no está: no se puede saber
    // dónde vivía, y suponer que fue aquí sería inventarlo.
    const state = behind([op({ sequence: 10, page: null })], { ...nada, openPage: 'page:1' });
    assert.equal(state.here, 0);
    assert.equal(state.waiting.length, 1);
  });
});

describe('lo retenido que dejó de estar al día', () => {
  it('una página guardada que otra mano tocó se anota', () => {
    const state = behind([op({ sequence: 10, page: 'page:vieja' })], {
      ...nada,
      openPage: 'page:1',
      retained: new Set(['page:vieja']),
    });
    assert.deepEqual(state.staleElsewhere, ['page:vieja']);
  });

  it('la página abierta no se anota ahí: se resuelve mirándola', () => {
    const state = behind([op({ sequence: 10, page: 'page:1' })], {
      ...nada,
      openPage: 'page:1',
      retained: new Set(['page:1']),
    });
    assert.deepEqual(state.staleElsewhere, []);
  });

  it('lo propio no se anuncia, pero invalida la copia retenida incluso si estaba abierta', () => {
    const state = behind([op({ sequence: 10, originId: 'web:mío', page: 'page:1' })], {
      ...nada,
      mine: new Set(['web:mío']),
      openPage: 'page:1',
      retained: new Set(['page:1']),
    });
    assert.equal(state.waiting.length, 0);
    assert.deepEqual(state.staleElsewhere, ['page:1']);
  });

  it('una página que no se tenía guardada no se anota: no hay nada viejo que corregir', () => {
    const state = behind([op({ sequence: 10, page: 'page:ajena' })], nada);
    assert.deepEqual(state.staleElsewhere, []);
  });

  it('no se repite aunque la tocaran diez veces', () => {
    const ops = [10, 11, 12].map((sequence) => op({ sequence, page: 'page:vieja' }));
    const state = behind(ops, { ...nada, retained: new Set(['page:vieja']) });
    assert.deepEqual(state.staleElsewhere, ['page:vieja']);
  });
});

describe('cómo se dice', () => {
  it('con nada esperando no se dice nada', () => {
    assert.equal(said(behind([], nada)), null);
  });

  it('lo que tocó esta página se dice distinto de lo que tocó el corpus', () => {
    const aquí = said(behind([op({ sequence: 10 })], { ...nada, openPage: 'page:1' }));
    const allá = said(behind([op({ sequence: 10, page: 'page:otra' })], { ...nada, openPage: 'page:1' }));
    assert.match(aquí?.message ?? '', /aquí/);
    assert.doesNotMatch(allá?.message ?? '', /aquí/);
  });

  it('nombra la mano que escribió, sin el prefijo de la máquina', () => {
    const dicho = said(behind([op({ sequence: 10 })], { ...nada, openPage: 'page:1' }));
    assert.match(dicho?.title ?? '', /Cotito/);
    assert.doesNotMatch(dicho?.title ?? '', /participant:/);
  });
});

/*
 * El desacuerdo: dos manos y el mismo bloque.
 *
 * Lo que otra mano cambió y aquí nadie tocó no es un desacuerdo: es lo nuevo, y se
 * toma sin preguntar. Preguntar por cada bloque convertiría una decisión en
 * cincuenta.
 */
describe('el desacuerdo', () => {
  it('sale donde lo pendiente y el corpus dicen cosas distintas del mismo bloque', () => {
    const found = disagreements(
      new Map([['block:1', 'lo que dice el corpus']]),
      [{ block: 'block:1', content: 'lo que escribí aquí' }],
      new Map([['block:1', 'participant:cotito']]),
    );
    assert.equal(found.length, 1);
    assert.equal(found[0]?.mine, 'lo que escribí aquí');
    assert.equal(found[0]?.theirs, 'lo que dice el corpus');
    assert.equal(found[0]?.hand, 'Cotito');
  });

  it('si dicen lo mismo no hay desacuerdo', () => {
    const found = disagreements(
      new Map([['block:1', 'igual']]),
      [{ block: 'block:1', content: 'igual' }],
      new Map(),
    );
    assert.deepEqual(found, []);
  });

  it('un bloque que el corpus no cambió no es un desacuerdo', () => {
    const found = disagreements(new Map(), [{ block: 'block:1', content: 'mío' }], new Map());
    assert.deepEqual(found, []);
  });

  it('de varias ediciones pendientes del mismo bloque vale la última', () => {
    // Es la que se va a mandar y la que se está mirando en pantalla.
    const found = disagreements(
      new Map([['block:1', 'del corpus']]),
      [
        { block: 'block:1', content: 'primer intento' },
        { block: 'block:1', content: 'como quedó' },
      ],
      new Map(),
    );
    assert.equal(found.length, 1);
    assert.equal(found[0]?.mine, 'como quedó');
  });

  it('varios bloques salen en el orden en que se escribieron', () => {
    const found = disagreements(
      new Map([
        ['block:1', 'a'],
        ['block:2', 'b'],
      ]),
      [
        { block: 'block:1', content: 'uno' },
        { block: 'block:2', content: 'dos' },
      ],
      new Map(),
    );
    assert.deepEqual(found.map((one) => one.block), ['block:1', 'block:2']);
  });
});

describe('las líneas que difieren', () => {
  it('marca sólo lo que cambió, y deja igual el casco común', () => {
    const { mine, theirs } = sideBySide(
      'La rejilla se vuelve generativa\ny eso decide el resto.',
      'La rejilla se vuelve generativa\ny de ahí sale la familia.',
    );
    assert.deepEqual(mine.map((l) => l.mark), ['same', 'mine']);
    assert.deepEqual(theirs.map((l) => l.mark), ['same', 'theirs']);
  });

  it('reconoce el casco por detrás además de por delante', () => {
    const { mine, theirs } = sideBySide('uno\nDOS\ntres', 'uno\ndos\ntres');
    assert.deepEqual(mine.map((l) => l.mark), ['same', 'mine', 'same']);
    assert.deepEqual(theirs.map((l) => l.mark), ['same', 'theirs', 'same']);
  });

  it('dos textos sin nada en común se marcan enteros', () => {
    const { mine, theirs } = sideBySide('esto', 'aquello');
    assert.deepEqual(mine.map((l) => l.mark), ['mine']);
    assert.deepEqual(theirs.map((l) => l.mark), ['theirs']);
  });

  it('dos textos iguales no marcan nada', () => {
    const { mine, theirs } = sideBySide('lo mismo', 'lo mismo');
    assert.deepEqual(mine.map((l) => l.mark), ['same']);
    assert.deepEqual(theirs.map((l) => l.mark), ['same']);
  });

  it('una versión que sólo añade líneas al final las marca a ellas', () => {
    const { mine, theirs } = sideBySide('uno', 'uno\ndos');
    assert.deepEqual(mine.map((l) => l.mark), ['same']);
    assert.deepEqual(theirs.map((l) => l.mark), ['same', 'theirs']);
  });
});
