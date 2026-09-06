import { isDateTitle } from '@vera/core';
import type { GraphData, GraphNode } from './types.ts';

function endpoint(value: string | GraphNode): string {
  return typeof value === 'string' ? value : value.id;
}

/**
 * La ley del interruptor de diarios.
 *
 * Un diario nunca es vecindad: aparece únicamente cuando él mismo es el foco.
 * El foco tiene precedencia sobre el interruptor, para que apagar los diarios
 * jamás quite el centro que da sentido a su vecindario.
 */
export function journalsInMap(data: GraphData, focus: string, _enabled: boolean): GraphData {
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
