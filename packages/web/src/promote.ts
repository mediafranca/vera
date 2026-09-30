// Sembrar una preparación argumental con un tramo del rastro.
//
// Componer un recorrido empieza por haberlo andado. Lo que el taller ofrece no
// es un compositor de rutas —una lista donde arrastrar nodos, un panel donde
// teclear conectivas— sino un gesto sobre el rastro que ya está en pantalla:
// promoverlo. Lo que queda después es una página y el editor de siempre.
// @guarantee WalkingIsTheFirstDraft.
//
// La diferencia con un compositor no está en el gesto sino en de dónde sale lo
// que se arrastra: en un compositor uno pone los nodos que cree que necesita, y
// en el rastro ya están porque uno pasó por ahí. Se poda algo que sobra, no se
// convoca algo que falta. Por eso promover no pide saber el argumento de
// antemano: es lo que uno hace mientras se entera de cuál era.
//
// Lo que nace no es aún un argumento: es la mesa donde sus fuentes y huecos
// quedan disponibles para ser podados, ordenados, anotados y articulados. Vera
// transcribe el testimonio y no escribe la conectiva nunca: un «y después» de
// plantilla tendría la forma de una conectiva sin afirmar nada, y ocuparía el
// sitio donde va lo que alguien tiene que escribir.
//
// Ver specs/trail.allium, regla PromoteTheTraceAsAnArgument.

import { ARGUMENT_PREPARATION_KIND, TESTIMONY_KEY } from '@vera/core';
import type { NavigationGesture, TraceStep } from './trace.ts';

/**
 * Cómo se anduvo un paso, dicho como un hecho.
 *
 * Es testimonio y no conectiva, y la línea entre las dos hay que saber decirla
 * porque se parecen mucho: esto es comprobable, sobre el caminante y ya ocurrido;
 * una conectiva es discutible, sobre el corpus y del guía.
 */
export function testimonyFor(step: TraceStep, titleOf: (page: string) => string): string {
  const from = step.from === null ? null : titleOf(step.from);
  const how: Record<NavigationGesture, string> = {
    followed_reference:
      from === null
        ? 'se llegó siguiendo una referencia'
        : `se llegó siguiendo una referencia desde «${from}»`,
    followed_backlink:
      from === null
        ? 'se llegó por un retroenlace'
        : `se llegó preguntando quién habla de «${from}»`,
    pressed_on_the_map: from === null ? 'se llegó desde el mapa' : `se llegó desde el mapa, viniendo de «${from}»`,
    searched: 'se llegó buscando',
    returned: 'se volvió sobre el propio rastro',
    opened_directly: 'se llegó de fuera',
  };
  return how[step.gesture] ?? 'se llegó';
}

/**
 * El nombre con que nace.
 *
 * Un andamio, y se dice que lo es. Lo pone Vera para que la página pueda existir
 * sin obligar a nadie a saber todavía de qué trata; ponerle el suyo es un
 * renombrado como cualquier otro. Todavía no es el título de un argumento: es
 * el nombre provisional de un trabajo que apenas se volvió manipulable.
 * @invariant TheUpgradeIsHavingAName.
 */
export function provisionalTitle(at: Date, taken: (title: string) => boolean): string {
  const day = at.toISOString().slice(0, 10);
  const first = `Preparación argumental del ${day}`;
  if (!taken(first)) return first;
  for (let n = 2; n < 100; n += 1) {
    const other = `Preparación argumental del ${day} (${n})`;
    if (!taken(other)) return other;
  }
  return `${first} · ${at.getTime()}`;
}

/** Un cambio de los que Vera acepta, tal como los escribe quien promueve. */
export type Change =
  | { kind: 'create_page'; title: string; visibility: 'private' }
  | { kind: 'set_property'; page: string; propertyKey: string; propertyValue: string }
  | { kind: 'create_block'; page: string; parent: null; position: number; content: string }
  | { kind: 'set_property'; block: string; propertyKey: string; propertyValue: string };

type CreatePageChange = Extract<Change, { kind: 'create_page' }>;

export interface Seeded {
  /** Los cambios en el orden en que hay que mandarlos. */
  changes: Change[];
  title: string;
}

/**
 * Completa cada par consecutivo con la relación dirigida que el corpus ya tiene.
 *
 * El gesto recuerda qué se pulsó; no gobierna qué relaciones existen. Por eso
 * una llegada por búsqueda o por un enlace corriente cita igualmente A → B si
 * el corpus ya la explicó. Una conectiva efectivamente recorrida conserva la
 * revisión que se leyó y tiene prioridad sobre la consulta posterior.
 */
export function fillTraceCrossings(
  trace: readonly TraceStep[],
  relation: (from: string, to: string) => NonNullable<TraceStep['crossing']> | null,
): TraceStep[] {
  return trace.map((step, at) => {
    if (at === 0 || step.crossing != null) return step;
    const from = trace[at - 1]?.page;
    if (from === undefined) return step;
    const held = relation(from, step.page);
    return held === null ? step : { ...step, crossing: held };
  });
}

/**
 * Los cambios que hacen nacer una preparación a partir de un tramo del rastro.
 *
 * Devuelve la lista y no la manda: quién la manda sabe de páginas nuevas y de
 * errores, y esta función sabe de recorridos. Se prueba entera sin servidor.
 *
 * `page` es el identificador que tendrá la página, que quien manda conoce sólo
 * después de crearla; por eso los bloques se piden aparte, con `blocksFor`.
 */
export function seedArgumentPreparation(
  trace: readonly TraceStep[],
  said: { title: string; intent?: string | null },
): { page: CreatePageChange; properties: (page: string) => Change[] } {
  return {
    page: { kind: 'create_page', title: said.title, visibility: 'private' },
    properties: (page) => {
      const changes: Change[] = [
        {
          kind: 'set_property',
          page,
          propertyKey: 'tipo',
          propertyValue: ARGUMENT_PREPARATION_KIND,
        },
      ];
      if (said.intent != null && said.intent !== '') {
        changes.push({
          kind: 'set_property',
          page,
          propertyKey: 'propósito',
          propertyValue: said.intent,
        });
      }
      return changes;
    },
  };
}

/**
 * Los bloques con que nace: una parada, un hueco, una parada.
 *
 * El hueco es un bloque vacío con el testimonio colgando, y está vacío a
 * propósito: es el sitio donde va la conectiva, y se ve que está vacío porque lo
 * está. No hay contador ni aviso —un recorrido puede querer dos paradas seguidas
 * sin nada entre ellas y eso también es decir algo—; lo que hay es el hueco.
 */
export function blocksFor(
  trace: readonly TraceStep[],
  titleOf: (page: string) => string,
): { content: string; testimony: string | null; crossing: TraceStep['crossing'] }[] {
  const said: { content: string; testimony: string | null; crossing: TraceStep['crossing'] }[] = [];
  trace.forEach((step, at) => {
    if (at > 0) said.push({
      content: step.crossing?.content ?? '',
      testimony: testimonyFor(step, titleOf),
      crossing: step.crossing ?? null,
    });
    said.push({ content: `[[${titleOf(step.page)}]]`, testimony: null, crossing: null });
  });
  return said;
}

export { TESTIMONY_KEY };
