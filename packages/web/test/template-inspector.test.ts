import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { OntologyView } from '../src/api.ts';
import { definitionForKey, derivedPropertySuggestion, inspectTemplate } from '../src/template-inspector.ts';
import { readFileSync } from 'node:fs';

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

  it('muestra preguntas globales, faltantes y adicionales sin mezclar relaciones', () => {
    const inspected = inspectTemplate({
      properties: [
        { key: 'type', value: 'Organization' },
        { key: 'website', value: 'https://example.org' },
        { key: 'color', value: 'azul' },
      ],
    }, ontology, 'tipo');
    assert.equal(inspected.template?.name, 'Organización');
    assert.deepEqual(inspected.properties.map((one) => [one.definition.name, one.written.length]), [
      ['tipo', 1], ['concepto', 0], ['url', 1],
    ]);
    assert.deepEqual(inspected.extra, [{ key: 'color', value: 'azul' }]);
    assert.equal('relations' in inspected, false);
  });

  it('proyecta sólo los huecos en la tabla canónica y no repite las presentes', () => {
    const source = readFileSync(new URL('../src/template-inspector.ts', import.meta.url), 'utf8');
    assert.match(source, /for \(const property of missing\)/);
    assert.match(source, /propertyTable\.append\(name, value\)/);
    assert.doesNotMatch(source, /template-property-list/);
  });

  it('deriva fecha sólo desde el título canónico de una bitácora', () => {
    const date: OntologyView['properties'][number] = {
      block: 'p:fecha', name: 'fecha', labels: { es: 'fecha' }, labelKeys: {}, field: 'fecha',
      many: false, role: null, subject: 'página', values: [], global: false, says: null, uses: 1,
    };
    assert.deepEqual(
      derivedPropertySuggestion({ title: '2026-11-15' }, 'bitácora', date),
      { value: '2026-11-15', reason: 'derivada del título canónico de esta bitácora' },
    );
    assert.equal(derivedPropertySuggestion({ title: '2026-11-15' }, 'Proyecto', date), null);
    assert.equal(derivedPropertySuggestion({ title: '15 de noviembre' }, 'bitácora', date), null);
  });

  it('deja las relaciones fuera del front matter', () => {
    const source = readFileSync(new URL('../src/template-inspector.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /kind: 'create_crossing'/);
    assert.doesNotMatch(source, /structural-relation-composer|template-relation-list/);
  });
});
