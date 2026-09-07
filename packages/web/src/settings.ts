// La configuración de Vera.
//
// Dos secciones por ahora: las teclas y la apariencia. Las teclas se leen de
// bindings.ts, que es de donde el editor también las lee, así que esta página
// no puede enseñar un atajo que ya no exista.
//
// @guarantee EditableDesignSystem: los tokens siguen siendo fuente legible y
// editable desde dentro de Vera. Lo que cambia es el control: un color se elige
// con un selector de color y una tipografía de una lista, en vez de escribir el
// valor a ciegas en un campo de texto.

import { BINDINGS, GESTURES, TRIGGERS } from './bindings.ts';
import { COMMANDS } from './autocomplete.ts';
import { api, type CatalogAsset, type PageSummary, type PublicationSiteView } from './api.ts';
import { icon } from './icons.ts';
import { openMediaDetails } from './media-dialog.ts';
import {
  DEFAULT_TOKENS,
  FONT_STACKS,
  kindOf,
  type ColourScheme,
  type DesignToken,
} from './tokens.ts';

export type Section = 'memoria' | 'archivos' | 'teclado' | 'apariencia';

export interface SettingsHandlers {
  scheme(): ColourScheme;
  /** Cambiar entre el esquema claro y el oscuro. */
  onScheme(next: ColourScheme): void;
  onTokenChange(token: DesignToken, value: string): void;
  onReset(): void;
  onClose(): void;
  onOpenFiles(): void;
  onOpenSharing(): void;
  /**
   * Dibuja el estado del corpus y su índice.
   *
   * Lo pone quien tiene los datos —main.ts, que ya los pide al servidor— en vez
   * de que esta página los pida por su cuenta: abrir los ajustes no debería
   * costar una petición más.
   */
  drawMemory?(host: HTMLElement): void;
}

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'memoria', label: 'Memoria' },
  { id: 'archivos', label: 'Archivos' },
  { id: 'teclado', label: 'Teclado' },
  { id: 'apariencia', label: 'Apariencia' },
];

const GROUPS: { id: string; label: string; note?: string }[] = [
  { id: 'navegación', label: 'Navegación', note: 'Valen en cualquier momento.' },
  { id: 'estructura', label: 'Estructura del esquema', note: 'Editando un bloque.' },
  { id: 'edición', label: 'Edición', note: 'Editando un bloque.' },
  { id: 'autocompletado', label: 'Autocompletado', note: 'Con la lista de sugerencias abierta.' },
];

/** Un nombre legible para un token, sin obligar a leer la variable CSS. */
const LABELS: Record<string, string> = {
  '--bg': 'fondo',
  '--bg-raised': 'fondo elevado',
  '--text': 'texto',
  '--text-dim': 'texto atenuado',
  '--rule': 'líneas y bordes',
  '--accent': 'acento',
  '--node-central': 'nodo central del grafo',
  '--node-fill': 'nodos del grafo',
  '--link-stroke': 'aristas del grafo',
  '--warm': 'énfasis cálido',
  '--line-height': 'interlínea',
  '--text-size': 'tamaño del texto',
  '--indent': 'sangría por nivel',
  '--phone-scale': 'tamaño en el teléfono',
  '--content-width': 'ancho de la columna',
  '--font-body': 'texto de lectura',
  '--font-ui': 'interfaz',
  '--font-mono': 'Markdown y código',
};

export function renderSettings(
  host: HTMLElement,
  tokens: DesignToken[],
  active: Section,
  handlers: SettingsHandlers,
): void {
  host.innerHTML = '';
  host.hidden = false;

  const head = document.createElement('header');
  head.className = 'settings-head';

  const title = document.createElement('h2');
  title.textContent = 'Configuración';
  head.append(title);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'settings-close';
  close.setAttribute('aria-label', 'Cerrar');
  close.title = 'Cerrar';
  close.innerHTML = icon('x');
  close.addEventListener('click', () => handlers.onClose());
  head.append(close);
  host.append(head);

  if (active !== 'apariencia' || !document.documentElement.dataset['access']?.includes('anybody')) {
    const sharing = document.createElement('button');
    sharing.type = 'button';
    sharing.className = 'settings-destination';
    const sharingName = document.createElement('strong');
    sharingName.textContent = 'Espacios compartidos';
    const sharingNote = document.createElement('span');
    sharingNote.textContent = 'Administrar páginas, participantes e invitaciones';
    sharing.append(sharingName, sharingNote);
    sharing.addEventListener('click', handlers.onOpenSharing);
    host.append(sharing);
  }

  const tabs = document.createElement('nav');
  tabs.className = 'settings-tabs';
  for (const section of SECTIONS) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = section.id === active ? 'settings-tab selected' : 'settings-tab';
    tab.textContent = section.label;
    tab.setAttribute('aria-pressed', String(section.id === active));
    tab.addEventListener('click', () => renderSettings(host, tokens, section.id, handlers));
    tabs.append(tab);
  }
  host.append(tabs);

  const body = document.createElement('div');
  body.className = 'settings-body';
  host.append(body);

  if (active === 'memoria') drawMemory(body, handlers);
  else if (active === 'archivos') void drawFilesSummary(body, handlers);
  else if (active === 'teclado') drawKeyboard(body);
  else drawAppearance(body, tokens, handlers);
}

type SharedPermission = 'read' | 'contribute' | 'edit';
const invitationUrlKey = (id: string): string => `vera-invitation-url:${id}`;
const rememberInvitationUrl = (id: string, url: string): void => {
  try { localStorage.setItem(invitationUrlKey(id), url); } catch { /* La invitación sigue sirviendo; sólo no se recuerda aquí. */ }
};
const rememberedInvitationUrl = (id: string): string | null => {
  try { return localStorage.getItem(invitationUrlKey(id)); } catch { return null; }
};
const forgetInvitationUrl = (id: string): void => {
  try { localStorage.removeItem(invitationUrlKey(id)); } catch { /* Nada que impedir. */ }
};
interface SharedAdministration {
  id: string; name: string; slug: string; selectorKey: string; selectorValue: string;
  criterionCombination: 'any' | 'all';
  criteria: { id: string; key: string; value: string; status: 'active' | 'removed' }[];
  manualPages: string[];
  audience: 'restricted' | 'anybody';
  status: 'active' | 'withdrawn'; pageCount: number;
  effectivePages: { page: string; reasons: string[] }[];
  invitations: { id: string; permissions: SharedPermission[]; intendedContact: string | null;
    status: 'pending' | 'redeemed' | 'revoked' | 'expired'; issuedAt: number; expiresAt: number }[];
  participants: { grant: string; participant: string; name: string; permissions: SharedPermission[];
    status: 'active' | 'revoked'; grantedAt: number; authenticators: number; activeSessions: number }[];
  proposals: { id: string; page: string; author: string; authorName: string; originId: string;
    channel: 'typed_text' | 'drawn' | 'walked'; change: Record<string, unknown>;
    status: 'awaiting_review' | 'accepted' | 'rejected';
    proposedAt: number; reviewedBy: string | null; reviewedAt: number | null }[];
}

async function sharingRequest(path: string, method = 'GET', body?: unknown): Promise<any> {
  const response = await fetch(path, { method, headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
  return value;
}

const field = (label: string, value: string, placeholder = ''): { label: HTMLLabelElement; input: HTMLInputElement } => {
  const held = document.createElement('label'); held.className = 'sharing-field';
  const name = document.createElement('span'); name.textContent = label;
  const input = document.createElement('input'); input.value = value; input.placeholder = placeholder;
  held.append(name, input); return { label: held, input };
};

/**
 * Dibuja la administración canónica de todas las formas de compartir.
 *
 * La exportamos porque `VERA:Publicación` y Configuración → Compartir son dos
 * puertas hacia la misma decisión. Mantener dos paneles fue precisamente lo
 * que permitió que la página especial siguiera enseñando sólo el sitio público.
 */
export async function drawSharing(host: HTMLElement): Promise<void> {
  host.innerHTML = '';
  const intro = document.createElement('p'); intro.className = 'settings-note';
  intro.textContent = 'Cada espacio comparte exactamente las páginas que cumplen un criterio de propiedad. Las invitaciones son de un solo uso, tienen duración elegible y pueden revocarse mientras estén pendientes.';
  const status = document.createElement('p'); status.className = 'settings-note'; status.textContent = 'Leyendo espacios compartidos…';
  host.append(intro, status);
  let spaces: SharedAdministration[];
  let publicSite: PublicationSiteView;
  let pages: PageSummary[];
  try {
    [spaces, publicSite, pages] = await Promise.all([
      sharingRequest('/shared-spaces').then((value) => value.spaces as SharedAdministration[]),
      api.publicationSite(),
      api.pages(),
    ]);
  }
  catch (error) { status.textContent = error instanceof Error ? error.message : 'No se pudo leer la configuración.'; return; }
  status.textContent = `${spaces.length + 1} ${spaces.length === 0 ? 'forma' : 'formas'} de compartir: una pública y ${spaces.length} con acceso autenticado.`;
  host.append(peopleDirectory(spaces));
  host.append(publicSiteAdministration(host, publicSite, pages));
  for (const space of spaces) {
    host.append(spaceAdministration(host, space, pages, publicSite.canonicalDomain));
  }
  const add = document.createElement('button'); add.type = 'button'; add.className = 'sharing-add';
  add.textContent = 'Agregar espacio compartido'; add.setAttribute('aria-expanded', 'false');
  const creation = document.createElement('section'); creation.className = 'sharing-new-space'; creation.hidden = true;
  const heading = document.createElement('h3'); heading.textContent = 'Nuevo espacio compartido';
  creation.append(heading, newSpaceForm(host, spaces.length === 0));
  add.onclick = () => {
    creation.hidden = !creation.hidden; add.setAttribute('aria-expanded', String(!creation.hidden));
    add.textContent = creation.hidden ? 'Agregar espacio compartido' : 'Cerrar nuevo espacio';
    if (!creation.hidden) creation.querySelector<HTMLInputElement>('input')?.focus();
  };
  host.append(add, creation);
}

/** Compartir tiene suficiente profundidad para ser una página, no una pestaña. */
export async function renderSharingAdministration(host: HTMLElement): Promise<void> {
  host.innerHTML = '';
  const page = document.createElement('article');
  page.className = 'sharing-administration';
  const head = document.createElement('header');
  head.className = 'special-page-header';
  const title = document.createElement('h1');
  title.textContent = 'Espacios compartidos';
  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = '← Volver';
  back.addEventListener('click', () => window.history.back());
  head.append(title, back);
  const body = document.createElement('div');
  body.className = 'sharing-administration-body';
  page.append(head, body);
  host.append(page);
  await drawSharing(body);
  // En la página completa las acciones no deben quedar escondidas detrás del
  // resumen del espacio: la invitación y su botón se ven al llegar.
  body.querySelectorAll<HTMLDetailsElement>('.sharing-space').forEach((space) => { space.open = true; });
}

/** Control contextual: pertenencia de una página sin obligar a reconstruirla
 * mentalmente dentro del directorio completo. */
export async function drawPageSharing(host: HTMLElement, page: string, title: string): Promise<void> {
  host.innerHTML = '';
  const head = document.createElement('header'); head.className = 'settings-head';
  const heading = document.createElement('h2'); heading.textContent = `Espacios compartidos · ${title}`;
  const close = document.createElement('button'); close.type = 'button'; close.className = 'settings-close';
  close.innerHTML = icon('x'); close.setAttribute('aria-label', 'Cerrar espacios compartidos');
  close.onclick = () => host.remove(); head.append(heading, close); host.append(head);
  const body = document.createElement('div'); body.className = 'settings-body'; host.append(body);
  const status = document.createElement('p'); status.className = 'settings-note'; status.textContent = 'Leyendo pertenencia…'; body.append(status);
  try {
    const spaces = (await sharingRequest('/shared-spaces')).spaces as SharedAdministration[];
    status.textContent = 'La pertenencia por criterio es derivada; la inclusión explícita puede cambiarse aquí.';
    const list = document.createElement('ul'); list.className = 'sharing-list';
    for (const space of spaces) {
      const admitted = space.effectivePages.find((one) => one.page === page);
      const manual = space.manualPages.includes(page);
      const row = document.createElement('li'); const text = document.createElement('span'); text.textContent = space.name;
      const reason = document.createElement('small'); reason.textContent = admitted?.reasons.join(' + ') ?? 'no pertenece'; text.append(reason);
      const action = document.createElement('button'); action.type = 'button';
      action.textContent = manual ? 'Quitar inclusión' : admitted === undefined ? 'Incluir' : 'Pertenece por criterio';
      action.disabled = admitted !== undefined && !manual;
      action.onclick = () => void sharingRequest(`/shared-spaces/${encodeURIComponent(space.slug)}/pages${manual ? `/${encodeURIComponent(page)}` : ''}`,
        manual ? 'DELETE' : 'POST', manual ? undefined : { page }).then(() => drawPageSharing(host, page, title));
      row.append(text, action); list.append(row);
    }
    if (spaces.length === 0) { const empty = document.createElement('li'); empty.textContent = 'No hay espacios compartidos.'; list.append(empty); }
    body.append(list);
  } catch (error) { status.textContent = error instanceof Error ? error.message : 'No se pudo leer la pertenencia.'; }
}

function newSpaceForm(host: HTMLElement, veraDefaults = true): HTMLElement {
  const form = document.createElement('form'); form.className = 'sharing-form';
  const name = field('Nombre', veraDefaults ? 'Vera' : '', 'nombre del espacio');
  const slug = field('Slug', veraDefaults ? 'vera' : '', 'ruta-corta');
  const key = field('Propiedad inicial (opcional)', veraDefaults ? 'concepto' : '', 'espacio');
  const value = field('Valor inicial (opcional)', veraDefaults ? 'Vera' : '', 'doctorado');
  const publicAccess = document.createElement('label'); publicAccess.className = 'sharing-public-choice';
  const publicInput = document.createElement('input'); publicInput.type = 'checkbox';
  publicAccess.append(publicInput, document.createTextNode(' Acceso público, sin invitación'));
  const create = document.createElement('button'); create.type = 'submit'; create.textContent = 'Crear espacio';
  const result = document.createElement('p'); result.className = 'settings-note';
  form.append(name.label, slug.label, key.label, value.label, publicAccess, create, result);
  form.addEventListener('submit', (event) => void (async () => {
    event.preventDefault(); create.disabled = true;
    try {
      await sharingRequest('/shared-spaces', 'POST', { name: name.input.value, slug: slug.input.value,
        selectorKey: key.input.value, selectorValue: value.input.value,
        audience: publicInput.checked ? 'anybody' : 'restricted' });
      await drawSharing(host);
    } catch (error) { result.textContent = error instanceof Error ? error.message : 'No se pudo crear.'; create.disabled = false; }
  })());
  return form;
}

function publicSiteAdministration(host: HTMLElement, site: PublicationSiteView, pages: PageSummary[]): HTMLElement {
  const details = document.createElement('details'); details.className = 'sharing-space sharing-public';
  details.append(sharingSummary('public', site.title || 'Sitio público', 'Público', '✓ Acceso libre',
    `${site.publications.length} ${site.publications.length === 1 ? 'página' : 'páginas'}`));
  const body = document.createElement('div'); body.className = 'sharing-space-body';
  const intro = document.createElement('p'); intro.className = 'settings-note';
  intro.textContent = 'Es el espacio raíz: no usa passkeys ni invitaciones. Su pertenencia es la lista explícita de publicaciones y cada página conserva su ruta pública.';
  const form = document.createElement('form'); form.className = 'sharing-form';
  const title = field('Nombre', site.title); const domain = field('Origen público', site.canonicalDomain, 'https://ejemplo.net');
  const entryLabel = document.createElement('label'); entryLabel.className = 'sharing-field';
  const entryName = document.createElement('span'); entryName.textContent = 'Portada';
  const entry = document.createElement('select');
  for (const publication of site.publications) {
    const option = document.createElement('option'); option.value = publication.page; option.textContent = publication.title;
    option.selected = publication.page === site.entryPoint; entry.append(option);
  }
  entryLabel.append(entryName, entry);
  const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Guardar sitio público';
  const saved = document.createElement('span'); saved.className = 'settings-note';
  form.append(title.label, domain.label, entryLabel, save, saved);
  form.addEventListener('submit', (event) => void (async () => {
    event.preventDefault(); save.disabled = true;
    const result = await api.configurePublicationSite({ title: title.input.value,
      canonicalDomain: domain.input.value, entryPoint: entry.value || null });
    if ('error' in result) { saved.textContent = String(result.error); save.disabled = false; return; }
    await drawSharing(host);
  })());

  const open = document.createElement('a'); open.href = site.canonicalDomain || '/'; open.target = '_blank';
  open.rel = 'noreferrer'; open.textContent = 'Abrir sitio público';
  const published = document.createElement('div'); published.className = 'sharing-group';
  const publishedHeading = document.createElement('h4'); publishedHeading.textContent = 'Páginas publicadas'; published.append(publishedHeading);
  const list = document.createElement('ul'); list.className = 'sharing-list';
  for (const publication of site.publications) {
    const row = document.createElement('li');
    const link = document.createElement('a'); link.href = publication.url; link.target = '_blank'; link.rel = 'noreferrer';
    link.className = 'sharing-publication-link';
    link.textContent = `${publication.title} · /${publication.path}${publication.entryPoint ? ' · portada' : ''}`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Retirar';
    remove.disabled = publication.entryPoint;
    remove.title = publication.entryPoint ? 'Elige otra portada antes de retirar ésta' : 'Retirar del sitio público';
    remove.onclick = () => void api.unpublish(publication.page).then(() => drawSharing(host));
    row.append(link, remove); list.append(row);
  }
  published.append(list);

  const unpublished = pages.filter((page) => page.visibility === 'public' &&
    !site.publications.some((publication) => publication.page === page.id));
  const add = document.createElement('form'); add.className = 'sharing-publish';
  const page = document.createElement('select');
  const first = document.createElement('option'); first.value = ''; first.textContent = 'Elegir página pública…'; page.append(first);
  for (const candidate of unpublished) { const option = document.createElement('option'); option.value = candidate.id; option.textContent = candidate.title; page.append(option); }
  const path = document.createElement('input'); path.placeholder = 'ruta-pública';
  page.addEventListener('change', () => {
    const title = unpublished.find((one) => one.id === page.value)?.title ?? '';
    path.value = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  });
  const publish = document.createElement('button'); publish.type = 'submit'; publish.textContent = 'Publicar página';
  const result = document.createElement('span'); result.className = 'settings-note';
  add.append(page, path, publish, result);
  add.addEventListener('submit', (event) => void (async () => {
    event.preventDefault(); if (page.value === '' || path.value.trim() === '') return;
    publish.disabled = true; const made = await api.publish(page.value, path.value.trim());
    if ('error' in made) { result.textContent = String(made.error); publish.disabled = false; return; }
    await drawSharing(host);
  })());
  body.append(intro, open, form, published, add); details.append(body); return details;
}

function spaceAdministration(host: HTMLElement, space: SharedAdministration, pages: PageSummary[],
  publicOrigin: string): HTMLElement {
  const card = document.createElement('details'); card.className = 'sharing-space';
  const activeParticipants = space.participants.filter((one) => one.status === 'active').length;
  const isPublic = space.audience === 'anybody';
  const title = sharingSummary(isPublic ? 'public' : 'authenticated', space.name,
    isPublic ? 'Público' : 'Autenticado',
    `${space.pageCount} ${space.pageCount === 1 ? 'página' : 'páginas'}`,
    `${activeParticipants} ${activeParticipants === 1 ? 'participante' : 'participantes'}`);
  const body = document.createElement('div'); body.className = 'sharing-space-body';
  const count = document.createElement('p'); count.className = 'settings-note';
  count.textContent = `${space.pageCount} ${space.pageCount === 1 ? 'página pertenece' : 'páginas pertenecen'} a la unión efectiva del espacio.`;
  const visit = document.createElement('a');
  visit.href = new URL(`/s/${encodeURIComponent(space.slug)}`, publicOrigin).toString();
  visit.target = '_blank'; visit.rel = 'noreferrer'; visit.textContent = 'Abrir superficie compartida';
  const form = document.createElement('form'); form.className = 'sharing-form';
  const name = field('Nombre', space.name); const slug = field('Slug', space.slug);
  const combinationLabel = document.createElement('label'); combinationLabel.className = 'sharing-field';
  const combinationName = document.createElement('span'); combinationName.textContent = 'Combinar criterios';
  const combination = document.createElement('select');
  for (const [value, label] of [['any', 'Cualquiera (O)'], ['all', 'Todos (Y)']] as const) {
    const option = document.createElement('option'); option.value = value; option.textContent = label;
    option.selected = value === space.criterionCombination; combination.append(option);
  }
  combinationLabel.append(combinationName, combination);
  const publicAccess = document.createElement('label'); publicAccess.className = 'sharing-public-choice';
  const publicInput = document.createElement('input'); publicInput.type = 'checkbox'; publicInput.checked = isPublic;
  publicAccess.append(publicInput, document.createTextNode(' Acceso público, sin invitación'));
  const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Guardar acceso y nombre';
  const saved = document.createElement('span'); saved.className = 'settings-note';
  form.append(name.label, slug.label, publicAccess, combinationLabel, save, saved);
  form.addEventListener('submit', (event) => void (async () => {
    event.preventDefault(); save.disabled = true;
    try {
      await sharingRequest(`/shared-spaces/${encodeURIComponent(space.slug)}`, 'PATCH', {
        name: name.input.value, slug: slug.input.value, criterionCombination: combination.value,
        audience: publicInput.checked ? 'anybody' : 'restricted',
      });
      await drawSharing(host);
    } catch (error) { saved.textContent = error instanceof Error ? error.message : 'No se pudo guardar.'; save.disabled = false; }
  })());
  body.append(count, visit, form);
  if (!isPublic) body.append(proposals(host, space, pages), participants(host, space), invitations(host, space), invitationForm(host, space));
  body.append(effectivePages(space, pages), criteriaAdministration(host, space), manualPagesAdministration(host, space, pages));
  const danger = document.createElement('div'); danger.className = 'sharing-group sharing-danger-zone';
  const dangerHeading = document.createElement('h4'); dangerHeading.textContent = 'Retirar superficie compartida';
  const dangerNote = document.createElement('p'); dangerNote.className = 'settings-note';
  dangerNote.textContent = 'Elimina esta superficie, sus invitaciones, accesos y propuestas. No elimina ninguna página de VERA.';
  const removeSpace = document.createElement('button'); removeSpace.type = 'button'; removeSpace.className = 'danger';
  removeSpace.textContent = 'Eliminar superficie compartida';
  removeSpace.onclick = () => {
    if (!confirm(`¿Eliminar definitivamente la superficie compartida «${space.name}»? Se retirarán sus invitaciones, accesos y propuestas; las páginas de VERA se conservarán. Esta acción no se puede deshacer.`)) return;
    removeSpace.disabled = true;
    void sharingRequest(`/shared-spaces/${encodeURIComponent(space.slug)}`, 'DELETE')
      .then(() => drawSharing(host))
      .catch((error: unknown) => { removeSpace.disabled = false; alert(error instanceof Error ? error.message : 'No se pudo eliminar.'); });
  };
  danger.append(dangerHeading, dangerNote, removeSpace); body.append(danger);
  card.append(title, body);
  return card;
}

function proposals(host: HTMLElement, space: SharedAdministration, pages: PageSummary[]): HTMLElement {
  const box = document.createElement('div'); box.className = 'sharing-group';
  const pending = space.proposals.filter((proposal) => proposal.status === 'awaiting_review');
  const heading = document.createElement('h4'); heading.textContent = `Propuestas pendientes · ${pending.length}`; box.append(heading);
  const list = document.createElement('ul'); list.className = 'sharing-list';
  for (const proposal of pending) {
    const row = document.createElement('li');
    const page = pages.find((candidate) => candidate.id === proposal.page)?.title ?? proposal.page;
    const kind = String(proposal.change.kind ?? 'cambio');
    const text = document.createElement('span');
    text.textContent = `${proposal.authorName} propone ${kind} en ${page}`;
    const detail = document.createElement('small'); detail.textContent = new Date(proposal.proposedAt).toLocaleString(); text.append(detail);
    const accept = document.createElement('button'); accept.type = 'button'; accept.textContent = 'Aceptar';
    accept.onclick = () => void sharingRequest(`/shared-spaces/${encodeURIComponent(space.slug)}/proposals/${encodeURIComponent(proposal.id)}/accept`, 'POST')
      .then(() => drawSharing(host));
    const reject = document.createElement('button'); reject.type = 'button'; reject.textContent = 'Rechazar';
    reject.onclick = () => void sharingRequest(`/shared-spaces/${encodeURIComponent(space.slug)}/proposals/${encodeURIComponent(proposal.id)}/reject`, 'POST')
      .then(() => drawSharing(host));
    row.append(text, accept, reject); list.append(row);
  }
  if (pending.length === 0) { const empty = document.createElement('li'); empty.textContent = 'No hay propuestas esperando revisión.'; list.append(empty); }
  box.append(list); return box;
}

function effectivePages(space: SharedAdministration, pages: PageSummary[]): HTMLElement {
  const box = document.createElement('div'); box.className = 'sharing-group';
  const heading = document.createElement('h4'); heading.textContent = 'Pertenencia efectiva'; box.append(heading);
  const list = document.createElement('ul'); list.className = 'sharing-list sharing-effective-pages';
  for (const admitted of space.effectivePages) {
    const row = document.createElement('li');
    const title = pages.find((page) => page.id === admitted.page)?.title ?? admitted.page;
    const text = document.createElement('span'); text.textContent = title;
    const reason = document.createElement('small'); reason.textContent = admitted.reasons.join(' + ') || 'sin razón declarada';
    text.append(reason); row.append(text); list.append(row);
  }
  if (space.effectivePages.length === 0) {
    const empty = document.createElement('li'); empty.textContent = 'El espacio todavía no contiene páginas.'; list.append(empty);
  }
  box.append(list); return box;
}

function peopleDirectory(spaces: SharedAdministration[]): HTMLElement {
  const people = new Map<string, { name: string; grants: { space: string; permissions: SharedPermission[]; status: string }[] }>();
  for (const space of spaces) for (const participant of space.participants.filter((one) => one.status === 'active')) {
    const person = people.get(participant.participant) ?? { name: participant.name, grants: [] };
    person.grants.push({ space: space.name, permissions: participant.permissions, status: participant.status });
    people.set(participant.participant, person);
  }
  const details = document.createElement('details'); details.className = 'sharing-people';
  const summary = document.createElement('summary'); summary.textContent = `Personas · ${people.size}`; details.append(summary);
  const note = document.createElement('p'); note.className = 'settings-note';
  note.textContent = 'Vista transversal de identidades con acceso activo; las invitaciones pendientes y los accesos revocados no aparecen aquí.';
  details.append(note);
  const list = document.createElement('ul'); list.className = 'sharing-list';
  for (const person of people.values()) {
    const row = document.createElement('li'); const text = document.createElement('span');
    text.textContent = person.name;
    const grants = document.createElement('small'); grants.textContent = person.grants
      .map((grant) => `${grant.space}: ${grant.permissions.join(', ')} · ${grant.status}`).join(' / ');
    text.append(grants); row.append(text); list.append(row);
  }
  if (people.size === 0) { const empty = document.createElement('li'); empty.textContent = 'Todavía no hay participantes autenticados.'; list.append(empty); }
  details.append(list); return details;
}

function criteriaAdministration(host: HTMLElement, space: SharedAdministration): HTMLElement {
  const box = document.createElement('div'); box.className = 'sharing-group';
  const heading = document.createElement('h4'); heading.textContent = 'Criterios de pertenencia'; box.append(heading);
  const list = document.createElement('ul'); list.className = 'sharing-list';
  for (const criterion of space.criteria) {
    const row = document.createElement('li'); const text = document.createElement('span');
    text.textContent = `${criterion.key}:: ${criterion.value}`; row.append(text);
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Quitar';
    remove.onclick = () => void sharingRequest(`/shared-spaces/${encodeURIComponent(space.slug)}/criteria/${encodeURIComponent(criterion.id)}`, 'DELETE')
      .then(() => drawSharing(host)); row.append(remove); list.append(row);
  }
  if (space.criteria.length === 0) {
    const empty = document.createElement('li'); empty.textContent = 'Ninguno; puedes comenzar vacío o usar inclusiones explícitas.'; list.append(empty);
  }
  const add = document.createElement('form'); add.className = 'sharing-publish';
  const key = document.createElement('input'); key.placeholder = 'propiedad';
  const value = document.createElement('input'); value.placeholder = 'valor exacto';
  const button = document.createElement('button'); button.type = 'submit'; button.textContent = 'Agregar criterio';
  add.append(key, value, button);
  add.addEventListener('submit', (event) => void (async () => {
    event.preventDefault(); if (key.value.trim() === '' || value.value.trim() === '') return;
    button.disabled = true;
    await sharingRequest(`/shared-spaces/${encodeURIComponent(space.slug)}/criteria`, 'POST',
      { key: key.value, value: value.value }); await drawSharing(host);
  })());
  box.append(list, add); return box;
}

function manualPagesAdministration(host: HTMLElement, space: SharedAdministration, pages: PageSummary[]): HTMLElement {
  const box = document.createElement('div'); box.className = 'sharing-group';
  const heading = document.createElement('h4'); heading.textContent = 'Páginas incluidas explícitamente'; box.append(heading);
  const list = document.createElement('ul'); list.className = 'sharing-list';
  for (const pageId of space.manualPages) {
    const row = document.createElement('li'); const text = document.createElement('span');
    text.textContent = pages.find((page) => page.id === pageId)?.title ?? pageId; row.append(text);
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Quitar';
    remove.onclick = () => void sharingRequest(`/shared-spaces/${encodeURIComponent(space.slug)}/pages/${encodeURIComponent(pageId)}`, 'DELETE')
      .then(() => drawSharing(host)); row.append(remove); list.append(row);
  }
  if (space.manualPages.length === 0) {
    const empty = document.createElement('li'); empty.textContent = 'Ninguna; sólo se aplican los criterios.'; list.append(empty);
  }
  const add = document.createElement('form'); add.className = 'sharing-publish';
  const select = document.createElement('select'); const first = document.createElement('option');
  first.value = ''; first.textContent = 'Elegir página…'; select.append(first);
  for (const page of pages.filter((one) => !space.manualPages.includes(one.id))) {
    const option = document.createElement('option'); option.value = page.id; option.textContent = page.title; select.append(option);
  }
  const button = document.createElement('button'); button.type = 'submit'; button.textContent = 'Incluir página'; add.append(select, button);
  add.addEventListener('submit', (event) => void (async () => {
    event.preventDefault(); if (select.value === '') return; button.disabled = true;
    await sharingRequest(`/shared-spaces/${encodeURIComponent(space.slug)}/pages`, 'POST', { page: select.value });
    await drawSharing(host);
  })());
  box.append(list, add); return box;
}

function sharingSummary(icon: 'public' | 'authenticated', name: string, ...facts: string[]): HTMLElement {
  const summary = document.createElement('summary');
  const identity = document.createElement('span'); identity.className = 'sharing-space-identity';
  const mark = document.createElement('span'); mark.className = 'sharing-space-icon'; mark.setAttribute('aria-hidden', 'true');
  mark.append(sharingIcon(icon));
  const named = document.createElement('strong'); named.textContent = name;
  identity.append(mark, named);
  const metadata = document.createElement('span'); metadata.className = 'sharing-space-facts';
  for (const fact of facts) { const badge = document.createElement('span'); badge.textContent = fact; metadata.append(badge); }
  const affordance = document.createElement('span'); affordance.className = 'sharing-space-affordance'; affordance.setAttribute('aria-hidden', 'true'); affordance.textContent = '›';
  summary.append(identity, metadata, affordance); return summary;
}

function sharingIcon(kind: 'public' | 'authenticated'): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  const paths = kind === 'public'
    ? ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M3 12h18', 'M12 3c2.2 2.5 3.3 5.5 3.3 9S14.2 18.5 12 21', 'M12 3C9.8 5.5 8.7 8.5 8.7 12S9.8 18.5 12 21']
    : ['M6.5 10V7.5a5.5 5.5 0 0 1 11 0V10', 'M5 10h14v11H5z', 'M12 14v3'];
  for (const data of paths) { const path = document.createElementNS(ns, 'path'); path.setAttribute('d', data); svg.append(path); }
  return svg;
}

function invitationForm(host: HTMLElement, space: SharedAdministration): HTMLElement {
  const box = document.createElement('div'); box.className = 'sharing-group';
  const heading = document.createElement('h4'); heading.textContent = 'Nueva invitación';
  const explanation = document.createElement('p'); explanation.className = 'settings-note';
  explanation.textContent = 'Cada enlace es de un solo uso y corresponde a una persona. Puedes crear tantos enlaces como participantes quieras invitar.';
  const contact = field('Para (opcional)', '', 'nombre o contacto');
  const permissions = document.createElement('div'); permissions.className = 'sharing-permissions';
  const controls: { permission: SharedPermission; input: HTMLInputElement }[] = [];
  for (const permission of ['read', 'contribute', 'edit'] as SharedPermission[]) {
    const label = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox';
    input.checked = permission === 'read'; input.disabled = permission === 'read'; label.append(input, ` ${permission}`);
    controls.push({ permission, input }); permissions.append(label);
  }
  const durationLabel = document.createElement('label'); durationLabel.className = 'sharing-field';
  const durationName = document.createElement('span'); durationName.textContent = 'Vigencia';
  const duration = document.createElement('select');
  for (const [milliseconds, label] of [[3_600_000, 'Una hora'], [86_400_000, 'Un día'],
    [604_800_000, 'Siete días'], [2_592_000_000, 'Treinta días']] as const) {
    const option = document.createElement('option'); option.value = String(milliseconds); option.textContent = label;
    option.selected = milliseconds === 604_800_000; duration.append(option);
  }
  durationLabel.append(durationName, duration);
  const create = document.createElement('button'); create.type = 'button'; create.textContent = 'Crear enlace de invitación';
  const result = document.createElement('div'); result.className = 'sharing-invitation-result';
  create.onclick = () => void (async () => {
    create.disabled = true; create.textContent = 'Creando…';
    try {
      const made = await sharingRequest(`/shared-spaces/${encodeURIComponent(space.slug)}/invitations`, 'POST', {
        intendedContact: contact.input.value,
        permissions: controls.filter((one) => one.input.checked).map((one) => one.permission),
        lifetimeMs: Number(duration.value),
      });
      const url = new URL(made.url, location.origin).href;
      rememberInvitationUrl(String(made.id), url);
      const issued = document.createElement('div'); issued.className = 'sharing-issued-invitation';
      const identity = document.createElement('p'); identity.className = 'settings-note';
      identity.textContent = `Invitación nueva · ${String(made.id)}`;
      const output = document.createElement('input'); output.readOnly = true; output.value = url;
      const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copiar enlace';
      copy.onclick = () => void navigator.clipboard.writeText(url)
        .then(() => { copy.textContent = 'Copiado'; })
        .catch(() => {
          output.focus(); output.select();
          copy.textContent = 'No se pudo copiar; el enlace quedó seleccionado';
        });
      const warning = document.createElement('p'); warning.className = 'settings-note';
      warning.textContent = `Este secreto sólo se muestra ahora. Vence ${new Date(made.expiresAt).toLocaleString()} y puede revocarse antes desde esta administración.`;
      issued.append(identity, output, copy, warning);
      // Sólo el enlace vigente queda a la vista: varias tarjetas idénticas
      // convertían un portapapeles viejo en una invitación aparentemente nueva.
      result.replaceChildren(issued);
      contact.input.value = ''; create.textContent = 'Crear otro enlace'; create.disabled = false;
    } catch (error) {
      const failure = document.createElement('p'); failure.className = 'settings-note';
      failure.textContent = error instanceof Error ? error.message : 'No se pudo crear.'; result.prepend(failure);
      create.textContent = 'Crear enlace de invitación'; create.disabled = false;
    }
  })();
  box.append(heading, explanation, contact.label, durationLabel, permissions, create, result); return box;
}

function invitations(host: HTMLElement, space: SharedAdministration): HTMLElement {
  const box = document.createElement('div'); box.className = 'sharing-group';
  const heading = document.createElement('h4'); heading.textContent = 'Invitaciones'; box.append(heading);
  if (space.invitations.length === 0) { const empty = document.createElement('p'); empty.className = 'settings-note'; empty.textContent = 'Ninguna todavía.'; box.append(empty); return box; }
  const list = document.createElement('ul'); list.className = 'sharing-list';
  for (const invitation of space.invitations) {
    const row = document.createElement('li');
    const expiry = invitation.status === 'pending' ? ` · vence ${new Date(invitation.expiresAt).toLocaleString()}` : '';
    const text = document.createElement('span'); text.textContent = `${invitation.intendedContact ?? 'Sin destinatario'} · ${invitation.permissions.join(', ')} · ${invitation.status}${expiry}`;
    row.append(text);
    if (invitation.status === 'pending') {
      const heldUrl = rememberedInvitationUrl(invitation.id);
      if (heldUrl !== null) {
        const address = document.createElement('input'); address.readOnly = true; address.value = heldUrl;
        address.setAttribute('aria-label', `Enlace pendiente para ${invitation.intendedContact ?? 'esta persona'}`);
        const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copiar enlace';
        copy.onclick = () => void navigator.clipboard.writeText(heldUrl)
          .then(() => { copy.textContent = 'Copiado'; })
          .catch(() => { address.focus(); address.select(); copy.textContent = 'Enlace seleccionado'; });
        row.append(address, copy);
      }
      const revoke = document.createElement('button'); revoke.textContent = 'Revocar';
      revoke.onclick = () => void sharingRequest(`/shared-spaces/${encodeURIComponent(space.slug)}/invitations/${encodeURIComponent(invitation.id)}`, 'DELETE')
        .then(() => { forgetInvitationUrl(invitation.id); void drawSharing(host); }); row.append(revoke);
    }
    const remove = document.createElement('button'); remove.textContent = 'Eliminar';
    remove.className = 'danger';
    remove.onclick = () => {
      if (!confirm('¿Eliminar definitivamente esta invitación? Si fue canjeada, también se revocará el acceso de esa persona. Esta acción no se puede deshacer.')) return;
      remove.disabled = true;
      void sharingRequest(`/shared-spaces/${encodeURIComponent(space.slug)}/invitations/${encodeURIComponent(invitation.id)}/permanent`, 'DELETE')
        .then(() => {
          forgetInvitationUrl(invitation.id);
          // La respuesta ya confirma el borrado. Quitar sólo esta fila conserva
          // el details abierto y el lugar de lectura; redibujar toda la página
          // cerraba el espacio y saltaba hacia arriba.
          row.remove();
        })
        .catch((error: unknown) => { remove.disabled = false; alert(error instanceof Error ? error.message : 'No se pudo eliminar.'); });
    };
    row.append(remove);
    list.append(row);
  }
  box.append(list); return box;
}

function participants(host: HTMLElement, space: SharedAdministration): HTMLElement {
  const box = document.createElement('div'); box.className = 'sharing-group';
  const heading = document.createElement('h4'); heading.textContent = 'Participantes autenticados'; box.append(heading);
  const active = space.participants.filter((person) => person.status === 'active');
  const revoked = space.participants.filter((person) => person.status === 'revoked');
  if (active.length === 0) { const empty = document.createElement('p'); empty.className = 'settings-note'; empty.textContent = 'No hay participantes con acceso activo.'; box.append(empty); }
  const list = document.createElement('ul'); list.className = 'sharing-list';
  for (const person of active) {
    const row = document.createElement('li');
    const text = document.createElement('span');
    text.textContent = `${person.name} · ${person.authenticators} passkey · ${person.activeSessions} sesiones · ${person.status}`;
    row.append(text);
    if (person.status === 'active') {
      const permissionControls = document.createElement('span'); permissionControls.className = 'sharing-permissions';
      for (const permission of ['read', 'contribute', 'edit'] as SharedPermission[]) {
        const label = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox';
        input.checked = person.permissions.includes(permission); input.disabled = permission === 'read';
        input.onchange = () => void sharingRequest(`/shared-spaces/${encodeURIComponent(space.slug)}/grants/${encodeURIComponent(person.grant)}`, 'PATCH', {
          permissions: ['read', ...(['contribute', 'edit'] as SharedPermission[]).filter((one) =>
            one === permission ? input.checked : person.permissions.includes(one))],
        }).then(() => drawSharing(host));
        label.append(input, ` ${permission}`); permissionControls.append(label);
      }
      row.append(permissionControls);
    }
    if (person.activeSessions > 0) {
      const sessions = document.createElement('button'); sessions.textContent = 'Cerrar sesiones';
      sessions.onclick = () => void sharingRequest(`/shared-spaces/${encodeURIComponent(space.slug)}/participants/${encodeURIComponent(person.participant)}/sessions`, 'DELETE')
        .then(() => drawSharing(host)); row.append(sessions);
    }
    if (person.status === 'active') {
      const revoke = document.createElement('button'); revoke.textContent = 'Revocar acceso';
      revoke.onclick = () => void sharingRequest(`/shared-spaces/${encodeURIComponent(space.slug)}/grants/${encodeURIComponent(person.grant)}`, 'DELETE')
        .then(() => drawSharing(host)); row.append(revoke);
    }
    list.append(row);
  }
  if (active.length > 0) box.append(list);
  if (revoked.length > 0) {
    const history = document.createElement('details'); history.className = 'sharing-revoked-history';
    const summary = document.createElement('summary'); summary.textContent = `Accesos revocados · ${revoked.length}`;
    const historical = document.createElement('ul'); historical.className = 'sharing-list';
    for (const person of revoked) {
      const row = document.createElement('li');
      const text = document.createElement('span'); text.textContent = `${person.name} · acceso revocado`;
      row.append(text); historical.append(row);
    }
    history.append(summary, historical); box.append(history);
  }
  return box;
}

const readableSize = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

/** La pestaña de configuración resume; administrar merece una dirección propia. */
async function drawFilesSummary(host: HTMLElement, handlers: SettingsHandlers): Promise<void> {
  const status = document.createElement('p');
  status.className = 'settings-note';
  status.textContent = 'Leyendo el almacén…';
  host.append(status);
  let files: CatalogAsset[];
  try { files = await api.media(); }
  catch { status.textContent = 'No se pudo leer el almacén.'; return; }

  const counts = new Map<string, number>();
  const kind = (type: string): string => type.startsWith('image/') ? 'Imágenes' : type.startsWith('audio/') ? 'Audios' : type === 'application/pdf' ? 'PDF' : 'Otros';
  for (const file of files) counts.set(kind(file.mediaType), (counts.get(kind(file.mediaType)) ?? 0) + 1);
  const orphaned = files.filter((file) => file.usages.length === 0).length;
  const facts = document.createElement('dl');
  facts.className = 'media-summary';
  for (const label of ['Imágenes', 'Audios', 'PDF', 'Otros']) {
    const count = counts.get(label) ?? 0;
    if (count === 0) continue;
    const term = document.createElement('dt'); term.textContent = label;
    const value = document.createElement('dd'); value.textContent = String(count);
    facts.append(term, value);
  }
  const orphanTerm = document.createElement('dt'); orphanTerm.textContent = 'Huérfanos';
  const orphanValue = document.createElement('dd'); orphanValue.textContent = String(orphaned);
  facts.append(orphanTerm, orphanValue);
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'settings-open-files';
  open.textContent = 'Administrar archivos';
  open.addEventListener('click', handlers.onOpenFiles);
  status.textContent = `${files.length} archivos en el almacén.`;
  host.append(facts, open);
}

/** La página persistente del almacén: encontrar, describir, usar y limpiar. */
export async function renderFilesAdministration(host: HTMLElement): Promise<void> {
  host.innerHTML = '';
  const head = document.createElement('header');
  head.className = 'page-header';
  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent = 'Administración de archivos';
  head.append(title);
  host.append(head);
  const intro = document.createElement('p');
  intro.className = 'settings-note';
  intro.textContent = 'Los archivos guardados en Vera. La columna «Enlazado desde» muestra dónde se usa cada uno; sólo los huérfanos se pueden eliminar.';
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'media-search';
  search.placeholder = 'Buscar archivos…';
  const status = document.createElement('p');
  status.className = 'settings-note';
  status.textContent = 'Buscando en el almacén…';
  const scroll = document.createElement('div');
  scroll.className = 'media-table-scroll';
  const table = document.createElement('table');
  table.className = 'media-table';
  table.innerHTML = '<thead><tr><th>Archivo</th><th>Descripción</th><th>Enlazado desde</th><th>Acciones</th></tr></thead>';
  const list = document.createElement('tbody');
  table.append(list);
  scroll.append(table);
  host.append(intro, search, status, scroll);

  let files: CatalogAsset[];
  try {
    files = await api.media();
  } catch {
    status.textContent = 'No se pudo leer el almacén.';
    return;
  }

  const draw = (): void => {
    list.innerHTML = '';
    const asked = search.value.trim().toLocaleLowerCase('es');
    const shown = files.filter((file) =>
      [file.originalName, file.path, file.description, file.alternativeText]
        .some((value) => value?.toLocaleLowerCase('es').includes(asked)),
    );
    status.textContent = `${shown.length} ${shown.length === 1 ? 'archivo' : 'archivos'}`;
    for (const file of shown) list.append(mediaRow(file));
  };
  search.addEventListener('input', draw);
  draw();
}

function mediaRow(file: CatalogAsset): HTMLTableRowElement {
  const row = document.createElement('tr');
  const preview = document.createElement('div');
  preview.className = 'media-preview';
  if (file.mediaType.startsWith('image/')) {
    const image = document.createElement('img');
    image.src = file.url;
    image.alt = file.alternativeText ?? '';
    image.loading = 'lazy';
    preview.append(image);
  } else if (file.mediaType.startsWith('audio/')) {
    const audio = document.createElement('audio');
    audio.src = file.url;
    audio.controls = true;
    preview.append(audio);
  } else {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'media-preview-button';
    button.textContent = 'Previsualizar PDF';
    button.addEventListener('click', () => openMediaDetails(file));
    preview.append(button);
  }
  const fileCell = document.createElement('td');
  fileCell.className = 'media-file-cell';
  const identity = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = file.originalName ?? file.path.split('/').pop() ?? 'Archivo';
  const facts = document.createElement('span');
  facts.className = 'media-facts';
  facts.textContent = `${file.mediaType} · ${readableSize(file.byteSize)}`;
  identity.append(name, facts);
  fileCell.append(preview, identity);

  const metadata = document.createElement('td');
  const description = document.createElement('textarea');
  description.rows = 2;
  description.placeholder = 'Describe este archivo';
  description.value = file.description ?? '';
  const alt = document.createElement('input');
  alt.type = 'text';
  alt.placeholder = 'Texto alternativo';
  alt.value = file.alternativeText ?? '';
  alt.hidden = !file.mediaType.startsWith('image/');
  metadata.append(description, alt);

  const usageCell = document.createElement('td');
  usageCell.className = 'media-usages';
  if (file.usages.length === 0) {
    const orphan = document.createElement('span');
    orphan.className = 'media-orphan';
    orphan.textContent = 'Huérfano';
    usageCell.append(orphan);
  } else {
    for (const usage of file.usages) {
      const link = document.createElement('a');
      link.href = `/p/${encodeURIComponent(usage.pageTitle)}#${encodeURIComponent(usage.block)}`;
      link.textContent = usage.pageTitle;
      link.title = 'Ir al bloque que enlaza este archivo';
      usageCell.append(link);
    }
  }

  const actionCell = document.createElement('td');
  const actions = document.createElement('div');
  actions.className = 'media-card-actions';
  const inspect = document.createElement('button');
  inspect.type = 'button';
  inspect.textContent = 'Previsualizar';
  inspect.addEventListener('click', () => openMediaDetails(file));
  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = 'Guardar';
  save.addEventListener('click', async () => {
    save.disabled = true;
    const result = await api.describeMedia(file.hash, { description: description.value, alternativeText: alt.value });
    save.disabled = false;
    if ('error' in result) { save.textContent = result.error; return; }
    file.description = result.description;
    file.alternativeText = result.alternativeText;
    save.textContent = 'Guardado';
    window.setTimeout(() => { save.textContent = 'Guardar'; }, 1200);
  });
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copiar referencia';
  copy.addEventListener('click', async () => {
    const label = file.alternativeText || file.description || file.originalName || 'archivo';
    const destination = file.path.replace(/ /g, '%20');
    await navigator.clipboard.writeText(file.mediaType.startsWith('image/') ? `![${label}](${destination})` : `[${label}](${destination})`);
    copy.textContent = 'Copiada';
    window.setTimeout(() => { copy.textContent = 'Copiar referencia'; }, 1200);
  });
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'media-delete';
  remove.textContent = 'Eliminar';
  remove.disabled = file.usages.length > 0;
  remove.title = remove.disabled ? 'Primero quita los enlaces desde los bloques indicados' : 'Eliminar este archivo huérfano';
  remove.addEventListener('click', async () => {
    const named = file.originalName ?? file.path;
    if (!window.confirm(`¿Eliminar definitivamente «${named}»?`)) return;
    remove.disabled = true;
    const result = await api.deleteMedia(file.hash);
    if ('error' in result) {
      remove.textContent = result.error;
      remove.disabled = false;
      return;
    }
    row.remove();
  });
  actions.append(inspect, save, copy, remove);
  actionCell.append(actions);
  row.append(fileCell, metadata, usageCell, actionCell);
  return row;
}

/**
 * Memoria: qué hay en el corpus y cómo está compuesto.
 *
 * Vivía en un panel lateral permanente, ocupando ancho en cada pantalla para
 * decir algo que se consulta de vez en cuando. Aquí se consulta cuando se
 * quiere, y el ancho vuelve al mapa y al texto.
 */
function drawMemory(host: HTMLElement, handlers: SettingsHandlers): void {
  const intro = document.createElement('p');
  intro.className = 'settings-note';
  intro.textContent =
    'Lo que hay en este grafo, lo que quedó a medias, y las páginas que gobiernan ' +
    'esta instancia. Para encontrar una página cualquiera está el buscador: ' +
    'encuentra por lo que uno recuerda, sin obligar a reconocer un título en una lista.';
  host.append(intro);

  if (handlers.drawMemory === undefined) return;
  handlers.drawMemory(host);

  heading(host, 'Portabilidad');
  const note = document.createElement('p');
  note.className = 'settings-note';
  note.textContent =
    'El archivo .vera contiene el grafo, su registro completo y todos los assets. ' +
    'Al importar, el contenido se agrega: nunca reemplaza páginas que ya existen.';

  const actions = document.createElement('div');
  actions.className = 'memory-portability';
  const download = document.createElement('a');
  download.className = 'settings-action';
  download.href = '/graph.vera';
  download.download = '';
  download.textContent = 'Descargar todo (.vera)';

  const choose = document.createElement('button');
  choose.type = 'button';
  choose.className = 'settings-action';
  choose.textContent = 'Importar archivo .vera';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.vera,application/vnd.vera.graph+json';
  input.hidden = true;
  const result = document.createElement('p');
  result.className = 'settings-note';
  result.setAttribute('aria-live', 'polite');
  choose.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (file === undefined) return;
    choose.disabled = true;
    result.textContent = `Importando ${file.name}…`;
    const imported = await api.importVera(file);
    if ('error' in imported) {
      result.textContent = `${imported.error}${imported.detail === undefined ? '' : `: ${imported.detail}`}`;
      choose.disabled = false;
      input.value = '';
      return;
    }
    result.textContent = `${imported.pages} páginas y ${imported.assets} assets incorporados. Recargando…`;
    window.setTimeout(() => window.location.reload(), 500);
  });
  actions.append(download, choose, input);
  host.append(note, actions, result);
}

/** Un encabezado de sección, con su aclaración de cuándo vale lo que sigue. */
function heading(host: HTMLElement, label: string, note?: string): void {
  const title = document.createElement('h3');
  title.textContent = label;
  host.append(title);
  if (note === undefined) return;
  const said = document.createElement('p');
  said.className = 'settings-note';
  said.textContent = note;
  host.append(said);
}

/** Una tabla de «esto se hace así», que es la única forma que toma esta página. */
function table(host: HTMLElement, rows: { keys: string; what: string; when?: string }[]): void {
  const list = document.createElement('dl');
  list.className = 'keys';
  for (const row of rows) {
    const key = document.createElement('dt');
    const chip = document.createElement('kbd');
    chip.textContent = row.keys;
    key.append(chip);

    const what = document.createElement('dd');
    what.textContent = row.what;
    if (row.when !== undefined) {
      const when = document.createElement('span');
      when.className = 'keys-when';
      when.textContent = row.when;
      what.append(when);
    }
    list.append(key, what);
  }
  host.append(list);
}

/**
 * Qué se puede hacer, y cómo.
 *
 * Se llama «Teclado» por costumbre, pero lo que contesta es «qué puedo hacer»,
 * y la respuesta no depende de si lo que se usa es una tecla, un dedo o una
 * barra escrita. Por eso están juntos los atajos, los gestos del mapa y los
 * comandos: quien viene aquí no sabe todavía en cuál de las tres categorías cae
 * lo que busca.
 *
 * Todo se lee del sitio del que la aplicación lo toma —`BINDINGS`, `GESTURES`,
 * `COMMANDS`—, nunca de una copia. Una lista de ayuda escrita aparte se
 * desincroniza sola, y entonces enseña teclas que ya no hacen eso.
 */
function drawKeyboard(host: HTMLElement): void {
  const intro = document.createElement('p');
  intro.className = 'settings-note';
  intro.textContent =
    'Todo lo que sigue se lee del mismo sitio del que la aplicación lo toma, así que ' +
    'lo que dice aquí es lo que hace.';
  host.append(intro);

  for (const group of GROUPS) {
    const rows = BINDINGS.filter((binding) => binding.group === group.id);
    if (rows.length === 0) continue;
    heading(host, group.label, group.note);
    table(
      host,
      rows.map((binding) => ({ keys: binding.keys, what: binding.what, when: binding.when })),
    );
  }

  /*
   * El mapa, que no se conduce con teclas.
   *
   * Estaba sin documentar en ninguna parte: había que descubrir a tientas que
   * dos dedos lo corren, o que con Shift se desplaza en vez de girar. Un gesto
   * que nadie enseña es un gesto que no existe.
   */
  heading(host, 'Mapa', 'El plano y el de tres dimensiones no se conducen igual.');
  table(
    host,
    GESTURES.map((gesture) => ({
      keys: gesture.does,
      what: gesture.what,
      when: gesture.where === 'las dos' ? 'en las dos vistas' : `sólo en ${gesture.where}`,
    })),
  );

  heading(
    host,
    'Comandos',
    'Se escriben con una barra al principio de un bloque. Basta teclear parte del nombre.',
  );
  table(
    host,
    COMMANDS.map((command) => ({ keys: `/${command.name}`, what: command.hint })),
  );

  heading(host, 'Lo que se escribe para abrir el autocompletado');
  table(host, TRIGGERS);
}

function drawAppearance(
  host: HTMLElement,
  tokens: DesignToken[],
  handlers: SettingsHandlers,
): void {
  const scheme = handlers.scheme();

  /*
   * Claro u oscuro, aquí y no en la barra.
   *
   * Era un botón permanente entre los de arriba, y en un teléfono la barra es el
   * recurso más escaso que hay: cada icono que se queda ahí es uno que compite
   * con hablar, buscar y volver al día. El tema se cambia dos veces al día como
   * mucho —al anochecer y poco más— y lo que se usa dos veces al día no vive
   * donde lo que se usa veinte.
   *
   * Y aquí está en su sitio: debajo se editan los colores de ese mismo esquema,
   * así que elegir cuál se está mirando es la primera decisión de esta página.
   */
  const chooser = document.createElement('div');
  chooser.className = 'scheme-choice';

  const label = document.createElement('span');
  label.className = 'settings-label';
  label.textContent = 'Esquema';
  chooser.append(label);

  // Con icono y no con palabra: «claro» y «oscuro» miden distinto, y dos
  // botones de anchos distintos para elegir entre dos cosas equivalentes leen
  // como si una pesara más. El sol y la luna miden lo mismo y se reconocen sin
  // leerse. El nombre sigue estando donde hace falta, en la etiqueta accesible.
  const options: { value: ColourScheme; shape: 'sun' | 'moon'; text: string }[] = [
    { value: 'light', shape: 'sun', text: 'claro' },
    { value: 'dark', shape: 'moon', text: 'oscuro' },
  ];
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'scheme-option';
    button.innerHTML = icon(option.shape);
    button.setAttribute('aria-label', `Esquema ${option.text}`);
    button.title = `Esquema ${option.text}`;
    const here = scheme === option.value;
    button.setAttribute('aria-pressed', String(here));
    if (here) button.classList.add('here');
    button.addEventListener('click', () => handlers.onScheme(option.value));
    chooser.append(button);
  }
  host.append(chooser);

  const intro = document.createElement('p');
  intro.className = 'settings-note';
  intro.textContent =
    `Se está editando el esquema ${scheme === 'dark' ? 'oscuro' : 'claro'}. ` +
    'Los ajustes habituales están primero. El sistema completo de tokens queda disponible como apariencia avanzada.';
  host.append(intro);

  const list = document.createElement('div');
  list.className = 'tokens';
  const advanced = document.createElement('details');
  advanced.className = 'appearance-advanced';
  const advancedSummary = document.createElement('summary');
  advancedSummary.textContent = 'Apariencia avanzada';
  const advancedList = document.createElement('div'); advancedList.className = 'tokens';
  advanced.append(advancedSummary, advancedList);
  const simpleTokens = new Set(['--text-size', '--line-height', '--content-width', '--phone-scale']);

  for (const token of tokens) {
    const row = document.createElement('label');
    row.className = 'token';

    const name = document.createElement('span');
    name.className = 'token-name';
    name.textContent = LABELS[token.name] ?? token.name;
    const variable = document.createElement('code');
    variable.className = 'token-var';
    variable.textContent = token.name;
    name.append(variable);

    const current = scheme === 'dark' ? token.dark : token.light;
    const kind = kindOf(token);
    let control: HTMLElement;

    if (kind === 'color') {
      /*
       * Un color se elige mirándolo. Junto al selector va su valor, porque el
       * token sigue siendo texto y hay quien prefiere escribirlo.
       *
       * Y el texto es el que manda sobre la transparencia, porque el selector no
       * sabe de ella: `<input type="color">` es de tres canales por
       * especificación, y al darle `#8fa2a363` devuelve `#8fa2a3` sin decir
       * nada. Medido. Como al tocarlo se escribía su valor de vuelta al token,
       * bastaba rozar el selector para que un color translúcido se volviera
       * opaco y nadie se enterara.
       *
       * Ahora el selector lleva sólo los tres canales y la transparencia viaja
       * aparte: se conserva al elegir un tono nuevo, y se escribe en el campo de
       * texto, que sí admite los ocho dígitos. Ni el modelo ni CSS tenían nada
       * en contra —`rgba(143, 162, 163, 0.39)` es lo que el navegador lee de
       * `#8fa2a363`—; era el control el que no llegaba.
       */
      const wrap = document.createElement('span');
      wrap.className = 'token-color';

      /** Los tres canales por un lado y la transparencia por otro. */
      const opaqueOf = (value: string): string => value.trim().slice(0, 7);
      const alphaOf = (value: string): string => {
        const held = value.trim();
        return /^#[0-9a-f]{8}$/i.test(held) ? held.slice(7) : '';
      };

      let alpha = alphaOf(current);

      const picker = document.createElement('input');
      picker.type = 'color';
      picker.value = opaqueOf(current);
      const text = document.createElement('input');
      text.type = 'text';
      text.className = 'token-hex';
      text.value = current;
      text.title = 'seis dígitos, u ocho para dar transparencia: #8fa2a363';

      /*
       * La transparencia, con su propio control.
       *
       * El selector del navegador no la ofrece, y dejarla sólo en el campo de
       * texto significa que para bajar un color al 40 % hay que saberse que eso
       * se escribe `66` en hexadecimal. Un tono se elige mirándolo y una
       * transparencia también.
       *
       * El deslizador es además la muestra: su carril va del transparente al
       * color entero sobre un damero, así que enseña exactamente lo que el token
       * va a valer. Por eso no hace falta un cuadrito aparte —había uno y era un
       * segundo selector de color a la vista, que es justo lo que no es—.
       */
      const opacity = document.createElement('input');
      opacity.type = 'range';
      opacity.className = 'token-alpha';
      opacity.min = '0';
      opacity.max = '100';
      opacity.setAttribute('aria-label', `opacidad de ${LABELS[token.name] ?? token.name}`);

      const pctOf = (hex: string): number =>
        hex === '' ? 100 : Math.round((parseInt(hex, 16) / 255) * 100);
      const hexOf = (pct: number): string =>
        pct >= 100 ? '' : Math.round((pct / 100) * 255).toString(16).padStart(2, '0');

      /** Deja los tres controles diciendo lo mismo, y pinta el carril. */
      const settle = (value: string): void => {
        const rgb = opaqueOf(value);
        alpha = alphaOf(value);
        picker.value = rgb;
        text.value = value;
        opacity.value = String(pctOf(alpha));
        wrap.style.setProperty('--token-rgb', rgb);
        opacity.title = `${pctOf(alpha)} % de opacidad`;
      };
      settle(current);

      const emit = (value: string): void => {
        settle(value);
        handlers.onTokenChange(token, value);
      };

      // La transparencia sobrevive a elegir un tono nuevo: es otra decisión.
      picker.addEventListener('input', () => emit(picker.value + alpha));
      opacity.addEventListener('input', () => emit(picker.value + hexOf(Number(opacity.value))));
      text.addEventListener('change', () => emit(text.value.trim()));

      wrap.append(picker, opacity, text);
      control = wrap;
    } else if (kind === 'font') {
      const select = document.createElement('select');
      for (const stack of FONT_STACKS) {
        const option = document.createElement('option');
        option.value = stack.value;
        option.textContent = stack.label;
        option.selected = stack.value === current;
        select.append(option);
      }
      // Una pila que no está en la lista no se pierde: se ofrece como está.
      if (!FONT_STACKS.some((stack) => stack.value === current)) {
        const option = document.createElement('option');
        option.value = current;
        option.textContent = 'la que hay ahora';
        option.selected = true;
        select.prepend(option);
      }
      select.addEventListener('change', () => handlers.onTokenChange(token, select.value));
      // Se ve escrita en su propia letra, que es la única forma de elegirla.
      select.style.fontFamily = current;
      control = select;
    } else {
      const field = document.createElement('input');
      field.type = 'text';
      field.value = current;
      field.addEventListener('change', () => handlers.onTokenChange(token, field.value));
      control = field;
    }

    row.append(name, control);
    (simpleTokens.has(token.name) ? list : advancedList).append(row);
  }

  host.append(list, advanced);

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'settings-reset';
  reset.textContent = `Restituir los ${DEFAULT_TOKENS.length} tokens de origen`;
  reset.addEventListener('click', () => handlers.onReset());
  host.append(reset);
}
