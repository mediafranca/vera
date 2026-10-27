// La sintaxis compacta con que se escribe una pregunta.
//
// Ver `contract CompactQuerySource` en specs/query-language.allium.
//
//     ? tipo=proyecto + concepto=accesibilidad + ( ->[[Vera]] * <-[[Vera]] ) + !~borrador ; tabla
//
//     ?              el bloque que empieza así es una pregunta
//     clave=valor    la propiedad vale eso
//     clave=         lleva esa clave, con el valor que sea
//     ->[[Página]]   enlaza a
//     <-[[Página]]   enlazada desde
//     ~texto         el contenido lo contiene
//     !término       no
//     +  y   ·   *  o   ·   ( ) grupo
//     ; tabla        páginas en tabla; sin eso, páginas en lista
//     ; bloques      cada bloque concreto que dice lo preguntado
//
// Signos y no palabras: `y` y `o` son castellano, y la lógica de un corpus que se
// escribe en tres idiomas no puede estar en uno. Y cuando una frase no se
// entiende falla la oración entera, mientras que aquí falla un término y se ve
// cuál —de ahí que un error diga dónde y no sólo que lo hubo.
//
// Aquí no se consulta nada: esto lee un texto y devuelve un árbol. Quién contesta
// es el grafo, y por eso este archivo no sabe qué páginas existen.

import type { QueryExpression } from './query.ts';

export type QueryView = 'list' | 'table' | 'blocks' | 'blocks-by-page';

export interface QuerySource {
  expression: QueryExpression;
  view: QueryView;
}

export interface QueryUnreadable {
  /** Qué no se entendió, en palabras que quien escribió pueda usar. */
  error: string;
  /** Dónde empieza lo que rompe la pregunta, contando desde el `?`. */
  at: number;
  /** Y qué dice ahí, para poder señalarlo sin volver a cortar el texto. */
  near: string;
}

/** Si un texto se presenta como pregunta. No dice si además se entiende. */
export function looksLikeQuery(source: string): boolean {
  return /^\s*\?/.test(source);
}

/*
 * Los signos, sueltos y con nombre.
 *
 * `+` y `*` unen; `!` niega; `( )` agrupa; `;` separa la pregunta de cómo se lee
 * la respuesta. Ninguno puede aparecer dentro de un valor sin comillas, que es lo
 * que hace que partir el texto sea contar y no adivinar.
 */
const AND = '+';
const OR = '*';
const NOT = '!';
const OPEN = '(';
const CLOSE = ')';
const SEMI = ';';
const SIGNS = new Set([AND, OR, NOT, OPEN, CLOSE, SEMI]);

const VIEWS: Record<string, QueryView> = {
  lista: 'list',
  list: 'list',
  tabla: 'table',
  table: 'table',
  bloques: 'blocks',
  blocks: 'blocks',
  'bloques por página': 'blocks-by-page',
  'bloques por pagina': 'blocks-by-page',
  'blocks by page': 'blocks-by-page',
};

interface Cursor {
  text: string;
  at: number;
}

// Sin propiedades de parámetro: Node ejecuta este TypeScript quitándole los tipos
// y nada más, y una propiedad declarada en el constructor no es un tipo.
class Unreadable extends Error {
  readonly at: number;
  readonly near: string;

  constructor(said: string, at: number, near: string) {
    super(said);
    this.at = at;
    this.near = near;
  }
}

const skip = (cursor: Cursor): void => {
  while (cursor.at < cursor.text.length && /\s/.test(cursor.text[cursor.at] ?? '')) cursor.at += 1;
};

const peek = (cursor: Cursor): string => cursor.text[cursor.at] ?? '';

/** Lo que queda por delante, recortado, para poder señalar dónde se rompió. */
const rest = (cursor: Cursor, at = cursor.at): string => {
  const ahead = cursor.text.slice(at).trim();
  return ahead.length <= 24 ? ahead : `${ahead.slice(0, 24)}…`;
};

/**
 * Lee una pregunta escrita.
 *
 * Devuelve el árbol y cómo se lee la respuesta, o por qué no se entiende y dónde.
 * Nunca devuelve una expresión a medias: una pregunta que no se entiende entera
 * no es media pregunta —@invariant WhatCannotBeReadSaysSo—, porque contestar la
 * mitad que se leyó daría una respuesta correcta a otra pregunta.
 */
export function readQuery(source: string): QuerySource | QueryUnreadable {
  const cursor: Cursor = { text: source, at: 0 };
  skip(cursor);
  if (peek(cursor) !== '?') {
    return { error: 'una pregunta empieza por «?»', at: 0, near: rest(cursor, 0) };
  }
  cursor.at += 1;

  try {
    // La presentación va detrás del `;` y se corta antes de leer las
    // condiciones: así el `;` no puede confundirse con parte de un valor.
    const semi = splitPresentation(cursor.text);
    const question: Cursor = { text: semi.question, at: cursor.at };

    const view = readView(semi.presentation, semi.at);

    skip(question);
    if (question.at >= question.text.length) {
      return {
        error: 'la pregunta no dice ninguna condición',
        at: question.at,
        near: '',
      };
    }

    const expression = readExpression(question);
    skip(question);
    if (question.at < question.text.length) {
      const stray = peek(question);
      throw new Unreadable(
        stray === CLOSE ? 'sobra un paréntesis que cierra' : `sobra «${rest(question)}»`,
        question.at,
        rest(question),
      );
    }
    return { expression, view };
  } catch (problem) {
    if (problem instanceof Unreadable) {
      return { error: problem.message, at: problem.at, near: problem.near };
    }
    throw problem;
  }
}

/** Parte la fuente por el `;` que no está dentro de comillas ni de un enlace. */
function splitPresentation(text: string): { question: string; presentation: string; at: number } {
  let quoted = false;
  for (let at = 0; at < text.length; at += 1) {
    const here = text[at];
    if (here === '"') quoted = !quoted;
    if (!quoted && here === SEMI) {
      return { question: text.slice(0, at), presentation: text.slice(at + 1), at: at + 1 };
    }
  }
  return { question: text, presentation: '', at: text.length };
}

function readView(said: string, at: number): QueryView {
  const word = said.trim().toLowerCase();
  if (word === '') return 'list';
  const view = VIEWS[word];
  if (view === undefined) {
    throw new Unreadable(
      `no sé leer una respuesta como «${word}»; hay lista, tabla, bloques y bloques por página`,
      at,
      said.trim(),
    );
  }
  return view;
}

/*
 * Una expresión es una fila de términos unidos por el mismo signo.
 *
 * El mismo: mezclar `+` y `*` en un nivel se rechaza pidiendo paréntesis
 * —@invariant ThereIsNoInvisiblePrecedence—. Cualquier regla de precedencia sería
 * una que hay que saberse, y una consulta que selecciona algo distinto de lo que
 * su autor leyó es peor que una que no corre.
 */
function readExpression(cursor: Cursor): QueryExpression {
  const operands: QueryExpression[] = [readTerm(cursor)];
  let sign: string | null = null;

  for (;;) {
    skip(cursor);
    const here = peek(cursor);
    if (here !== AND && here !== OR) break;
    if (sign !== null && here !== sign) {
      throw new Unreadable(
        'para mezclar «+» y «*» hacen falta paréntesis',
        cursor.at,
        rest(cursor),
      );
    }
    sign = here;
    cursor.at += 1;
    operands.push(readTerm(cursor));
  }

  if (operands.length === 1) return operands[0] as QueryExpression;
  return sign === OR
    ? { kind: 'OrTerm', operands }
    : { kind: 'AndTerm', operands };
}

function readTerm(cursor: Cursor): QueryExpression {
  skip(cursor);
  if (peek(cursor) === NOT) {
    cursor.at += 1;
    return { kind: 'NotTerm', operand: readTerm(cursor) };
  }
  return readAtom(cursor);
}

function readAtom(cursor: Cursor): QueryExpression {
  skip(cursor);
  const at = cursor.at;

  if (cursor.at >= cursor.text.length) {
    throw new Unreadable('falta una condición', at, '');
  }

  if (peek(cursor) === OPEN) {
    cursor.at += 1;
    const inside = readExpression(cursor);
    skip(cursor);
    if (peek(cursor) !== CLOSE) {
      throw new Unreadable('falta el paréntesis que cierra', cursor.at, rest(cursor));
    }
    cursor.at += 1;
    return inside;
  }

  if (cursor.text.startsWith('->', cursor.at)) {
    cursor.at += 2;
    return { kind: 'LinksToTerm', targetTitle: readTitle(cursor) };
  }

  if (cursor.text.startsWith('-[', cursor.at)) {
    const relation = readRelation(cursor, 'out');
    return { kind: 'RelatesToTerm', relation, targetTitle: readTitle(cursor) };
  }

  if (cursor.text.startsWith('<-[', cursor.at) && !cursor.text.startsWith('<-[[', cursor.at)) {
    const relation = readRelation(cursor, 'in');
    return { kind: 'RelatedFromTerm', relation, originTitle: readTitle(cursor) };
  }

  if (cursor.text.startsWith('<-', cursor.at)) {
    cursor.at += 2;
    return { kind: 'LinkedFromTerm', originTitle: readTitle(cursor) };
  }

  if (peek(cursor) === '~') {
    cursor.at += 1;
    const text = readValue(cursor);
    if (text === '') throw new Unreadable('«~» sin nada que buscar', at, rest(cursor, at));
    return { kind: 'ContentTerm', text };
  }

  // Lo demás es una propiedad: clave, `=`, y el valor que puede faltar.
  const key = readKey(cursor);
  if (key === '') {
    throw new Unreadable(`no sé leer «${rest(cursor, at)}»`, at, rest(cursor, at));
  }
  if (peek(cursor) !== '=') {
    throw new Unreadable(
      `a «${key}» le falta el «=» y el valor; para preguntar si la lleva, «${key}=»`,
      at,
      rest(cursor, at),
    );
  }
  cursor.at += 1;
  const value = readValue(cursor);
  return {
    kind: 'PropertyTerm',
    key,
    value: value === '' ? null : value,
  };
}

/** Lee `-[relación]->` o `<-[relación]-` y deja el cursor ante `[[Página]]`. */
function readRelation(cursor: Cursor, direction: 'out' | 'in'): string {
  const at = cursor.at;
  cursor.at += direction === 'out' ? 2 : 3;
  const closes = cursor.text.indexOf(']', cursor.at);
  if (closes === -1) {
    throw new Unreadable('falta el corchete que cierra el tipo de relación', at, rest(cursor, at));
  }
  const relation = cursor.text.slice(cursor.at, closes).trim();
  cursor.at = closes + 1;
  const arrow = direction === 'out' ? '->' : '-';
  if (!cursor.text.startsWith(arrow, cursor.at)) {
    throw new Unreadable(
      direction === 'out' ? 'a la relación le falta «->»' : 'a la relación entrante le falta «-»',
      cursor.at,
      rest(cursor),
    );
  }
  cursor.at += arrow.length;
  if (relation === '') throw new Unreadable('el tipo de relación está vacío', at, rest(cursor, at));
  return relation;
}

/** El título entre dobles corchetes de un término de enlace. */
function readTitle(cursor: Cursor): string {
  skip(cursor);
  const at = cursor.at;
  if (!cursor.text.startsWith('[[', cursor.at)) {
    throw new Unreadable(
      'a una flecha le sigue una página entre dobles corchetes: ->[[Título]]',
      at,
      rest(cursor, at),
    );
  }
  const closes = cursor.text.indexOf(']]', cursor.at + 2);
  if (closes === -1) {
    throw new Unreadable('faltan los corchetes que cierran el título', at, rest(cursor, at));
  }
  const title = cursor.text.slice(cursor.at + 2, closes).trim();
  cursor.at = closes + 2;
  if (title === '') throw new Unreadable('el título está vacío', at, rest(cursor, at));
  return title;
}

/**
 * La clave de una propiedad: hasta el `=`.
 *
 * Con espacios dentro, porque el corpus los tiene —`revisión de código`— y una
 * clave es del corpus. Cortar en el primer espacio dejaba sin poder preguntar
 * por media docena de las propiedades ya escritas.
 *
 * Lo que sí la corta es un signo: dentro de una clave no cabe `+`, `*`, `!`,
 * `(`, `)` ni `;`, que es lo que permite seguir partiendo la pregunta contando
 * en vez de adivinando.
 */
function readKey(cursor: Cursor): string {
  const from = cursor.at;
  while (cursor.at < cursor.text.length) {
    const here = cursor.text[cursor.at] ?? '';
    if (here === '=' || SIGNS.has(here)) break;
    cursor.at += 1;
  }
  return cursor.text.slice(from, cursor.at).trim();
}

/*
 * Un valor llega hasta el siguiente signo.
 *
 * Sin comillas puede llevar espacios —`tipo=entrada diaria` es un valor del
 * corpus— y no puede llevar `+`, `*`, `(`, `)`, `!` ni `;`. Cuando hace falta uno
 * de ésos, comillas: `tipo="ida + vuelta"`. Es la única concesión de la sintaxis,
 * y existe porque el corpus manda sobre la gramática.
 */
function readValue(cursor: Cursor): string {
  skip(cursor);
  if (peek(cursor) === '"') {
    const closes = cursor.text.indexOf('"', cursor.at + 1);
    if (closes === -1) {
      throw new Unreadable('faltan las comillas que cierran', cursor.at, rest(cursor));
    }
    const said = cursor.text.slice(cursor.at + 1, closes);
    cursor.at = closes + 1;
    return said;
  }
  const from = cursor.at;
  while (cursor.at < cursor.text.length && !SIGNS.has(cursor.text[cursor.at] ?? '')) {
    cursor.at += 1;
  }
  return cursor.text.slice(from, cursor.at).trim();
}

/**
 * Escribe un árbol como la pregunta que lo produciría.
 *
 * @invariant WritingBackReadsTheSame: leer lo que esto escribe da el mismo árbol.
 * Es lo que permitirá que un constructor toque una consulta escrita a mano sin
 * cambiar lo que preguntaba.
 *
 * Tres términos del lenguaje no tienen signo todavía —título, etiqueta y tipo
 * semántico—. Escribir uno de ellos no puede fingirse: se dice que no se sabe, en
 * vez de devolver un texto que al leerse diría otra cosa.
 */
export function writeQuery(expression: QueryExpression, view: QueryView = 'list'): string {
  const said = write(expression, null);
  if (view === 'table') return `? ${said} ; tabla`;
  if (view === 'blocks') return `? ${said} ; bloques`;
  if (view === 'blocks-by-page') return `? ${said} ; bloques por página`;
  return `? ${said}`;
}

function write(expression: QueryExpression, within: string | null): string {
  switch (expression.kind) {
    case 'PropertyTerm':
      return `${expression.key}=${expression.value === null ? '' : quote(expression.value)}`;
    case 'ContentTerm':
      return `~${quote(expression.text)}`;
    case 'LinksToTerm':
      return `->[[${expression.targetTitle}]]`;
    case 'LinkedFromTerm':
      return `<-[[${expression.originTitle}]]`;
    case 'RelatesToTerm':
      return `-[${expression.relation}]->[[${expression.targetTitle}]]`;
    case 'RelatedFromTerm':
      return `<-[${expression.relation}]-[[${expression.originTitle}]]`;
    case 'NotTerm':
      return `${NOT}${write(expression.operand, NOT)}`;
    case 'AndTerm':
    case 'OrTerm': {
      const sign = expression.kind === 'AndTerm' ? AND : OR;
      const said = expression.operands.map((one) => write(one, sign)).join(` ${sign} `);
      /*
       * Paréntesis siempre que esto vaya dentro de algo, aunque el signo sea el
       * mismo.
       *
       * Omitirlos ahí parecía inofensivo —`a * ( b * c )` y `a * b * c`
       * seleccionan lo mismo— y no lo es: el segundo se vuelve a leer como una
       * fila de tres, y entonces escribir y leer deja de devolver el árbol que
       * entró. Lo encontró la prueba de propiedad, no la de ejemplos.
       *
       * Quien escribe a mano no paga nada por esto: `a * b * c` da un árbol
       * plano, y un árbol plano se escribe plano.
       */
      return within === null ? said : `( ${said} )`;
    }
    default:
      throw new Error(`no hay forma de escribir un ${expression.kind} en la sintaxis compacta`);
  }
}

/** Comillas sólo cuando hacen falta: un signo dentro, o un borde en blanco. */
function quote(value: string): string {
  const needs = [...value].some((one) => SIGNS.has(one) || one === '"') || value.trim() !== value;
  return needs ? `"${value.replaceAll('"', '')}"` : value;
}
