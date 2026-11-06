import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { VeraGraph, type Change } from '@vera/core';
import { BIBLIOGRAPHY_NAMES, blocksFor, propertiesFor, servicePages, titleFor } from '../src/services.ts';
import { readItem } from '../src/zotero.ts';

const item = {
  key: 'ABCD1234',
  version: 42,
  itemType: 'book',
  title: 'El diseño de lo cotidiano',
  creators: ['Norman, Donald'],
  date: '2013-11-05',
  publication: null,
  publisher: 'Basic Books',
  doi: null,
  isbn: '978-0465050659',
  url: null,
  abstract: 'Sobre por qué las puertas se empujan cuando había que tirar.',
  tags: ['diseño'],
};

describe('servicePages', () => {
  const connection = (access?: string) => {
    const graph = VeraGraph.create({ name: 'mind', id: 'graph:services' });
    graph.addParticipant({ id: 'participant:herbert', name: 'Herbert', kind: 'human' });
    graph.admit('participant:herbert');
    let sequence = 0;
    const write = (change: Change): string => {
      const done = graph.submitOperation({
        originId: `service:${sequence += 1}`,
        participant: 'participant:herbert',
        channel: 'typed_text',
        change,
      });
      assert.equal(done.status, 'applied');
      return done.subjectId;
    };
    const page = write({ kind: 'create_page', title: 'Zotero', visibility: 'private' });
    write({ kind: 'set_property', page, propertyKey: 'special-kind', propertyValue: 'service' });
    write({ kind: 'set_property', page, propertyKey: 'servicio', propertyValue: 'zotero' });
    if (access !== undefined) write({ kind: 'set_property', page, propertyKey: 'acceso', propertyValue: access });
    return servicePages(graph, 'special-kind')[0]!;
  };

  it('es sólo lectura mientras la página no conceda escritura', () => {
    assert.equal(connection().access, 'read');
  });

  it('separa la autorización local de la capacidad de la clave', () => {
    assert.equal(connection('lectura y escritura').access, 'read-write');
  });
});

describe('readItem', () => {
  it('lee un ítem de Zotero y deja lo que a Vera le sirve', () => {
    const read = readItem({
      data: {
        key: 'XYZ',
        version: 7,
        itemType: 'journalArticle',
        title: 'Un artículo',
        creators: [{ creatorType: 'author', firstName: 'Ada', lastName: 'Lovelace' }],
        date: '1843',
        publicationTitle: 'Scientific Memoirs',
        DOI: '10.1000/xyz',
        tags: [{ tag: 'cálculo' }, { tag: '' }],
      },
    });
    assert.equal(read?.key, 'XYZ');
    assert.deepEqual(read?.creators, ['Lovelace, Ada']);
    assert.equal(read?.publication, 'Scientific Memoirs');
    assert.deepEqual(read?.tags, ['cálculo']);
  });

  it('un autor que viene con el nombre junto se lee entero', () => {
    // Las instituciones vienen así: un solo campo con el nombre completo.
    const read = readItem({ data: { key: 'K', creators: [{ name: 'Naciones Unidas' }] } });
    assert.deepEqual(read?.creators, ['Naciones Unidas']);
  });

  it('un ítem sin título no queda sin nombre', () => {
    // Existe —una nota, un adjunto suelto— y una página llamada «» no se puede
    // ni abrir ni encontrar.
    const read = readItem({ data: { key: 'SIN' } });
    assert.equal(read?.title, 'Ítem SIN');
  });

  it('lo que no trae clave no es un ítem', () => {
    assert.equal(readItem({ data: { title: 'sin clave' } }), null);
  });
});

describe('propertiesFor', () => {
  it('escribe la procedencia, que es lo que permite volver a traerlo', () => {
    const written = propertiesFor(item, 'users/123', 'tipo', 'Referencia');
    const said = new Map(written.map((one) => [one.key, one.value]));
    assert.equal(said.get(BIBLIOGRAPHY_NAMES.source), 'zotero');
    assert.equal(said.get(BIBLIOGRAPHY_NAMES.key), 'ABCD1234');
    assert.equal(said.get(BIBLIOGRAPHY_NAMES.version), '42');
    assert.equal(said.get(BIBLIOGRAPHY_NAMES.library), 'users/123');
  });

  it('respeta cómo llama este corpus a la clase de una página', () => {
    // La clave viene de la ontología: quien escriba en otra lengua no recibe
    // páginas con `type` dentro.
    const written = propertiesFor(item, 'users/123', 'momo', 'Referencia');
    assert.ok(written.some((one) => one.key === 'momo' && one.value === 'Referencia'));
  });

  it('lo que el ítem no dice no se escribe', () => {
    const written = propertiesFor(item, 'users/123', 'tipo', 'Referencia');
    assert.ok(!written.some((one) => one.key === BIBLIOGRAPHY_NAMES.doi));
  });

  it('varios autores van separados por coma, que es como Vera lee varias respuestas', () => {
    const written = propertiesFor(
      { ...item, creators: ['Norman, Donald', 'Nielsen, Jakob'] },
      'users/123',
      'tipo',
      'Referencia',
    );
    const autor = written.find((one) => one.key === BIBLIOGRAPHY_NAMES.creators);
    assert.equal(autor?.value, 'Norman, Donald, Nielsen, Jakob');
  });
});

describe('titleFor', () => {
  it('el título del ítem, cuando nadie lo tiene', () => {
    assert.equal(titleFor(item, () => false), 'El diseño de lo cotidiano');
  });

  it('con el nombre tomado, se dice de quién y de cuándo', () => {
    // Y no se numera: «Título (2)» no le dice nada a nadie dentro de un año.
    assert.equal(
      titleFor(item, (name) => name === 'El diseño de lo cotidiano'),
      'El diseño de lo cotidiano (Norman, 2013)',
    );
  });

  it('si hasta eso está tomado, la clave del ítem desempata', () => {
    assert.match(titleFor(item, () => true), /· ABCD1234$/);
  });
});

describe('blocksFor', () => {
  it('el resumen es el primer bloque', () => {
    assert.deepEqual(blocksFor(item), [
      'Sobre por qué las puertas se empujan cuando había que tirar.',
    ]);
  });

  it('no inventa apartados vacíos', () => {
    // Una página que llega con «Ideas» y «Citas» en blanco le pide a quien la
    // abre que rellene un formulario.
    assert.deepEqual(blocksFor({ ...item, abstract: null }), []);
  });

  it('las notas de Zotero llegan como texto y no como HTML', () => {
    const blocks = blocksFor({ ...item, abstract: null }, [
      '<p>Lo dice en el <b>cap&iacute;tulo 3</b></p><p>y lo repite luego</p>',
    ]);
    assert.equal(blocks.length, 1);
    assert.ok(!blocks[0]?.includes('<'));
    assert.match(blocks[0] ?? '', /Lo dice en el/);
  });

  it('una nota vacía no se vuelve un bloque vacío', () => {
    assert.deepEqual(blocksFor({ ...item, abstract: null }, ['<p></p>']), []);
  });
});
