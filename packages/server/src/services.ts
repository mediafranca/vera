// Los servicios de fuera, gobernados desde el corpus.
//
// Una conexión con algo de fuera —Zotero, hoy— no vive en un archivo de
// configuración: vive en una página especial, con `special-kind:: service`, que
// se lee y se edita como cualquier otra. Ahí está qué servicio es, con qué
// biblioteca habla y qué se trae de ella; y ahí se ve, porque una conexión que
// nadie puede mirar es una conexión que nadie puede revisar.
//
//     Zotero
//       special-kind:: service
//       servicio:: zotero
//       biblioteca:: users/123456
//       colecciones:: Tesis, Diseño
//
// Lo único que no está en la página es el secreto, y no por importante sino por
// ser de otra clase: un valor que hay que presentar, no algo que se sepa. Ver
// packages/store/src/secrets.ts, que explica por qué un log append-only es mal
// sitio para una clave.
//
// Lo que Vera sabe de la conexión —si hay clave, cuándo se usó, cuántas páginas
// vinieron de ahí— no se escribe en la página: se deriva. Es la misma decisión
// que con la fecha de creación de una página, y por la misma razón: dos sitios
// diciendo lo mismo acaban diciendo cosas distintas.
//
// Ver specs/service-connections.allium.

import type { VeraGraph } from '@vera/core';

import type { ZoteroItem } from './zotero.ts';

/** El valor de `special-kind` que hace de una página una conexión. */
export const SERVICE_KIND = 'service';

/** La clave con que una página de servicio dice de qué servicio habla. */
export const SERVICE_KEY = 'servicio';

export interface ServicePage {
  id: string;
  title: string;
  /** `zotero`, y mañana otro. En minúsculas, que es como se compara. */
  service: string;
  /** `users/123456` o `groups/98765`. Puede faltar: se resuelve preguntando. */
  library: string | null;
  /** Lo que la página dice traer. Hoy se anota y no filtra. */
  collections: string[];
  /** La autoridad saliente que el dueño concede a Vera, además de la de la clave. */
  access: 'read' | 'read-write';
}

const valueOf = (
  properties: readonly { key: string; value: string }[],
  key: string,
): string | null => {
  const found = properties.find((one) => one.key.trim().toLowerCase() === key);
  return found === undefined || found.value.trim() === '' ? null : found.value.trim();
};

/** Las páginas que gobiernan una conexión, leídas del grafo. */
export function servicePages(graph: VeraGraph, specialKey: string): ServicePage[] {
  return graph
    .pages()
    .map((page) => {
      const properties = graph.propertiesOf(page.id);
      const special = valueOf(properties, specialKey);
      if (special === null || special.toLowerCase() !== SERVICE_KIND) return null;
      const service = valueOf(properties, SERVICE_KEY);
      if (service === null) return null;
      return {
        id: page.id,
        title: page.title,
        service: service.toLowerCase(),
        library: valueOf(properties, 'biblioteca'),
        collections: (valueOf(properties, 'colecciones') ?? '')
          .split(',')
          .map((one) => one.trim())
          .filter((one) => one !== ''),
        access: ['escritura', 'lectura y escritura', 'read-write', 'write'].includes(
          (valueOf(properties, 'acceso') ?? '').toLowerCase(),
        ) ? 'read-write' : 'read',
      };
    })
    .filter((one): one is ServicePage => one !== null);
}

/*
 * Cómo se llama en el corpus lo que Zotero trae.
 *
 * @invariant DefaultsLiveInTheCode: esto es lo que hay mientras la ontología no
 * diga otra cosa. Están en castellano por la misma razón que el resto del
 * vocabulario que Vera trae: lo que Vera escribe en una página lo va a leer una
 * persona.
 *
 * `source` y `key` no son bibliografía sino procedencia: dicen de dónde vino
 * esta página y cómo encontrar el ítem del que vino, y son lo que permite
 * traerlo otra vez sin duplicarlo.
 */
export const BIBLIOGRAPHY_NAMES = {
  source: 'fuente',
  key: 'zotero',
  version: 'zotero-versión',
  library: 'zotero-biblioteca',
  itemType: 'clase',
  creators: 'autor',
  date: 'fecha',
  publication: 'publicación',
  publisher: 'editorial',
  doi: 'doi',
  isbn: 'isbn',
  url: 'url',
  presence: 'presencia',
} as const;

/** Lo que una página bibliográfica lleva escrito, ya en pares clave/valor. */
export function propertiesFor(
  item: ZoteroItem,
  library: string,
  kindKey: string,
  kindValue: string,
): { key: string; value: string }[] {
  const n = BIBLIOGRAPHY_NAMES;
  const pairs: [string, string | null][] = [
    [kindKey, kindValue],
    [n.source, 'zotero'],
    [n.key, item.key],
    [n.version, String(item.version)],
    [n.library, library],
    [n.itemType, item.itemType],
    // Varios autores van separados por coma, que es como Vera lee una propiedad
    // con varias respuestas: cada una se vuelve un enlace a su página.
    [n.creators, item.creators.length === 0 ? null : item.creators.join(', ')],
    [n.date, item.date],
    [n.publication, item.publication],
    [n.publisher, item.publisher],
    [n.doi, item.doi],
    [n.isbn, item.isbn],
    [n.url, item.url],
    [n.presence, 'en Zotero'],
  ];
  return pairs
    .filter((pair): pair is [string, string] => pair[1] !== null && pair[1] !== '')
    .map(([key, value]) => ({ key, value }));
}

/**
 * El título que va a llevar la página del ítem.
 *
 * El del ítem, y si ese nombre ya está tomado por otra cosa, con su autor y su
 * año detrás. No se numera —«Título (2)» no le dice nada a nadie dentro de un
 * año— y no se pisa la página que ya existía, que podría ser una nota de alguien
 * sobre ese mismo libro.
 */
export function titleFor(item: ZoteroItem, taken: (title: string) => boolean): string {
  if (!taken(item.title)) return item.title;
  const who = item.creators[0]?.split(',')[0]?.trim() ?? '';
  const when = (item.date ?? '').match(/\d{4}/)?.[0] ?? '';
  const said = [who, when].filter((one) => one !== '').join(', ');
  const better = said === '' ? `${item.title} (Zotero)` : `${item.title} (${said})`;
  return taken(better) ? `${better} · ${item.key}` : better;
}

/**
 * Los bloques con que nace una página bibliográfica.
 *
 * El resumen y las notas, y nada inventado: lo que no venga de Zotero no se
 * escribe. Una página que llega con apartados vacíos —«Ideas», «Citas»— le pide
 * a quien la abre que rellene un formulario, y lo que hace falta es que pueda
 * escribir lo que tenga que decir donde quiera decirlo.
 */
export function blocksFor(item: ZoteroItem, notes: readonly string[] = []): string[] {
  const blocks: string[] = [];
  if (item.abstract !== null) blocks.push(item.abstract);
  for (const note of notes) {
    // Las notas de Zotero vienen en HTML. Se le quitan las etiquetas: Vera
    // presenta el marcado como texto, así que dejarlas sería enseñar los
    // corchetes angulares en vez de lo que alguien escribió.
    const clean = note
      .replace(/<\/(p|div|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (clean !== '') blocks.push(clean);
  }
  return blocks;
}
