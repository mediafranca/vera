import type { PageView } from './api.ts';

export const DEFAULT_PRESENTATION_STYLESHEET = 'VERA: Presentaciones.css';

const normal = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

/** La página enlazada por `tema`, si la presentación escogió una propia. */
export function presentationThemeTitle(
  properties: readonly { key: string; value: string }[],
): string | null {
  const value = properties.find((property) => normal(property.key) === 'tema')?.value.trim();
  if (value === undefined || value === '') return null;
  const linked = /^\[\[([^\]]+)\]\]$/.exec(value);
  return (linked?.[1] ?? value).trim() || null;
}

/**
 * Una hoja CSS es una página ordinaria. El primer bloque cercado como CSS es
 * su fuente; si no hay cerca, todos los bloques raíz forman la hoja. Así la
 * página puede explicar el tema en descendientes sin convertir esa prosa en CSS.
 */
export function stylesheetSource(page: PageView): string {
  const ordered = [...page.blocks].sort((a, b) => a.position - b.position);
  for (const block of ordered) {
    const fenced = /^\s*```css\s*\n([\s\S]*?)\n```\s*$/i.exec(block.content);
    if (fenced !== null) return fenced[1]?.trim() ?? '';
  }
  return ordered.filter((block) => block.parent === null).map((block) => block.content).join('\n').trim();
}

export interface StylesheetValidation {
  valid: boolean;
  reason: string | null;
}

/** Lo que una hoja gobernada nunca puede traer desde fuera ni sacar del recinto. */
export function validateStylesheetSource(source: string): StylesheetValidation {
  if (new TextEncoder().encode(source).byteLength > 64 * 1024) {
    return { valid: false, reason: 'la hoja supera 64 KB' };
  }
  const forbidden: [RegExp, string][] = [
    [/@import\b/i, '`@import` no está permitido'],
    [/@namespace\b/i, '`@namespace` no está permitido'],
    [/url\s*\(/i, '`url(…)` no está permitido'],
    [/expression\s*\(/i, '`expression(…)` no está permitido'],
    [/-moz-binding\s*:/i, '`-moz-binding` no está permitido'],
    [/(?:https?:|data:|blob:|\/\/)/i, 'las direcciones externas no están permitidas'],
  ];
  for (const [pattern, reason] of forbidden) {
    if (pattern.test(source)) return { valid: false, reason };
  }
  const allowedAtRules = new Set(['media', 'supports', 'container', 'layer']);
  for (const match of source.matchAll(/@([a-z-]+)/gi)) {
    const name = match[1]?.toLowerCase() ?? '';
    if (!allowedAtRules.has(name)) return { valid: false, reason: `\`@${name}\` no está permitido` };
  }
  return { valid: true, reason: null };
}

/** El navegador confina incluso selectores universales al escenario del visor. */
export function scopedPresentationStylesheet(source: string): string {
  return `@scope (.vera-presentation .presentation-stage) {\n${source}\n}`;
}
