import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BORN_KEY, dailyPageId, initialDateProperty } from '../src/pages.ts';

describe('fecha inicial de una página', () => {
  it('da al mismo día la misma identidad en todos los aparatos', () => {
    assert.equal(dailyPageId('2026-11-18'), 'page:day:2026-11-18');
  });

  it('fecha una bitácora con el día documentado en su título', () => {
    assert.deepEqual(initialDateProperty('2026-11-11', '2026-11-16'), {
      key: 'fecha',
      value: '2026-11-11',
    });
  });

  it('conserva el día de creación para una página ordinaria', () => {
    assert.deepEqual(initialDateProperty('MediaFranca', '2026-11-16'), {
      key: BORN_KEY,
      value: '2026-11-16',
    });
  });
});
