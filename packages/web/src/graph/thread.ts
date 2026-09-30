import type { Trail } from '@vera/core';
import type { GraphData, GraphLink } from './types.ts';
import type { ThreadSettings } from './render.ts';

const endpoint = (value: GraphLink['source']): string =>
  typeof value === 'string' ? value : value.id;

/**
 * La lectura canónica del argumento llevada a la forma que consumen los tres
 * mapas. Mantener esta traducción en un solo sitio evita que la primera entrega
 * y su enriquecimiento decidan de forma distinta si hay hilo.
 */
export function threadSettings(page: string, trail: Trail | null): ThreadSettings | null {
  if (trail === null || trail.route.length < 2) return null;
  return {
    page,
    stops: trail.route.map((one) => ({ page: one.page, ordinal: one.ordinal })),
    kinds: trail.crossings.map((one) => one.kind),
  };
}

/**
 * Un recorrido abierto no es el vecindario de su página.
 *
 * Su mapa es una proyección temporal compuesta únicamente por las paradas, en
 * el orden del argumento. Los enlaces entre ellas se conservan para distinguir
 * por dónde el corpus ya tenía camino; la página del recorrido y todos los
 * vecinos laterales quedan fuera del dibujo, sin alterar el grafo canónico.
 */
export function graphOfThread(data: GraphData, thread: ThreadSettings | null): GraphData {
  if (thread === null) return data;
  const wanted = new Set(
    thread.stops.flatMap((stop) => stop.page === null ? [] : [stop.page]),
  );
  return {
    nodes: data.nodes.filter((node) => wanted.has(node.id)),
    links: data.links.filter((link) =>
      wanted.has(endpoint(link.source)) && wanted.has(endpoint(link.target)),
    ),
  };
}
