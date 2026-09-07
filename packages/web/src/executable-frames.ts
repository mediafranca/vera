// Recintos de HTML, p5.js y SVG escritos deliberadamente.
//
// El iframe no puede leer VERA: sólo recibe una copia de los valores visuales
// y sólo puede responder con la altura que necesita. El origen opaco impuesto
// por `sandbox` mantiene esa frontera incluso cuando la fuente ejecuta scripts.

import { icon } from './icons.ts';

const MESSAGE = 'vera-executable-frame';
const MIN_HEIGHT = 24;
const MAX_HEIGHT = 2400;

function frames(): HTMLIFrameElement[] {
  return [...document.querySelectorAll<HTMLIFrameElement>('iframe[data-executable-frame]')];
}

function appearance(): { scheme: 'light' | 'dark'; tokens: Record<string, string> } {
  const root = document.documentElement;
  const computed = getComputedStyle(root);
  const tokens: Record<string, string> = {};
  for (const name of [
    '--bg', '--bg-raised', '--text', '--text-dim', '--rule', '--accent',
    '--text-size', '--line-height', '--font-body', '--font-ui', '--font-mono',
  ]) tokens[name] = computed.getPropertyValue(name).trim();
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
  }, '*');
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
  for (const frame of frames()) send(frame);
}

addEventListener('vera-sync-executable-frames', syncExecutableFrames);

addEventListener('message', (event: MessageEvent<unknown>) => {
  const data = event.data as { type?: unknown; height?: unknown } | null;
  if (data?.type !== MESSAGE) return;
  const frame = frames().find((one) => one.contentWindow === event.source);
  if (frame === undefined) return;
  const asked = typeof data.height === 'number' && Number.isFinite(data.height) ? data.height : MIN_HEIGHT;
  frame.style.height = `${Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(asked)))}px`;
  send(frame);
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
