import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  fieldKindOf,
  missingFor,
  readObjectDeclarations,
  readPropertyDeclarations,
  readRelationDeclarations,
} from '../src/ontology.ts';
import { namesFromRoles } from '../src/property-names.ts';

let at = 0;
const block = (content: string, properties: Record<string, string> = {}) => ({
  block: `block:${(at += 1)}`,
  content,
  properties: Object.entries(properties).map(([key, value]) => ({ key, value })),
});

describe('readRelationDeclarations', () => {
  it('separa el tipo de arista de sus restricciones orientativas', () => {
    const [said] = readRelationDeclarations([
      block('contradice', {
        inversa: 'es contradicha por',
        dominio: 'Afirmación, Publicación',
        rango: 'Afirmación',
        simétrica: 'no',
        transitiva: 'no',
        estado: 'aprobada',
        definición: 'presenta razones incompatibles con el destino',
        'equivalente externo': 'http://example.org/contradicts',
      }),
    ]);
    assert.equal(said?.name, 'contradice');
    assert.equal(said?.inverse, 'es contradicha por');
    assert.deepEqual(said?.domain, ['Afirmación', 'Publicación']);
    assert.deepEqual(said?.range, ['Afirmación']);
    assert.equal(said?.symmetric, false);
    assert.equal(said?.transitive, false);
    assert.equal(said?.status, 'aprobada');
    assert.deepEqual(said?.external, ['http://example.org/contradicts']);
  });

  it('permite declarar un tipo sin fingir restricciones todavía desconocidas', () => {
    const [said] = readRelationDeclarations([block('dialoga con', { simétrica: 'sí' })]);
    assert.equal(said?.inverse, 'dialoga con');
    assert.deepEqual(said?.domain, []);
    assert.deepEqual(said?.range, []);
    assert.equal(said?.symmetric, true);
    assert.equal(said?.transitive, null);
  });
});

describe('readPropertyDeclarations', () => {
  it('lee una propiedad con su clase de campo', () => {
    const [said] = readPropertyDeclarations([
      block('concepto', { campo: 'enlace', varios: 'sí', papel: 'topic', qué: 'de qué trata' }),
    ]);
    assert.equal(said?.name, 'concepto');
    assert.equal(said?.field, 'enlace');
    assert.equal(said?.many, true);
    assert.equal(said?.role, 'topic');
    assert.equal(said?.says, 'de qué trata');
  });

  it('nadie está obligado a decir de qué clase es', () => {
    const [said] = readPropertyDeclarations([block('encaje', { qué: 'lo que sea' })]);
    assert.equal(said?.field, null);
    assert.equal(said?.many, false);
  });

  it('el marcado no hace otra propiedad', () => {
    // Quien escribe una lista de propiedades tiende a marcarlas, y `**autor**`
    // no es una propiedad distinta de `autor`.
    assert.equal(readPropertyDeclarations([block('**autor**', { campo: 'enlace' })])[0]?.name, 'autor');
    assert.equal(readPropertyDeclarations([block('`doi`', { campo: 'texto' })])[0]?.name, 'doi');
  });

  it('lo que va detrás de un guion largo es explicación, no nombre', () => {
    const [said] = readPropertyDeclarations([block('fecha — la de la cosa', { campo: 'fecha' })]);
    assert.equal(said?.name, 'fecha');
  });

  it('los valores conocidos de una lista corta', () => {
    const [said] = readPropertyDeclarations([
      block('sentido', { campo: 'una de', valores: 'directo, mutua' }),
    ]);
    assert.deepEqual(said?.values, ['directo', 'mutua']);
  });

  it('una clase de campo escrita de otra manera se reconoce igual', () => {
    assert.equal(fieldKindOf('date'), 'fecha');
    assert.equal(fieldKindOf('  Enlace '), 'enlace');
    assert.equal(fieldKindOf('booleano'), 'sí/no');
    assert.equal(fieldKindOf('color'), null);
  });
});

describe('readObjectDeclarations', () => {
  it('lee una clase de cosa con lo que la constituye', () => {
    const [said] = readObjectDeclarations([
      block('Persona', { propiedades: 'org, cargo, email', qué: 'alguien' }),
    ]);
    assert.equal(said?.name, 'Persona');
    assert.deepEqual(said?.properties, ['org', 'cargo', 'email']);
    assert.equal(said?.says, 'alguien');
  });

  it('una clase puede no constituirse de nada', () => {
    // Un día no lleva propiedades declaradas y sigue siendo una clase de cosa.
    const [said] = readObjectDeclarations([block('Bitácora', { qué: 'un día' })]);
    assert.deepEqual(said?.properties, []);
  });

  it('una clase puede cumplir un papel del código', () => {
    // `day` no nombra una propiedad: nombra la clase con que nace un día, que es
    // un valor de `tipo`. Leerlo aquí es lo que evita tener que escribirlo en la
    // página de propiedades como si fuera una clave.
    const [said] = readObjectDeclarations([block('Bitácora', { papel: 'day', qué: 'un día' })]);
    assert.equal(said?.role, 'day');
  });

  it('el papel de una clase nombra el valor, como el de una propiedad nombra la clave', () => {
    const names = namesFromRoles([
      ...readPropertyDeclarations([block('tipo', { papel: 'kind' })]),
      ...readObjectDeclarations([block('Jornada', { papel: 'day' })]),
    ]);
    assert.equal(names.kind, 'tipo');
    assert.equal(names.day, 'Jornada');
  });
});

describe('missingFor', () => {
  const persona = {
    block: 'block:persona',
    name: 'Persona',
    properties: ['org', 'cargo', 'email'],
    role: null,
    says: null,
  };

  it('dice qué falta, sin importar mayúsculas', () => {
    assert.deepEqual(missingFor(persona, ['Org', 'email']), ['cargo']);
  });

  it('lo que sobra no sobra', () => {
    // Casi nada de lo que uno escribe nace completo, y una propiedad de más no
    // es un error: es alguien que sabía algo que la ontología todavía no.
    assert.deepEqual(missingFor(persona, ['org', 'cargo', 'email', 'vibra']), []);
  });

  it('de una clase que nadie declaró no falta nada', () => {
    assert.deepEqual(missingFor(undefined, ['lo que sea']), []);
  });
});

describe('namesFromRoles', () => {
  it('cada propiedad dice su papel pegada a sí misma', () => {
    const names = namesFromRoles([
      { name: 'momo', role: 'kind' },
      { name: 'tema', role: 'topic' },
    ]);
    assert.equal(names.kind, 'momo');
    assert.equal(names.topic, 'tema');
  });

  it('lo que no se declara lo cubre lo que Vera trae', () => {
    // @invariant DefaultsLiveInTheCode.
    const names = namesFromRoles([{ name: 'momo', role: 'kind' }]);
    assert.equal(names.explains, 'explica');
  });

  it('un papel que el código no conoce se ignora en silencio', () => {
    // La página es de quien la escribe y puede tener dentro cosas que Vera
    // todavía no sepa leer.
    const names = namesFromRoles([{ name: 'lo que sea', role: 'vibra' }]);
    assert.equal(names.kind, 'tipo');
  });
});
