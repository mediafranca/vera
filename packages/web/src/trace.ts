// El rastro: por dónde se ha pasado, y cómo.
//
// workspace-interface.allium lo gobierna. Vive aquí y no en main.ts porque a
// partir del paso 2 se poda y se reordena, y esas son operaciones sobre una
// lista que conviene poder probar sin un DOM delante.
//
// Lo que este módulo defiende, dicho una vez: el breadcrumb contiene páginas,
// no una bitácora de visitas. Cada página aparece una sola vez. El paso conserva
// la llegada más reciente porque su gesto sí importa, pero volver a una página
// mueve ese único paso al final en vez de sumar otra instancia. Ver
// workspace-interface.allium.

/**
 * Qué hizo alguien para llegar a la página en la que está.
 *
 * No son maneras de moverse: son maneras de leer.
 * @invariant TheGestureIsObservedAndNeverInferred: lo pone la superficie que
 * recibió el gesto, porque es la única que lo sabe. No hay valor por defecto y no
 * se deduce después mirando el grafo — eso contestaría qué había en el corpus, y
 * la pregunta es qué hizo alguien.
 */
export type NavigationGesture =
  /** Se pulsó el nombre de otra página dentro del texto que se leía. */
  | 'followed_reference'
  /** Se entró por un backlink: la pregunta era quién había hablado de esto. */
  | 'followed_backlink'
  /** Se vio una forma en el mapa y se fue ahí. */
  | 'pressed_on_the_map'
  /** Se fue a por algo que ya se sabía que se quería. */
  | 'searched'
  /** Se regresó sobre el propio rastro. */
  | 'returned'
  /** Se llegó de fuera: una dirección, el día de hoy, una página del menú. */
  | 'opened_directly';

/** Un paso del rastro. `from` es nulo cuando se llegó sin venir de ninguna parte. */
export interface TraceStep {
  readonly page: string;
  readonly from: string | null;
  readonly gesture: NavigationGesture;
  /** La conectiva realmente pulsada para llegar, no una inferencia posterior. */
  readonly crossing?: {
    readonly id: string;
    readonly revision: string;
    readonly content: string;
  } | null;
  readonly at: number;
}

const TRACE_KEY = 'vera.navigationTrace';
export const TRACE_LIMIT = 50;
const GESTURES = new Set<NavigationGesture>([
  'followed_reference',
  'followed_backlink',
  'pressed_on_the_map',
  'searched',
  'returned',
  'opened_directly',
]);

/** Conserva sólo la llegada más reciente de cada página y su orden relativo. */
function uniqueMostRecent(trace: readonly TraceStep[]): TraceStep[] {
  const seen = new Set<string>();
  const unique: TraceStep[] = [];
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    const step = trace[index];
    if (step === undefined || seen.has(step.page)) continue;
    seen.add(step.page);
    unique.push(step);
  }
  return unique.reverse();
}

/** Recupera el taller local sin permitir que datos viejos o rotos impidan abrir Vera. */
export function loadTrace(): TraceStep[] {
  try {
    const held: unknown = JSON.parse(localStorage.getItem(TRACE_KEY) ?? '[]');
    if (!Array.isArray(held)) return [];
    const valid = held.filter((step): step is TraceStep => {
      if (typeof step !== 'object' || step === null) return false;
      const candidate = step as Partial<TraceStep>;
      return (
        typeof candidate.page === 'string' &&
        (candidate.from === null || typeof candidate.from === 'string') &&
        typeof candidate.gesture === 'string' &&
        GESTURES.has(candidate.gesture as NavigationGesture) &&
        (candidate.crossing === undefined || candidate.crossing === null || (
          typeof candidate.crossing === 'object' &&
          typeof candidate.crossing.id === 'string' &&
          typeof candidate.crossing.revision === 'string' &&
          typeof candidate.crossing.content === 'string'
        )) &&
        typeof candidate.at === 'number' &&
        Number.isFinite(candidate.at)
      );
    });

    /*
     * Versiones anteriores guardaban una instancia por llegada. La migración se
     * queda con la llegada más reciente de cada página: A → B → A pasa a B → A,
     * el mismo reordenamiento que produce una revisita desde ahora.
     */
    const migrated = uniqueMostRecent(valid).slice(-TRACE_LIMIT);
    if (migrated.length !== valid.length) saveTrace(migrated);
    return migrated;
  } catch {
    return [];
  }
}

/** El rastro es local-first: cada gesto queda durable antes de volver a la red. */
export function saveTrace(trace: readonly TraceStep[]): void {
  localStorage.setItem(TRACE_KEY, JSON.stringify(uniqueMostRecent(trace).slice(-TRACE_LIMIT)));
}

/** Vacía el rastro local: todavía no es corpus y por eso no deja historial. */
export function clearTrace(): void {
  localStorage.removeItem(TRACE_KEY);
}

/**
 * Registra la llegada más reciente a una página.
 *
 * @invariant RevisitingReordersInsteadOfRepeating: si la página ya estaba, se
 * quita su paso anterior y la llegada nueva ocupa el final. Cambian el orden, el
 * origen y el gesto conservado; la cantidad de páginas no aumenta.
 *
 * Conserva como máximo las últimas TRACE_LIMIT páginas. El rastro orienta el
 * taller y puede promoverse, pero no es un archivo ilimitado de actividad: para
 * guardar un tramo como argumento existe el gesto de promoverlo a recorrido.
 */
export function walked(trace: readonly TraceStep[], step: TraceStep): TraceStep[] {
  /*
   * Lo que sí se descarta: llegar donde ya se estaba.
   *
   * @invariant RedrawingAPageIsNotWalkingToIt, dicho donde no se puede olvidar.
   * Lo estaba sólo por convención —quien redibuja no pasa gesto— y bastó un
   * camino que sí lo pasara para romperlo: pulsar un enlace a un ancla cambiaba
   * el fragmento de la dirección, el enrutador lo leía como una llegada, y el
   * rastro se llenaba de la misma página tantas veces como clics hubo.
   *
   * Esto no es una revisita: no hubo movimiento, por lo que tampoco hay nada que
   * reordenar ni una llegada nueva que conservar.
   */
  if (step.from === step.page) return [...trace];
  // Y sin `from` —una dirección pegada, el botón de atrás— lo dice el rastro:
  // si el último paso ya estaba ahí, nadie se movió.
  if (step.from === null && trace[trace.length - 1]?.page === step.page) return [...trace];
  return [...trace.filter((existing) => existing.page !== step.page), step].slice(-TRACE_LIMIT);
}

/**
 * Quita un paso.
 *
 * @invariant DroppingAStepLeavesNoRecord: no queda constancia de que estuvo. El
 * rastro no tiene historia porque no es una página.
 */
export function dropped(trace: readonly TraceStep[], index: number): TraceStep[] {
  if (index < 0 || index >= trace.length) return [...trace];
  return trace.filter((_, i) => i !== index);
}

/**
 * Descarta paradas cuya identidad ya no pertenece al corpus actual.
 *
 * El rastro vive en el aparato y puede sobrevivir a una restauración o a la
 * consolidación de páginas. Una identidad huérfana no debe convertirse en un
 * nombre `page:…` ni impedir que las demás paradas formen un librillo.
 */
export function retainingPages(trace: readonly TraceStep[], pages: ReadonlySet<string>): TraceStep[] {
  return trace.filter((step) => pages.has(step.page));
}

/**
 * Mueve un paso a otra posición.
 *
 * @invariant ReorderingDoesNotRewriteWhatHappened: el paso conserva su gesto y su
 * `from`, que son hechos sobre lo que ocurrió y no cambian porque cambie de
 * sitio. Lo que cambia es de quién es vecino, y por eso `from` puede acabar
 * nombrando una página que ya no es la anterior. No se repara: es la distancia
 * entre por dónde se anduvo y por dónde se quiere llevar a alguien.
 */
export function movedTo(trace: readonly TraceStep[], index: number, position: number): TraceStep[] {
  if (index < 0 || index >= trace.length) return [...trace];
  const target = Math.max(0, Math.min(position, trace.length - 1));
  if (target === index) return [...trace];
  const next = [...trace];
  const [step] = next.splice(index, 1);
  if (step === undefined) return [...trace];
  next.splice(target, 0, step);
  return next;
}

/** Las páginas por las que se pasó, en orden. Lo que el mapa necesita del rastro. */
export function pagesOf(trace: readonly TraceStep[]): string[] {
  return trace.map((step) => step.page);
}
