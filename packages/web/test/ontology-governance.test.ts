import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import type { OntologyView } from '../src/api.ts';
import {
  governanceDiagram,
  governanceNodeSize,
  reflectOntologyChange,
} from '../src/ontology-governance-map.ts';

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
const outliner = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');
const table = readFileSync(new URL('../src/table.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const map = readFileSync(new URL('../src/ontology-governance-map.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('gobierno ontológico facetado', () => {
  it('conserva las tres páginas rectoras como facetas operativas', () => {
    assert.match(governing, /type GoverningKind = 'objects' \| 'properties' \| 'relations'/);
    assert.match(governing, /api\.specialPages\(\)/);
    assert.match(governing, /callbacks\.onOpen|openFacet/);
    assert.match(governing, /`governing-facet facet-\$\{facet\.kind\} selected`/);
    assert.doesNotMatch(governing, /`governing-facet \$\{facet\.kind\}/);
    assert.match(styles, /governing-facet\.selected[\s\S]*?color-mix\(in srgb, var\(--ontology-kind\)/);
    assert.match(readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8'),
      /header\.after\(facets\)/);
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

  it('reserva la tarjeta completa para nombres largos y edición visual', () => {
    const short = governanceNodeSize({
      id: 'short', block: 'short', kind: 'relations', title: 'dialoga con', details: ['aprobada'],
    });
    const long = governanceNodeSize({
      id: 'long', block: 'long', kind: 'relations',
      title: 'es una relación constitutiva extraordinariamente extensa',
      details: ['↔ tiene una formulación inversa también extensa', 'aprobada'],
    }, true);
    const phone = governanceNodeSize({
      id: 'phone', block: 'phone', kind: 'relations', title: 'dialoga con', details: ['aprobada'],
    }, true, 1.4);
    assert.ok(long.width >= short.width);
    assert.ok(long.width <= 304);
    assert.ok(long.height > short.height);
    assert.ok(phone.height > governanceNodeSize({
      id: 'desktop', block: 'desktop', kind: 'relations', title: 'dialoga con', details: ['aprobada'],
    }, true).height);
  });

  it('explica las aristas una vez y distingue el rango por forma de línea', () => {
    assert.match(map, /ontology-government-legend/);
    assert.doesNotMatch(map, /kindNames: Record<GoverningKind, string>/);
    assert.match(map, /heading\.dataset\['facet'\] = facet/);
    assert.match(map, /facet === 'objects' \? 'Objetos'/);
    assert.match(map, /path\.classList\.add\(`edge-\$\{source\.label\}`\)/);
    assert.doesNotMatch(map, /createElementNS\(svg\.namespaceURI, 'text'\)/);
    assert.match(styles, /path\.edge-rango[\s\S]*?stroke-dasharray/);
  });

  it('distingue objetos, propiedades y relaciones con nombre y color', () => {
    for (const kind of ['objects', 'properties', 'relations']) {
      assert.match(styles, new RegExp(`legend-kind\\.${kind},[\\s\\S]*?node\\.${kind}`));
      assert.match(styles, new RegExp(`governing-facet\\.facet-${kind}`));
    }
    assert.match(styles, /border-inline-start: \.28rem solid var\(--ontology-kind\)/);
    assert.match(styles, /color-mix\(in srgb, var\(--ontology-kind\) 7%/);
  });

  it('reemplaza sólo el mapa ordinario mientras las tablas conservan sus operaciones', () => {
    assert.match(main, /governingKind\(openView\?\.properties/);
    assert.match(main, /diagram\.renderOntologyGovernanceMap\([\s\S]*?container,[\s\S]*?ontology,[\s\S]*?governing/);
    assert.match(main, /api\.submit\(change, 'drawn'\)/);
    assert.match(main, /vera:ontology-local-change/);
    assert.match(governing, /vera:ontology-focus/);
    for (const change of ['edit_block', 'set_property', 'remove_property']) {
      assert.match(governing, new RegExp(change));
    }
  });

  it('refleja una edición local en tabla y mapa sin reconstruir la página', () => {
    const local = structuredClone(ontology);
    assert.equal(reflectOntologyChange(local, {
      kind: 'set_property', block: 'person', propertyKey: 'propiedades', propertyValue: 'nombre, equipo',
    }), true);
    assert.deepEqual(local.objects[0]?.properties, ['nombre', 'equipo']);
    assert.match(table, /cell\.focus\(\{ preventScroll: true \}\)/);
    assert.match(table, /current = \[\.\.\.next\][\s\S]*?draw\(\)[\s\S]*?focusCurrent/);
    assert.doesNotMatch(
      outliner.slice(outliner.indexOf('void renderGoverning('), outliner.indexOf('const renderProcess')),
      /callbacks\.onReload/,
    );
  });

  it('pone el mapa a la izquierda y mantiene completa la ruta no visual', () => {
    assert.match(styles, /ontology-government-open\[data-layout='split'\][\s\S]*?'graph divider text'/);
    assert.match(map, /card\.tabIndex = 0/);
    assert.match(map, /event\.key !== 'Enter' && event\.key !== ' '/);
    assert.match(map, /setAttribute\('aria-label'/);
    assert.match(styles, /prefers-reduced-motion: reduce/);
    assert.match(styles, /ontology-government-node[\s\S]*?box-sizing: border-box/);
    assert.match(styles, /ontology-government-node[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
    assert.match(styles, /ontology-government-node strong,[\s\S]*?white-space: normal/);
  });

  it('conserva el espejo en móvil como alternancia explícita y reversible', () => {
    assert.match(governing, /Declaración/);
    assert.match(governing, /detail: \{ layout: 'graph_only' \}/);
    assert.match(map, /detail: \{ layout: 'text_only' \}/);
    assert.match(main, /vera:ontology-layout/);
    assert.match(main, /setLayout\(layout\)/);
    assert.match(styles, /\.ontology-mobile-switch[\s\S]*?grid-template-columns: 1fr 1fr/);
  });
});
