// Las dos páginas que dicen de qué está hecho este corpus.
//
// Hasta ahora había una sola, «Ontología», con todo dentro: los tipos, algunas
// propiedades sueltas, el vocabulario de relaciones y las reglas de gobierno. Se
// parte en dos porque son dos preguntas distintas y se responden en momentos
// distintos:
//
//   - Las propiedades: cuáles hay y qué clase de campo es cada una. Un `fecha`
//     no se rellena como un `doi`, y un `concepto` que nombra otra página no se
//     lee como un texto suelto. Sin decirlo en alguna parte, cada propiedad es
//     una caja de texto y quien escribe tiene que acordarse de todo.
//
//   - Los objetos: qué clases de cosa reconoce el corpus y qué propiedades
//     constituyen a cada una. Es lo que permite que una página nueva diga qué le
//     falta en vez de esperar a que alguien se acuerde.
//
// Las dos se escriben con las herramientas de siempre: un bloque por cosa, con
// sus propiedades colgando. Que la ontología de las propiedades esté escrita con
// propiedades no es un juego: es lo que hace que se edite, se busque, se enlace y
// se versione como todo lo demás, en vez de ser un formato aparte que sólo
// entiende el programa.
//
//     # Propiedades
//     - concepto
//       campo:: enlace
//       varios:: sí
//       papel:: topic
//
//     # Objetos
//     - Referencia
//       propiedades:: autor, fecha, publicación, editorial, doi, isbn, url
//
// @invariant DefaultsLiveInTheCode: lo que digan estas páginas es lo que rige, y
// lo que no digan lo cubre lo que Vera trae.
//
// Ver specs/controlled-ontology.allium.

/**
 * Las clases de campo que Vera sabe nombrar.
 *
 * Cortas a propósito. Una lista larga de tipos —«correo», «teléfono», «color»—
 * es una lista de validaciones que alguien va a tener que escribir y mantener, y
 * lo que hace falta aquí es distinguir lo que se comporta distinto: un enlace
 * lleva a alguna parte, una fecha ordena y tiene su día, y lo demás es texto.
 */
export const FIELD_KINDS = ['texto', 'número', 'fecha', 'enlace', 'sí/no', 'una de'] as const;

export type FieldKind = (typeof FIELD_KINDS)[number];

/** Cómo se escribe una clase de campo, con las variantes que alguien usaría. */
const FIELD_ALIASES: Record<string, FieldKind> = {
  texto: 'texto',
  text: 'texto',
  número: 'número',
  numero: 'número',
  number: 'número',
  fecha: 'fecha',
  date: 'fecha',
  día: 'fecha',
  enlace: 'enlace',
  link: 'enlace',
  página: 'enlace',
  'sí/no': 'sí/no',
  'si/no': 'sí/no',
  booleano: 'sí/no',
  boolean: 'sí/no',
  'una de': 'una de',
  'uno de': 'una de',
  enum: 'una de',
};

export function fieldKindOf(said: string): FieldKind | null {
  return FIELD_ALIASES[said.trim().toLowerCase()] ?? null;
}

/**
 * De qué cuelga una propiedad.
 *
 * En el almacén una asignación nombra una página o un bloque, nunca las dos —lo
 * dice la restricción de la tabla—, así que esto no es una convención sino la
 * forma que el dato ya tiene. Que no estuviera dicho en ninguna parte es lo que
 * hacía ilegible la página de propiedades: `término` y `cargo` se leían como
 * cosas del mismo orden, y una cuelga de un bloque para explicar una relación
 * entre dos páginas mientras la otra dice qué hace una persona en su trabajo.
 *
 * Lo declara el corpus con `sujeto::`. Cuando no lo dice, se deduce del papel
 * —las tres de la relación explicada cuelgan de un bloque, y las demás de una
 * página— y en último término se supone página, que es donde vive casi todo lo
 * que alguien escribe. @invariant DefaultsLiveInTheCode.
 */
export type PropertySubject = 'bloque' | 'página';

/**
 * De qué cuelga cada papel que el código conoce.
 *
 * `explains`, `term` y `sense` son las tres claves de la relación explicada, y
 * una relación se afirma desde un bloque: es el bloque el que dice por qué esta
 * página y aquélla se tocan. Ver relations.ts. Los demás papeles hablan de la
 * página entera —qué clase de cosa es, de qué trata, cuándo nació— y por eso
 * cuelgan de ella.
 */
const SUBJECT_BY_ROLE: Record<string, PropertySubject> = {
  explains: 'bloque',
  term: 'bloque',
  sense: 'bloque',
};

/** Qué escribe alguien cuando quiere decir de qué cuelga. */
const SUBJECT_ALIASES: Record<string, PropertySubject> = {
  bloque: 'bloque',
  bloques: 'bloque',
  block: 'bloque',
  'página': 'página',
  pagina: 'página',
  'páginas': 'página',
  paginas: 'página',
  page: 'página',
};

/** Un bloque de una página especial, con lo que cuelga de él. */
export interface DeclaredBlock {
  /**
   * El bloque del que salió, por su identidad estable.
   *
   * Sin esto una declaración es un dato suelto que no se puede corregir: se lee
   * «Persona lleva org, cargo, grado» y no hay forma de volver al sitio donde
   * eso está escrito. Se localiza por identidad y nunca por su texto, porque dos
   * bloques pueden decir lo mismo y el texto se edita mientras se mira.
   */
  block: string;
  content: string;
  properties: readonly { key: string; value: string }[];
}

export interface PropertyDeclaration {
  /** El bloque que la declara. Ver `DeclaredBlock.block`. */
  block: string;
  /** Cómo se llama la propiedad en este corpus. */
  name: string;
  /** Qué clase de campo es. Nulo cuando no se dijo: nadie está obligado a decirlo. */
  field: FieldKind | null;
  /** Si admite varias respuestas separadas por coma. */
  many: boolean;
  /**
   * Qué papel de los que el código conoce cumple, si cumple alguno.
   *
   * Es lo que antes se declaraba como `kind · tipo` en una lista aparte. Aquí va
   * pegado a la propiedad de la que habla, que es donde alguien lo va a buscar.
   */
  role: string | null;
  /** De qué cuelga. Ver `PropertySubject`. */
  subject: PropertySubject;
  /** Los valores conocidos, cuando es «una de». */
  values: string[];
  /** Lo que quien la declaró quiso explicar. */
  says: string | null;
}

const valueOf = (block: DeclaredBlock, key: string): string | null => {
  const found = block.properties.find((one) => one.key.trim().toLowerCase() === key);
  const said = found?.value.trim() ?? '';
  return said === '' ? null : said;
};

const listOf = (said: string | null): string[] =>
  (said ?? '')
    .split(',')
    .map((one) => one.trim())
    .filter((one) => one !== '');

const yes = (said: string | null): boolean =>
  said !== null && /^(sí|si|yes|true|varios|varias)$/i.test(said.trim());

/**
 * El nombre de una propiedad, tomado del texto del bloque.
 *
 * Se le quita el marcado —negrita, código— porque quien escribe una lista de
 * propiedades tiende a marcarlas, y `**autor**` no es una propiedad distinta de
 * `autor`.
 */
function nameIn(content: string): string {
  return content
    .split('\n')[0]!
    .replace(/^[-*·]\s*/, '')
    .replace(/[`*_]/g, '')
    // Lo que venga detrás de un guion largo o dos puntos es explicación, no nombre.
    .split(/\s+[—–:]\s+/)[0]!
    .trim();
}

/** Lee la página de propiedades: un bloque por propiedad, con lo que cuelgue. */
export function readPropertyDeclarations(blocks: readonly DeclaredBlock[]): PropertyDeclaration[] {
  const said: PropertyDeclaration[] = [];
  for (const block of blocks) {
    const name = nameIn(block.content);
    if (name === '') continue;
    const role = valueOf(block, 'papel');
    said.push({
      block: block.block,
      name,
      subject:
        SUBJECT_ALIASES[(valueOf(block, 'sujeto') ?? '').toLowerCase()] ??
        (role === null ? 'página' : (SUBJECT_BY_ROLE[role.trim().toLowerCase()] ?? 'página')),
      field: fieldKindOf(valueOf(block, 'campo') ?? ''),
      many: yes(valueOf(block, 'varios')),
      role,
      values: listOf(valueOf(block, 'valores')),
      says: valueOf(block, 'qué') ?? valueOf(block, 'nota'),
    });
  }
  return said;
}

export interface ObjectDeclaration {
  /** El bloque que la declara. Ver `DeclaredBlock.block`. */
  block: string;
  /** La clase de cosa: «Persona», «Referencia», «Proyecto». */
  name: string;
  /** Qué propiedades la constituyen, en el orden en que se declararon. */
  properties: string[];
  /**
   * Qué papel del código cumple esta clase, si cumple alguno.
   *
   * Los papeles no son sólo de las claves. `day` no nombra una propiedad: nombra
   * la clase con que nace un día, que es un valor de `tipo` y por tanto una de
   * estas clases. Hasta que `papel::` se leyó también aquí, la única forma de
   * atarlo era escribir `bitácora` en la página de propiedades como si fuera una
   * clave, y quedaba declarada dos veces: bien aquí, como clase, y mal allí,
   * como una propiedad que no existe.
   *
   * El papel viaja con la cosa que nombra, y aquí las cosas son clases.
   */
  role: string | null;
  says: string | null;
}

/** Lee la página de objetos: un bloque por clase de cosa. */
export function readObjectDeclarations(blocks: readonly DeclaredBlock[]): ObjectDeclaration[] {
  const said: ObjectDeclaration[] = [];
  for (const block of blocks) {
    const name = nameIn(block.content);
    if (name === '') continue;
    said.push({
      block: block.block,
      name,
      properties: listOf(valueOf(block, 'propiedades')),
      role: valueOf(block, 'papel'),
      says: valueOf(block, 'qué') ?? valueOf(block, 'nota'),
    });
  }
  return said;
}

/**
 * Un tipo de arista declarado por el corpus.
 *
 * El tipo no es la arista: una relación concreta conserva sus extremos, su
 * identidad y su contenido aunque todavía no tenga tipo. Esta declaración sólo
 * ofrece un vocabulario común para nombrarla y leerla desde ambos extremos.
 */
export interface RelationDeclaration {
  block: string;
  name: string;
  inverse: string;
  domain: string[];
  range: string[];
  symmetric: boolean | null;
  transitive: boolean | null;
  status: string | null;
  says: string | null;
  external: string[];
}

const truth = (said: string | null): boolean | null => {
  if (said === null) return null;
  if (/^(sí|si|yes|true)$/i.test(said.trim())) return true;
  if (/^(no|false)$/i.test(said.trim())) return false;
  return null;
};

/** Lee `VERA: Relaciones`: un bloque con propiedades por tipo de arista. */
export function readRelationDeclarations(blocks: readonly DeclaredBlock[]): RelationDeclaration[] {
  const said: RelationDeclaration[] = [];
  for (const block of blocks) {
    const name = nameIn(block.content);
    if (name === '') continue;
    const symmetric = truth(valueOf(block, 'simétrica') ?? valueOf(block, 'simetrica'));
    const declaredInverse = valueOf(block, 'inversa');
    said.push({
      block: block.block,
      name,
      inverse: declaredInverse ?? (symmetric === true ? name : name),
      domain: listOf(valueOf(block, 'dominio')),
      range: listOf(valueOf(block, 'rango')),
      symmetric,
      transitive: truth(valueOf(block, 'transitiva')),
      status: valueOf(block, 'estado'),
      says: valueOf(block, 'definición') ?? valueOf(block, 'definicion') ?? valueOf(block, 'qué') ?? valueOf(block, 'nota'),
      external: listOf(valueOf(block, 'equivalente externo')),
    });
  }
  return said;
}

/**
 * Qué le falta a una página para ser lo que dice ser.
 *
 * Se calcula y se enseña; no se impide nada. Una memoria que rechaza una página
 * incompleta obliga a saber el final antes de empezar, y casi nada de lo que uno
 * escribe nace completo. @guarantee TheShapeIsSaidAndNeverEnforced.
 */
export function missingFor(
  object: ObjectDeclaration | undefined,
  has: readonly string[],
): string[] {
  if (object === undefined) return [];
  const held = new Set(has.map((one) => one.trim().toLowerCase()));
  return object.properties.filter((one) => !held.has(one.toLowerCase()));
}
