// Lo que pasó desde el cursor, y qué hacer con ello.
//
// Ver specs/offline-reconciliation.allium, fase 3 y 4. Aquí no hay red ni DOM: entra
// lo que el servidor contestó a «¿qué ha pasado desde mi cursor?» y sale qué de eso
// espera, cuánto toca la página abierta, y con qué choca de lo que este aparato aún
// no ha logrado mandar.
//
// La pregunta es barata y tomarla no lo es, y esa asimetría es el diseño entero.
// Medido sobre el corpus real: las últimas veinte operaciones son 3,8 KB y 3 ms;
// una página muy escrita son 512 KB y 0,81 s. Preguntar puede ser continuo; traer
// hay que pedirlo. @guarantee KnowingIsCheapAndTakingIsNot.
//
// Y nada de lo que salga de aquí se aplica solo. Otra mano escribe en este corpus
// —ver agent-participation.allium— así que una página puede haberse movido mientras
// se la lee. Cambiar el texto bajo los ojos de quien lee no es sincronizar, es
// interrumpir; callarlo es lo único que SilenceNeverPretendsToBeSuccess prohíbe.
// Queda decirlo y dejar que el dueño elija cuándo.
// @guarantee WhatArrivesIsAnnouncedAndNotImposed.

/** Una operación canónica, tal como `GET /ops?since=` la cuenta. */
export interface CanonicalOp {
  sequence: number;
  originId: string;
  kind: string;
  subjectId: string | null;
  /** A qué página tocó. Nulo cuando no se puede saber: un bloque ya borrado. */
  page: string | null;
  authoredBy: string;
  channel: string;
}

/** Lo que espera, ya sabido y todavía sin tomar. */
export interface Waiting {
  op: CanonicalOp;
  /** Si tocó la página que se está leyendo. */
  here: boolean;
}

export interface Behind {
  waiting: Waiting[];
  /** Cuántas tocan lo que está en pantalla. Es lo que decide si el aviso pregunta. */
  here: number;
  /** Hasta dónde llegaría el cursor si se tomara todo esto. */
  upTo: number;
  /** Las páginas retenidas que dejaron de estar al día. */
  staleElsewhere: string[];
  /** Quiénes escribieron lo que espera, sin repetir. */
  hands: string[];
}

/**
 * Lo que de verdad espera, quitando lo propio.
 *
 * Lo que este aparato mandó vuelve por el mismo sitio —el registro canónico es uno
 * solo— y anunciárselo a quien lo escribió sería pedirle que tome lo que acaba de
 * dar. Se reconoce por el `originId`, que es la misma llave con que la bandeja
 * sabe que algo ya llegó. @invariant OriginIdentityIsTheIdempotencyKey.
 */
export function behind(
  ops: readonly CanonicalOp[],
  what: {
    /** Los orígenes que salieron de este aparato. */
    mine: ReadonlySet<string>;
    /** La página abierta, si hay alguna. */
    openPage: string | null;
    /** Qué páginas tiene retenidas este aparato. */
    retained: ReadonlySet<string>;
  },
): Behind {
  const waiting: Waiting[] = [];
  const stale = new Set<string>();
  const hands = new Set<string>();
  let upTo = 0;

  for (const op of ops) {
    upTo = Math.max(upTo, op.sequence);
    const here = what.openPage !== null && op.page === what.openPage;
    const mine = what.mine.has(op.originId);
    /*
     * Lo propio no se anuncia, pero sí vuelve vieja una copia retenida.
     *
     * El gesto ya se vio en pantalla; eso no significa que IndexedDB haya
     * recibido la nueva PageView. Si se conserva el snapshot anterior, la
     * próxima visita resucita el estado previo y parece que el gesto se perdió.
     */
    if (op.page !== null && what.retained.has(op.page) && (mine || !here)) stale.add(op.page);
    if (mine) continue;
    waiting.push({ op, here });
    hands.add(op.authoredBy);
    /*
     * Una página retenida que otra mano tocó dejó de estar al día, y hay que
     * saberlo aunque no se esté mirando: si no, la próxima visita la enseñaría al
     * instante y equivocada, que es exactamente lo que un caché sin nadie a quien
     * preguntarle hace mal.
     */
    if (!here && op.page !== null && what.retained.has(op.page)) stale.add(op.page);
  }

  return {
    waiting,
    here: waiting.filter((one) => one.here).length,
    upTo,
    staleElsewhere: [...stale],
    hands: [...hands],
  };
}

/** Cómo se dice, en la barra, lo que espera. */
export function said(state: Behind): { message: string; title: string } | null {
  if (state.waiting.length === 0) return null;
  const quien =
    state.hands.length === 1 ? nameOf(state.hands[0] as string) : `${state.hands.length} manos`;
  if (state.here > 0) {
    return {
      message: state.here === 1 ? 'cambió aquí' : `cambió aquí · ${state.here}`,
      title: `${quien} escribió en esta página mientras la leías. Pulsa para traerlo.`,
    };
  }
  return {
    message: state.waiting.length === 1 ? 'algo nuevo' : `algo nuevo · ${state.waiting.length}`,
    title: `${quien} escribió en el corpus. Nada de esta página cambió. Pulsa para ponerte al día.`,
  };
}

/** Los identificadores de participante se presentan como rótulos legibles. */
function nameOf(participant: string): string {
  if (participant === 'participant:cotito') return 'Cotito';
  const cut = participant.indexOf(':');
  return cut === -1 ? participant : participant.slice(cut + 1);
}

// ── El desacuerdo ─────────────────────────────────────────────────────────

/** Un bloque que dos manos escribieron, con las dos versiones. */
export interface Disagreement {
  block: string;
  /** Lo escrito aquí y todavía sin confirmar. */
  mine: string;
  /** Lo que el corpus dice ahora. */
  theirs: string;
  /** Quién escribió lo del corpus. */
  hand: string;
}

/**
 * Dónde el corpus y lo pendiente dicen cosas distintas del mismo bloque.
 *
 * Se compara con lo que el corpus entregó y no con la operación que lo cambió,
 * porque `/ops` cuenta qué pasó y no qué quedó: dos ediciones seguidas del mismo
 * bloque son dos operaciones y un solo texto, y el que importa es el último.
 *
 * Lo que no está pendiente no es un desacuerdo aunque haya cambiado: es
 * simplemente lo nuevo, y se toma sin preguntar. Preguntar por cada bloque que otra
 * mano tocó convertiría una decisión en cincuenta.
 */
export function disagreements(
  canonical: ReadonlyMap<string, string>,
  pending: readonly { block: string; content: string }[],
  hands: ReadonlyMap<string, string>,
): Disagreement[] {
  const out: Disagreement[] = [];
  const seen = new Set<string>();
  // Del final hacia atrás: de varias ediciones pendientes del mismo bloque, la que
  // vale es la última, que es la que se va a mandar y la que se está mirando.
  for (let at = pending.length - 1; at >= 0; at -= 1) {
    const one = pending[at] as { block: string; content: string };
    if (seen.has(one.block)) continue;
    seen.add(one.block);
    const theirs = canonical.get(one.block);
    if (theirs === undefined || theirs === one.content) continue;
    out.push({
      block: one.block,
      mine: one.content,
      theirs,
      hand: nameOf(hands.get(one.block) ?? 'el corpus'),
    });
  }
  return out.reverse();
}

// ── Las líneas que difieren ───────────────────────────────────────────────

export type Line = { text: string; mark: 'same' | 'mine' | 'theirs' };

/**
 * Las dos versiones de un bloque, línea a línea, con lo que cambió marcado.
 *
 * Se enseñan; no se eligen. La unidad de la decisión es el bloque, que es lo único
 * de lo que Vera tiene identidad: elegir línea a línea dejaría un texto que no
 * escribió ninguna de las dos manos, en un bloque cuya autoría ya no se podría
 * afirmar. Pero elegir entre dos versiones sin ver en qué difieren es elegir a
 * ciegas. @guarantee ADisagreementIsResolvedOneBlockAtATime.
 *
 * El casco común por delante y por detrás, y en medio lo de cada uno. Un diff de
 * verdad diría más y costaría más; para un bloque —unas líneas, no un archivo—
 * esto marca lo mismo que se vería con uno.
 */
export function sideBySide(mine: string, theirs: string): { mine: Line[]; theirs: Line[] } {
  const a = mine.split('\n');
  const b = theirs.split('\n');

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;

  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail += 1;
  }

  const dress = (lines: string[], mark: 'mine' | 'theirs'): Line[] =>
    lines.map((text, at) => ({
      text,
      mark: at < head || at >= lines.length - tail ? 'same' : mark,
    }));

  return { mine: dress(a, 'mine'), theirs: dress(b, 'theirs') };
}
