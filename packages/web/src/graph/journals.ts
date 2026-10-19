import { isDateTitle } from '@vera/core';
import type { GraphData, GraphNode } from './types.ts';

function endpoint(value: string | GraphNode): string {
  return typeof value === 'string' ? value : value.id;
}

/**
 * La ley del interruptor de diarios.
 *
 * Encendido significa lo que dice: los días que pertenecen a la vecindad
 * vuelven a ella. Apagado los retira, salvo el día que ya es el foco; quitar el
 * centro dejaría un mapa que ya no responde a la página seleccionada.
 */
export function journalsInMap(data: GraphData, focus: string, enabled: boolean): GraphData {
  if (enabled) return data;

  const focused = data.nodes.find((node) => node.id === focus);
  const focusIsJournal = focused !== undefined && isDateTitle(focused.name);

  const nodes = data.nodes.filter((node) =>
    !isDateTitle(node.name) || (focusIsJournal && node.id === focus),
  );
  const kept = new Set(nodes.map((node) => node.id));
  const links = data.links.filter((link) =>
    kept.has(endpoint(link.source)) && kept.has(endpoint(link.target)),
  );
  return { nodes, links };
}
