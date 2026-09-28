import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ARGUMENT_KIND,
  ARGUMENT_PREPARATION_PHASES,
  argumentMaturity,
  argumentMaturityChanges,
  argumentPreparationPhase,
  isArgumentPreparation,
  isArgumentWork,
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

  it('reconoce una sola obra antes y después de alcanzar el estado publicable', () => {
    assert.equal(isArgumentWork([{ key: 'tipo', value: 'preparación argumental' }]), true);
    assert.equal(isArgumentWork([{ key: 'tipo', value: 'argumento' }]), true);
    assert.equal(isArgumentWork([{ key: 'tipo', value: 'nota' }]), false);
    assert.equal(
      argumentMaturity([
        { key: 'tipo', value: 'preparación argumental' },
        { key: 'madurez argumental', value: 'Validación' },
      ]),
      'validación',
    );
    assert.equal(argumentMaturity([{ key: 'tipo', value: 'argumento' }]), ARGUMENT_KIND);
  });

  it('termina y reabre la misma página mediante cambios atómicos de estado', () => {
    const prepared = [
      { key: 'tipo', value: 'preparación argumental' },
      { key: 'madurez argumental', value: 'validación' },
    ];
    assert.deepEqual(argumentMaturityChanges('page:work', prepared, 'argumento'), [
      {
        kind: 'set_property', page: 'page:work', propertyKey: 'tipo', propertyValue: 'argumento',
      },
      {
        kind: 'remove_property', page: 'page:work', propertyKey: 'madurez argumental',
      },
    ]);
    assert.deepEqual(argumentMaturityChanges(
      'page:work', [{ key: 'tipo', value: 'argumento' }], 'contexto',
    ), [
      {
        kind: 'set_property', page: 'page:work', propertyKey: 'tipo',
        propertyValue: 'preparación argumental',
      },
      {
        kind: 'set_property', page: 'page:work', propertyKey: 'madurez argumental',
        propertyValue: 'contexto',
      },
    ]);
  });
});
