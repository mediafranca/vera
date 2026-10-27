// Pruebas de la sintaxis compacta. Ver CompactQuerySource en
// specs/query-language.allium.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { looksLikeQuery, readQuery, writeQuery } from '@vera/core';
import type { QueryExpression, QuerySource, QueryUnreadable } from '@vera/core';

const read = (source: string): QuerySource => {
  const outcome = readQuery(source);
  assert.ok(!('error' in outcome), `no se dejó leer: ${JSON.stringify(outcome)}`);
  return outcome;
};

const refuse = (source: string): QueryUnreadable => {
  const outcome = readQuery(source);
  assert.ok('error' in outcome, `debería no entenderse: ${source}`);
  return outcome;
};

describe('readQuery · los términos', () => {
  it('lee una propiedad con su valor', () => {
    assert.deepEqual(read('? tipo=proyecto').expression, {
      kind: 'PropertyTerm',
      key: 'tipo',
      value: 'proyecto',
    });
  });

  it('un valor puede llevar espacios, que el corpus los lleva', () => {
    assert.deepEqual(read('? tipo=entrada diaria').expression, {
      kind: 'PropertyTerm',
      key: 'tipo',
      value: 'entrada diaria',
    });
  });

  it('sin valor pregunta si lleva la clave', () => {
    assert.deepEqual(read('? concepto=').expression, {
      kind: 'PropertyTerm',
      key: 'concepto',
      value: null,
    });
  });

  it('entre comillas caben los signos', () => {
    assert.deepEqual(read('? tipo="ida + vuelta"').expression, {
      kind: 'PropertyTerm',
      key: 'tipo',
      value: 'ida + vuelta',
    });
  });

  it('lee los dos sentidos de un enlace', () => {
    assert.deepEqual(read('? ->[[Ciudad Abierta]]').expression, {
      kind: 'LinksToTerm',
      targetTitle: 'Ciudad Abierta',
    });
    assert.deepEqual(read('? <-[[Cotito]]').expression, {
      kind: 'LinkedFromTerm',
      originTitle: 'Cotito',
    });
  });

  it('lee los dos sentidos de una relación explicada', () => {
    assert.deepEqual(read('? -[forma parte de]->[[Vida personal y familiar]]').expression, {
      kind: 'RelatesToTerm',
      relation: 'forma parte de',
      targetTitle: 'Vida personal y familiar',
    });
    assert.deepEqual(read('? <-[forma parte de]-[[PICTOS.net]]').expression, {
      kind: 'RelatedFromTerm',
      relation: 'forma parte de',
      originTitle: 'PICTOS.net',
    });
  });

  it('lee una condición de contenido', () => {
    assert.deepEqual(read('? ~pictogramas').expression, {
      kind: 'ContentTerm',
      text: 'pictogramas',
    });
  });

  it('niega con «!»', () => {
    assert.deepEqual(read('? !tipo=proyecto').expression, {
      kind: 'NotTerm',
      operand: { kind: 'PropertyTerm', key: 'tipo', value: 'proyecto' },
    });
  });
});

describe('readQuery · la composición', () => {
  it('une con «+»', () => {
    const { expression } = read('? tipo=proyecto + concepto=accesibilidad');
    assert.equal(expression.kind, 'AndTerm');
    assert.equal((expression as unknown as { operands: readonly QueryExpression[] }).operands.length, 2);
  });

  it('alterna con «*»', () => {
    const { expression } = read('? concepto=aac * concepto=pictogramas');
    assert.equal(expression.kind, 'OrTerm');
  });

  it('agrupa con paréntesis', () => {
    const { expression } = read('? tipo=persona + ( concepto=aac * concepto=pictogramas )');
    assert.equal(expression.kind, 'AndTerm');
    const operands = (expression as unknown as { operands: readonly QueryExpression[] }).operands;
    assert.equal(operands[1]?.kind, 'OrTerm');
  });

  it('mezclar «+» y «*» sin paréntesis se rechaza, y dice por qué', () => {
    // @invariant ThereIsNoInvisiblePrecedence: una consulta que selecciona algo
    // distinto de lo que su autor leyó es peor que una que no corre.
    const refused = refuse('? a=1 + b=2 * c=3');
    assert.match(refused.error, /paréntesis/);
  });

  it('se puede escribir en varias líneas', () => {
    const { expression } = read('? tipo=proyecto\n  + concepto=accesibilidad\n  + !~borrador');
    assert.equal((expression as unknown as { operands: readonly QueryExpression[] }).operands.length, 3);
  });
});

describe('readQuery · la presentación', () => {
  it('sin decir nada, una lista', () => {
    assert.equal(read('? tipo=proyecto').view, 'list');
  });

  it('«; tabla» pide la tabla', () => {
    assert.equal(read('? tipo=proyecto ; tabla').view, 'table');
  });

  it('«; bloques» pide cada pasaje concreto', () => {
    assert.equal(read('? ~factura ; bloques').view, 'blocks');
    assert.equal(read('? ~factura ; blocks').view, 'blocks');
  });

  it('«; bloques por página» conserva los pasajes juntos por su origen', () => {
    assert.equal(read('? ~"[ ]" ; bloques por página').view, 'blocks-by-page');
  });


  it('la presentación no cambia la selección', () => {
    assert.deepEqual(read('? tipo=proyecto').expression, read('? tipo=proyecto ; tabla').expression);
  });

  it('un «;» dentro de comillas no es la presentación', () => {
    assert.deepEqual(read('? nota="uno; dos"').expression, {
      kind: 'PropertyTerm',
      key: 'nota',
      value: 'uno; dos',
    });
  });

  it('una forma que no existe se dice, no se ignora', () => {
    assert.match(refuse('? tipo=proyecto ; mosaico').error, /lista, tabla, bloques/);
  });
});

describe('readQuery · lo que no se entiende lo dice', () => {
  it('sin «?» no es una pregunta', () => {
    assert.match(refuse('tipo=proyecto').error, /empieza por «\?»/);
    assert.equal(looksLikeQuery('tipo=proyecto'), false);
    assert.equal(looksLikeQuery('  ? tipo=proyecto'), true);
  });

  it('una pregunta sin condiciones no se contesta', () => {
    assert.match(refuse('?').error, /ninguna condición/);
    assert.match(refuse('?   ').error, /ninguna condición/);
  });

  it('una clave sin «=» dice cómo se preguntaba', () => {
    const refused = refuse('? concepto');
    assert.match(refused.error, /«=»/);
    assert.match(refused.error, /concepto=/);
  });

  it('un paréntesis sin cerrar se señala donde está', () => {
    const refused = refuse('? ( tipo=a + tipo=b');
    assert.match(refused.error, /paréntesis que cierra/);
    assert.ok(refused.at > 0);
  });

  it('una flecha sin página dice qué le falta', () => {
    assert.match(refuse('? ->Vera').error, /dobles corchetes/);
    assert.match(refuse('? ->[[Vera').error, /corchetes que cierran/);
    assert.match(refuse('? ->[[  ]]').error, /vacío/);
  });

  it('un «~» sin nada que buscar', () => {
    assert.match(refuse('? ~').error, /sin nada que buscar/);
  });

  it('lo que sobra al final se señala', () => {
    const refused = refuse('? tipo=a )');
    assert.match(refused.error, /paréntesis/);
    assert.notEqual(refused.near, '');
  });

  it('un error dice dónde, no sólo que lo hubo', () => {
    const refused = refuse('? tipo=a + b');
    assert.ok(refused.at >= 10, `la posición señala el término roto: ${refused.at}`);
    assert.equal(refused.near.startsWith('b'), true);
  });
});

describe('writeQuery', () => {
  it('escribe la pregunta que se leería', () => {
    assert.equal(
      writeQuery(read('? tipo=proyecto + concepto=accesibilidad').expression),
      '? tipo=proyecto + concepto=accesibilidad',
    );
  });

  it('pone paréntesis donde harían falta al volver a leer', () => {
    const { expression } = read('? tipo=persona + ( concepto=aac * concepto=pictogramas )');
    assert.equal(writeQuery(expression), '? tipo=persona + ( concepto=aac * concepto=pictogramas )');
  });

  it('dice la tabla cuando la respuesta es una tabla', () => {
    assert.equal(writeQuery(read('? tipo=a').expression, 'table'), '? tipo=a ; tabla');
  });

  it('dice los bloques cuando la respuesta son pasajes concretos', () => {
    assert.equal(writeQuery(read('? ~factura').expression, 'blocks'), '? ~factura ; bloques');
  });

  it('pone comillas sólo cuando hacen falta', () => {
    assert.equal(
      writeQuery({ kind: 'PropertyTerm', key: 'tipo', value: 'entrada diaria' }),
      '? tipo=entrada diaria',
    );
    assert.equal(
      writeQuery({ kind: 'PropertyTerm', key: 'tipo', value: 'ida + vuelta' }),
      '? tipo="ida + vuelta"',
    );
  });

  it('no finge saber escribir un término que no tiene signo', () => {
    // Título, etiqueta y tipo semántico siguen en el lenguaje y todavía no se
    // pueden pedir. Devolver un texto que al leerse dijera otra cosa sería peor.
    assert.throws(() => writeQuery({ kind: 'TagTerm', tag: 'aac' }), /no hay forma de escribir/);
  });
});

/*
 * Ida y vuelta.
 *
 * @invariant WritingBackReadsTheSame: escribir un árbol y volver a leerlo da el
 * mismo árbol. Es lo que permitirá que un constructor toque una consulta escrita
 * a mano sin cambiar lo que preguntaba, y es la propiedad que una prueba de
 * ejemplos no alcanza: los casos que rompen esto son los raros —un valor con un
 * signo dentro, una negación de un grupo, un grupo dentro de otro del mismo
 * signo—, y ésos los encuentra generando.
 */
const palabra = fc
  .stringMatching(/^[a-záéíóúñ][a-záéíóúñ0-9 ]{0,12}$/)
  .map((one) => one.trim())
  .filter((one) => one !== '');

const conSignos = fc.oneof(palabra, palabra.map((one) => `${one} + otro`), palabra.map((one) => `${one}; ya`));

const hoja: fc.Arbitrary<QueryExpression> = fc.oneof(
  fc.record({ kind: fc.constant('PropertyTerm' as const), key: palabra.map((k) => k.replace(/ /g, '-')), value: fc.oneof(conSignos, fc.constant(null)) }),
  fc.record({ kind: fc.constant('ContentTerm' as const), text: conSignos }),
  fc.record({ kind: fc.constant('LinksToTerm' as const), targetTitle: palabra }),
  fc.record({ kind: fc.constant('LinkedFromTerm' as const), originTitle: palabra }),
  fc.record({ kind: fc.constant('RelatesToTerm' as const), relation: palabra, targetTitle: palabra }),
  fc.record({ kind: fc.constant('RelatedFromTerm' as const), relation: palabra, originTitle: palabra }),
);

/*
 * Los mismos datos, con prototipo.
 *
 * fast-check construye sus registros sin prototipo, y `deepEqual` estricto
 * distingue un objeto sin prototipo de uno con él. La diferencia no dice nada
 * sobre la sintaxis: se quita antes de comparar, en vez de aflojar la comparación.
 */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const arbol: fc.Arbitrary<QueryExpression> = fc.letrec<{ node: QueryExpression }>((tie) => ({
  node: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    hoja,
    fc.record({ kind: fc.constant('NotTerm' as const), operand: tie('node') }),
    fc.record({
      kind: fc.constant('AndTerm' as const),
      operands: fc.array(tie('node'), { minLength: 2, maxLength: 3 }),
    }),
    fc.record({
      kind: fc.constant('OrTerm' as const),
      operands: fc.array(tie('node'), { minLength: 2, maxLength: 3 }),
    }),
  ),
})).node;

describe('la ida y la vuelta', () => {
  it('lo escrito se vuelve a leer igual', () => {
    fc.assert(
      fc.property(
        arbol,
        fc.constantFrom<'list' | 'table' | 'blocks' | 'blocks-by-page'>(
          'list', 'table', 'blocks', 'blocks-by-page',
        ),
        (expression, view) => {
        const written = writeQuery(expression, view);
        const back = readQuery(written);
        assert.ok(!('error' in back), `no se dejó leer «${written}»`);
        assert.deepEqual(plain(back.expression), plain(expression));
        assert.equal(back.view, view);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('leer, escribir y volver a leer no cambia nada', () => {
    fc.assert(
      fc.property(arbol, (expression) => {
        const once = writeQuery(expression);
        const twice = writeQuery(read(once).expression);
        assert.equal(twice, once);
      }),
      { numRuns: 300 },
    );
  });
});

/*
 * La clave es la que se escribió.
 *
 * Hubo una versión de esto que traducía `tipo` a `type` al leer y al revés al
 * escribir. Resolvía este corpus y rompía el siguiente: quien lleve el suyo en
 * maorí escribiría `momo` y la traducción no sabría nada de él —o peor, quien
 * tuviera una clave que se llama de verdad `estado` se la vería convertida en
 * `status` sin que nada lo dijera. Una propiedad es del corpus, y preguntar por
 * ella es preguntar por lo que dice.
 */
describe('la clave no se traduce', () => {
  it('lo que se escribe es lo que se pregunta, en cualquier lengua', () => {
    for (const key of ['tipo', 'type', 'momo', 'Soort']) {
      const outcome = readQuery(`? ${key}=x`);
      assert.ok(!('error' in outcome));
      assert.equal((outcome.expression as { key: string }).key, key);
    }
  });

  it('y volver a escribirla la deja igual', () => {
    assert.equal(writeQuery(read('? momo=rangahau').expression), '? momo=rangahau');
  });
});

/*
 * Una clave puede llevar espacios, porque el corpus los lleva.
 *
 * `revisión de código` es una propiedad de verdad de este corpus. Cortar la
 * clave en el primer espacio dejaba sin poder preguntar por media docena de las
 * que ya estaban escritas.
 */
describe('claves con espacios', () => {
  it('la clave llega hasta el «=», espacios incluidos', () => {
    assert.deepEqual(read('? revisión de código=2026-08-07').expression, {
      kind: 'PropertyTerm',
      key: 'revisión de código',
      value: '2026-08-07',
    });
  });

  it('y se puede preguntar si la lleva', () => {
    assert.deepEqual(read('? revisión de código=').expression, {
      kind: 'PropertyTerm',
      key: 'revisión de código',
      value: null,
    });
  });

  it('un signo sí la corta: dentro de una clave no cabe «+»', () => {
    const { expression } = read('? item-type=x + revisión de código=y');
    assert.equal((expression as { operands: readonly QueryExpression[] }).operands.length, 2);
  });

  it('y escribirla la deja igual', () => {
    assert.equal(writeQuery(read('? revisión de código=hoy').expression), '? revisión de código=hoy');
  });
});
