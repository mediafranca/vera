/** Geometría de la puerta que sigue al título de una página en el mapa. */
export interface InlineOpenGlyph {
  x: number;
  y: number;
  size: number;
  frameX: number;
  frameY: number;
  hitX: number;
  hitY: number;
  hitWidth: number;
  hitHeight: number;
}

/**
 * Coloca el icono como un carácter de 1em inmediatamente después del título.
 *
 * `endX` es el final medido de la última línea y `baseline` su línea de base.
 * La corrección vertical equivale al `vertical-align: -0.125em` habitual de un
 * SVG inline. El blanco táctil incluye también el pequeño avance entre texto e
 * icono, por lo que no aparece una zona muerta al mover el puntero.
 */
export function inlineOpenGlyph(
  fontSize: number,
  endX: number,
  baseline: number,
  minimumHit = 16,
): InlineOpenGlyph {
  const size = fontSize;
  const advance = fontSize * 0.08;
  const x = endX + advance;
  const y = baseline - fontSize * 0.875;
  const hitWidth = Math.max(size + advance, minimumHit);
  const hitHeight = Math.max(size, minimumHit);
  const centreX = endX + (size + advance) / 2;
  const centreY = y + size / 2;
  return {
    x,
    y,
    size,
    frameX: x,
    frameY: y,
    hitX: centreX - hitWidth / 2,
    hitY: centreY - hitHeight / 2,
    hitWidth,
    hitHeight,
  };
}
