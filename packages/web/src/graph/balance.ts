import type { GraphLens } from './types.ts';

export interface GraphBalance {
  value: number;
  links: number;
  concepts: number;
  lens: GraphLens;
}

/**
 * Traduce el deslizador en multiplicadores visibles de la física.
 *
 * El centro conserva ambas fuerzas; los extremos apagan una y llevan la otra
 * hasta 4× para que la diferencia pueda calibrarse sobre el corpus real.
 */
export function graphBalance(value: number): GraphBalance {
  const held = Number.isFinite(value) ? value : 50;
  const normalized = Math.min(100, Math.max(0, held));
  const proportion = normalized / 100;
  return {
    value: normalized,
    links: 4 * (1 - proportion),
    concepts: 4 * proportion,
    lens: normalized === 0 ? 'links' : normalized === 100 ? 'concepts' : 'hybrid',
  };
}

export function graphBalanceLabel(value: number): string {
  const balance = graphBalance(value);
  return `Enlaces ${balance.links.toFixed(1)}× · Conceptos ${balance.concepts.toFixed(1)}×`;
}
