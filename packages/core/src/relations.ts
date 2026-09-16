// La relación explicada: por qué esta página y aquélla se tocan.
//
// Ver «La relación explicada» en specs/trail.allium. Hasta ahora, decir por qué
// dos páginas tienen que ver exigía componer un recorrido entero, y la mayor
// parte de lo que alguien sabe sobre su corpus no llega nunca a ser un
// argumento: es una frase suelta que no tenía dónde ponerse.
//
// Se escribe como un bloque que cuelga de aquel desde el que se afirma:
//
//     - PICTOS toma la rejilla de Guemil y la lleva a generación.
//       - profundiza lo que Guemil dejó planteado: su rejilla se vuelve generativa.
//         explica:: [[Guemil]]
//         término:: profundiza
//
// Un bloque y no una tabla, y de ahí sale gratis todo lo que hace falta: se
// edita como se edita cualquier bloque, se puede grabar con la voz porque
// voice-capture ya sabe pegar audio a un bloque, conserva de qué mano salió, se
// busca con la búsqueda de siempre y viaja en la proyección Markdown. Un corpus
// donde las explicaciones vivieran aparte tendría una segunda memoria al lado de
// la primera.
//
// Y propiedades y no prosa —@invariant TheExplainedFaceIsWrittenAndTheDerivedFaceIsNot—
// porque las propiedades no se recalculan al editar el texto: la explicación
// sobrevive a corregir una tilde en la frase que la ocasionó, que es
// exactamente lo que no ocurriría si colgara del enlace derivado.

/*
 * Las claves con que un bloque dice que explica una relación no están escritas
 * aquí: las dice el corpus.
 *
 * Ver property-names.ts. Lo que este archivo sabe es qué papel cumple cada una
 * —a dónde apunta, con qué término, en qué sentido—, y cuál es la palabra lo
 * declara `VERA: Relaciones`. Escribirlas aquí las convertía en una decisión
 * de Vera sobre la lengua de quien escribe.
 */

import type { PropertyNames } from './property-names.ts';
import type { CrossingId } from './types.ts';

/** Cómo vale una relación leída desde donde se escribió. */
export type CrossingSense = 'directed';

/**
 * Un término del vocabulario de relaciones, con su recíproco.
 *
 * Cada término nombra su inverso porque no se lee igual en los dos extremos:
 * «contradice» dicho desde A se lee «es contradicha por» desde B, y sin el par
 * la columna de entrantes mentiría sobre quién afirma qué. Los simétricos son su
 * propio inverso, y eso es lo que los hace aptos para una relación mutua.
 */
export interface RelationTerm {
  name: string;
  inverse: string;
}

/*
 * El vocabulario que Vera trae, que es un mínimo y no una verdad.
 *
 * @invariant DefaultsLiveInTheCode: lo que rige es lo que diga `VERA: Relaciones`
 * cuando la haya; esto es lo que hay mientras no la haya, y está aquí
 * para que explicar una relación no exija antes construir un vocabulario.
 */
export const STARTER_RELATIONS: RelationTerm[] = [
  { name: 'profundiza', inverse: 'es profundizada por' },
  { name: 'contradice', inverse: 'es contradicha por' },
  { name: 'respalda', inverse: 'es respaldada por' },
  { name: 'ejemplifica', inverse: 'es ejemplificada por' },
  { name: 'generaliza', inverse: 'es un caso de' },
  { name: 'precede a', inverse: 'sigue a' },
  { name: 'nace de', inverse: 'da lugar a' },
  // Simétricos: su propio inverso, y por eso valen para una relación mutua.
  { name: 'se opone a', inverse: 'se opone a' },
  { name: 'dialoga con', inverse: 'dialoga con' },
  { name: 'es lo mismo que', inverse: 'es lo mismo que' },
];

export function isSymmetric(term: RelationTerm): boolean {
  return term.name === term.inverse;
}

/** El término tal como se lee desde el otro extremo. */
export function inverseOf(
  name: string | null,
  vocabulary: RelationTerm[] = STARTER_RELATIONS,
): string | null {
  if (name === null) return null;
  const held = vocabulary.find((one) => one.name.toLowerCase() === name.trim().toLowerCase());
  // Un término que el vocabulario no tiene se lee igual en los dos lados. No se
  // inventa un recíproco: inventarlo pondría en boca de una página una
  // afirmación que nadie escribió.
  return held?.inverse ?? name;
}

/**
 * Una relación explicada, derivada de las propiedades de un bloque.
 *
 * No es una fila que alguien escribe: es lo que resulta de mirar un bloque que
 * lleva `explica::`. Por eso no hay operación de crear ni de borrar una
 * relación: se escribe el bloque, y se borra el bloque.
 */
export interface Crossing {
  /** Identidad estable de la conectiva. */
  stableId: CrossingId;
  /** Alias transitorio para consumidores anteriores. */
  connective: CrossingId;
  /** Lo que se dijo. */
  said: string;
  /** El outline canónico que expresa la relación. */
  blocks: readonly import('./types.ts').Block[];
  /** Bloque antiguo del que se migró, si todavía no es entidad nativa. */
  fromBlock: string | null;
  /** Y la página donde vive, que es la que afirma. */
  fromPage: string;
  /** El título al que apunta, tal como se escribió. */
  targetTitle: string;
  /** La página del destino; nula sólo para una descripción antigua aún no migrada. */
  toPage: string | null;
  sense: CrossingSense;
  /** El término, cuando quien explica quiso decirlo. La prosa es obligatoria y
   *  el término no: nadie debería tener que decidir en qué cajón va una relación
   *  antes de poder decir por qué existe. */
  term: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Qué papel cumple una clave, si cumple alguno de los tres. */
export function relationKeyOf(
  key: string,
  names: Pick<PropertyNames, 'explains' | 'term' | 'sense'>,
): 'explains' | 'term' | 'sense' | null {
  const clean = key.trim().toLowerCase();
  if (clean === names.explains.toLowerCase()) return 'explains';
  if (clean === names.term.toLowerCase()) return 'term';
  if (clean === names.sense.toLowerCase()) return 'sense';
  return null;
}

/** El título que nombra un valor, con o sin corchetes. */
export function titleIn(value: string): string {
  const linked = /\[\[([^\]]+)\]\]/.exec(value);
  return (linked?.[1] ?? value).trim();
}

export function senseIn(value: string | null): CrossingSense {
  return 'directed';
}
