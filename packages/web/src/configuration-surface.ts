// Gramática común para las proyecciones administrativas de Vera.
//
// Estas superficies no son páginas del corpus: carecen de una página focal y,
// por ello, no muestran un mapa sin ancla. Sí comparten una estructura legible
// y nombran la relación de cada campo con el estado operativo.

export type ConfigurationFieldState = 'effective' | 'derived' | 'pending';

const STATE_LABELS: Record<ConfigurationFieldState, string> = {
  effective: 'Efectivo',
  derived: 'Derivado',
  pending: 'Pendiente',
};

export interface ConfigurationSurfaceOptions {
  title: string;
  introduction: string;
  className?: string;
}

export interface ConfigurationSurface {
  root: HTMLElement;
  title: HTMLHeadingElement;
  introduction: HTMLParagraphElement;
  body: HTMLDivElement;
}

export function configurationState(state: ConfigurationFieldState): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = 'configuration-field-state';
  badge.dataset['state'] = state;
  badge.textContent = STATE_LABELS[state];
  return badge;
}

export function configurationField(
  label: string,
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  state: ConfigurationFieldState = 'effective',
  note?: string,
): HTMLLabelElement {
  const field = document.createElement('label');
  field.className = 'configuration-field';
  const heading = document.createElement('span');
  heading.className = 'configuration-field-heading';
  const name = document.createElement('span'); name.textContent = label;
  heading.append(name, configurationState(state));
  field.append(heading, control);
  if (note !== undefined) {
    const explanation = document.createElement('small'); explanation.textContent = note;
    field.append(explanation);
  }
  return field;
}

export function createConfigurationSurface(
  host: HTMLElement,
  options: ConfigurationSurfaceOptions,
): ConfigurationSurface {
  host.replaceChildren();
  const root = document.createElement('article');
  root.className = ['configuration-surface', options.className].filter(Boolean).join(' ');
  const header = document.createElement('header'); header.className = 'configuration-surface-header';
  const heading = document.createElement('div');
  const kind = document.createElement('p'); kind.className = 'configuration-surface-kind';
  kind.textContent = 'Administración operativa';
  const title = document.createElement('h1'); title.className = 'page-title'; title.textContent = options.title;
  heading.append(kind, title);
  const back = document.createElement('button'); back.type = 'button'; back.className = 'configuration-surface-back';
  back.textContent = '← Volver'; back.addEventListener('click', () => window.history.back());
  header.append(heading, back);
  const introduction = document.createElement('p'); introduction.className = 'configuration-surface-introduction';
  introduction.textContent = options.introduction;
  const boundary = document.createElement('p'); boundary.className = 'configuration-surface-boundary';
  boundary.textContent = 'Esta vista administra estado operativo. Las páginas del corpus conservan su mapa, procedencia e historia.';
  const body = document.createElement('div'); body.className = 'configuration-surface-body';
  root.append(header, introduction, boundary, body); host.append(root);
  return { root, title, introduction, body };
}
