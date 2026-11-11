import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { governedArgumentMaturities } from '../src/argument-workbench-page.ts';

describe('mesa argumental gobernada', () => {
  it('ofrece sólo los valores declarados y conserva su orden', () => {
    assert.deepEqual(governedArgumentMaturities({
      properties: [{ key: 'tipo', value: 'Ensayo' }],
      objectTemplates: [{
        block: 'essay', name: 'Ensayo', properties: ['avance'], carrier: 'página',
        composition: { ordered: true, members: [] }, stageProperty: 'madurez argumental',
        capability: null, role: null, says: null,
      }],
      domains: {
        'madurez argumental': [
          { value: 'contexto', uses: 2, declared: true },
          { value: 'estructura', uses: 1, declared: true },
          { value: 'ensayo', uses: 4 },
          { value: 'argumento', uses: 8, declared: true },
        ],
      },
    }), ['contexto', 'estructura', 'argumento']);
  });

  it('no inventa una escala cuando el Gobierno no la declara', () => {
    assert.deepEqual(governedArgumentMaturities({
      properties: [], objectTemplates: [], domains: {},
    }), []);
  });
});
