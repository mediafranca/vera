// El recorrido: la lectura ordenada de una preparación o argumento.
//
// No hay entidad que mantener y no hay tabla nueva. Un recorrido es una página
// con `tipo:: preparación argumental` o `tipo:: argumento`, y todo lo demás se
// calcula mirándola: los nodos son las
// referencias que su texto lleva, en el orden en que se leen; las conectivas son
// lo que queda del texto cuando se le quitan las referencias; los cruces son los
// pares de nodos consecutivos. Un recorrido de siete nodos tiene seis cruces, y
// ninguno de los seis está guardado en ninguna parte.
//
// De ahí sale @invariant AnyPageCouldBeSeenAsAThread, que no es una observación
// bonita sino una identidad: toda página tiene referencias en un orden y texto
// entre ellas. Declararla recorrido no crea nada —no reordena, no toca una
// referencia, no cambia el mapa de nadie—; lo único que cambia es que a partir de
// ahí ese orden se puede leer como ruta, porque alguien dijo que era a propósito.
//
// Las dos caras del cruce. La escrita la pone el guía y no se deriva de nada: es
// la conectiva. La derivada la pone el grafo y no se guarda: ¿había ya una frase
// uniendo estas dos páginas, o las junta este argumento y nadie más? Se calcula
// en tiempo presente, así que un cruce a campo través puede pasar a ser por
// camino sin que el recorrido se toque —alguien escribió por fin la frase que
// faltaba, y eso es el corpus alcanzando a un argumento que iba por delante—.
//
// Ver specs/trail.allium.

import { ARGUMENT_KIND } from './argument-workbench.ts';
import type { PropertyNames } from './property-names.ts';

/** El valor de `tipo` con que una página dice que su orden es un argumento. */
export const TRAIL_KIND = ARGUMENT_KIND;

/**
 * La propiedad con que un bloque de cruce dice cómo se anduvo.
 *
 * La escribe la promoción de un rastro y se puede borrar como cualquier otra
 * cosa escrita. No es la conectiva y no hay que confundirlas: «se llegó aquí
 * por quién nombra a X» es un hecho sobre el caminante, ya ocurrido; «y por eso
 * X no podía sostenerse» es una afirmación del guía, discutible.
 */
export const TESTIMONY_KEY = 'cruzado';

/** Qué había en el corpus entre dos paradas, en el momento de mirar. */
export type CrossingKind = 'by_path' | 'across_open_ground';

/** Un bloque de la página, tal como hace falta para leerla como ruta. */
export interface TrailBlock {
  stableId: string;
  parent: string | null;
  position: number;
  content: string;
  /** El testimonio de cómo se anduvo hasta aquí, si vino de un rastro. */
  testimony?: string | null;
  citedCrossing?: string | null;
  citedRevision?: string | null;
}

/** Una parada: un sitio del corpus citado desde el texto del recorrido. */
export interface TrailNode {
  /** Su número, desde 1. Es del argumento y no del dibujo: no se renumera. */
  ordinal: number;
  /** De qué bloque sale, para poder ir a corregirlo. */
  block: string;
  /** El título tal como está escrito. */
  title: string;
  /** A qué página lleva. Nulo es un puente cortado: se enseña, no se quita. */
  page: string | null;
  /** El bloque preciso referido, cuando la perla es `((bloque))`. */
  targetBlock?: string;
}

export interface TrailCrossing {
  from: TrailNode;
  to: TrailNode;
  /** Lo que el guía escribió entre los dos. Vacío mientras no escribió nada. */
  connective: string;
  /** Cómo se anduvo, cuando se anduvo. */
  testimony: string | null;
  /** La conectiva declarada efectivamente recorrida y la revisión leída. */
  citation: { crossing: string; revision: string } | null;
  kind: CrossingKind;
  /** ¿Hay algo dicho sobre este cruce, sea del guía o del caminante? */
  spokenFor: boolean;
  /**
   * De qué bloques salió la conectiva.
   *
   * Para poder dibujar el tramo donde se lee: la costura de un cruce no es una
   * marca junto a la parada a la que llega, es la raya que corre al lado de lo
   * que se lee mientras se va de una a otra.
   */
  blocks: string[];
}

export interface Trail {
  page: string;
  /** Para quién es esto, escrito por quien lo compuso. */
  intent: string | null;
  /** Lo que se lee antes de la primera parada. No es una conectiva. */
  opening: string;
  route: TrailNode[];
  crossings: TrailCrossing[];
  /** Lo que se escribe después de la última parada. */
  conclusion: string;
  /** Las paradas que ya no llevan a ninguna parte. */
  broken: TrailNode[];
  /** Un recorrido sin una sola conectiva es una lista de enlaces. */
  argues: boolean;
}

/** ¿Esta página dice de sí misma que ya alcanzó el estado argumento? */
export function isTrail(
  properties: readonly { key: string; value: string }[],
  names: PropertyNames,
): boolean {
  const key = names.kind.trim().toLowerCase();
  return properties.some(
    (one) =>
      one.key.trim().toLowerCase() === key &&
      one.value.trim().toLowerCase() === TRAIL_KIND,
  );
}

/**
 * Los bloques en el orden en que se leen.
 *
 * En profundidad y por posición, que es como los dibuja el esquema: un hijo se
 * lee después de su padre y antes del siguiente hermano. El orden importa porque
 * es lo único que un recorrido afirma —«por aquí, en este orden»— y leerlo plano
 * pondría las notas colgando de una parada detrás de la parada siguiente.
 */
export function readingOrder(blocks: readonly TrailBlock[]): TrailBlock[] {
  const children = new Map<string | null, TrailBlock[]>();
  for (const block of blocks) {
    const kin = children.get(block.parent) ?? [];
    kin.push(block);
    children.set(block.parent, kin);
  }
  for (const kin of children.values()) kin.sort((a, b) => a.position - b.position);

  const said: TrailBlock[] = [];
  const walk = (parent: string | null): void => {
    for (const block of children.get(parent) ?? []) {
      said.push(block);
      walk(block.stableId);
    }
  };
  walk(null);
  return said;
}

interface Piece {
  kind: 'text' | 'node';
  said: string;
  block: string;
  targetBlock?: string;
  /** El testimonio del bloque, para el cruce que llega a este nodo. */
  testimony: string | null;
}

/**
 * La página como una sola corriente de trozos: texto, referencia, texto.
 *
 * Un recorrido no distingue entre lo que está en el bloque de una parada y lo
 * que está en el bloque de al lado. «Y siete años después ya no se podía
 * deshacer: [[X]]» es una conectiva y un nodo en el mismo bloque, y «[[X]]» con
 * la frase encima es lo mismo dicho en dos. Partir por bloques obligaría a
 * decidir cuál de las dos formas es la buena, y las dos lo son.
 */
function pieces(blocks: readonly TrailBlock[]): Piece[] {
  const said: Piece[] = [];
  for (const block of readingOrder(blocks)) {
    const testimony = block.testimony ?? null;
    const before = said.length;
    let at = 0;
    for (const found of block.content.matchAll(/\[\[([^\]]+)\]\]|\(\(([^()\s]+)\)\)/g)) {
      const before = block.content.slice(at, found.index);
      if (before.trim() !== '') {
        said.push({ kind: 'text', said: before, block: block.stableId, testimony });
      }
      said.push({
        kind: 'node',
        said: (found[1] ?? found[2] ?? '').trim(),
        block: block.stableId,
        ...(found[2] === undefined ? {} : { targetBlock: found[2] }),
        testimony,
      });
      at = found.index + found[0].length;
    }
    const rest = block.content.slice(at);
    if (rest.trim() !== '') {
      said.push({ kind: 'text', said: rest, block: block.stableId, testimony });
    }
    /*
     * Un bloque vacío deja igualmente su huella en el tramo.
     *
     * Es el caso del bloque de cruce que escribe la promoción de un rastro: nace
     * sin conectiva y con el testimonio colgando. Si no dejara trozo, el tramo no
     * sabría de qué bloque salía su testimonio y el cruce se leería mudo teniendo
     * escrito cómo se anduvo.
     */
    if (said.length === before) {
      said.push({ kind: 'text', said: '', block: block.stableId, testimony });
    }
  }
  return said;
}

/** Junta los trozos de texto de un tramo en una frase legible. */
const joined = (parts: readonly string[]): string =>
  parts
    .map((one) => one.trim())
    .filter((one) => one !== '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

export interface TrailReading {
  page: string;
  intent: string | null;
  blocks: readonly TrailBlock[];
  /** De un título a la página que nombra, o null si nadie la escribió todavía. */
  resolve: (title: string) => string | null;
  /** Resuelve una referencia precisa a su página sin convertirla en copia. */
  resolveBlock?: (block: string) => { page: string; title: string } | null;
  /**
   * ¿Unía ya el corpus estas dos páginas?
   *
   * Sin contar los enlaces que salen del propio recorrido: un recorrido enlaza a
   * todas sus paradas —es lo que lo hace encontrable desde cada una— y contarlos
   * haría que todo cruce fuera por camino por construcción, con lo que la
   * distinción no distinguiría nada.
   */
  linked: (a: string, b: string) => boolean;
  /** La relación dirigida que el corpus ya explicó para este par, si existe. */
  relation: (
    from: string,
    to: string,
  ) => { id: string; revision: string; content: string } | null;
}

/**
 * Lee una página como recorrido.
 *
 * Lo devuelve siempre, la haya declarado o no: mirar cualquier página como hilo
 * es posible y casi todas darían ruido. Quién llama decide si preguntarlo —ver
 * `isTrail`—, y eso deja esta función siendo lo que es, una lectura y no un
 * permiso.
 */
export function readTrail(said: TrailReading): Trail {
  const stream = pieces(said.blocks);

  const route: TrailNode[] = [];
  /** El texto de cada hueco, y de qué bloques salió: el testimonio vive ahí. */
  const between: { text: string[]; blocks: string[] }[] = [];
  const opening: string[] = [];
  let pending: { text: string[]; blocks: string[] } | null = null;

  for (const piece of stream) {
    if (piece.kind === 'text') {
      if (pending === null) opening.push(piece.said);
      else {
        pending.text.push(piece.said);
        pending.blocks.push(piece.block);
      }
      continue;
    }
    const resolvedBlock = piece.targetBlock === undefined
      ? null
      : (said.resolveBlock?.(piece.targetBlock) ?? null);
    route.push({
      ordinal: route.length + 1,
      block: piece.block,
      title: resolvedBlock?.title ?? piece.said,
      page: resolvedBlock?.page ?? (piece.targetBlock === undefined ? said.resolve(piece.said) : null),
      ...(piece.targetBlock === undefined ? {} : { targetBlock: piece.targetBlock }),
    });
    pending = { text: [], blocks: [] };
    between.push(pending);
  }

  // Lo que quedó pendiente después de la última parada es la conclusión, y no la
  // conectiva de un cruce que no existe. @invariant TheLastConnectiveLeadsNowhere.
  const conclusion = joined(between[between.length - 1]?.text ?? []);

  /*
   * De qué bloque sale el testimonio de un cruce.
   *
   * Del bloque de la conectiva y no del bloque de la parada, porque es ahí donde
   * lo escribe la promoción de un rastro: un cruce es su propio bloque, entre
   * dos paradas. Si la conectiva no dejó bloque —dos paradas seguidas sin nada
   * escrito entre ellas— se mira el de la parada a la que se llega, que es donde
   * lo pondría quien lo escribiera a mano.
   */
  const testimonies = new Map<string, string | null>();
  for (const block of said.blocks) testimonies.set(block.stableId, block.testimony ?? null);

  const crossings: TrailCrossing[] = [];
  for (let at = 0; at + 1 < route.length; at += 1) {
    const from = route[at]!;
    const to = route[at + 1]!;
    const gap = between[at] ?? { text: [], blocks: [] };
    const written = joined(gap.text);
    const testimony =
      [...gap.blocks, to.block]
        .map((block) => testimonies.get(block) ?? null)
        .find((one) => one !== null && one !== '') ?? null;
    const cited = [...gap.blocks, to.block]
      .map((id) => said.blocks.find((block) => block.stableId === id))
      .find((block) => block?.citedCrossing != null && block.citedRevision != null);
    /*
     * La ruta decide el par y la dirección; el corpus aporta lo que ya dijo.
     * Haber llegado por una referencia ordinaria no vuelve inexistente una
     * relación A → B. El texto propio del argumento se conserva por compatibilidad
     * mientras se materializa como revisión, pero un hueco no oculta la relación.
     */
    const held = from.page !== null && to.page !== null
      ? said.relation(from.page, to.page)
      : null;
    const connective = written === '' ? (held?.content ?? '') : written;
    const citation = cited?.citedCrossing != null && cited.citedRevision != null
      ? { crossing: cited.citedCrossing, revision: cited.citedRevision }
      : held === null
        ? null
        : { crossing: held.id, revision: held.revision };
    const kind: CrossingKind =
      from.page !== null && to.page !== null && said.linked(from.page, to.page)
        ? 'by_path'
        : 'across_open_ground';
    crossings.push({
      from,
      to,
      connective,
      testimony,
      citation,
      kind,
      spokenFor: connective !== '' || testimony !== null,
      blocks: [...new Set(gap.blocks)].filter((one) => one !== from.block && one !== to.block),
    });
  }

  return {
    page: said.page,
    intent: said.intent,
    opening: joined(opening),
    route,
    crossings,
    conclusion,
    broken: route.filter((node) => node.page === null),
    argues: crossings.some((one) => one.connective !== ''),
  };
}
