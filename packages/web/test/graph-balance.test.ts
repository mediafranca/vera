import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { graphBalance, graphBalanceLabel } from '../src/graph/balance.ts';

describe('calibración continua del mapa', () => {
  it('expone extremos fuertes y un centro realmente híbrido', () => {
    assert.deepEqual(graphBalance(0), { value: 0, links: 4, concepts: 0, lens: 'links' });
    assert.deepEqual(graphBalance(50), { value: 50, links: 2, concepts: 2, lens: 'hybrid' });
    assert.deepEqual(graphBalance(100), { value: 100, links: 0, concepts: 4, lens: 'concepts' });
    assert.equal(graphBalanceLabel(75), 'Enlaces 1.0× · Conceptos 3.0×');
    assert.deepEqual(graphBalance(37), { value: 37, links: 2.52, concepts: 1.48, lens: 'hybrid' });
  });

  it('acota valores persistidos fuera del rango', () => {
    assert.equal(graphBalance(-20).value, 0);
    assert.equal(graphBalance(140).value, 100);
    assert.equal(graphBalance(Number.NaN).value, 50);
  });
});
