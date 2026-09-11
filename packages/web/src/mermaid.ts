// Presentación de diagramas Mermaid.
//
// @invariant NativePresentation: un diagrama se lee dentro de la página, sin
// exportarlo a otra aplicación.
//
// @invariant ExecutableContentIsolation: Mermaid se ejecuta en modo `sandbox`,
// que dibuja dentro de un iframe aislado. Un diagrama no puede alcanzar el
// grafo ni lo que el documento tenga: recibe su texto y nada más.
//
// @invariant SourceFidelity: el bloque sigue guardando su cercado ```mermaid.
// Esto reemplaza lo que se muestra, nunca lo que se guarda, así que al editar
// reaparece la fuente tal como se escribió.
//
import { codeCopyButton } from './code-copy.ts';

// La biblioteca pesa más que todo el resto de la aplicación junta, así que se
// carga sólo cuando una página trae un diagrama, y una sola vez por sesión.

type MermaidModule = typeof import('mermaid');

let loading: Promise<MermaidModule['default']> | null = null;

/**
 * Mermaid trae grises propios que no conocen la paleta de Vera. En particular,
 * varios tipos de diagrama usan `secondaryTextColor` y `tertiaryTextColor` en
 * vez de `textColor`; dejarlos en sus valores implícitos produce letras grises
 * sobre nodos grises. La paleta se declara completa para que texto, nodos,
 * grupos, notas y etiquetas de arista conserven contraste en ambos esquemas.
 */
export function mermaidTheme(dark: boolean) {
  const text = dark ? '#f4f1eb' : '#171513';
  const muted = dark ? '#ddd7ce' : '#302c28';
  const surface = dark ? '#292724' : '#fffdfa';
  const raised = dark ? '#38342f' : '#f1ece4';
  const accent = dark ? '#9fc7ff' : '#245b9e';
  const rule = dark ? '#aaa096' : '#756b62';

  return {
    theme: 'base' as const,
    themeVariables: {
      background: surface,
      mainBkg: surface,
      primaryColor: surface,
      primaryTextColor: text,
      primaryBorderColor: rule,
      secondaryColor: raised,
      secondaryTextColor: text,
      secondaryBorderColor: rule,
      tertiaryColor: dark ? '#202a35' : '#e8f1fb',
      tertiaryTextColor: text,
      tertiaryBorderColor: accent,
      textColor: text,
      lineColor: rule,
      nodeBorder: rule,
      clusterBkg: raised,
      clusterBorder: rule,
      titleColor: text,
      edgeLabelBackground: surface,
      labelTextColor: text,
      actorTextColor: text,
      actorBorder: rule,
      actorBkg: surface,
      signalTextColor: text,
      noteTextColor: text,
      noteBkgColor: raised,
      noteBorderColor: rule,
      loopTextColor: muted,
      activationTextColor: text,
    },
  };
}

async function mermaidFor(dark: boolean): Promise<MermaidModule['default']> {
  if (loading === null) {
    loading = import('mermaid').then((module) => module.default);
  }
  const mermaid = await loading;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'sandbox',
    ...mermaidTheme(dark),
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-ui') || 'sans-serif',
  });
  return mermaid;
}

/** Un identificador por diagrama: Mermaid lo exige y tiene que ser único. */
let counter = 0;

/**
 * Sustituye cada bloque de código mermaid por su diagrama.
 *
 * Un diagrama que no compila deja su fuente a la vista con el error al lado.
 * Ocultar la fuente sería perder lo único que permite arreglarlo.
 */
export async function renderMermaid(root: HTMLElement): Promise<void> {
  const blocks = [...root.querySelectorAll('code.language-mermaid')];
  // El esquema lo declara el documento, así que no hace falta pasarlo por cada
  // capa de la interfaz hasta aquí.
  const dark = document.documentElement.dataset['scheme'] === 'dark';
  if (blocks.length === 0) return;

  let mermaid: MermaidModule['default'];
  try {
    mermaid = await mermaidFor(dark);
  } catch {
    // Sin la biblioteca el bloque se queda como código, que es lo que ya era.
    return;
  }

  for (const block of blocks) {
    const source = block.textContent ?? '';
    const pre = block.closest('pre');
    if (pre === null || source.trim() === '') continue;

    counter += 1;
    const figure = document.createElement('div');
    figure.className = 'mermaid-figure';

    try {
      const { svg } = await mermaid.render(`vera-mermaid-${counter}`, source);
      figure.innerHTML = svg;
      figure.append(codeCopyButton(source));
      pre.replaceWith(figure);
      fitFrame(figure);
    } catch (error) {
      // El cercado se conserva; sólo se añade por qué no se pudo dibujar.
      const note = document.createElement('p');
      note.className = 'mermaid-error';
      note.textContent =
        error instanceof Error ? `no se pudo dibujar: ${error.message}` : 'no se pudo dibujar';
      pre.after(note);
    }
  }
}

const scheduled = new WeakSet<HTMLElement>();
const activeRoots = new Map<HTMLElement, Set<IntersectionObserver>>();
let lifecycle: MutationObserver | null = null;

function watchProgressiveRoots(): void {
  if (lifecycle !== null) return;
  lifecycle = new MutationObserver(() => {
    for (const [root, observers] of activeRoots) {
      if (root.isConnected) continue;
      for (const observer of observers) observer.disconnect();
      activeRoots.delete(root);
    }
    if (activeRoots.size === 0) {
      lifecycle?.disconnect();
      lifecycle = null;
    }
  });
  lifecycle.observe(document.body, { childList: true, subtree: true });
}

/**
 * Hidrata diagramas cerca de la lectura sin retener detrás de ellos el texto.
 * Puede llamarse después de cada lote: cada cercado se registra una sola vez.
 */
export function renderMermaidProgressively(root: HTMLElement): void {
  const blocks = [...root.querySelectorAll<HTMLElement>('code.language-mermaid')]
    .filter((block) => !scheduled.has(block));
  if (blocks.length === 0) return;

  let remaining = blocks.length;
  const finished = (): void => {
    remaining -= 1;
    if (remaining > 0 || observer === null) return;
    observer.disconnect();
    const observers = activeRoots.get(root);
    observers?.delete(observer);
    if (observers?.size === 0) activeRoots.delete(root);
  };
  const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer?.unobserve(entry.target);
      void hydrate(entry.target as HTMLElement).finally(finished);
    }
  }, { root: root.closest('#text'), rootMargin: '700px 0px' });
  if (observer !== null) {
    const observers = activeRoots.get(root) ?? new Set<IntersectionObserver>();
    observers.add(observer);
    activeRoots.set(root, observers);
    watchProgressiveRoots();
  }

  const hydrate = async (block: HTMLElement): Promise<void> => {
    if (!block.isConnected) return;
    const row = block.closest<HTMLElement>('.block');
    const scroller = root.closest<HTMLElement>('#text');
    const scrollerTop = scroller?.getBoundingClientRect().top ?? 0;
    const beforeTop = row?.getBoundingClientRect().top ?? 0;
    const beforeHeight = row?.getBoundingClientRect().height ?? 0;
    await renderMermaid(block.closest('pre') ?? block);
    row?.classList.remove('rich-pending');
    if (row?.classList.contains('rich-native-pending') !== true) row?.removeAttribute('aria-busy');
    // Si algo que ya quedó sobre la lectura cambia de alto, compensarlo en el
    // recinto y conservar el renglón que la persona tenía bajo los ojos.
    if (row !== null && scroller !== null && beforeTop < scrollerTop) {
      scroller.scrollTop += row.getBoundingClientRect().height - beforeHeight;
    }
  };

  for (const block of blocks) {
    scheduled.add(block);
    const row = block.closest<HTMLElement>('.block');
    row?.classList.add('rich-pending');
    row?.setAttribute('aria-busy', 'true');
    if (observer === null) {
      window.setTimeout(() => void hydrate(block).finally(finished), 0);
    } else {
      observer.observe(block);
    }
  }
}

/**
 * Ajusta el dibujo al ancho de la columna, guardando su proporción.
 *
 * En modo `sandbox` Mermaid dibuja dentro de un iframe al que le pone el ancho de
 * la columna y el alto del SVG **a su tamaño natural**. Las dos medidas juntas no
 * describen ninguna figura: el SVG lleva `max-width: 100%`, así que dentro del
 * marco se encoge para caber a lo ancho, y el marco conserva el alto de antes de
 * encogerlo. Lo que queda es un hueco en blanco debajo del diagrama, exactamente
 * del tamaño de lo que se encogió — y por eso parecía que la figura conservaba el
 * alto del bloque de código del que salió.
 *
 * El arreglo es dar al marco las dos medidas del mismo dibujo, y no una de cada
 * uno: el ancho que quepa, y el alto que a ese ancho le corresponde. Una figura
 * ancha se ve entera y pequeña, que es lo que «ajustar al ancho» quiere decir.
 *
 * Se probó antes lo contrario —tamaño natural y desplazamiento lateral, para que
 * un diagrama ancho se leyera a su tamaño— y se descartó: un dibujo que hay que
 * arrastrar para ver deja de ser una figura y pasa a ser un documento dentro del
 * documento, y en una columna de texto eso interrumpe la lectura cada vez. Lo que
 * un diagrama tiene que decir en el sitio donde está es su forma; el detalle se
 * mira ampliando, que es un gesto aparte y del lector.
 *
 * Sólo se encoge, nunca se agranda: por encima de su ancho natural el factor es
 * uno, así que un dibujo pequeño no se estira para llenar la columna.
 *
 * Y se recalcula mientras la figura exista, porque el ancho se mueve —arrastrar
 * el divisor, cambiar de ventana— y el factor depende del ancho. El observador
 * muere con ella: no hay nada que desconectar a mano.
 *
 * Si no se puede averiguar el tamaño natural no se toca nada: la medida de Mermaid
 * es imperfecta y ninguna medida es peor.
 */
function fitFrame(figure: HTMLElement): void {
  const frame = figure.querySelector('iframe');
  if (frame === null) return;

  const natural = naturalSize(frame.getAttribute('src') ?? '');
  if (natural === null) return;

  /*
   * El sitio lo dice la figura y no el marco: el marco es justamente lo que se
   * está midiendo, y preguntarle su ancho después de habérselo fijado devolvería
   * lo que uno mismo puso.
   */
  let applied = -1;
  const fit = (): void => {
    const room = figure.clientWidth;
    if (room <= 0 || room === applied) return;
    applied = room;
    const scale = Math.min(1, room / natural.width);
    frame.style.width = `${Math.floor(natural.width * scale)}px`;
    frame.style.height = `${Math.ceil(natural.height * scale)}px`;
  };

  fit();
  new ResizeObserver(fit).observe(figure);
}

/** Cuánto mide el dibujo antes de que nadie lo encoja, leído de su `viewBox`. */
function naturalSize(src: string): { width: number; height: number } | null {
  const comma = src.indexOf(',');
  if (!src.startsWith('data:') || comma === -1) return null;
  let html: string;
  try {
    html = src.slice(0, comma).includes(';base64')
      ? atob(src.slice(comma + 1))
      : decodeURIComponent(src.slice(comma + 1));
  } catch {
    return null;
  }
  const box = /viewBox="\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)/.exec(html);
  if (box === null) return null;
  const width = Number(box[1]);
  const height = Number(box[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}
