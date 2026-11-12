// Lectura del contenido de un bloque. Todo lo derivado del texto vive aquí, en
// un solo lugar, para que los índices no puedan discrepar del contenido.

/** `[[Página]]` — referencias a páginas. */
const LINK = /\[\[([^\]]+)\]\]/g;

/** Separa el destino de las palabras visibles de `[[Página|estas palabras]]`. */
export function wikiReference(inner: string): { title: string; label: string } | null {
  const divider = inner.indexOf('|');
  const title = (divider < 0 ? inner : inner.slice(0, divider)).trim();
  if (title === '') return null;
  const writtenLabel = divider < 0 ? title : inner.slice(divider + 1).trim();
  return { title, label: writtenLabel === '' ? title : writtenLabel };
}

/** `#tag` — etiquetas libres. */
const TAG = /(?:^|\s)#([\p{L}\p{N}_-]+)/gu;

/** `{{query ...}}` — macros de Logseq que el corpus trae y Vera no traduce. */
const QUERY_MACRO = /\{\{query\b/;

/**
 * Títulos referenciados por un bloque, sin repetir y en orden de aparición.
 * Una misma página nombrada dos veces produce un solo enlace.
 */
export function referencedTitles(content: string): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const match of content.matchAll(LINK)) {
    const reference = wikiReference(match[1] ?? '');
    if (reference === null) continue;
    const { title } = reference;
    if (seen.has(title)) continue;
    seen.add(title);
    titles.push(title);
  }
  return titles;
}

/**
 * Reescribe los `[[enlaces]]` que nombran un título para que nombren otro.
 *
 * Sólo toca lo que está entre corchetes dobles: el mismo nombre escrito en la
 * prosa se queda como está. Una frase que dice «como cuenta la página Vera» no
 * es un enlace, y cambiarla sería reescribir lo que alguien dijo en vez de a
 * dónde apunta.
 *
 * Compara sin distinguir mayúsculas ni espacios de sobra, que es como el grafo
 * identifica un título en todas partes: un enlace escrito `[[vera]]` apunta a la
 * página «Vera» y tiene que seguir a su lado cuando ésta cambie de nombre.
 *
 * Conserva lo que el enlace llevara pegado dentro —un alias, un espacio— sólo en
 * la medida en que el título es todo el contenido del corchete; si el corchete
 * dice otra cosa, no es este enlace y no se toca.
 */
export function retitleLinks(content: string, from: string, to: string): string {
  const wanted = from.trim().toLowerCase();
  return content.replace(LINK, (whole, inner: string) => {
    const reference = wikiReference(inner);
    if (reference === null || reference.title.toLowerCase() !== wanted) return whole;
    const divider = inner.indexOf('|');
    return divider < 0 ? `[[${to}]]` : `[[${to}|${inner.slice(divider + 1)}]]`;
  });
}

/** Etiquetas de un bloque, sin repetir. */
export function referencedTags(content: string): string[] {
  const seen = new Set<string>();
  for (const match of content.matchAll(TAG)) {
    const tag = match[1];
    if (tag) seen.add(tag);
  }
  return [...seen];
}

/**
 * El texto literal de la macro de consulta, si el bloque trae una.
 * Cuenta llaves para no cortar en un `}}` interno.
 */
export function queryMacroText(content: string): string | null {
  if (!QUERY_MACRO.test(content)) return null;
  const start = content.search(QUERY_MACRO);
  if (start < 0) return null;

  let depth = 0;
  for (let i = start; i < content.length - 1; i += 1) {
    if (content[i] === '{' && content[i + 1] === '{') {
      depth += 1;
      i += 1;
    } else if (content[i] === '}' && content[i + 1] === '}') {
      depth -= 1;
      i += 1;
      if (depth === 0) return content.slice(start, i + 1);
    }
  }
  return content.slice(start);
}

/**
 * Clave de comparación de títulos: sin mayúsculas, sin diacríticos y con los
 * espacios normalizados, igual que el `remove_diacritics 2` del esquema SQL.
 */
export function titleKey(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Si un título es una fecha, y por tanto la página es un día de la bitácora.
 *
 * Un día no es otra clase de página: es una página cuyo título es una fecha —ver
 * `entity DailyLog` en daily-log.allium—, así que reconocerlo es leer el título y
 * no consultar una tabla aparte. Una sola grafía, la del calendario, que es la
 * que ordena los días al ordenar sus títulos.
 */
/**
 * El día de un instante, dicho como se titula una bitácora.
 *
 * En hora local y no en UTC, por la misma razón por la que un día se titula con
 * la fecha de quien escribe: si son las once de la noche del lunes para quien
 * mira, es lunes.
 */
export function calendarDay(at: number): string {
  const when = new Date(at);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
}

export function isDateTitle(title: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(title.trim());
}

/** Coincidencia de texto libre, con el mismo plegado que titleKey. */
export function matches(haystack: string, needle: string): boolean {
  if (needle === '') return false;
  return titleKey(haystack).includes(titleKey(needle));
}

/**
 * Palabras funcionales que no distinguen evidencia en una consulta libre.
 * La lista es corta y versionada: quitar una palabra del ranking no debe
 * depender de un modelo ni de la configuración regional del proceso.
 */
const SEARCH_STOP_WORDS = new Set([
  'a', 'al', 'como', 'con', 'cual', 'de', 'del', 'el', 'en', 'es', 'esta', 'este',
  'la', 'las', 'lo', 'los', 'on', 'para', 'por', 'que', 'qué', 'se', 'the', 'un',
  'una', 'usa', 'use', 'uses', 'y',
].map(titleKey));

/** Tokens deterministas para ranking; conserva números y términos de código. */
export function searchTokens(text: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of titleKey(text).match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? []) {
    if (token.length < 2 || SEARCH_STOP_WORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

/**
 * Raíz conservadora para variantes frecuentes en castellano e inglés técnico.
 * No pretende analizar la lengua: sólo acerca flexiones cuyo prefijo largo ya
 * aporta evidencia, como `reconstruible` y `reconstruirse`.
 */
export function searchStem(token: string): string {
  let stem = titleKey(token);
  for (const suffix of [
    'amientos', 'imientos', 'aciones', 'uciones', 'amiento', 'imiento', 'acion',
    'ucion', 'idades', 'mente', 'idad', 'ables', 'ibles', 'able', 'ible',
    'ando', 'iendo', 'ados', 'idos', 'adas', 'idas', 'arse', 'erse', 'irse',
  ]) {
    if (stem.length - suffix.length >= 4 && stem.endsWith(suffix)) {
      stem = stem.slice(0, -suffix.length);
      break;
    }
  }
  if (stem.length > 5 && stem.endsWith('es')) stem = stem.slice(0, -1);
  else if (stem.length > 4 && stem.endsWith('s')) stem = stem.slice(0, -1);
  for (const suffix of ['ar', 'er', 'ir']) {
    if (stem.length - suffix.length >= 4 && stem.endsWith(suffix)) {
      stem = stem.slice(0, -suffix.length);
      break;
    }
  }
  return stem;
}

export type SearchTokenMatch = 'exact_token' | 'prefix' | 'morphology' | 'substring';

/** La señal léxica más fuerte que une dos tokens, o nulo si no se sostienen. */
export function searchTokenMatch(asked: string, candidate: string): SearchTokenMatch | null {
  if (asked === candidate) return 'exact_token';
  const comparable = Math.min(asked.length, candidate.length) / Math.max(asked.length, candidate.length) >= 0.6;
  if (comparable && Math.min(asked.length, candidate.length) >= 4 &&
      (asked.startsWith(candidate) || candidate.startsWith(asked))) return 'prefix';
  if (Math.min(asked.length, candidate.length) >= 4 && searchStem(asked) === searchStem(candidate)) {
    return 'morphology';
  }
  if (comparable && Math.min(asked.length, candidate.length) >= 4 &&
      (asked.includes(candidate) || candidate.includes(asked))) return 'substring';
  return null;
}

/** Fragmento alrededor de la coincidencia, para justificar un acierto. */
export function excerpt(source: string, needle: string, width = 80): string {
  const at = titleKey(source).indexOf(titleKey(needle));
  if (at < 0) return source.slice(0, width);
  const from = Math.max(0, at - Math.floor(width / 3));
  const slice = source.slice(from, from + width);
  return (from > 0 ? '…' : '') + slice + (from + width < source.length ? '…' : '');
}


/**
 * Los títulos que encajan con lo que se lleva escrito, ordenados por cómo encajan.
 *
 * Autocompletar no es buscar. Buscar mira dentro del corpus y tarda lo que tarde;
 * esto contesta con lo que ya está en memoria mientras se teclea, y por eso puede
 * ir delante de cada pulsación. Lo que ofrece son páginas, que es lo que uno
 * suele querer cuando escribe tres letras en un buscador: ir a algo que ya sabe
 * que existe.
 *
 * Tres grados de encaje, y en ese orden: el título empieza por lo escrito, una de
 * sus palabras empieza por lo escrito, o lo escrito aparece en cualquier parte.
 * Un empate lo decide el orden en que vengan —quien llama los trae ordenados por
 * conectividad, que es una medida de qué tan central es una página en el corpus—
 * y por eso el orden de entrada se conserva.
 */
export function suggestTitles<T extends { title: string }>(
  query: string,
  pages: readonly T[],
  most = 6,
): T[] {
  const needle = titleKey(query);
  if (needle === '') return [];

  const graded: { page: T; grade: number; at: number }[] = [];
  pages.forEach((page, at) => {
    const key = titleKey(page.title);
    if (key === needle) graded.push({ page, grade: 0, at });
    else if (key.startsWith(needle)) graded.push({ page, grade: 1, at });
    else if (key.split(/[\s—–:·,()/]+/).some((word) => word.startsWith(needle))) {
      graded.push({ page, grade: 2, at });
    } else if (key.includes(needle)) graded.push({ page, grade: 3, at });
  });

  return graded
    .sort((a, b) => a.grade - b.grade || a.at - b.at)
    .slice(0, most)
    .map((one) => one.page);
}
