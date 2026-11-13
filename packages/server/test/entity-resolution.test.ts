import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { entityResolutionCandidates } from '../src/entity-resolution.ts';
import { inhabitedGraph, makeBlock, makePage, submit } from '../../core/test/helpers.ts';

const all = () => true;

describe('entityResolutionCandidates', () => {
  it('propone resolver un enlace pendiente mediante un rótulo alternativo sin escribirlo', () => {
    const graph = inhabitedGraph();
    const source = makePage(graph, 'Apunte');
    const target = makePage(graph, 'Pontificia Universidad Católica de Valparaíso');
    submit(graph, { kind: 'set_property', page: target, propertyKey: 'alias', propertyValue: 'PUCV' });
    const block = makeBlock(graph, source, 'Colabora con [[PUCV]] desde 2024.');

    const found = entityResolutionCandidates({ graph, page: source, canRead: all });

    assert.equal(graph.block(block)?.content, 'Colabora con [[PUCV]] desde 2024.');
    assert.equal(found.length, 1);
    assert.equal(found[0]?.kind, 'pending_link');
    assert.equal(found[0]?.status, 'proposable');
    assert.equal(found[0]?.matches[0]?.page, target);
    assert.equal(found[0]?.matches[0]?.matchedBy, 'alternative_label');
    assert.equal(found[0]?.draft?.next,
      'Colabora con [[Pontificia Universidad Católica de Valparaíso|PUCV]] desde 2024.');
  });

  it('conserva los homónimos como ambigüedad y no fabrica una propuesta', () => {
    const graph = inhabitedGraph();
    const source = makePage(graph, 'Notas de campo');
    const north = makePage(graph, 'Taller Norte');
    const south = makePage(graph, 'Taller Sur');
    submit(graph, { kind: 'set_property', page: north, propertyKey: 'alias', propertyValue: 'El Taller' });
    submit(graph, { kind: 'set_property', page: south, propertyKey: 'alias', propertyValue: 'El Taller' });
    makeBlock(graph, source, 'Volvimos a [[El Taller]].');

    const [found] = entityResolutionCandidates({ graph, page: source, canRead: all });

    assert.equal(found?.status, 'ambiguous');
    assert.equal(found?.draft, null);
    assert.deepEqual(found?.matches.map((one) => one.page).sort(), [north, south].sort());
  });

  it('formaliza una mención de título y preserva literalmente sus palabras visibles', () => {
    const graph = inhabitedGraph();
    const source = makePage(graph, 'Crónica');
    const target = makePage(graph, 'Ciudad Abierta');
    const block = makeBlock(graph, source, 'Llegamos a ciudad abierta al atardecer.');

    const [found] = entityResolutionCandidates({ graph, page: source, canRead: all });

    assert.equal(found?.kind, 'unlinked_mention');
    assert.equal(found?.matches[0]?.page, target);
    assert.equal(found?.draft?.next, 'Llegamos a [[Ciudad Abierta|ciudad abierta]] al atardecer.');
    assert.equal(graph.block(block)?.content, 'Llegamos a ciudad abierta al atardecer.');
  });

  it('excluye el territorio oculto antes de decidir si una grafía es ambigua', () => {
    const graph = inhabitedGraph();
    const source = makePage(graph, 'Informe');
    const visible = makePage(graph, 'Laboratorio Público');
    const hidden = makePage(graph, 'Laboratorio Privado');
    submit(graph, { kind: 'set_property', page: visible, propertyKey: 'alias', propertyValue: 'Laboratorio' });
    submit(graph, { kind: 'set_property', page: hidden, propertyKey: 'alias', propertyValue: 'Laboratorio' });
    makeBlock(graph, source, 'Trabajamos con [[Laboratorio]].');

    const [found] = entityResolutionCandidates({
      graph,
      page: source,
      canRead: (page) => page !== hidden,
    });

    assert.equal(found?.status, 'proposable');
    assert.deepEqual(found?.matches.map((one) => one.page), [visible]);
  });

  it('señala equivalencias posibles como revisión sin fusionar páginas', () => {
    const graph = inhabitedGraph();
    const source = makePage(graph, 'Escuela de Arquitectura y Diseño');
    const other = makePage(graph, 'e[ad]');
    submit(graph, { kind: 'set_property', page: source, propertyKey: 'alias', propertyValue: 'e[ad]' });

    const found = entityResolutionCandidates({ graph, page: source, canRead: all })
      .find((one) => one.kind === 'possible_equivalence');

    assert.equal(found?.status, 'review_only');
    assert.equal(found?.draft, null);
    assert.deepEqual(found?.matches.map((one) => one.page), [other]);
  });

  it('ignora código, enlaces ya formales y direcciones', () => {
    const graph = inhabitedGraph();
    const source = makePage(graph, 'Protecciones');
    makePage(graph, 'Ciudad Abierta');
    makeBlock(graph, source, '`Ciudad Abierta` [[Ciudad Abierta]] https://ejemplo.test/Ciudad-Abierta');

    assert.deepEqual(entityResolutionCandidates({ graph, page: source, canRead: all }), []);
  });

  it('no convierte una palabra común en entidad, pero conserva siglas gobernadas', () => {
    const graph = inhabitedGraph();
    const source = makePage(graph, 'Texto');
    makePage(graph, 'perfil');
    makePage(graph, 'Proyectos');
    const language = makePage(graph, 'nzsl');
    submit(graph, { kind: 'set_property', page: language, propertyKey: 'alias', propertyValue: 'NZSL' });
    makeBlock(graph, source, 'El perfil estudia NZSL dentro de varios proyectos.');

    const found = entityResolutionCandidates({ graph, page: source, canRead: all });

    assert.deepEqual(found.map((one) => one.written), ['NZSL']);
    assert.equal(found[0]?.matches[0]?.matchedBy, 'alternative_label');
  });
});
