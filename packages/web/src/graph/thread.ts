import type { Trail } from '@vera/core';
import type { ThreadSettings } from './render.ts';

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
