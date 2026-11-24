import type { GraphData, GraphResource } from './types.ts';

/**
 * Los recursos externos siguen llegando en GraphData, pero no se dibujan.
 *
 * La primera órbita resultó decorativa y obstructiva: equidistancia, aristas y
 * satélites competían con las páginas sin explicar la relación. Se conserva el
 * código de proyección para rediseñarlo; esta puerta única evita que 2D y 3D
 * vuelvan a divergir mientras tanto.
 */
export const EXTERNAL_RESOURCES_VISIBLE = false;

export function externalResourcesForMap(data: GraphData): GraphResource[] {
  return EXTERNAL_RESOURCES_VISIBLE ? data.resources ?? [] : [];
}
