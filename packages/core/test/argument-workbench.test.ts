import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  argumentMaturity,
  argumentMaturityChanges,
  isArgumentPreparation,
  isArgumentWork,
} from '../src/index.ts';

describe('la preparación argumental', () => {
  it('acepta la clase antigua sólo para migrarla y reconoce Argumento como objeto estable', () => {
    assert.equal(
      isArgumentPreparation([{ key: 'tipo', value: 'preparación argumental' }]),
      true,
    );
    assert.equal(isArgumentPreparation([{ key: 'tipo', value: 'Argumento' }]), true);
    assert.equal(isArgumentPreparation([
      { key: 'tipo', value: 'Argumento' },
      { key: 'madurez argumental', value: 'argumento' },
    ]), false);
  });

  it('toma la escala del Gobierno y conserva su grafía canónica', () => {
    const governed = ['contexto', 'estructura', 'composición', 'validación', 'argumento'];
    assert.equal(isArgumentWork([{ key: 'tipo', value: 'preparación argumental' }]), true);
    assert.equal(isArgumentWork([{ key: 'tipo', value: 'Argumento' }]), true);
    assert.equal(isArgumentWork([{ key: 'tipo', value: 'nota' }]), false);
    assert.equal(
      argumentMaturity([
        { key: 'tipo', value: 'Argumento' },
        { key: 'madurez argumental', value: 'Validación' },
      ], 'tipo', governed),
      'validación',
    );
    assert.equal(argumentMaturity([{ key: 'tipo', value: 'Argumento' }]), null);
  });

  it('cambia sólo la madurez y migra el tipo legado en el mismo lote', () => {
    const prepared = [
      { key: 'tipo', value: 'preparación argumental' },
      { key: 'madurez argumental', value: 'validación' },
    ];
    assert.deepEqual(argumentMaturityChanges('page:work', prepared, 'argumento'), [
      {
        kind: 'set_property', page: 'page:work', propertyKey: 'tipo', propertyValue: 'argumento',
      },
      {
        kind: 'set_property', page: 'page:work', propertyKey: 'madurez argumental',
        propertyValue: 'argumento',
      },
    ]);
    assert.deepEqual(argumentMaturityChanges(
      'page:work', [
        { key: 'tipo', value: 'argumento' },
        { key: 'madurez argumental', value: 'argumento' },
      ], 'contexto',
    ), [
      {
        kind: 'set_property', page: 'page:work', propertyKey: 'madurez argumental',
        propertyValue: 'contexto',
      },
    ]);
  });
});
