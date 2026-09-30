import type { EmbeddedMapCamera, EmbeddedMapConfig } from '@vera/core';

export const COPIED_MAP_HEIGHT = 400;

const tidy = (value: number): number => Number(value.toFixed(6));

/** La cámara escrita no arrastra el ruido decimal de cada gesto del puntero. */
export function portableMapCamera(camera: EmbeddedMapCamera): EmbeddedMapCamera {
  if (camera.kind === '3d') {
    return {
      kind: '3d',
      centre: {
        x: tidy(camera.centre.x),
        y: tidy(camera.centre.y),
        z: tidy(camera.centre.z),
      },
      distance: tidy(camera.distance),
      azimuth: tidy(camera.azimuth),
      elevation: tidy(camera.elevation),
    };
  }
  return { kind: camera.kind, x: tidy(camera.x), y: tidy(camera.y), k: tidy(camera.k) };
}

/** El bloque completo que se pega: declaración, no captura ni estado oculto. */
export function mapEmbeddingSource(
  page: string,
  view: EmbeddedMapConfig['view'],
  reach: EmbeddedMapConfig['reach'],
  rotate: boolean,
  camera: EmbeddedMapCamera,
): string {
  const safePage = page.replaceAll(']]', '］］');
  return [
    '```mapa',
    `página: [[${safePage}]]`,
    `vista: ${view.toUpperCase()}`,
    `alcance: ${reach}`,
    `rotación: ${view === '3d' && rotate ? 'sí' : 'no'}`,
    `cámara: ${JSON.stringify(portableMapCamera(camera))}`,
    `alto: ${COPIED_MAP_HEIGHT}`,
    '```',
  ].join('\n');
}
