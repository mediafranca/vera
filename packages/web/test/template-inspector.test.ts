import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { OntologyView } from '../src/api.ts';
import { definitionForKey, inspectTemplate } from '../src/template-inspector.ts';

const ontology: OntologyView = {
  properties: [
    { block: 'p:tipo', name: 'tipo', labels: { es: 'tipo', en: 'type' }, labelKeys: {}, field: 'una de', many: false, role: 'kind', subject: 'página', values: [], global: true, says: null, uses: 2 },
    { block: 'p:concepto', name: 'concepto', labels: { es: 'concepto', en: 'topic' }, labelKeys: {}, field: 'enlace', many: true, role: null, subject: 'página', values: [], global: true, says: null, uses: 2 },
    { block: 'p:url', name: 'url', labels: { es: 'url', en: 'website' }, labelKeys: {}, field: 'texto', many: false, role: null, subject: 'página', values: [], global: false, says: null, uses: 1 },
  ],
  objects: [{ block: 'o:org', name: 'Organización', labels: { es: 'Organización', en: 'Organization' }, labelKeys: {}, properties: ['url'], carrier: 'página', composition: null, stageProperty: null, capability: null, role: null, says: null }],
  relations: [{ block: 'r:part', name: 'forma parte de', labels: { es: 'forma parte de' }, labelKeys: {}, inverse: 'comprende', domain: ['Organización'], range: ['Organización'], symmetric: false, transitive: false, status: 'aprobada', function: 'descriptiva', scope: 'directo', inheritedThrough: null, verifiedBy: null, says: null, external: [] }],
  names: { kind: 'tipo' }, fields: ['texto'], undeclared: [],
};

describe('inspector de plantilla', () => {
  it('resuelve rótulos lingüísticos sin duplicar propiedades', () => {
    assert.equal(definitionForKey(ontology.properties, 'website')?.block, 'p:url');
  });

  it('muestra preguntas globales, faltantes, adicionales y relaciones posibles', () => {
    const inspected = inspectTemplate({
      properties: [
        { key: 'type', value: 'Organization' },
        { key: 'website', value: 'https://example.org' },
        { key: 'color', value: 'azul' },
      ],
      crossingsOut: [], crossingsIn: [],
    }, ontology, 'tipo');
    assert.equal(inspected.template?.name, 'Organización');
    assert.deepEqual(inspected.properties.map((one) => [one.definition.name, one.written.length]), [
      ['tipo', 1], ['concepto', 0], ['url', 1],
    ]);
    assert.deepEqual(inspected.extra, [{ key: 'color', value: 'azul' }]);
    assert.deepEqual(inspected.relations.map((one) => one.name), ['forma parte de']);
  });
});
