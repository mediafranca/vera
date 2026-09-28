import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ARGUMENT_PREPARATION_PHASES,
  argumentPreparationPhase,
  isArgumentPreparation,
} from '../src/index.ts';

describe('la preparación argumental', () => {
  it('es un tipo propio y no una variante implícita de argumento', () => {
    assert.equal(
      isArgumentPreparation([{ key: 'tipo', value: 'preparación argumental' }]),
      true,
    );
    assert.equal(isArgumentPreparation([{ key: 'tipo', value: 'argumento' }]), false);
  });

  it('puede nacer sin que el origen del material decida su madurez', () => {
    assert.equal(
      argumentPreparationPhase([{ key: 'tipo', value: 'preparación argumental' }]),
      null,
    );
  });

  it('limita la mesa a estados preparatorios y deja argumento para la transición final', () => {
    assert.deepEqual(ARGUMENT_PREPARATION_PHASES, [
      'contexto',
      'estructura',
      'composición',
      'validación',
    ]);
    assert.equal(
      argumentPreparationPhase([{ key: 'madurez argumental', value: 'Composición' }]),
      'composición',
    );
    assert.equal(
      argumentPreparationPhase([{ key: 'madurez argumental', value: 'argumento' }]),
      null,
    );
  });
});
