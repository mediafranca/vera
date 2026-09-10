// Renderizado de Markdown para la presentación de un bloque.
//
// Vive en el dominio y no en el cliente porque ya no es del cliente: la misma
// función dibuja un bloque en pantalla y lo compone en el papel del que sale un
// PDF. Duplicarla era garantizar que un día dijeran cosas distintas del mismo
// texto.
//
// @invariant RenderedPresentationIsFaithful: encabezados, listas, citas, código,
// tablas, imágenes, líneas horizontales y referencias a notas al pie se leen como
// lo que son y no como sus marcas.
//
// @invariant EmbeddedMarkupIsInert: el HTML escrito dentro de un bloque se
// presenta como texto. Este módulo no produce marcado activo, y el corpus trae
// 108 bloques con HTML crudo que dependen de eso.
//
// @invariant EditingRevealsTheSource: nada de aquí vuelve al grafo. Renderizar es
// una vista sobre la fuente; la fuente se guarda tal como se escribió y ninguna
// edición pasa de ida y vuelta por este archivo.
//
// La estructura de bloque se reconoce sobre el texto crudo y el escapado ocurre
// después, sobre el contenido de cada pieza. Al revés no funciona: escapar
// primero convierte el `>` de una cita en `&gt;` y la cita deja de existir.

/*
 * Un bloque que es, entero, una incrustación.
 *
 * La regla de la casa es que el marcado escrito dentro de un bloque se presenta
 * como texto —@invariant EmbeddedMarkupIsInert—, y con razón: si bastara con que
 * apareciera en cualquier parte, pegar una nota copiada de una página web
 * convertiría media bitácora en marcado ajeno sin que nadie lo hubiera decidido.
 * Ciento ocho bloques de este corpus dependen de eso.
 *
 * La excepción es estrecha: el bloque entero es una sola incrustación, o una
 * parte queda señalada deliberadamente con una valla `iframe`. El marcado
 * suelto entre prosa sigue inerte. Ver
 * specs/executable-content-sandbox.allium.
 */
import { drawingSvg, readDrawing } from './drawing.ts';
import { renderMediaWiki } from './mediawiki.ts';
import { wikiReference } from './text.ts';

const EMBED = /^\s*<iframe\b([^>]*)>\s*<\/iframe>\s*$/i;
const ATTRIBUTE = /(\w[\w-]*)\s*=\s*"([^"]*)"/g;

/** Cuánto ocupa una incrustación que no dice cuánto ocupa. */
const EMBED_HEIGHT = 460;

type LinkedResourceKind = 'pdf' | 'image' | 'audio' | 'video' | 'tiktok' | 'instagram' | 'page';

/**
 * Una dirección que ocupa el bloque entero se presenta como objeto enlazado.
 * No se pide todavía: salvo YouTube, cargar el recurso requiere el gesto
 * «Mostrar». Así reconocer una dirección no informa al sitio de que se leyó la
 * página que la contiene.
 */
export function linkedResourceIn(source: string): string | null {
  const clean = source.trim();
  const markdown = /^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)$/.exec(clean);
  const raw = /^https:\/\/[^\s<>]+$/.test(clean) ? clean : null;
  const href = markdown?.[2] ?? raw;
  if (href === null || href === undefined) return null;

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.toLowerCase();
  const kind: LinkedResourceKind =
    host === 'tiktok.com' || host.endsWith('.tiktok.com') ? 'tiktok' :
      host === 'instagram.com' || host.endsWith('.instagram.com') ? 'instagram' :
        /\.pdf$/.test(path) ? 'pdf' :
          /\.(?:avif|gif|jpe?g|png|svg|webp)$/.test(path) ? 'image' :
            /\.(?:aac|flac|m4a|mp3|oga|ogg|opus|wav)$/.test(path) ? 'audio' :
              /\.(?:mp4|m4v|mov|ogv|webm)$/.test(path) ? 'video' : 'page';
  const label = markdown?.[1]?.trim() || href;
  const named = kind === 'page' ? 'enlace' : kind;
  const canShow = ['pdf', 'image', 'audio', 'video'].includes(kind);
  const escapedHref = quoteAttribute(escapeHtml(href));

  return (
    `<figure class="linked-resource" data-resource-kind="${kind}">` +
    `<figcaption><span>${escapeHtml(named)} · ${escapeHtml(host)}</span>` +
    `<a href="${escapedHref}" rel="noreferrer" target="_blank">${escapeHtml(label)}</a>` +
    (canShow
      ? `<button type="button" class="linked-resource-show" data-resource-kind="${kind}" ` +
        `data-resource-url="${escapedHref}">Mostrar</button>`
      : '') +
    `</figcaption></figure>`
  );
}

export function embedIn(source: string, hosts: readonly string[] = []): string | null {
  const youtube = youtubeEmbed(source.trim());
  const found = EMBED.exec(youtube ?? source);
  if (found === null) return null;

  const said = new Map<string, string>();
  for (const attribute of (found[1] ?? '').matchAll(ATTRIBUTE)) {
    said.set((attribute[1] ?? '').toLowerCase(), attribute[2] ?? '');
  }

  /*
   * Sólo lo que viaja cifrado —@invariant OnlyOverACarriedConnection—. Una
   * incrustación sin cifrar deja a quien mire la red saber qué se está leyendo,
   * y además el navegador la rechazaría en una Vera servida por HTTPS: valdría
   * un hueco donde debería haber algo.
   */
  const src = said.get('src') ?? '';
  if (!/^https:\/\//i.test(src)) return null;

  let host = '';
  let origin = '';
  /*
   * La dirección dicha corta: origen y ruta, sin consulta ni fragmento.
   *
   * Es la que se imprime cuando el marco no puede correr, y la larga no sirve
   * para eso: una herramienta que recibe su documento en el fragmento trae ahí
   * media hoja de base64, y lo que saldría en el papel serían veinte líneas de
   * ruido donde debería leerse de dónde venía.
   */
  let address = '';
  try {
    const parsed = new URL(src);
    host = parsed.host;
    origin = parsed.origin;
    address = `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }

  /*
   * Nunca lo que viene del mismo sitio que Vera.
   *
   * Es la única combinación que rompe el encierro: contenido servido desde el
   * origen de Vera y con permiso de conservar ese origen puede alcanzar la
   * página que lo contiene y quitarse el sandbox a sí mismo. De fuera no puede
   * —el navegador no le deja cruzar a otro origen— y por eso lo de fuera sí
   * corre con el suyo. @invariant NothingReachesBack.
   */
  const here = (globalThis as { location?: { origin?: string } }).location?.origin;
  if (here !== undefined && origin === here) return null;

  /*
   * Y sólo de un servidor registrado.
   *
   * Que algo corra dentro de una página propia no puede decidirlo quien escribió
   * el bloque —una dirección se copia y se pega sin mirar—, así que lo decide el
   * corpus: la lista vive en la página de ontología y aquí no hay ninguna por
   * omisión. Lo que no está en ella se lee como el texto que es, que es lo que
   * Vera hace con todo el marcado desde siempre.
   *
   * Se admite el servidor y sus subdominios: registrar `github.io` deja entrar a
   * `eadpucv.github.io`, y quien quiera sólo uno registra el nombre entero.
   */
  const allowed = host === 'www.youtube-nocookie.com' || hosts.some((one) => {
    const clean = one.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return clean !== '' && (host === clean || host.endsWith(`.${clean}`));
  });
  if (!allowed) return null;

  const height = /^\d{2,4}$/.test(said.get('height') ?? '')
    ? Number(said.get('height'))
    : EMBED_HEIGHT;

  /*
   * Lo que se le permite y lo que no.
   *
   * `sandbox` con su propio origen y nada más. Lo incrustado corre siendo quien
   * es —puede guardar lo suyo, pedir a su servidor y usar sus propias APIs, que
   * es lo que hace falta para que una herramienta funcione— y no alcanza nada de
   * VERA: el navegador no le deja cruzar a otro origen, y de ahí que la única
   * combinación prohibida sea incrustar algo servido desde el origen de Vera,
   * que se comprueba más arriba. @invariant NothingReachesBack.
   *
   * `allow-scripts` porque lo que se incrusta suele ser una herramienta y sin
   * ejecutar no es nada; `allow-forms` porque escribir en ella es usarla. Lo que
   * no lleva: navegar la ventana de arriba, ni pantalla completa sin pedirla, ni
   * descargas.
   *
   * `referrerpolicy` para que la petición no diga desde qué nota se hizo: quien
   * aloja esto tiene que poder servirlo y no tiene por qué saber cómo se llama la
   * página desde la que alguien lo mira. YouTube es la excepción observable:
   * rechaza el reproductor con el error 153 si no recibe siquiera el origen que
   * lo contiene. En ese caso viaja sólo el origen, nunca la ruta de la nota.
   *
   * `loading="lazy"` porque una bitácora con seis incrustaciones no puede saludar
   * a seis servidores por el hecho de abrirse.
   */
  const referrerPolicy = host === 'www.youtube-nocookie.com'
    ? 'strict-origin-when-cross-origin'
    : 'no-referrer';

  return (
    // La dirección viaja en el marcado aunque en pantalla se lea sólo quién
    // aloja: impresa, una incrustación es un rectángulo en blanco, y lo único
    // que puede salvarla es decir dónde estaba.
    `<figure class="embed" data-source="${quoteAttribute(escapeHtml(address))}">` +
    `<iframe src="${quoteAttribute(escapeHtml(src))}" height="${height}" loading="lazy" ` +
    `referrerpolicy="${referrerPolicy}" sandbox="allow-scripts allow-forms allow-popups allow-same-origin" ` +
    `title="incrustado desde ${quoteAttribute(escapeHtml(host))}"></iframe>` +
    // Debajo, de dónde viene: un rectángulo que corre programa ajeno sin decir de
    // quién es se parece demasiado a una parte de Vera, y no lo es.
    `<figcaption>incrustado desde ${escapeHtml(host)}` +
    (host === 'www.youtube-nocookie.com'
      ? `<button type="button" class="youtube-transcript" data-youtube-source="${quoteAttribute(escapeHtml(source))}">Traer transcripción</button>`
      : '') +
    `</figcaption>` +
    `</figure>`
  );
}

/** Una URL de YouTube pegada sola se vuelve su reproductor sin cookies. */
function youtubeEmbed(source: string): string | null {
  if (!/^https:\/\//i.test(source)) return null;
  try {
    const url = new URL(source);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    let id = '';
    if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0] ?? '';
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (url.pathname === '/watch') id = url.searchParams.get('v') ?? '';
      else id = /^\/(?:shorts|embed)\/([^/?]+)/.exec(url.pathname)?.[1] ?? '';
    }
    if (!/^[\w-]{6,20}$/.test(id)) return null;
    return `<iframe src="https://www.youtube-nocookie.com/embed/${id}" height="460"></iframe>`;
  } catch {
    return null;
  }
}

/** Esquemas que pueden viajar en un href o un src. `javascript:` no está. */
const SAFE_URL = /^(https?:\/\/|mailto:|\/|\.\.?\/|#)/i;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Vuelve seguro un valor que va dentro de comillas dobles. Se aplica sobre texto
 * que ya pasó por `escapeHtml`, así que sólo faltan las comillas: escapar de
 * nuevo convertiría el `&` de una URL en `&amp;amp;`.
 */
function quoteAttribute(escaped: string): string {
  return escaped.replace(/"/g, '&quot;');
}

/** Una URL que no declara un esquema conocido no se emite como enlace. */
function safeUrl(raw: string): string | null {
  const url = raw.trim();
  return SAFE_URL.test(url) ? quoteAttribute(url) : null;
}

/**
 * El nombre con el que un encabezado se deja enlazar desde el índice.
 *
 * Las reglas son las de GitHub, y no por deferencia: los documentos que traen
 * índices con anclas se escribieron para ese lector, así que cualquier otra
 * convención rompería justamente los enlaces que ya venían escritos. Minúsculas,
 * fuera todo lo que no sea letra, número, guion o blanco, y los blancos a
 * guiones. Los acentos y la eñe se quedan: son letras.
 *
 * Ver specs/workspace-interface.allium, @invariant AnchorsReachTheirHeading.
 */
export function headingAnchor(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} \t_-]/gu, '')
    .replace(/[ \t]+/g, '-');
}

/**
 * Y los de una página entera, donde dos encabezados pueden decir lo mismo.
 *
 * El segundo «Notas» de un documento no puede llevar al primero, así que se
 * numera: `notas`, `notas-1`, `notas-2`. Es lo que hace GitHub y es lo que los
 * índices ya escritos esperan.
 */
export function uniqueAnchors(headings: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return headings.map((heading) => {
    const base = headingAnchor(heading);
    const times = seen.get(base) ?? 0;
    seen.set(base, times + 1);
    return times === 0 ? base : `${base}-${times}`;
  });
}

/**
 * Marcas que no emiten atributos y por lo tanto pueden correr sobre cualquier
 * texto ya escapado sin poder romper nada.
 */
function decorate(html: string): string {
  return html
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/(?<!~)~([^~\n]+)~(?!~)/g, '<sub>$1</sub>')
    .replace(/\^([^\^\n]+)\^/g, '<sup>$1</sup>')
    .replace(/\+\+([^+\n]+)\+\+/g, '<u>$1</u>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
}

const SLOT = '\u0000';

/**
 * Cómo se resuelve una ruta del corpus a algo que el navegador pueda pedir.
 *
 * El bloque conserva su `../assets/foo.png` y aquí se traduce al objeto que
 * Vera guarda. Sin resolvedor, la ruta se emite tal cual y la presentación
 * degrada sola: es lo que ocurre mientras los binarios no se hayan ingerido.
 */
export interface RenderOptions {
  /**
   * De qué servidores se acepta una incrustación.
   *
   * Vacía o ausente, ninguno: una incrustación es contenido de fuera que corre
   * dentro de una página propia, y quién puede hacer eso lo dice el corpus y no
   * quien escribió el bloque. Ver specs/executable-content-sandbox.allium y la
   * página de ontología, bajo «Incrustaciones».
   */
  embedHosts?: readonly string[];
  resolveAsset?: (path: string) => { url: string; mediaType: string } | null;
  /**
   * Qué bloque nombra una referencia `((stable_id))`.
   *
   * @invariant ReferenceResolvesToItsBlock: una referencia que no se puede
   * seguir no es una referencia. Sin resolvedor se emite el identificador tal
   * cual, que es la forma honesta de decir que aún no se sabe a qué apunta.
   */
  resolveBlock?: (stableId: string) => { page: string; excerpt: string } | null;
  /**
   * ¿Existe ya la página que este enlace nombra?
   *
   * Sin resolvedor se asume que sí, que es lo que hacía antes: un enlace sin
   * marca de pendiente no promete nada falso, sólo dice menos.
   */
  pageExists?: (title: string) => boolean;
}

/** Un medio que no es imagen se ofrece como archivo, no se finge presentado. */
function mediaElement(
  resolved: { url: string; mediaType: string },
  alt: string,
  fallbackLabel: string,
): string {
  if (resolved.mediaType.startsWith('image/')) {
    return `<img src="${quoteAttribute(resolved.url)}" alt="${quoteAttribute(alt)}" loading="lazy">`;
  }
  if (resolved.mediaType.startsWith('audio/')) {
    return `<audio class="media-audio" src="${quoteAttribute(resolved.url)}" controls preload="metadata"></audio>`;
  }
  return (
    `<a class="media-file" href="${quoteAttribute(resolved.url)}" ` +
    `data-media-type="${quoteAttribute(resolved.mediaType)}">${alt === '' ? fallbackLabel : alt}</a>`
  );
}

/**
 * Marcas que viven dentro de una línea. Recibe texto crudo y devuelve HTML
 * seguro: escapa antes de cualquier otra cosa.
 *
 * Todo elemento que lleve atributos se emite y se guarda de inmediato,
 * dejando en su lugar una marca que ninguna regla posterior reconoce. Sin eso,
 * una regla que corre después reescribe lo que hay dentro de un atributo ya
 * emitido: `![a #x](u)` terminaba con un `<span class="tag">` metido dentro del
 * `alt`, y ese `class="tag"` cerraba el atributo y abría otros. El corpus lo
 * produjo solo, con un `*Begriffsschrift*` dentro de un texto alternativo.
 *
 * El orden entre marcas también importa. Las imágenes van antes que los
 * enlaces, porque `![alt](src)` contiene un `[alt](src)` que el enlace se
 * llevaría; y la nota al pie va antes por la misma razón, porque `[^3]` es un
 * corchete.
 */
export function inlineMarkdown(source: string, options: RenderOptions = {}): string {
  // El separador tiene que ser un carácter que el contenido no pueda traer.
  let html = escapeHtml(source.replace(/\u0000/g, ''));

  const held: string[] = [];
  const hold = (fragment: string): string => `${SLOT}${held.push(fragment) - 1}${SLOT}`;

  // Imagen. Una ruta que no pasa el filtro de esquema se degrada a su texto
  // alternativo en vez de desaparecer sin dejar rastro. El `alt` es texto
  // plano por definición de HTML, así que no recibe marcas.
  html = html.replace(
    /!\[([^\]]*)\]\(([^)\n]+?)(?:\s+"[^"]*")?\)/g,
    (whole, alt: string, src: string) => {
      // Si Vera tiene el objeto, la ruta del corpus se traduce a él. Si no, se
      // emite tal cual y la presentación degrada sola.
      const resolved = options.resolveAsset?.(src) ?? null;
      if (resolved !== null) return hold(mediaElement(resolved, alt, src));

      const url = safeUrl(src);
      if (url === null) return alt === '' ? whole : alt;
      return hold(`<img src="${url}" alt="${quoteAttribute(alt)}" loading="lazy">`);
    },
  );

  // Referencia a nota al pie. La identidad única de cada aparición se asigna
  // cuando la página completa está dibujada: inlineMarkdown sólo conoce este
  // fragmento y no puede saber cuántas veces se citó la misma nota fuera de él.
  html = html.replace(/\[\^([^\]\s]+)\]/g, (_whole, id: string) =>
    hold(
      `<sup class="fnref"><a class="fnref-link" data-footnote="${quoteAttribute(id)}" ` +
        `href="#fn-${encodeURIComponent(id)}">${id}</a></sup>`,
    ),
  );

  // Referencia a bloque. El identificador no lleva espacios ni paréntesis, de
  // modo que un texto con paréntesis anidados no se confunde con una.
  html = html.replace(/\(\(([^()\s]+)\)\)/g, (whole, id: string) => {
    const target = options.resolveBlock?.(id) ?? null;
    /*
     * El rótulo se escapa, y hasta ahora no.
     *
     * Todo el texto de un bloque pasa por `escapeHtml` al empezar; esto entra
     * después, así que un bloque citado cuyo texto llevara un `<` salía crudo al
     * HTML. Se notaba poco mientras el rótulo era un extracto corto de la propia
     * memoria de uno; con el bloque entero —que es lo que el papel necesita, ver
     * @invariant AQuotedBlockTravelsAsItsWords— deja de notarse poco.
     */
    const label = escapeHtml(target === null ? id : target.excerpt);
    return hold(
      `<a class="block-ref" data-block="${quoteAttribute(id)}" href="#"` +
        `${target === null ? ' data-dangling="true"' : ''}>${label}</a>`,
    );
  });

  /*
   * Una etiqueta es el nombre de una página, y por eso se enlaza.
   *
   * `#casiopea` y `[[Casiopea]]` nombran lo mismo; que uno llevara a su página y
   * el otro fuera texto de adorno hacía que media clasificación del corpus no
   * se pudiera seguir. Se dibujan distinto —la almohadilla sigue a la vista—
   * pero son el mismo enlace y van por el mismo camino.
   *
   * `#[[con espacios]]` va antes que `[[…]]` a secas: si no, el corchete se
   * llevaría el título y dejaría la almohadilla suelta delante del enlace.
   */
  const wikiLink = (title: string, extra = '', label = title): string =>
    `<a class="wiki${extra}${options.pageExists?.(title) === false ? ' pending' : ''}" ` +
    `data-page="${quoteAttribute(title)}" href="#">${decorate(label)}</a>`;

  // La almohadilla se queda dentro del enlace: es lo que distingue a simple
  // vista una clasificación de una mención, y perderla al volverla enlace sería
  // ganar el destino y perder el sentido.
  const tagLink = (title: string): string => wikiLink(title, ' tag', `#${title}`);

  html = html.replace(/#\[\[([^\]]+)\]\]/g, (_whole, title: string) => hold(tagLink(title)));

  html = html.replace(/\[\[([^\]]+)\]\]/g, (whole, inner: string) => {
    const reference = wikiReference(inner);
    return reference === null ? whole : hold(wikiLink(reference.title, '', reference.label));
  });

  html = html.replace(
    /\[([^\]]*)\]\(([^)\n]+?)(?:\s+"[^"]*")?\)/g,
    (whole, label: string, href: string) => {
      // El corpus también enlaza assets sin la marca de imagen —PDF, sobre
      // todo—, y esos apuntan al mismo objeto.
      const resolved = options.resolveAsset?.(href) ?? null;
      if (resolved !== null) {
        return hold(
          `<a class="media-file" href="${quoteAttribute(resolved.url)}" ` +
            `data-media-type="${quoteAttribute(resolved.mediaType)}">${decorate(label)}</a>`,
        );
      }

      /*
       * Un ancla no es una dirección: es un sitio de esta misma página.
       *
       * Y en Vera el fragmento de la dirección ya significa otra cosa —un
       * bloque, ver router.ts—, así que emitirlo tal cual no sólo no llevaba a
       * ninguna parte: el enrutador leía el fragmento como una llegada, volvía a
       * pedir la página al servidor y dejaba un paso en el rastro. Un índice de
       * treinta entradas dejaba treinta veces la misma página.
       *
       * Viaja como los otros enlaces internos de VERA —una referencia a página,
       * una cita de bloque—: sin dirección, con el destino en un atributo, y lo
       * resuelve quien conoce la página entera. @invariant AnchorsReachTheirHeading.
       */
      if (href.startsWith('#') && href.length > 1) {
        return hold(
          `<a class="anchor" data-anchor="${quoteAttribute(escapeHtml(href.slice(1)))}" ` +
            `href="#">${decorate(label)}</a>`,
        );
      }

      const url = safeUrl(href);
      if (url === null) return whole;
      const external = /^https?:/i.test(url);
      const attributes = external ? ' rel="noreferrer" target="_blank"' : '';
      return hold(`<a href="${url}"${attributes}>${decorate(label)}</a>`);
    },
  );

  /*
   * Una URL cruda ya es una dirección completa: no necesita que quien escribe
   * vuelva a envolverla en Markdown para que se pueda seguir. Corre después de
   * las marcas explícitas, que ya quedaron apartadas en SLOT, y por eso nunca
   * enlaza otra vez un href ni una imagen.
   */
  html = html.replace(/https?:\/\/[^\s<>]+/g, (found) => {
    let href = found;
    let tail = '';
    while (/[.,;:!?»”'\]]$/.test(href)) {
      tail = href.slice(-1) + tail;
      href = href.slice(0, -1);
    }
    if (href === '') return found;
    const safe = safeUrl(href);
    return safe === null
      ? found
      : `${hold(`<a href="${safe}" rel="noreferrer" target="_blank">${href}</a>`)}${tail}`;
  });

  html = decorate(html).replace(
    /(^|\s)#([\p{L}\p{N}_-]+)/gu,
    (_whole, before: string, tag: string) => `${before}${tagLink(tag)}`,
  );

  // Un elemento guardado puede contener la marca de otro —una imagen dentro de
  // un enlace—, así que se restituye hasta que no quede ninguna.
  for (let pass = 0; pass < 5 && html.includes(SLOT); pass += 1) {
    html = html.replace(new RegExp(`${SLOT}(\\d+)${SLOT}`, 'g'), (_w, at: string) => held[Number(at)] ?? '');
  }

  return html.replace(/\n/g, '<br>');
}

// --------------------------------------------------------------------------
// Estructura de bloque
// --------------------------------------------------------------------------

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+-]*)\s*$/;

function executableBlock(language: string, source: string, options: RenderOptions): string | null {
  const kind = language.trim().toLowerCase();
  if (kind === 'iframe') return embedIn(source, options.embedHosts ?? []);
  if (kind === 'mediawiki') {
    return `<figure class="mediawiki-figure"><div class="mediawiki-body">${renderMediaWiki(source)}</div><details><summary>fuente MediaWiki</summary><pre><code>${escapeHtml(source)}</code></pre></details></figure>`;
  }
  if (kind !== 'html-live' && kind !== 'p5js' && kind !== 'svg') return null;

  const title = kind === 'p5js' ? 'sketch p5.js' : kind === 'svg' ? 'ilustración SVG' : 'HTML';
  const bridge = `<script nonce="vera-frame">\n${executableFrameBridge()}\n<\/script>`;
  // En SVG sólo corre el puente exacto de Vera. El hash impide que un <script>
  // o un manejador `onload` pegado dentro de la ilustración gane ejecución.
  const scriptPolicy = kind === 'svg'
    ? "'sha256-wgyR5BYfyYZZKEzfArrxKC8eIKqOy4/9tjvjaLir9iA='"
    : "'unsafe-inline'";
  const frame = kind === 'p5js'
    ? `<iframe data-executable-frame sandbox="allow-scripts" referrerpolicy="no-referrer" loading="lazy" title="${title}" src="/p5-frame.html#${encodeURIComponent(source)}"></iframe>`
    : `<iframe sandbox="allow-scripts" referrerpolicy="no-referrer" loading="lazy" title="${title}" srcdoc="${quoteAttribute(escapeHtml([
        '<!doctype html><meta charset="utf-8">',
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${scriptPolicy}; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'">`,
        '<style>:root{color-scheme:light dark;--bg:transparent;--text:currentColor;--rule:currentColor;--accent:currentColor;--font-body:system-ui,sans-serif;--font-ui:system-ui,sans-serif;--font-mono:ui-monospace,monospace}html,body{margin:0;background:var(--bg);color:var(--text);font:var(--text-size,16px)/var(--line-height,1.55) var(--font-body)}*{box-sizing:border-box}svg{display:block;max-width:100%;height:auto}</style>',
        source,
        bridge,
      ].join('\n')))}"></iframe>`;

  const marked = kind === 'p5js' ? frame : frame.replace('<iframe ', '<iframe data-executable-frame ');

  // La fuente queda siempre al alcance: es la salida segura si el recinto no
  // puede ejecutarla y el camino para inspeccionar exactamente qué se escribió.
  return `<figure class="executable executable-${kind}">${marked}<details><summary>fuente ${title}</summary><pre><code>${escapeHtml(source)}</code></pre></details></figure>`;
}

/** Puente mínimo del recinto: recibe apariencia y sólo devuelve su talla. */
function executableFrameBridge(): string {
  return `
const veraFrame = ${JSON.stringify('vera-executable-frame')};
const report = () => parent.postMessage({ type: veraFrame, height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0) }, '*');
addEventListener('message', event => {
  if (event.source !== parent || event.data?.type !== veraFrame) return;
  const appearance = event.data.appearance;
  if (appearance === null || typeof appearance !== 'object') return;
  for (const [name, value] of Object.entries(appearance.tokens ?? {})) {
    if (/^--[a-z0-9-]+$/.test(name) && typeof value === 'string') document.documentElement.style.setProperty(name, value);
  }
  document.documentElement.dataset.scheme = appearance.scheme === 'dark' ? 'dark' : 'light';
  document.documentElement.style.colorScheme = appearance.scheme === 'dark' ? 'dark' : 'light';
  report();
});
new ResizeObserver(report).observe(document.documentElement);
addEventListener('load', report);
document.fonts?.ready.then(report);
report();`;
}
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const FOOTNOTE = /^ {0,3}\[\^([^\]\s]+)\]:\s*(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_DIVIDER = /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/;

interface ListItem {
  indent: number;
  ordered: boolean;
  ordinal?: number;
  text: string;
}

/** Anida por sangría. Una lista dentro de un bloque rara vez pasa de dos niveles. */
function renderList(items: ListItem[], options: RenderOptions): string {
  let html = '';
  // Cada nivel abierto recuerda con qué etiqueta se abrió: una lista ordenada
  // dentro de una con viñetas tiene que cerrar con </ol>, no con </ul>.
  const open: { indent: number; tag: 'ul' | 'ol' }[] = [];
  const top = (): { indent: number; tag: 'ul' | 'ol' } | undefined => open[open.length - 1];

  for (const item of items) {
    while (open.length > 0 && item.indent < (top()?.indent ?? 0)) {
      html += `</li></${open.pop()?.tag}>`;
    }

    const current = top();
    if (current === undefined || item.indent > current.indent) {
      const tag = item.ordered ? 'ol' : 'ul';
      const start = tag === 'ol' && item.ordinal !== undefined && item.ordinal !== 1
        ? ` start="${item.ordinal}"`
        : '';
      html += `<${tag}${start}>`;
      open.push({ indent: item.indent, tag });
    } else if (current.tag !== (item.ordered ? 'ol' : 'ul')) {
      // Cambiar de viñetas a numeración al mismo nivel abre una lista nueva.
      html += `</li></${open.pop()?.tag}>`;
      const tag = item.ordered ? 'ol' : 'ul';
      const start = tag === 'ol' && item.ordinal !== undefined && item.ordinal !== 1
        ? ` start="${item.ordinal}"`
        : '';
      html += `<${tag}${start}>`;
      open.push({ indent: item.indent, tag });
    } else {
      html += '</li>';
    }

    html += `<li>${inlineMarkdown(item.text, options)}`;
  }

  while (open.length > 0) html += `</li></${open.pop()?.tag}>`;
  return html;
}

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/**
 * Renderiza el Markdown de un bloque completo.
 *
 * Devuelve HTML seguro: todo el texto pasa por `escapeHtml` antes de recibir
 * marcado, y ninguna rama emite atributos provenientes del contenido sin
 * escaparlos.
 */
export function renderMarkdown(source: string, options: RenderOptions = {}): string {
  /*
   * Un poema no es HTML arbitrario: es una marca editorial estrecha y segura.
   *
   * Sólo se reconoce cuando envuelve el bloque entero y no lleva atributos.
   * El interior vuelve a pasar por este mismo renderizador, por lo que conserva
   * Markdown y las mismas fronteras de seguridad del resto del corpus. Cualquier
   * variante como `<poem class=...>` sigue viéndose como fuente, en vez de abrir
   * una puerta lateral al HTML activo.
   */
  const poem = /^\s*<poem>([\s\S]*?)<\/poem>\s*$/i.exec(source);
  if (poem !== null) {
    // Como en `<pre>`, el primer salto que sólo separa la etiqueta del texto no
    // forma parte de éste. Todo lo demás —espacios, blancos y sangrías— sí.
    const text = (poem[1] ?? '').replace(/^\r?\n/, '').replace(/\r?\n$/, '');
    return `<div class="poem">${inlineMarkdown(text, options)}</div>`;
  }

  // Un bloque que es una incrustación entera se presenta como tal y no como su
  // marcado. Ver `embedIn` y specs/executable-content-sandbox.allium.
  const embed = embedIn(source, options.embedHosts ?? []);
  if (embed !== null) return embed;

  const resource = linkedResourceIn(source);
  if (resource !== null) return resource;

  const lines = source.split('\n');
  let html = '';
  let at = 0;

  const flushParagraph = (buffer: string[]): void => {
    if (buffer.length === 0) return;
    html += `<p>${inlineMarkdown(buffer.join('\n'), options)}</p>`;
    buffer.length = 0;
  };

  const paragraph: string[] = [];

  while (at < lines.length) {
    const line = lines[at] ?? '';

    // Código cercado. Su contenido se escapa y no recibe marcado en línea: un
    // ejemplo de código tiene que verse tal como se escribió.
    const fence = FENCE.exec(line);
    if (fence !== null) {
      flushParagraph(paragraph);
      const marker = fence[1] ?? '```';
      const language = fence[2] ?? '';
      const body: string[] = [];
      at += 1;
      while (at < lines.length) {
        const current = lines[at] ?? '';
        const closing = FENCE.exec(current);
        if (closing !== null && (closing[1] ?? '').startsWith(marker[0] ?? '`')) {
          at += 1;
          break;
        }
        body.push(current);
        at += 1;
      }
      /*
       * Una valla que dice `dibujo` no es código: es lo dibujado a mano.
       *
       * Sus trazos son el texto del bloque —ver drawing.ts y
       * specs/hand-drawing.allium— y aquí se vuelven la figura. Sin color:
       * `currentColor` toma la tinta del texto de la página y no hay fondo, así
       * que un dibujo hecho de día se lee de noche.
       *
       * Lo que no se pueda leer como dibujo cae al caso de abajo y se presenta
       * como el bloque de código que es. @invariant
       * WhatCannotBeReadAsADrawingIsReadAsText: un dibujo roto no se arregla
       * solo ni se vacía; se ve lo que hay.
       */
      if (/^dibujo$/i.test(language.trim())) {
        const drawn = drawingSvg(readDrawing(['```dibujo', ...body, '```'].join('\n')));
        if (drawn !== null) {
          html += `<figure class="drawn">${drawn.svg}</figure>`;
          continue;
        }
      }

      const executable = executableBlock(language, body.join('\n'), options);
      if (executable !== null) {
        html += executable;
        continue;
      }

      // El lenguaje viene de la línea cruda, así que aquí sí hay que escapar
      // todo: `quoteAttribute` sólo completa lo que `escapeHtml` ya hizo.
      const attribute =
        language === '' ? '' : ` class="language-${quoteAttribute(escapeHtml(language))}"`;
      html += `<pre><code${attribute}>${escapeHtml(body.join('\n'))}</code></pre>`;
      continue;
    }

    if (line.trim() === '') {
      flushParagraph(paragraph);
      at += 1;
      continue;
    }

    if (RULE.test(line)) {
      flushParagraph(paragraph);
      html += '<hr>';
      at += 1;
      continue;
    }

    // El título de la página ya es el h1 del documento, así que un `#` de bloque
    // entra un nivel más abajo y el esquema de encabezados no queda con dos h1.
    const heading = HEADING.exec(line);
    if (heading !== null) {
      flushParagraph(paragraph);
      const level = Math.min(6, (heading[1] ?? '#').length + 1);
      html += `<h${level}>${inlineMarkdown(heading[2] ?? '', options)}</h${level}>`;
      at += 1;
      continue;
    }

    const footnote = FOOTNOTE.exec(line);
    if (footnote !== null) {
      flushParagraph(paragraph);
      const id = footnote[1] ?? '';
      html +=
        `<div class="footnote" id="fn-${encodeURIComponent(id)}" data-footnote="${quoteAttribute(id)}">` +
        `<span class="footnote-id">${escapeHtml(id)}</span>` +
        `<span class="footnote-body">${inlineMarkdown(footnote[2] ?? '', options)}` +
        `<a class="footnote-back" data-footnote-back="${quoteAttribute(id)}" ` +
        `href="#fnref-${encodeURIComponent(id)}" aria-label="volver a la referencia ${quoteAttribute(id)}">↩</a>` +
        `</span></div>`;
      at += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      flushParagraph(paragraph);
      const body: string[] = [];
      while (at < lines.length) {
        const quoted = QUOTE.exec(lines[at] ?? '');
        if (quoted === null) break;
        body.push(quoted[1] ?? '');
        at += 1;
      }
      html += `<blockquote>${inlineMarkdown(body.join('\n'), options)}</blockquote>`;
      continue;
    }

    // Tabla: exige la fila separadora, para no confundir con un texto que
    // simplemente contiene barras verticales.
    if (TABLE_ROW.test(line) && TABLE_DIVIDER.test(lines[at + 1] ?? '')) {
      flushParagraph(paragraph);
      const head = cells(line);
      at += 2;
      const body: string[][] = [];
      while (at < lines.length && TABLE_ROW.test(lines[at] ?? '')) {
        body.push(cells(lines[at] ?? ''));
        at += 1;
      }
      const headRow = head.map((cell) => `<th>${inlineMarkdown(cell, options)}</th>`).join('');
      const rows = body
        .map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell, options)}</td>`).join('')}</tr>`)
        .join('');
      html += `<div class="table-scroll"><table><thead><tr>${headRow}</tr></thead><tbody>${rows}</tbody></table></div>`;
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      flushParagraph(paragraph);
      const items: ListItem[] = [];
      while (at < lines.length) {
        const current = lines[at] ?? '';
        if (current.trim() === '') {
          let next = at + 1;
          while (next < lines.length && (lines[next] ?? '').trim() === '') next += 1;
          if (!BULLET.test(lines[next] ?? '') && !ORDERED.test(lines[next] ?? '')) break;
          // Una línea vacía afloja la lista; no la termina si después continúa
          // otra marca. Vera no envuelve aún cada ítem suelto en <p>, pero sí
          // conserva la continuidad y, con ella, la numeración del <ol>.
          at = next;
          continue;
        }
        const bullet = BULLET.exec(current);
        const ordered = ORDERED.exec(current);
        if (bullet === null && ordered === null) break;
        items.push({
          indent: ((ordered ?? bullet)?.[1] ?? '').length,
          ordered: ordered !== null,
          ...(ordered === null ? {} : { ordinal: Number(ordered[2] ?? '1') }),
          text: ordered === null ? (bullet?.[2] ?? '') : (ordered[3] ?? ''),
        });
        at += 1;
      }
      html += renderList(items, options);
      continue;
    }

    paragraph.push(line);
    at += 1;
  }

  flushParagraph(paragraph);
  return html;
}
