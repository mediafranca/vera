// El enrutado de Vera.
//
// Hasta ahora la página abierta vivía sólo en memoria: no se podía enlazar, ni
// volver con el botón de atrás, ni recargar sin perder el sitio. Aquí se decide
// qué dice una dirección y cómo se escribe; quién la aplica es main.ts.
//
// La forma es `/p/<título>?focus=<bloque>#<bloque>`:
//
//   /p/Lectogram                      la página
//   /p/Lectogram?focus=block:31024    con la vista enraizada en un bloque
//   /p/Lectogram#block:31066          saltando a un bloque concreto
//   /p/page:31015                     también vale: la identidad estable
//
// El título va en la URL porque es lo que se lee y lo que se comparte. La
// identidad también resuelve, para que un enlace escrito antes de un renombrado
// no se rompa; el servidor prueba primero por identidad y después por título.

export interface Route {
  /** Título o identificador de la página. `null` en la raíz. */
  page: string | null;
  /** Bloque en el que está enraizada la vista. */
  focus: string | null;
  /** Bloque al que saltar dentro de la página. */
  block: string | null;
  /** Texto de una página de resultados; nulo en una ruta de página. */
  search: string | null;
}

export const EMPTY: Route = { page: null, focus: null, block: null, search: null };

export function parseRoute(url: URL): Route {
  // `/search` es la superficie JSON histórica del servidor. La página visual
  // necesita otro nombre: si comparte la ruta, una recarga entrega el JSON
  // crudo antes de que la aplicación pueda arrancar.
  if (/^(?:\/s\/[^/]+)?\/buscar\/?$/.test(url.pathname)) {
    const asked = url.searchParams.get('q')?.trim() ?? '';
    return { page: null, focus: null, block: null, search: asked === '' ? null : asked };
  }
  const match = /^(?:\/s\/[^/]+)?\/p\/(.+)$/.exec(url.pathname);
  if (match === null) return EMPTY;

  let page: string;
  try {
    page = decodeURIComponent(match[1] ?? '');
  } catch {
    // Una dirección mal escrita a mano no debe tumbar el arranque.
    page = match[1] ?? '';
  }

  const fragment = url.hash.startsWith('#') ? url.hash.slice(1) : '';
  return {
    page: page === '' ? null : page,
    focus: url.searchParams.get('focus'),
    block: fragment === '' ? null : decodeURIComponent(fragment),
    search: null,
  };
}

/** Dirección estable de una búsqueda, conservando el cerco público si existe. */
export function searchRoute(text: string, pathname = window.location.pathname): string {
  const space = /^(\/s\/[^/]+)(?:\/.*)?$/.exec(pathname)?.[1] ?? '';
  return `${space}/buscar?q=${encodeURIComponent(text.trim())}`;
}

/**
 * La dirección de una página.
 *
 * El título se codifica entero, incluidas las barras: un título como
 * «MediaFranca - Ruta práctica» tiene que caber en un solo segmento y no
 * inventar niveles de ruta que no existen.
 */
export function routeTo(
  page: { id: string; title: string },
  options: { focus?: string | null; block?: string | null; publicPath?: string | null } = {},
): string {
  if (options.publicPath != null && options.publicPath !== '') {
    let url = `/${options.publicPath.replace(/^\/+|\/+$/g, '')}/`;
    if (options.focus != null && options.focus !== '') {
      url += `?focus=${encodeURIComponent(options.focus)}`;
    }
    if (options.block != null && options.block !== '') {
      url += `#${encodeURIComponent(options.block)}`;
    }
    return url;
  }
  // Sin título utilizable se cae a la identidad, que siempre resuelve.
  const named = page.title.trim() === '' ? page.id : page.title;
  let url = `/p/${encodeURIComponent(named)}`;
  if (options.focus != null && options.focus !== '') {
    url += `?focus=${encodeURIComponent(options.focus)}`;
  }
  if (options.block != null && options.block !== '') {
    url += `#${encodeURIComponent(options.block)}`;
  }
  return url;
}

/** ¿Dos direcciones nombran lo mismo? Evita apilar la misma entrada dos veces. */
export function sameRoute(a: Route, b: Route): boolean {
  return a.page === b.page && a.focus === b.focus && a.block === b.block && a.search === b.search;
}
