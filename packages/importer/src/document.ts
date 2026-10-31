// Lector de documentos terminados: Markdown y docx.
//
// Traducido desde specs/document-import.allium. Este archivo sólo lee: entra un
// archivo y salen trozos con su profundidad. No conoce Vera, no emite
// operaciones y no toca el disco.
//
// @invariant DepthComesFromDeclaredMarks: la profundidad sale de una marca que
// el documento trae escrita —nivel de encabezado, nivel de lista— y de ninguna
// otra cosa. No se mira el largo de los párrafos ni la tipografía.

import { inflateRawSync } from 'node:zlib';
import { PDFParse } from 'pdf-parse';

export type DocumentFormat = 'markdown' | 'docx' | 'pdf' | 'rtf';

export interface DocumentPiece {
  /** Cero es raíz de la página. Un hijo declara uno más que su padre. */
  depth: number;
  content: string;
}

export interface ParsedDocument {
  format: DocumentFormat;
  /** El título que el documento declara, si declara alguno. */
  title: string | null;
  pieces: DocumentPiece[];
  /** Lo que se leyó y no se supo representar, dicho en palabras. */
  losses: string[];
}

/** Convierte prosa plana en párrafos sin inventar jerarquía. */
function parsePlainTextDocument(
  source: string,
  format: 'pdf' | 'rtf',
  title: string | null = null,
  losses: string[] = [],
): ParsedDocument {
  const pieces = source
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n+/)
    .map((content) => content.replace(/[ \t]+\n/g, '\n').trim())
    .filter((content) => content !== '')
    .map((content) => ({ depth: 0, content }));
  return { format, title, pieces, losses };
}

/**
 * La pila de encabezados, que es lo que convierte niveles en profundidades.
 *
 * Un documento que salta de `#` a `###` no tiene un nivel intermedio invisible:
 * tiene un hijo. Contar la profundidad como `nivel - 1` inventaría un escalón
 * vacío y dejaría el árbol torcido a partir de ahí. Lo que decide es cuántos
 * encabezados abiertos hay por encima, no qué número lleva éste.
 */
class Headings {
  #open: number[] = [];

  /** Abre un encabezado de este nivel y devuelve su profundidad. */
  enter(level: number): number {
    while (this.#open.length > 0 && (this.#open.at(-1) ?? 0) >= level) this.#open.pop();
    const depth = this.#open.length;
    this.#open.push(level);
    return depth;
  }

  /** Dónde cuelga el texto que viene bajo el encabezado abierto. */
  get under(): number {
    return this.#open.length;
  }
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;

/** Cuántos niveles de lista declara esta sangría. Dos espacios o un tabulador. */
function listLevel(indent: string): number {
  const tabs = (indent.match(/\t/g) ?? []).length;
  const spaces = (indent.match(/ /g) ?? []).length;
  return tabs + Math.floor(spaces / 2);
}

/**
 * Lee un documento Markdown corriente: encabezados, párrafos, listas, tablas y
 * bloques de código.
 *
 * No es el lector de Logseq. Aquél lee un esquema de viñetas donde la sangría es
 * la estructura entera; éste lee prosa, donde la estructura la llevan los
 * encabezados y las viñetas son sólo una de las cosas que cuelgan de ellos.
 */
export function parseMarkdownDocument(source: string): ParsedDocument {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const pieces: DocumentPiece[] = [];
  const headings = new Headings();
  let title: string | null = null;

  // El primer encabezado de primer nivel es el título de la página, no un bloque:
  // repetirlo dentro sería tener el mismo texto dos veces en pantalla.
  let seenAnything = false;

  let paragraph: string[] = [];
  const flush = (): void => {
    const text = paragraph.join('\n').trim();
    paragraph = [];
    if (text !== '') pieces.push({ depth: headings.under, content: text });
  };

  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at] ?? '';

    // Un cercado se toma entero, con sus líneas en blanco dentro. Partirlo por
    // párrafos rompería el código en trozos que ya no compilan.
    const fence = FENCE.exec(line);
    if (fence !== null) {
      flush();
      const mark = fence[1] ?? '```';
      const held = [line];
      at += 1;
      while (at < lines.length) {
        const next = lines[at] ?? '';
        held.push(next);
        at += 1;
        if (next.trimStart().startsWith(mark)) break;
      }
      pieces.push({ depth: headings.under, content: held.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      flush();
      const level = (heading[1] ?? '#').length;
      const text = (heading[2] ?? '').trim();
      if (!seenAnything && level === 1 && title === null && text !== '') {
        title = text;
        seenAnything = true;
        continue;
      }
      seenAnything = true;
      pieces.push({ depth: headings.enter(level), content: `${'#'.repeat(level)} ${text}` });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet !== null) {
      flush();
      seenAnything = true;
      pieces.push({
        depth: headings.under + listLevel(bullet[1] ?? ''),
        content: (bullet[2] ?? '').trim(),
      });
      continue;
    }

    if (line.trim() === '') {
      flush();
      continue;
    }

    seenAnything = true;
    paragraph.push(line);
  }
  flush();

  return { format: 'markdown', title, pieces, losses: [] };
}

// ---------------------------------------------------------------------------
// docx
// ---------------------------------------------------------------------------

/*
 * Un docx es un zip con XML dentro, y aquí se abre a mano.
 *
 * Vera no tiene dependencias en tiempo de ejecución y ésta no va a ser la
 * primera: leer un zip son cien líneas y traer una biblioteca para eso es
 * cambiar cien líneas propias por un árbol de dependencias ajeno en un programa
 * que guarda la memoria de alguien.
 *
 * Se lee por el directorio central y no recorriendo las cabeceras locales,
 * porque una cabecera local puede declarar tamaño cero y dejar el dato real en
 * un descriptor que va después: recorrerlas en orden funciona hasta que Word
 * decide escribir el archivo de la otra forma.
 */
const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;

function zipEntry(bytes: Buffer, wanted: string): Buffer | null {
  // El final del directorio va al final del archivo, detrás de un comentario de
  // longitud variable, así que se busca hacia atrás.
  let end = -1;
  for (let at = bytes.length - 22; at >= 0; at -= 1) {
    if (bytes.readUInt32LE(at) === END_OF_DIRECTORY) {
      end = at;
      break;
    }
  }
  if (end < 0) return null;

  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);

  for (let seen = 0; seen < count; seen += 1) {
    if (at + 46 > bytes.length || bytes.readUInt32LE(at) !== DIRECTORY_ENTRY) return null;
    const method = bytes.readUInt16LE(at + 10);
    const packed = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const localAt = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8');

    if (name === wanted) {
      // La cabecera local repite el nombre y los extras, y sus longitudes no
      // tienen por qué coincidir con las del directorio: hay que releerlas.
      const localName = bytes.readUInt16LE(localAt + 26);
      const localExtra = bytes.readUInt16LE(localAt + 28);
      const from = localAt + 30 + localName + localExtra;
      const raw = bytes.subarray(from, from + packed);
      if (method === 0) return Buffer.from(raw);
      if (method === 8) {
        try {
          return inflateRawSync(raw);
        } catch {
          return null;
        }
      }
      return null;
    }

    at += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

/** Las entidades que Word escribe. No hace falta un lector de XML para cinco. */
function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_whole, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

/*
 * El nivel de encabezado que declara un párrafo de Word.
 *
 * `w:pStyle` lleva el identificador del estilo, que en teoría es constante y en
 * la práctica lo escribe cada versión de Word en su idioma: `Heading1` en inglés,
 * `Ttulo1` o `Título1` en español, y a veces sólo el número. Se aceptan las tres
 * formas porque el documento que hay que leer es el que llega, no el que
 * debería llegar.
 */
function headingLevel(paragraph: string): number | null {
  const style = /<w:pStyle\s[^>]*w:val="([^"]+)"/.exec(paragraph);
  if (style === null) return null;
  const name = unescapeXml(style[1] ?? '');
  const named = /^(?:heading|t[íi]?tulo|berschrift|titre)\s*-?\s*(\d)$/i.exec(name.trim());
  if (named !== null) return Number(named[1]);
  const bare = /^(\d)$/.exec(name.trim());
  return bare === null ? null : Number(bare[1]);
}

/** El nivel de lista, cuando el párrafo declara numeración. */
function bulletLevel(paragraph: string): number | null {
  if (!paragraph.includes('<w:numPr')) return null;
  const level = /<w:ilvl\s[^>]*w:val="(\d+)"/.exec(paragraph);
  return level === null ? 0 : Number(level[1]);
}

/** El texto de un párrafo: todos sus fragmentos, en orden, y los saltos duros. */
function paragraphText(paragraph: string): string {
  let out = '';
  for (const piece of paragraph.matchAll(/<w:(t|br|tab)(\s[^>]*)?(\/>|>([\s\S]*?)<\/w:\1>)/g)) {
    const tag = piece[1];
    if (tag === 'br') out += '\n';
    else if (tag === 'tab') out += '\t';
    else out += unescapeXml(piece[4] ?? '');
  }
  return out.replace(/[ \t]+/g, ' ').trim();
}

/**
 * Lee un .docx.
 *
 * Devuelve `null` cuando el archivo no es un docx legible, para que quien llame
 * pueda negarse entero en vez de importar la mitad.
 */
export function parseDocx(bytes: Buffer): ParsedDocument | null {
  const xml = zipEntry(bytes, 'word/document.xml');
  if (xml === null) return null;
  const source = xml.toString('utf8');
  if (!source.includes('<w:body')) return null;

  const pieces: DocumentPiece[] = [];
  const headings = new Headings();
  const losses: string[] = [];
  let title: string | null = null;
  let seenAnything = false;

  // Las celdas de una tabla son párrafos como los demás y entran por aquí, así
  // que el texto no se pierde; lo que se pierde es la rejilla. Se cuenta.
  const tables = (source.match(/<w:tbl(\s|>)/g) ?? []).length;
  if (tables > 0) {
    losses.push(
      `${tables} ${tables === 1 ? 'tabla llegó' : 'tablas llegaron'} como párrafos sueltos: el texto está, la rejilla no`,
    );
  }
  const drawings = (source.match(/<w:drawing(\s|>)/g) ?? []).length;
  if (drawings > 0) {
    losses.push(`${drawings} ${drawings === 1 ? 'imagen' : 'imágenes'} sin traer`);
  }

  for (const found of source.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
    const paragraph = found[1] ?? '';
    const text = paragraphText(paragraph);
    if (text === '') continue;

    const level = headingLevel(paragraph);
    if (level !== null && level >= 1) {
      if (!seenAnything && level === 1 && title === null) {
        title = text;
        seenAnything = true;
        continue;
      }
      seenAnything = true;
      pieces.push({ depth: headings.enter(level), content: `${'#'.repeat(Math.min(6, level))} ${text}` });
      continue;
    }

    seenAnything = true;
    const bullet = bulletLevel(paragraph);
    pieces.push({ depth: headings.under + (bullet ?? 0), content: text });
  }

  return { format: 'docx', title, pieces, losses };
}

// ---------------------------------------------------------------------------
// PDF y RTF
// ---------------------------------------------------------------------------

/**
 * Extrae el texto visible de un RTF sin convertir sus decisiones tipográficas
 * en estructura inventada. Los destinos de metadatos, imágenes y objetos se
 * omiten; la pérdida se declara en el resultado.
 */
export function parseRtf(bytes: Buffer): ParsedDocument | null {
  const source = bytes.toString('latin1');
  if (!/^\s*\{\\rtf\d/.test(source)) return null;

  type State = { skip: boolean; starred: boolean; unicodeFallback: number };
  const stack: State[] = [];
  let state: State = { skip: false, starred: false, unicodeFallback: 1 };
  let text = '';
  let skippedPictures = 0;
  const ignored = new Set([
    'fonttbl', 'colortbl', 'stylesheet', 'info', 'header', 'headerl', 'headerr',
    'footer', 'footerl', 'footerr', 'object', 'filetbl', 'listtable', 'listoverridetable',
  ]);

  for (let at = 0; at < source.length; at += 1) {
    const character = source[at] ?? '';
    if (character === '{') {
      stack.push({ ...state });
      continue;
    }
    if (character === '}') {
      state = stack.pop() ?? state;
      continue;
    }
    if (character !== '\\') {
      if (!state.skip && character !== '\r' && character !== '\n') text += character;
      continue;
    }

    const next = source[at + 1] ?? '';
    if (next === '\\' || next === '{' || next === '}') {
      if (!state.skip) text += next;
      at += 1;
      continue;
    }
    if (next === '*') {
      state.starred = true;
      at += 1;
      continue;
    }
    if (next === "'") {
      const hex = source.slice(at + 2, at + 4);
      if (!state.skip && /^[0-9a-f]{2}$/i.test(hex)) text += Buffer.from([Number.parseInt(hex, 16)]).toString('latin1');
      at += 3;
      continue;
    }
    if (!/[a-z]/i.test(next)) {
      if (!state.skip && next === '~') text += '\u00a0';
      at += 1;
      continue;
    }

    const control = /^\\([a-z]+)(-?\d+)? ?/i.exec(source.slice(at));
    if (control === null) continue;
    const word = (control[1] ?? '').toLowerCase();
    const parameter = control[2] === undefined ? null : Number(control[2]);
    at += (control[0]?.length ?? 1) - 1;

    if (word === 'pict') { skippedPictures += 1; state.skip = true; continue; }
    if (ignored.has(word) || state.starred) { state.skip = true; continue; }
    if (state.skip) continue;
    if (word === 'par' || word === 'line') text += '\n\n';
    else if (word === 'tab') text += '\t';
    else if (word === 'uc' && parameter !== null) state.unicodeFallback = Math.max(0, parameter);
    else if (word === 'u' && parameter !== null) {
      const code = parameter < 0 ? parameter + 65_536 : parameter;
      text += String.fromCodePoint(code);
      at += state.unicodeFallback;
    } else if (word === 'bin' && parameter !== null) {
      at += Math.max(0, parameter);
    }
  }

  const losses = skippedPictures === 0
    ? []
    : [`${skippedPictures} ${skippedPictures === 1 ? 'imagen' : 'imágenes'} sin traer`];
  return parsePlainTextDocument(text, 'rtf', null, losses);
}

async function parsePdf(bytes: Buffer): Promise<ParsedDocument | null> {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    // pdf.js mantiene estado interno durante el análisis: pedir texto e
    // información en paralelo puede hacer que un documento válido parezca
    // ilegible. La lectura es secuencial y sigue ocurriendo una sola vez.
    const text = await parser.getText();
    const info = await parser.getInfo();
    const title = typeof info.info?.Title === 'string' && info.info.Title.trim() !== ''
      ? info.info.Title.trim()
      : null;
    return parsePlainTextDocument(text.text, 'pdf', title, [
      'el PDF conserva su archivo original; diagramas, imágenes y disposición de página no se convierten en bloques',
    ]);
  } catch {
    return null;
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

/**
 * Lee lo que llegue, decidiendo el formato por el nombre y el tipo declarado.
 *
 * @invariant AnEmptyDocumentIsNotAPage: un archivo sin texto no devuelve un
 * documento vacío que después haya que comprobar en otro sitio; devuelve el
 * motivo por el que no hay nada que traer.
 */
export async function parseDocument(
  bytes: Buffer,
  filename: string,
  mediaType: string,
): Promise<ParsedDocument | { error: string }> {
  const name = filename.toLowerCase();
  const looksDocx =
    name.endsWith('.docx') ||
    mediaType.includes('officedocument.wordprocessingml') ||
    // Un zip que empieza por PK y trae `word/`: Word no siempre declara su tipo.
    (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b);

  let parsed: ParsedDocument | null;
  if (looksDocx) {
    parsed = parseDocx(bytes);
    if (parsed === null) {
      return { error: 'no se pudo leer este .docx; ¿es un documento de Word?' };
    }
  } else if (name.endsWith('.pdf') || mediaType === 'application/pdf') {
    parsed = await parsePdf(bytes);
    if (parsed === null) return { error: 'no se pudo leer este PDF; puede estar cifrado o no contener texto extraíble' };
  } else if (name.endsWith('.rtf') || mediaType === 'application/rtf' || mediaType === 'text/rtf') {
    parsed = parseRtf(bytes);
    if (parsed === null) return { error: 'no se pudo leer este RTF' };
  } else if (name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt') || mediaType.startsWith('text/')) {
    parsed = parseMarkdownDocument(bytes.toString('utf8'));
  } else {
    return { error: `no sé leer «${filename}»; entran .md, .txt, .docx, .pdf y .rtf` };
  }

  if (parsed.pieces.length === 0 && parsed.title === null) {
    return { error: 'este archivo no tiene texto que traer' };
  }
  return parsed;
}
