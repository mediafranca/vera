// Recintos de HTML, p5.js y SVG escritos deliberadamente.
//
// El iframe no puede leer VERA: sólo recibe una copia de los valores visuales
// y sólo puede responder con la altura que necesita. El origen opaco impuesto
// por `sandbox` mantiene esa frontera incluso cuando la fuente ejecuta scripts.

import { icon } from './icons.ts';
import { DEFAULT_TOKENS } from './tokens.ts';

const MESSAGE = 'vera-executable-frame';
const MAP_APPEARANCE = 'vera-embedded-map-appearance';
const MIN_HEIGHT = 24;
const MAX_HEIGHT = 2400;

function frames(): HTMLIFrameElement[] {
  return [...document.querySelectorAll<HTMLIFrameElement>('iframe[data-executable-frame]')];
}

function appearance(): { scheme: 'light' | 'dark'; tokens: Record<string, string> } {
  const root = document.documentElement;
  const computed = getComputedStyle(root);
  const tokens: Record<string, string> = {};
  for (const { name } of DEFAULT_TOKENS) tokens[name] = computed.getPropertyValue(name).trim();
  return { scheme: root.dataset['scheme'] === 'dark' ? 'dark' : 'light', tokens };
}

function send(frame: HTMLIFrameElement): void {
  const slide = frame.closest<HTMLElement>('.vera-presentation .slides section:not(.stack)');
  frame.contentWindow?.postMessage({
    type: MESSAGE,
    appearance: appearance(),
    // Fuera del presentador un recinto visible conserva su comportamiento. En
    // una presentación sólo anima el de la lámina actual; los demás conservan
    // su último cuadro como miniatura sin quemar Safari por detrás.
    active: slide === null || slide.classList.contains('present'),
    // En presentación el recinto ya ocupa el escenario. El documento interior
    // recibe esa diferencia para poder escalar canvas y SVG al viewport, en vez
    // de conservar el tamaño editorial de la página ordinaria.
    presentation: slide !== null,
  }, '*');
}

const wiredMaps = new WeakSet<HTMLIFrameElement>();

function sendMapAppearance(frame: HTMLIFrameElement): void {
  frame.contentWindow?.postMessage({ type: MAP_APPEARANCE, appearance: appearance() }, location.origin);
}

function wireEmbeddedMaps(root: ParentNode = document): void {
  const nested = [...root.querySelectorAll<HTMLIFrameElement>('.embedded-map iframe')];
  const direct = root instanceof HTMLIFrameElement && root.matches('.embedded-map iframe') ? [root] : [];
  for (const frame of [...direct, ...nested]) {
    if (!wiredMaps.has(frame)) {
      wiredMaps.add(frame);
      frame.addEventListener('load', () => sendMapAppearance(frame));
    }
    sendMapAppearance(frame);
  }
}

let maximized: { figure: HTMLElement; frame: HTMLIFrameElement; button: HTMLButtonElement; overlay: HTMLElement } | null = null;

function setMaximized(figure: HTMLElement, button: HTMLButtonElement, maximize: boolean): void {
  if (maximize) {
    if (maximized !== null) setMaximized(maximized.figure, maximized.button, false);
    const frame = figure.querySelector<HTMLIFrameElement>('iframe[data-executable-frame]');
    if (frame === null) return;
    const overlay = document.createElement('div');
    overlay.className = 'executable-maximized';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'HTML maximizado');
    figure.classList.add('has-maximized-frame');
    overlay.append(frame, button);
    document.body.append(overlay);
    maximized = { figure, frame, button, overlay };
  } else if (maximized?.figure === figure) {
    const details = figure.querySelector('details');
    figure.insertBefore(maximized.frame, details);
    figure.append(maximized.button);
    maximized.overlay.remove();
    figure.classList.remove('has-maximized-frame');
    maximized = null;
  }
  document.documentElement.classList.toggle('has-maximized-executable', maximized !== null);
  button.innerHTML = icon(maximize ? 'arrows-minimize' : 'arrows-maximize');
  button.title = maximize ? 'minimizar HTML' : 'maximizar HTML';
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-pressed', String(maximize));
  if (maximize) button.focus({ preventScroll: true });
}

function wireHtmlControls(root: ParentNode = document): void {
  for (const figure of root.querySelectorAll<HTMLElement>('.executable-html-live')) {
    if (figure.querySelector('.executable-size-toggle') !== null || figure.classList.contains('has-maximized-frame')) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'executable-size-toggle';
    setMaximized(figure, button, false);
    button.addEventListener('click', () => {
      setMaximized(figure, button, maximized?.figure !== figure);
    });
    figure.append(button);
  }
}

export function syncExecutableFrames(): void {
  wireHtmlControls();
  wireEmbeddedMaps();
  for (const frame of frames()) send(frame);
}

addEventListener('vera-sync-executable-frames', syncExecutableFrames);

addEventListener('message', (event: MessageEvent<unknown>) => {
  const data = event.data as { type?: unknown; height?: unknown } | null;
  if (data?.type !== MESSAGE) return;
  const frame = frames().find((one) => one.contentWindow === event.source);
  if (frame === undefined) return;
  const asked = typeof data.height === 'number' && Number.isFinite(data.height) ? data.height : MIN_HEIGHT;
  const fillsAvailableHeight = frame.closest('.executable-window-height') !== null;
  const minimum = fillsAvailableHeight ? Math.max(640, window.innerHeight) : MIN_HEIGHT;
  frame.style.height = `${Math.min(MAX_HEIGHT, Math.max(minimum, Math.ceil(asked)))}px`;
  send(frame);
});

addEventListener('resize', () => {
  for (const frame of frames()) {
    if (frame.closest('.executable-window-height') !== null) send(frame);
  }
});

// Los tokens y el esquema viven como atributos de la raíz. Observarlos hace
// que una edición de apariencia llegue a los recintos ya visibles sin recargar.
new MutationObserver(syncExecutableFrames).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['style', 'data-scheme'],
});

new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.matches('.executable-html-live')) wireHtmlControls(node.parentNode ?? document);
      else wireHtmlControls(node);
      wireEmbeddedMaps(node.matches('.embedded-map') ? node.parentNode ?? document : node);
    }
  }
}).observe(document.body, { childList: true, subtree: true });

addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (maximized !== null) {
    const { figure, button } = maximized;
    setMaximized(figure, button, false);
    button.focus();
  }
});
