import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import type { OntologyView } from '../src/api.ts';
import { governanceDiagram } from '../src/ontology-governance-map.ts';

const ontology: OntologyView = {
  objects: [
    { block: 'person', name: 'Persona', properties: ['nombre'], role: null, says: null },
    { block: 'unit', name: 'Unidad', properties: ['nombre'], role: null, says: null },
  ],
  properties: [
    {
      block: 'name', name: 'nombre', field: 'texto', many: false, role: null,
      subject: 'página', values: [], says: null, uses: 2,
    },
  ],
  relations: [
    {
      block: 'directs', name: 'dirige', inverse: 'es dirigida por',
      domain: ['Persona'], range: ['Unidad'], symmetric: false, transitive: false,
      status: 'aprobada', says: null, external: [],
    },
  ],
  names: {}, fields: ['texto'], undeclared: [],
};

const governing = readFileSync(new URL('../src/governing-table.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const map = readFileSync(new URL('../src/ontology-governance-map.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('gobierno ontológico facetado', () => {
  it('conserva las tres páginas rectoras como facetas operativas', () => {
    assert.match(governing, /type GoverningKind = 'objects' \| 'properties' \| 'relations'/);
    assert.match(governing, /api\.specialPages\(\)/);
    assert.match(governing, /callbacks\.onOpen|openFacet/);
  });

  it('proyecta objetos sin inventar relaciones', () => {
    const diagram = governanceDiagram(ontology, 'objects');
    assert.deepEqual(diagram.nodes.map((one) => one.title), ['Persona', 'Unidad']);
    assert.equal(diagram.edges.length, 0);
  });

  it('explica qué objetos usan cada propiedad', () => {
    const diagram = governanceDiagram(ontology, 'properties');
    assert.equal(diagram.nodes.length, 3);
    assert.deepEqual(
      diagram.edges.map((one) => [one.source, one.target, one.label]),
      [
        ['objects:Persona', 'properties:nombre', 'usa'],
        ['objects:Unidad', 'properties:nombre', 'usa'],
      ],
    );
  });

  it('representa una relación como entidad gobernable entre dominio y rango', () => {
    const diagram = governanceDiagram(ontology, 'relations');
    assert.ok(diagram.nodes.some((one) => one.id === 'relations:dirige' && one.block === 'directs'));
    assert.deepEqual(
      diagram.edges.map((one) => [one.source, one.target, one.label]),
      [
        ['objects:Persona', 'relations:dirige', 'dominio'],
        ['relations:dirige', 'objects:Unidad', 'rango'],
      ],
    );
  });

  it('reemplaza sólo el mapa ordinario mientras las tablas conservan sus operaciones', () => {
    assert.match(main, /governingKind\(openView\?\.properties/);
    assert.match(main, /diagram\.renderOntologyGovernanceMap\([\s\S]*?container,[\s\S]*?ontology,[\s\S]*?governing/);
    assert.match(main, /api\.submitCanonical\(change, 'drawn'\)/);
    assert.match(governing, /vera:ontology-focus/);
    for (const change of ['edit_block', 'set_property', 'remove_property']) {
      assert.match(governing, new RegExp(change));
    }
  });

  it('pone la declaración a la izquierda y mantiene completa la ruta no visual', () => {
    assert.match(styles, /ontology-government-open\[data-layout='split'\][\s\S]*?'text divider graph'/);
    assert.match(map, /card\.tabIndex = 0/);
    assert.match(map, /event\.key !== 'Enter' && event\.key !== ' '/);
    assert.match(map, /setAttribute\('aria-label'/);
    assert.match(styles, /prefers-reduced-motion: reduce/);
  });
});
