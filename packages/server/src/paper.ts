// La página en papel: el documento sin el taller alrededor.
//
// Exportar a PDF era pedirle al navegador que imprimiera, y lo que salía
// dependía de quién lo pidiera: márgenes del sistema, encabezados con la fecha y
// la dirección, y el tamaño de papel de la impresora que hubiera configurada. Un
// PDF que se guarda no puede depender de eso.
//
// Así que se compone aquí y se descarga hecho. El HTML lo dibuja `renderMarkdown`
// —el mismo que dibuja la pantalla, por eso vive en el dominio y no en el
// cliente— y quien lo pasa a papel es un Chrome sin ventana, encontrado como se
// encuentra whisper o llama: un binario en el sistema, y donde no lo haya se dice
// que no lo hay. @invariant TheModelIsLocalOrThereIsNone dice esto mismo para el
// modelo; aquí vale igual, y por la misma razón: componer un PDF fuera de casa
// sería mandar la página entera a un servidor ajeno para que la lea.
//
// Lo que el papel deja fuera lo decidió Herbert: las propiedades de la cabecera,
// las referencias del pie, los fondos y la sangría del esquema. Un papel no se
// navega —no hay dónde pulsar una propiedad ni a dónde llevar un retroenlace—, y
// lo que queda cuando se quita todo eso es el texto seguido, que es lo que un
// documento es cuando deja de ser una herramienta.

import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { renderMarkdown, type RenderOptions } from '@vera/core';

import { findTool } from './transcribe.ts';

const run = promisify(execFile);

/** Los nombres con que un Chrome sin ventana se llama a sí mismo por ahí. */
const CHROMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome'];

export interface PaperBlock {
  stableId: string;
  parent: string | null;
  position: number;
  content: string;
}

export interface PaperOptions {
  title: string;
  blocks: readonly PaperBlock[];
  /** A qué resuelve cada `../assets/foo.png` que la página nombre. */
  assets?: readonly { path: string; url: string; mediaType: string }[];
  /** De qué servidores se aceptan incrustaciones, para decir de dónde venían. */
  embedHosts?: readonly string[];
  /**
   * Qué dice cada bloque que la página cite, entero, y de qué página salió.
   *
   * @invariant AQuotedBlockTravelsAsItsWords. Sin esto, una cita `((…))` se
   * imprimía como su identificador —`block:1f3a…`— que es lo peor de las dos
   * cosas: ocupa el sitio de una frase, no dice lo que ella decía, y no lleva a
   * ninguna parte. El papel no tiene adónde ir, así que o viaja la frase o no
   * viaja nada.
   */
  resolveBlock?: (stableId: string) => { page: string; excerpt: string } | null;
  /**
   * El dibujo de cada diagrama, por su fuente.
   *
   * @invariant ADiagramIsDrawnOnPaper. Va por la fuente y no por un índice
   * porque la fuente es lo único que identifica a un diagrama sin depender de
   * cuántos hubiera antes: una página que repite el mismo diagrama dos veces lo
   * dibuja una y lo pega dos.
   *
   * Un valor nulo es un diagrama que no compila, y entonces se deja la fuente a
   * la vista con el error al lado, como en pantalla. Una clave ausente es un
   * diagrama que nadie intentó dibujar, y se deja como estaba.
   */
  diagrams?: ReadonlyMap<string, { svg: string } | { error: string }>;
  /**
   * Con sangría, para poder compararlo.
   *
   * El papel va sin ella: un esquema sangrado en pantalla se lee como jerarquía
   * porque las viñetas la sostienen, y en papel sin viñetas quedan escalones sin
   * causa. Queda la opción porque quitarla del todo es una apuesta y hay que
   * poder mirar las dos.
   */
  indent?: boolean;
}

export interface BookletOptions {
  title: string;
  pages: readonly PaperOptions[];
}

/** El orden de lectura: cada bloque después de su padre, y los hijos por posición. */
function inReadingOrder(blocks: readonly PaperBlock[]): { block: PaperBlock; depth: number }[] {
  const byParent = new Map<string | null, PaperBlock[]>();
  for (const block of blocks) {
    const kin = byParent.get(block.parent) ?? [];
    kin.push(block);
    byParent.set(block.parent, kin);
  }
  for (const kin of byParent.values()) kin.sort((a, b) => a.position - b.position);

  const ordered: { block: PaperBlock; depth: number }[] = [];
  const walk = (parent: string | null, depth: number): void => {
    for (const block of byParent.get(parent) ?? []) {
      ordered.push({ block, depth });
      walk(block.stableId, depth + 1);
    }
  };
  walk(null, 0);

  /*
   * Un bloque cuyo padre no está en la página no se pierde.
   *
   * No debería pasar, y por eso mismo hay que decidir qué hacer si pasa: un
   * documento al que le falta un párrafo sin avisar es peor que uno con el
   * párrafo fuera de sitio.
   */
  if (ordered.length < blocks.length) {
    const seen = new Set(ordered.map((one) => one.block.stableId));
    for (const block of blocks) {
      if (!seen.has(block.stableId)) ordered.push({ block, depth: 0 });
    }
  }
  return ordered;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/*
 * La hoja de estilo del papel, que es corta a propósito.
 *
 * Carta, sin fondos, tinta negra. Las fuentes son las que Vera ya sirve —el
 * papel se pide al propio servidor, así que las alcanza por su ruta de siempre—
 * y no las del sistema, que en otra máquina serían otras.
 */
const STYLE = `
@font-face {
  font-family: 'IBM Plex Sans';
  src: url('/fonts/plex-sans-400.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
}
@font-face {
  font-family: 'IBM Plex Sans';
  src: url('/fonts/plex-sans-400-italic.woff2') format('woff2');
  font-weight: 400;
  font-style: italic;
}
@font-face {
  font-family: 'IBM Plex Sans';
  src: url('/fonts/plex-sans-600.woff2') format('woff2');
  font-weight: 600;
  font-style: normal;
}
@font-face {
  font-family: 'IBM Plex Mono';
  src: url('/fonts/plex-mono-400.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
}

@page {
  size: letter;
  margin: 25mm 22mm;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: none;
  color: #000;
  font-family: 'IBM Plex Sans', system-ui, sans-serif;
  font-size: 10.5pt;
  line-height: 1.55;
  -webkit-print-color-adjust: economy;
}

h1.paper-title {
  margin: 0 0 1.55rem;
  font-size: 18pt;
  font-weight: 600;
  line-height: 1.25;
}

.b { margin: 0; }

/* Un párrafo detrás de otro, sin hueco entre ellos: el texto va seguido y lo que
   separa es el sentido, no el aire. Lo que sí abre son los encabezados. */
.b > p { margin: 0 0 0.55rem; }

.b > :is(h1, h2, h3, h4, h5, h6) {
  margin: 1.55rem 0 0.4rem;
  font-weight: 600;
  break-after: avoid;
}

.b > h1 { font-size: 14pt; }
.b > h2 { font-size: 12.5pt; }
.b > h3 { font-size: 11.5pt; }
.b > :is(h4, h5, h6) { font-size: 10.5pt; }

.b > :first-child { margin-top: 0; }

.b ul, .b ol { margin: 0 0 0.55rem; padding-left: 1.4em; }
.b li { margin: 0; }

.b blockquote {
  margin: 0 0 0.55rem;
  padding-left: 1em;
  border-left: 1px solid #999;
}

/* Una cita de bloque. En pantalla es un enlace; aquí es la frase, y se dibuja
   como una frase de otro: entre comillas y con su procedencia detrás. Va en
   línea y no aparte porque pertenece a la oración que la trajo. */
.b .quoted::before { content: '\\201C'; }
.b .quoted::after { content: '\\201D'; }
.b .quoted-from::before { content: ' \\2014\\00a0'; }
.b .quoted-from {
  font-size: 0.85em;
  font-style: italic;
  color: #444;
}
.b .quoted-from::after { content: ''; }
.b .quoted.gone {
  font-style: italic;
  color: #666;
}
.b .quoted.gone::before, .b .quoted.gone::after { content: ''; }

/* Un diagrama. Centrado y entero: se prohíbe partirlo porque una figura cortada
   por el salto de página deja de decir lo que decía, y el navegador la cortaría
   sin pensarlo. Y con ancho máximo, que es lo que hace que un diagrama ancho
   quepa en la caja del texto en vez de salirse por el margen. */
.b .diagram {
  margin: 0.8rem 0;
  text-align: center;
  break-inside: avoid;
  page-break-inside: avoid;
}

/* Un dibujo a mano también es una sola figura. Sus medidas ya llegan reducidas
   a la caja imprimible, con la misma regla proporcional de los diagramas. */
.b .drawn {
  margin: 0.8rem 0;
  text-align: center;
  break-inside: avoid;
  page-break-inside: avoid;
}
.b .drawn svg {
  display: block;
  margin: 0 auto;
}
/* Las medidas ya vienen puestas desde el servidor, ajustadas a la caja de la
   página. Aquí no se acota nada más: un ancho máximo encogería el ancho sin
   tocar el alto, que es exactamente el hueco en blanco que esto vino a quitar. */
.b .diagram svg {
  display: block;
  margin: 0 auto;
}
/* Uno que no compiló: la fuente sigue a la vista, que es lo único con lo que se
   arregla, y el porqué encima en vez de un hueco sin explicar. */
.b .diagram-failed {
  margin: 0.8rem 0;
  border-left: 2px solid #999;
  padding-left: 0.8em;
}
.b .diagram-why {
  font-size: 0.85em;
  font-style: italic;
  color: #444;
  margin: 0 0 0.3rem;
}

.b code, .b pre {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.88em;
}

.b pre {
  margin: 0 0 0.55rem;
  padding: 0.5em 0.7em;
  border: 1px solid #ccc;
  white-space: pre-wrap;
  break-inside: avoid;
}

/* Imagen y HTML usan toda la caja imprimible, sin el marco de la interfaz.
   object-fit: contain conserva la proporción aunque la hoja y la imagen tengan
   formas distintas. La caja coincide con PAGE_FIT: carta menos los márgenes y
   la holgura del paginador. */
.b img {
  display: block;
  width: 100%;
  height: 820px;
  margin: 0 auto;
  border: 0;
  border-radius: 0;
  object-fit: contain;
  break-inside: avoid;
  page-break-inside: avoid;
}

.b .executable {
  width: 100%;
  max-width: none;
  margin: 0;
  border: 0;
  break-inside: avoid;
  page-break-inside: avoid;
}

.b .executable iframe {
  display: block;
  width: 100%;
  height: 820px;
  border: 0;
  border-radius: 0;
}

.b .executable :is(summary, .executable-size-toggle) { display: none; }

.b table {
  width: 100%;
  margin: 0 0 0.55rem;
  border-collapse: collapse;
}

/* Las tablas largas sí se parten: preservar tamaño legible importa más que la
   unidad de la tabla. El grupo de cabecera se repite en cada hoja nueva. */
.b .table-scroll { overflow: visible; }
.b thead { display: table-header-group; }
.b tbody { display: table-row-group; }
.b tr {
  break-inside: avoid;
  page-break-inside: avoid;
}

.b :is(th, td) {
  padding: 0.25em 0.5em;
  border: 1px solid #bbb;
  text-align: left;
  vertical-align: top;
  background: none;
}

/* Los enlaces se leen, no se pulsan: en papel un color no lleva a ninguna parte. */
.b a { color: #000; text-decoration: underline; }

/* Lo que corre no corre en el papel. Queda dónde estaba, que es lo único que un
   papel puede llevar de una incrustación. */
.b .embed iframe { display: none; }
.b .embed figcaption { display: none; }
.b .embed::after {
  content: 'incrustado desde ' attr(data-source);
  display: block;
  padding: 0.4rem 0;
  border-top: 1px solid #999;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.75em;
  word-break: break-all;
}
`;

/**
 * El papel de una página: HTML completo, servido desde el propio Vera.
 *
 * Se sirve y no se escribe en un archivo temporal porque así las imágenes, las
 * fuentes y los medios se piden por su ruta de siempre y a su propio origen. Un
 * `file://` habría obligado a copiar cada objeto al lado del HTML y a reescribir
 * las rutas, y a que las dos formas de mirar la misma página no fueran la misma.
 */
/**
 * Lo que en pantalla era un enlace, en papel es una cita.
 *
 * @invariant AQuotedBlockTravelsAsItsWords. La misma función dibuja el papel y la
 * pantalla —@invariant TheTextIsRenderedByTheSameHandAsTheScreen— y eso está bien
 * para el texto y no para lo que se pulsa: una cita sale como `<a href="#">`, que
 * en un PDF es un enlace a ninguna parte. Se le quita el enlace, se le deja el
 * texto, y se le añade de qué página salió, que en pantalla se sabe yendo y aquí
 * no se sabría de ninguna manera.
 *
 * Una cita cuyo bloque ya no existe se marca como lo que es en vez de imprimir su
 * identificador como si fuera una frase.
 */
function onPaper(html: string, source: ReadonlyMap<string, string>): string {
  return html.replace(
    /<a class="block-ref" data-block="([^"]*)" href="#"( data-dangling="true")?>([\s\S]*?)<\/a>/g,
    (whole, id: string, dangling: string | undefined, text: string) => {
      if (dangling !== undefined) {
        return '<span class="quoted gone">[la frase citada ya no está en el corpus]</span>';
      }
      const from = source.get(unquoteAttribute(id));
      // Hermanos y no anidados: la comilla de cierre va antes de la procedencia,
      // que es de quien cita y no de lo citado.
      const said = from === undefined ? '' : `<span class="quoted-from">${escapeHtml(from)}</span>`;
      return `<span class="quoted">${text}</span>${said}`;
    },
  );
}

/** Deshace lo que `quoteAttribute` hizo, para volver a preguntar por el mismo id. */
function unquoteAttribute(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/** Y lo que `escapeHtml` hizo. El `&amp;` al final, o se desharía dos veces. */
function unescapeHtml(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/*
 * La caja donde tiene que caber una figura, en píxeles de CSS.
 *
 * Sale de `@page`: carta —215,9 × 279,4 mm— menos los márgenes de 25 y 22, que
 * dejan 171,9 × 229,4 mm de papel escribible; a 3,7795 px por milímetro, 649 ×
 * 867. De ese alto se descuenta el margen propio de la figura y un dedo de
 * holgura: quien decide si algo cabe en la página es el paginador de Chrome, y
 * apurar el último punto es cómo se consigue que una figura del alto exacto se
 * vaya sola a la página siguiente y deje media hoja en blanco detrás.
 *
 * Si cambian los márgenes de `@page`, cambian estos dos números. Van juntos y con
 * la cuenta escrita para que se vea que dependen de allí.
 */
const PAGE_FIT = { width: 649, height: 820 };

/**
 * Encoge un dibujo hasta que quepa en la página, guardando su proporción.
 *
 * @invariant ADiagramFitsOnOnePage. En pantalla la única restricción es el ancho
 * de la columna, porque hacia abajo se sigue leyendo. En papel no: hacia abajo se
 * acaba la hoja, y una figura más alta que la caja o se parte —y deja de decir lo
 * que decía— o se va entera a la página siguiente dejando media hoja en blanco.
 * Así que aquí manda la más chica de las dos medidas, y suele ser el alto.
 *
 * Se calcula aquí y no se deja en CSS a propósito. Un `max-height` sobre un SVG
 * en línea depende de que el motor le reconozca proporción intrínseca, y Mermaid
 * le escribe encima su propio `width` y su `max-width` en línea; el resultado
 * depende de a quién le gane cuál. La aritmética es la misma en todas partes.
 *
 * Sólo encoge. Un dibujo que ya cabe se queda como está: agrandarlo para llenar
 * la caja lo dejaría desenfocado de la escala del resto del documento.
 */
function fitToPage(svg: string): string {
  const box = /viewBox="\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)/.exec(svg);
  if (box === null) return svg;
  const width = Number(box[1]);
  const height = Number(box[2]);
  if (!(width > 0) || !(height > 0)) return svg;

  const scale = Math.min(1, PAGE_FIT.width / width, PAGE_FIT.height / height);
  const w = Math.floor(width * scale);
  const h = Math.floor(height * scale);

  // Se le quitan a la etiqueta las medidas que traía —incluido el `max-width` en
  // línea, que es el que en pantalla lo encogía a la columna— y se le ponen las
  // dos de la cuenta. Sólo la etiqueta de apertura: dentro puede haber otros
  // `width` que son del dibujo y no del marco.
  const open = /^<svg\b[^>]*>/.exec(svg);
  if (open === null) return svg;
  const attrs = open[0]
    .replace(/\s(?:width|height)="[^"]*"/g, '')
    .replace(/\sstyle="[^"]*"/g, '')
    .replace(/^<svg/, `<svg width="${w}" height="${h}" style="width:${w}px;height:${h}px"`);
  return attrs + svg.slice(open[0].length);
}

/**
 * Ajusta sólo los dibujos manuales; los Mermaid se sustituyen y ajustan después.
 *
 * @invariant AHandDrawingFitsOnOnePage. El cercado sigue siendo el contenido
 * canónico del bloque. Esta transformación toca únicamente su proyección SVG
 * para papel y deja la pantalla y el corpus intactos.
 */
function fittedHandDrawings(html: string): string {
  return html.replace(
    /(<figure class="drawn">)(<svg\b[\s\S]*?<\/svg>)(<\/figure>)/g,
    (_whole, opening: string, svg: string, closing: string) => opening + fitToPage(svg) + closing,
  );
}

/**
 * Dónde está cada diagrama en el HTML del papel, y qué dice.
 *
 * Se busca sobre el HTML ya dibujado y no sobre el Markdown de los bloques a
 * propósito: así lo que se manda a dibujar es exactamente lo mismo que después
 * se va a sustituir. Buscarlo dos veces por caminos distintos —el cercado por un
 * lado, el `<code>` por el otro— es cómo se llega a un mapa cuyas claves no
 * casan con nada y a una página que dibuja la mitad de sus figuras.
 */
const DIAGRAM = /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g;

/**
 * Las fuentes de los diagramas de un papel, sin repetir y en orden de lectura.
 *
 * Exportada porque quien compone el papel necesita saber qué hay que dibujar
 * antes de tener con qué dibujarlo: primero se pregunta, luego se dibuja, y sólo
 * entonces se vuelve a componer con los dibujos puestos.
 */
export function diagramsIn(html: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const [, source] of html.matchAll(DIAGRAM)) {
    const text = unescapeHtml(source ?? '');
    if (seen.has(text)) continue;
    seen.add(text);
    found.push(text);
  }
  return found;
}

/**
 * Cambia cada fuente por su dibujo.
 *
 * @invariant ADiagramIsDrawnOnPaper. Lo que no se pudo dibujar se queda como
 * estaba —con su porqué encima, si lo hay—: un hueco callado sería peor que la
 * fuente, porque la fuente al menos se puede arreglar.
 */
function drawn(
  html: string,
  diagrams: ReadonlyMap<string, { svg: string } | { error: string }>,
): string {
  if (diagrams.size === 0) return html;
  return html.replace(DIAGRAM, (whole, source: string) => {
    const made = diagrams.get(unescapeHtml(source));
    if (made === undefined) return whole;
    if ('error' in made) {
      return (
        `<div class="diagram-failed"><p class="diagram-why">` +
        `Este diagrama no se pudo dibujar: ${escapeHtml(made.error)}</p>${whole}</div>`
      );
    }
    return `<div class="diagram">${fitToPage(made.svg)}</div>`;
  });
}

export function paperHtml(options: PaperOptions): string {
  const render: RenderOptions = {};
  if (options.embedHosts !== undefined) render.embedHosts = options.embedHosts;
  const assets = options.assets ?? [];
  if (assets.length > 0) {
    const byPath = new Map(assets.map((asset) => [asset.path, asset]));
    render.resolveAsset = (path) => {
      const found = byPath.get(path);
      if (found !== undefined) return { url: found.url, mediaType: found.mediaType };
      try {
        return byPath.get(decodeURIComponent(path)) ?? null;
      } catch {
        return null;
      }
    };
  }

  /*
   * Las citas: el texto entero, y de dónde salió.
   *
   * El de dónde no lo sabe el renderizador —le basta con el rótulo— así que se
   * anota aquí, al resolver, y se pega al pie de la cita más abajo.
   */
  const source = new Map<string, string>();
  if (options.resolveBlock !== undefined) {
    const ask = options.resolveBlock;
    render.resolveBlock = (stableId) => {
      const found = ask(stableId);
      if (found !== null) source.set(stableId, found.page);
      return found;
    };
  }

  const body = inReadingOrder(options.blocks)
    .filter(({ block }) => block.content.trim() !== '')
    .map(({ block, depth }) => {
      const sangría =
        options.indent === true && depth > 0 ? ` style="margin-left:${depth * 1.2}rem"` : '';
      const text = fittedHandDrawings(onPaper(renderMarkdown(block.content, render), source));
      return `<div class="b"${sangría}>${drawn(text, options.diagrams ?? new Map())}</div>`;
    })
    .join('\n');

  return (
    `<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n` +
    `<title>${escapeHtml(options.title)}</title>\n<style>${STYLE}</style>\n</head>\n` +
    `<body>\n<h1 class="paper-title">${escapeHtml(options.title)}</h1>\n${body}\n</body>\n</html>\n`
  );
}

/** Varias páginas, en el orden de un recorrido, dentro de un solo cuadernillo. */
export function bookletHtml(options: BookletOptions): string {
  const chapters = options.pages.map((page) => {
    const html = paperHtml(page);
    const body = /<body>\n([\s\S]*)\n<\/body>/.exec(html)?.[1] ?? '';
    return `<section class="paper-chapter">${body}</section>`;
  }).join('\n');
  return (
    `<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n` +
    `<title>${escapeHtml(options.title)}</title>\n<style>${STYLE}\n` +
    `.paper-chapter + .paper-chapter { break-before: page; }\n</style>\n</head>\n` +
    `<body>\n${chapters}\n</body>\n</html>\n`
  );
}

export interface PaperPresence {
  ready: boolean;
  binary: string | null;
}

/** ¿Hay con qué componer un PDF? Se pregunta antes de prometer nada. */
export function paperPresence(): PaperPresence {
  const binary = findTool(CHROMES, process.env['VERA_CHROME']);
  return { ready: binary !== null, binary };
}

/**
 * La misma Mermaid que dibuja la pantalla, buscada en el árbol de paquetes.
 *
 * @invariant ADiagramIsDrawnOnPaper pide que sea la misma mano, y «la misma» aquí
 * quiere decir la misma versión del mismo archivo: dos Mermaid distintas dibujan
 * el mismo texto con formas distintas, y entonces el papel enseñaría otra figura
 * que la que se estaba mirando. Se resuelve desde el paquete que la declara
 * —`packages/web`— en vez de fijar una ruta, para que actualizarla ahí la
 * actualice aquí.
 */
function mermaidLibrary(): string | null {
  const ask = createRequire(import.meta.url);
  for (const from of ['mermaid/dist/mermaid.min.js', 'mermaid']) {
    try {
      const found = ask.resolve(from);
      return from.endsWith('.js') ? found : join(dirname(found), 'mermaid.min.js');
    } catch {
      // La siguiente forma de pedirla.
    }
  }
  return null;
}

/**
 * Dibuja los diagramas de una página, todos de una vez.
 *
 * @invariant ADiagramIsDrawnOnPaper.
 *
 * De una vez y no uno por uno porque el coste es arrancar el navegador y cargar
 * la biblioteca, no dibujar: treinta y seis diagramas de la página más cargada
 * del corpus tardan tres segundos y medio juntos, y arrancar Chrome treinta y
 * seis veces tardaría un minuto largo.
 *
 * El resultado viaja como texto y no como DOM: la página se vacía al terminar y
 * deja en su sitio un JSON con los dibujos, así que lo que hay que leer del
 * volcado es una sola cosa y no hay que ir separando SVG a ojo. De paso el
 * volcado deja de arrastrar los tres megas y medio de la biblioteca.
 */
export async function drawDiagrams(
  sources: readonly string[],
  options: { timeoutMs?: number; dark?: boolean } = {},
): Promise<Map<string, { svg: string } | { error: string }>> {
  const made = new Map<string, { svg: string } | { error: string }>();
  if (sources.length === 0) return made;

  const presence = paperPresence();
  const library = mermaidLibrary();
  /*
   * Sin con qué dibujar se dice, y se dice una vez por diagrama.
   *
   * No se lanza: un papel sin diagramas dibujados sigue siendo un papel, y
   * negarse a componerlo entero por esto dejaría a quien no tiene Chrome sin
   * poder exportar nada. Cada figura lleva encima por qué no está.
   */
  if (!presence.ready || presence.binary === null || library === null) {
    const why =
      library === null
        ? 'no se encontró la biblioteca de diagramas en esta instalación'
        : 'no hay un Chrome en esta máquina con el que dibujarlo';
    for (const source of sources) made.set(source, { error: why });
    return made;
  }

  let workshop: string | null = null;
  try {
    workshop = await mkdtemp(join(tmpdir(), 'vera-diagramas-'));
    const page = join(workshop, 'dibujo.html');
    /*
     * `strict` y no `sandbox`, que es lo que usa la pantalla.
     *
     * En pantalla el aislamiento lo da el iframe —ver ExecutableContentIsolation—
     * y aquí no cabe: de un iframe no se saca el SVG, y un iframe no se imprime
     * como una figura. `strict` desinfecta el marcado que el diagrama traiga
     * dentro, que es la parte que importa cuando el texto lo escribió otro; y el
     * resto del aislamiento lo da el sitio: un Chrome sin ventana, con perfil
     * nuevo que se borra, leyendo un archivo local y sin nada que alcanzar.
     */
    await writeFile(
      page,
      `<!doctype html><meta charset="utf-8"><body><div id="donde"></div>\n` +
        `<script>${await readFile(library, 'utf8')}</script>\n` +
        `<script>\n` +
        `const fuentes = ${JSON.stringify(sources)};\n` +
        `mermaid.initialize({ startOnLoad: false, securityLevel: 'strict',` +
        ` theme: ${options.dark === true ? "'dark'" : "'default'"},` +
        ` fontFamily: 'IBM Plex Sans, sans-serif' });\n` +
        `(async () => {\n` +
        `  const hechos = [];\n` +
        `  for (let i = 0; i < fuentes.length; i += 1) {\n` +
        `    try {\n` +
        `      const { svg } = await mermaid.render('vera-d' + i, fuentes[i], ` +
        `document.getElementById('donde'));\n` +
        `      hechos.push({ svg });\n` +
        `    } catch (e) {\n` +
        `      hechos.push({ error: (e && e.message) ? String(e.message) : 'no compila' });\n` +
        `    }\n` +
        `  }\n` +
        `  document.head.innerHTML = '';\n` +
        `  document.body.innerHTML = '';\n` +
        `  document.body.textContent = JSON.stringify(hechos);\n` +
        `})();\n` +
        `</script></body>`,
      'utf8',
    );

    const { stdout } = await run(
      presence.binary,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        `--user-data-dir=${join(workshop, 'perfil')}`,
        // El reloj corre acelerado hasta agotarlo: así se espera a que Mermaid
        // termine sin esperar el tiempo de verdad.
        '--virtual-time-budget=30000',
        '--dump-dom',
        `file://${page}`,
      ],
      { timeout: options.timeoutMs ?? 120_000, maxBuffer: 256 * 1024 * 1024 },
    );

    const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(stdout);
    const said: unknown = body === null ? null : JSON.parse(unescapeHtml(body[1] ?? ''));
    if (!Array.isArray(said)) throw new Error('el navegador no devolvió los dibujos');
    sources.forEach((source, i) => {
      const one: unknown = said[i];
      if (one !== null && typeof one === 'object' && 'svg' in one && typeof one.svg === 'string') {
        made.set(source, { svg: one.svg });
      } else if (
        one !== null &&
        typeof one === 'object' &&
        'error' in one &&
        typeof one.error === 'string'
      ) {
        made.set(source, { error: one.error });
      } else {
        made.set(source, { error: 'el navegador no devolvió este dibujo' });
      }
    });
    return made;
  } catch (error) {
    const why = error instanceof Error ? error.message : 'error desconocido';
    for (const source of sources) made.set(source, { error: why });
    return made;
  } finally {
    if (workshop !== null) await rm(workshop, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * El papel entero, con sus diagramas dibujados.
 *
 * Se compone dos veces y no es un descuido: la primera dice qué diagramas hay
 * —que es algo que sólo se sabe después de dibujar el Markdown, porque un
 * cercado puede venir dentro de una lista o de una cita— y la segunda los pone.
 * Dibujar el Markdown cuesta milisegundos sobre la página más larga del corpus;
 * adivinar qué hay que dibujar por otro camino costaría que los dos caminos se
 * separaran.
 *
 * Una página sin diagramas no paga nada: no se arranca ningún navegador.
 */
export async function composePaper(
  options: PaperOptions,
  how: { timeoutMs?: number; dark?: boolean } = {},
): Promise<string> {
  const first = paperHtml(options);
  const sources = diagramsIn(first);
  if (sources.length === 0) return first;
  return paperHtml({ ...options, diagrams: await drawDiagrams(sources, how) });
}

/** Compone de una vez todos los diagramas que aparecen en un librillo. */
export async function composeBooklet(
  options: BookletOptions,
  how: { timeoutMs?: number; dark?: boolean } = {},
): Promise<string> {
  const first = bookletHtml(options);
  const sources = diagramsIn(first);
  if (sources.length === 0) return first;
  const diagrams = await drawDiagrams(sources, how);
  return bookletHtml({
    ...options,
    pages: options.pages.map((page) => ({ ...page, diagrams })),
  });
}

/**
 * Pasa a PDF lo que haya en esa dirección.
 *
 * Con su propio perfil temporal: sin él, un Chrome sin ventana se encuentra con
 * el Chrome que la persona tiene abierto, y o falla o —peor— le habla. El perfil
 * se borra al terminar, salga bien o mal.
 */
export async function toPdf(
  url: string,
  options: { timeoutMs?: number } = {},
): Promise<{ pdf: Buffer } | { error: string }> {
  const presence = paperPresence();
  if (!presence.ready || presence.binary === null) {
    return { error: 'no hay un Chrome en esta máquina con el que componer el PDF' };
  }

  let workshop: string | null = null;
  try {
    workshop = await mkdtemp(join(tmpdir(), 'vera-paper-'));
    const out = join(workshop, 'pagina.pdf');
    await run(
      presence.binary,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        `--user-data-dir=${join(workshop, 'perfil')}`,
        // Sin encabezado ni pie: la fecha y la dirección que el navegador
        // estampa por su cuenta son suyas, no del documento.
        '--no-pdf-header-footer',
        // Y sin fondos: lo que se imprime es tinta sobre el papel que haya.
        `--print-to-pdf=${out}`,
        // Tiempo virtual: el reloj de la página corre acelerado hasta agotarlo,
        // así se esperan las fuentes y las imágenes sin esperarlas de verdad.
        '--virtual-time-budget=5000',
        url,
      ],
      { timeout: options.timeoutMs ?? 60_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const pdf = await readFile(out);
    return { pdf };
  } catch (error) {
    const why = error instanceof Error ? error.message : 'error desconocido';
    return { error: `no se pudo componer el PDF: ${why}` };
  } finally {
    if (workshop !== null) await rm(workshop, { recursive: true, force: true }).catch(() => undefined);
  }
}
