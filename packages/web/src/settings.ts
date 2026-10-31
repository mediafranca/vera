// La configuración de Vera.
//
// El Centro de Vera reúne ajustes, gobierno y ayuda. Las teclas se leen de
// bindings.ts, que es de donde el editor también las lee, así que esta página
// siempre enseña los atajos que la aplicación ejecuta.
//
// @guarantee EditableDesignSystem: los tokens siguen siendo fuente legible y
// editable desde dentro de Vera. Lo que cambia es el control: un color se elige
// con un selector de color y una tipografía de una lista, en vez de escribir el
// valor a ciegas en un campo de texto.

import { BINDINGS, GESTURES, TRIGGERS } from './bindings.ts';
import { COMMANDS } from './autocomplete.ts';
import {
  api,
  type CatalogAsset,
  type ObservedServiceStatus,
  type PageSummary,
  type PublicationSiteView,
} from './api.ts';
import { icon } from './icons.ts';
import { openMediaDetails } from './media-dialog.ts';
import {
  createServiceStatusIndicator,
  createServiceStatusViewer,
  type ServiceStatus,
  type ServiceStatusViewer,
} from './service-status.ts';
import { toDataURL } from 'qrcode';
import {
  clearTokenImportBackup,
  FONT_STACKS,
  kindOf,
  loadTokenImportBackup,
  parseDesignTokenPackage,
  planDesignTokenImport,
  saveTokenImportBackup,
  serialiseDesignTokenPackage,
  type ColourScheme,
  type DesignToken,
  type DesignTokenImportPlan,
  type DesignLibrary,
  type ParsedDesignTokenPackage,
  type TokenImportMode,
} from './tokens.ts';

export type Section =
  | 'inicio'
  | 'biblioteca'
  | 'personas'
  | 'conexiones'
  | 'gobierno'
  | 'apariencia'
  | 'ayuda'
  | 'sistema';

export interface SettingsHandlers {
  scheme(): ColourScheme;
  /** Cambiar entre el esquema claro y el oscuro. */
  onScheme(next: ColourScheme): void;
  onTokenChange(token: DesignToken, value: string): void;
  onTokensImported(tokens: DesignToken[]): void;
  designs(): DesignLibrary;
  onDesignSelected(id: string): void;
  onDesignCreated(copyCurrent: boolean): void;
  onDesignImported(name: string, tokens: DesignToken[]): void;
  onDesignRenamed(name: string): void;
  onDesignRemoved(): void;
  onReset(): void;
  onClose(): void;
  onSectionChange(section: Section): void;
  onOpenPage(title: string): void;
  onImportDocuments(): void;
  sharedSpace(): { slug: string; name: string } | null;
  onOpenFiles(): void;
  onOpenPeople(): void;
  onOpenAgents(): void;
  onOpenSharing(): void;
  onOpenActivity(): void;
  /**
   * Dibuja el estado del corpus y su índice.
   *
   * Lo pone quien tiene los datos —main.ts, que ya los pide al servidor— en vez
   * de que esta página los pida por su cuenta: abrir los ajustes no debería
   * costar una petición más.
   */
  drawMemory?(host: HTMLElement): void;
  drawSummary?(host: HTMLElement): void;
}

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'inicio', label: 'Inicio' },
  { id: 'biblioteca', label: 'Biblioteca' },
  { id: 'personas', label: 'Personas' },
  { id: 'conexiones', label: 'Conexiones' },
  { id: 'gobierno', label: 'Gobierno' },
  { id: 'apariencia', label: 'Apariencia' },
  { id: 'ayuda', label: 'Ayuda' },
  { id: 'sistema', label: 'Sistema' },
];

type CentreDestination = {
  section: Section;
  label: string;
  note: string;
  terms?: string;
  open?: (handlers: SettingsHandlers) => void;
};

const CENTRE_DESTINATIONS: CentreDestination[] = [
  { section: 'inicio', label: 'Estado de Vera', note: 'Corpus, actividad y accesos frecuentes', terms: 'salud resumen' },
  { section: 'biblioteca', label: 'Archivos', note: 'Imágenes, audios, documentos y adjuntos', open: (h) => h.onOpenFiles() },
  { section: 'personas', label: 'Participantes', note: 'Presencia, passkeys, sesiones y roles', open: (h) => h.onOpenPeople() },
  { section: 'personas', label: 'Bibliotecarios y agentes', note: 'Principal humano, constitución y estado', open: (h) => h.onOpenAgents() },
  { section: 'personas', label: 'Espacios compartidos', note: 'Superficies, invitaciones y permisos', open: (h) => h.onOpenSharing() },
  { section: 'conexiones', label: 'Puerta de conexiones', note: 'Entradas, salidas, canales y credenciales', terms: 'mcp extensión web telegram zotero', open: (h) => h.onOpenPage('VERA: Conexiones') },
  { section: 'conexiones', label: 'Editores externos', note: 'Aplicaciones predeterminadas para cada archivo', terms: 'markdown pdf imagen audio' },
  { section: 'gobierno', label: 'Gobierno de Vera', note: 'Páginas rectoras y superficies administrativas', terms: 'ontología objetos propiedades relaciones' },
  { section: 'apariencia', label: 'Apariencia', note: 'Tema de color, lectura, tipografías y medidas' },
  { section: 'ayuda', label: 'Manual de Vera', note: 'Guía completa con búsqueda', terms: 'documentación aprender', open: (h) => h.onOpenPage('VERA — Manual') },
  { section: 'ayuda', label: 'Teclado y gestos', note: 'Atajos, mapa, comandos y autocompletado', terms: 'ayuda teclas' },
  { section: 'sistema', label: 'Respaldo y traslado', note: 'Exportar o incorporar una biblioteca completa', terms: 'backup importar exportar vera' },
  { section: 'sistema', label: 'Registro de actividad', note: 'Cambios, eliminaciones y restauraciones', open: (h) => h.onOpenActivity() },
  { section: 'sistema', label: 'Esta Vera', note: 'Nombre, perfil Personal o Colectiva y ubicación de datos', terms: 'instancia identidad', open: (h) => h.onOpenPage('Vera — Perfiles de instancia') },
];

const GROUPS: { id: string; label: string; note?: string }[] = [
  { id: 'navegación', label: 'Navegación', note: 'Valen en cualquier momento.' },
  { id: 'estructura', label: 'Estructura del esquema', note: 'Editando un bloque.' },
  { id: 'edición', label: 'Edición', note: 'Editando un bloque.' },
  { id: 'autocompletado', label: 'Autocompletado', note: 'Con la lista de sugerencias abierta.' },
];

const waitingService = (id: ObservedServiceStatus['id']): ServiceStatus => ({
  service: id === 'mcp' ? 'MCP' : 'Conecta',
  condition: 'checking',
});

const visibleService = (status: ObservedServiceStatus): ServiceStatus => ({
  service: status.service,
  condition: status.condition,
  detail: status.detail,
  checkedAt: new Date(status.checkedAt),
  ...(status.latencyMs === null ? {} : { latencyMs: status.latencyMs }),
});

/** Las dos señales de servicio que Herbert situó en la barra del Centro. */
function serviceStatusBar(): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'settings-service-status';
  bar.setAttribute('aria-label', 'Estado de los servicios de Vera');
  const slots = new Map<ObservedServiceStatus['id'], {
    indicator: HTMLElement;
    viewer: ServiceStatusViewer;
  }>();
  let refresh = async (): Promise<void> => undefined;

  for (const id of ['mcp', 'conecta'] as const) {
    const waiting = waitingService(id);
    const service = document.createElement('details');
    service.className = 'settings-service';
    const summary = document.createElement('summary');
    summary.className = 'settings-service-summary';
    const name = document.createElement('span');
    name.className = 'settings-service-name';
    name.textContent = waiting.service;
    const indicator = document.createElement('span');
    indicator.className = 'settings-service-indicator';
    indicator.append(createServiceStatusIndicator(waiting));
    summary.append(name, indicator);
    const viewer = createServiceStatusViewer(waiting, { onCheck: () => refresh() });
    service.append(summary, viewer.element);
    service.addEventListener('toggle', () => {
      if (!service.open) return;
      for (const other of bar.querySelectorAll<HTMLDetailsElement>('.settings-service[open]')) {
        if (other !== service) other.open = false;
      }
    });
    bar.append(service);
    slots.set(id, { indicator, viewer });
  }

  const show = (status: ObservedServiceStatus): void => {
    const slot = slots.get(status.id);
    if (slot === undefined) return;
    const visible = visibleService(status);
    slot.indicator.replaceChildren(createServiceStatusIndicator(visible));
    slot.viewer.update(visible);
  };

  refresh = async (): Promise<void> => {
    for (const id of ['mcp', 'conecta'] as const) {
      const slot = slots.get(id)!;
      const waiting = waitingService(id);
      slot.indicator.replaceChildren(createServiceStatusIndicator(waiting));
      slot.viewer.update(waiting);
    }
    try {
      for (const status of await api.serviceStatus()) show(status);
    } catch {
      for (const id of ['mcp', 'conecta'] as const) {
        show({
          id,
          service: id === 'mcp' ? 'MCP' : 'Conecta',
          condition: 'unknown',
          detail: 'No se pudo completar la comprobación desde esta Vera.',
          checkedAt: Date.now(),
          latencyMs: null,
        });
      }
    }
  };
  void refresh();
  return bar;
}

/** Un nombre legible para un token, sin obligar a leer la variable CSS. */
const LABELS: Record<string, string> = {
  '--bg': 'fondo',
  '--bg-raised': 'fondo elevado',
  '--text': 'texto',
  '--text-dim': 'texto atenuado',
  '--rule': 'líneas y bordes',
  '--accent': 'acento',
  '--node-central': 'texto de la página central',
  '--node-fill': 'nodos del modo circular',
  '--link-stroke': 'aristas del mapa',
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
  title.textContent = 'Centro de Vera';
  head.append(title);

  head.append(serviceStatusBar());

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'settings-close';
  close.setAttribute('aria-label', 'Cerrar');
  close.title = 'Cerrar';
  close.innerHTML = icon('x');
  close.addEventListener('click', () => handlers.onClose());
  head.append(close);
  host.append(head);
  void greetHuman(head, title, close);

  const tabs = document.createElement('nav');
  tabs.className = 'settings-pills';
  tabs.setAttribute('aria-label', 'Secciones del Centro de Vera');
  for (const section of SECTIONS) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = section.id === active ? 'settings-pill selected' : 'settings-pill';
    tab.textContent = section.label;
    tab.setAttribute('aria-pressed', String(section.id === active));
    tab.addEventListener('click', () => {
      handlers.onSectionChange(section.id);
      renderSettings(host, tokens, section.id, handlers);
    });
    tabs.append(tab);
  }
  host.append(tabs);

  const search = document.createElement('div');
  search.className = 'settings-search';
  const query = document.createElement('input');
  query.type = 'search';
  query.placeholder = 'Buscar ajustes y ayuda';
  query.setAttribute('aria-label', 'Buscar en el Centro de Vera');
  const matches = document.createElement('div');
  matches.className = 'settings-search-results';
  matches.hidden = true;
  search.append(query, matches);
  host.append(search);

  const drawMatches = (): void => {
    const asked = query.value.trim().toLocaleLowerCase('es');
    matches.innerHTML = '';
    matches.hidden = asked === '';
    if (asked === '') return;
    const found = CENTRE_DESTINATIONS.filter((entry) =>
      `${entry.label} ${entry.note} ${entry.terms ?? ''} ${SECTIONS.find((one) => one.id === entry.section)?.label ?? ''}`
        .toLocaleLowerCase('es').includes(asked),
    );
    if (found.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'settings-note';
      empty.textContent = 'Prueba con el nombre de una tarea, una conexión o una sección.';
      matches.append(empty);
      return;
    }
    for (const entry of found) {
      const button = destination(entry.label, `${SECTIONS.find((one) => one.id === entry.section)?.label} · ${entry.note}`, () => {
        if (entry.open !== undefined) {
          entry.open(handlers);
          return;
        }
        handlers.onSectionChange(entry.section);
        renderSettings(host, tokens, entry.section, handlers);
      });
      matches.append(button);
    }
  };
  query.addEventListener('input', drawMatches);

  const body = document.createElement('div');
  body.className = 'settings-body';
  host.append(body);

  if (active === 'inicio') drawStart(body, handlers, host, tokens);
  else if (active === 'biblioteca') drawLibrary(body, handlers);
  else if (active === 'personas') drawPeople(body, handlers);
  else if (active === 'conexiones') void drawConnections(body, handlers);
  else if (active === 'gobierno') drawGovernment(body, handlers);
  else if (active === 'apariencia') drawAppearance(body, tokens, handlers);
  else if (active === 'ayuda') drawHelp(body, handlers);
  else drawSystem(body, handlers);
}

type ExternalEditorsBridge = {
  editors(): Promise<Record<string, string>>;
  chooseEditor(kind: string): Promise<Record<string, string>>;
  clearEditor(kind: string): Promise<Record<string, string>>;
};

const externalEditorsBridge = (): ExternalEditorsBridge | null =>
  (window as unknown as { veraExternalEditing?: ExternalEditorsBridge }).veraExternalEditing ?? null;

const EXTERNAL_EDITOR_ROWS = [
  { key: 'markdown', label: 'Markdown', note: 'Páginas y bloques comunes (.md)' },
  { key: 'mermaid', label: 'Mermaid', note: 'Fuente de diagramas (.mmd)' },
  { key: 'svg', label: 'SVG', note: 'Gráficos vectoriales (.svg)' },
  { key: 'html', label: 'HTML', note: 'Recintos HTML ejecutables (.html)' },
  { key: 'javascript', label: 'p5.js / JavaScript', note: 'Bocetos y programas (.js)' },
  { key: 'process', label: 'Proceso', note: 'Definiciones declarativas (.yaml)' },
  { key: 'mediawiki', label: 'MediaWiki', note: 'Fuente wiki (.wiki)' },
  { key: 'code', label: 'Código', note: 'Otros lenguajes según su extensión' },
] as const;

async function drawExternalEditors(host: HTMLElement): Promise<void> {
  heading(
    host,
    'Editores externos',
    'Estas asociaciones pertenecen a este dispositivo; no se guardan en el grafo ni se sincronizan.',
  );
  const bridge = externalEditorsBridge();
  if (bridge === null) {
    const note = document.createElement('p');
    note.className = 'settings-note';
    note.textContent = 'La PWA usa Descargar borrador / Importar resultado. Las aplicaciones directas se configuran en Vera Desktop.';
    host.append(note);
    return;
  }

  let editors = await bridge.editors();
  const list = document.createElement('div');
  list.className = 'external-editor-settings';
  for (const row of EXTERNAL_EDITOR_ROWS) {
    const item = document.createElement('section');
    item.className = 'external-editor-setting';
    const description = document.createElement('div');
    const label = document.createElement('strong');
    label.textContent = row.label;
    const note = document.createElement('span');
    note.textContent = row.note;
    const selected = document.createElement('code');
    const refresh = (): void => {
      selected.textContent = editors[row.key] ?? 'Aplicación predeterminada del sistema';
    };
    refresh();
    description.append(label, note, selected);
    const actions = document.createElement('div');
    const choose = document.createElement('button');
    choose.type = 'button';
    choose.textContent = 'Elegir aplicación';
    choose.onclick = () => {
      choose.disabled = true;
      void bridge.chooseEditor(row.key).then((next) => {
        editors = next;
        refreshControls();
      }).finally(() => { choose.disabled = false; });
    };
    const useSystem = document.createElement('button');
    useSystem.type = 'button';
    useSystem.textContent = 'Usar la del sistema';
    const refreshControls = (): void => {
      refresh();
      useSystem.disabled = editors[row.key] === undefined;
    };
    refreshControls();
    useSystem.onclick = () => {
      useSystem.disabled = true;
      void bridge.clearEditor(row.key).then((next) => {
        editors = next;
        refreshControls();
      });
    };
    actions.append(choose, useSystem);
    item.append(description, actions);
    list.append(item);
  }
  host.append(list);
}

interface HumanIdentity {
  participant: string;
  name: string;
  authenticators: number;
  activeSessions: number;
}

/**
 * La configuración recibe a la persona, no a la credencial que trajo consigo.
 * La identidad sólo aparece cuando una sesión humana real la demuestra; el
 * dueño local sin sesión conserva el encabezado administrativo habitual.
 */
async function greetHuman(head: HTMLElement, title: HTMLHeadingElement, close: HTMLButtonElement): Promise<void> {
  const response = await fetch('/human-auth/me').catch(() => null);
  if (response === null || !response.ok) return;
  const identity = await response.json() as HumanIdentity;
  const familiar = identity.name.trim().split(/\s+/)[0] || identity.name;
  title.textContent = `Hola, ${familiar}`;

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'settings-add-device';
  add.setAttribute('aria-label', 'Abrir Vera en otro dispositivo');
  add.title = 'Abrir Vera en otro dispositivo';
  add.innerHTML = icon('qrcode');
  add.addEventListener('click', () => void openDeviceEnrollment(identity));
  head.insertBefore(add, close);
}

async function openDeviceEnrollment(identity: HumanIdentity): Promise<void> {
  const dialog = document.createElement('dialog');
  dialog.className = 'device-enrollment-dialog';
  const heading = document.createElement('h2'); heading.textContent = 'Abrir Vera en otro dispositivo';
  const explanation = document.createElement('p');
  explanation.textContent = `Escanea este código con el dispositivo que quieres añadir a la identidad de ${identity.name}.`;
  const state = document.createElement('p'); state.className = 'device-enrollment-state';
  state.textContent = 'Creando un código de un solo uso…';
  const qr = document.createElement('img'); qr.alt = ''; qr.hidden = true;
  const actions = document.createElement('div'); actions.className = 'dialog-actions';
  const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copiar enlace'; copy.disabled = true;
  const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Cerrar';
  close.addEventListener('click', () => dialog.close());
  actions.append(copy, close);
  dialog.append(heading, explanation, qr, state, actions);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();

  try {
    const response = await fetch('/human-auth/device-enrollments', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ returnTo: location.pathname }),
    });
    const made = await response.json() as { url?: string; expiresAt?: number; error?: string };
    if (!response.ok || made.url === undefined || made.expiresAt === undefined) {
      throw new Error(made.error ?? `HTTP ${response.status}`);
    }
    qr.src = await toDataURL(made.url, { width: 280, margin: 1,
      color: { dark: '#111111', light: '#ffffff' }, errorCorrectionLevel: 'M' });
    qr.hidden = false;
    state.textContent = `Este código vence a las ${new Date(made.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
    copy.disabled = false;
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(made.url!);
      copy.textContent = 'Enlace copiado';
      window.setTimeout(() => { copy.textContent = 'Copiar enlace'; }, 1200);
    });
  } catch (error) {
    state.dataset['bad'] = 'true';
    state.textContent = error instanceof Error ? error.message : 'No se pudo crear el código.';
  }
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
  status: 'active' | 'withdrawn'; entryPoint: string | null; pageCount: number;
  effectivePages: { page: string; reasons: string[] }[];
  invitations: { id: string; participant: string | null; participantName: string | null;
    permissions: SharedPermission[]; intendedContact: string | null;
    status: 'pending' | 'redeemed' | 'revoked' | 'expired'; issuedAt: number; expiresAt: number }[];
  participants: { grant: string; participant: string; name: string; permissions: SharedPermission[];
    status: 'active' | 'revoked'; grantedAt: number; authenticators: number; activeSessions: number }[];
  proposals: { id: string; page: string; author: string; authorName: string; originId: string;
    channel: 'typed_text' | 'drawn' | 'walked'; change: Record<string, unknown>;
    status: 'awaiting_review' | 'accepted' | 'rejected';
    proposedAt: number; reviewedBy: string | null; reviewedAt: number | null }[];
  people: ParticipantIdentity[];
}

interface ParticipantIdentity {
  id: string; name: string; kind: 'human' | 'agent'; status: 'active' | 'suspended'; canonical: string;
  credentials?: { active: number; revoked: number };
}

type CollectiveRole = 'root_custodian' | 'administrator' | 'editor' | 'contributor' | 'reader' | 'publisher';
interface CollectiveGovernance {
  profile: 'personal' | 'collective'; participant: string; roles: CollectiveRole[];
  people: { participant: string; name: string; roles: CollectiveRole[];
    authenticators: number; activeSessions: number }[];
  invitations: { id: string; participant: string | null; participantName: string | null;
    role: 'administrator' | 'editor' | 'reader'; intendedContact: string | null;
    status: 'pending' | 'redeemed' | 'revoked' | 'expired'; issuedAt: number; expiresAt: number;
    redeemedBy: string | null }[];
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
  let participants: ParticipantIdentity[];
  try {
    [spaces, publicSite, pages, participants] = await Promise.all([
      sharingRequest('/shared-spaces').then((value) => value.spaces as SharedAdministration[]),
      api.publicationSite(),
      api.pages(),
      sharingRequest('/participants').then((value) => value.participants as ParticipantIdentity[]),
    ]);
  }
  catch (error) { status.textContent = error instanceof Error ? error.message : 'No se pudo leer la configuración.'; return; }
  status.textContent = `${spaces.length + 1} ${spaces.length === 0 ? 'forma' : 'formas'} de compartir: una pública y ${spaces.length} con acceso autenticado.`;
  host.append(participantDirectory(host, participants));
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

/** Gobierno humano de la instancia: identidad primero; subgrafos después. */
export async function renderCollectiveAdministration(host: HTMLElement): Promise<void> {
  host.innerHTML = '';
  const page = document.createElement('article'); page.className = 'sharing-administration';
  const head = document.createElement('header'); head.className = 'special-page-header';
  const title = document.createElement('h1'); title.textContent = 'Personas e identidad';
  const back = document.createElement('button'); back.type = 'button'; back.textContent = '← Volver';
  back.onclick = () => window.history.back(); head.append(title, back);
  const body = document.createElement('div'); body.className = 'sharing-administration-body';
  page.append(head, body); host.append(page);
  await drawCollectiveAdministration(body);
}

async function drawCollectiveAdministration(host: HTMLElement): Promise<void> {
  host.innerHTML = '';
  const status = document.createElement('p'); status.className = 'settings-note';
  status.textContent = 'Leyendo el gobierno de la instancia…'; host.append(status);
  let view: CollectiveGovernance;
  try { view = await sharingRequest('/collective-governance') as CollectiveGovernance; }
  catch (error) { status.textContent = error instanceof Error ? error.message : 'No se pudo leer el gobierno.'; return; }
  status.textContent = view.profile === 'collective'
    ? `Instancia colectiva · tus roles: ${view.roles.join(', ') || 'ninguno'}.`
    : 'Instancia personal · una sola persona gobierna el corpus y el acceso local sigue funcionando sin iniciar sesión.';
  if (view.profile !== 'collective') {
    const boundary = document.createElement('section'); boundary.className = 'sharing-group';
    const title = document.createElement('h4'); title.textContent = 'Pasar a una Vera colectiva';
    const explanation = document.createElement('p'); explanation.className = 'settings-note';
    explanation.textContent = 'No es un interruptor sobre este corpus. La conversión crea otra instancia y conserva su linaje; antes de migrar se registra y comprueba una passkey administrativa. Este acceso personal no cambia hasta completar esa prueba.';
    const sharing = document.createElement('p'); sharing.className = 'settings-note';
    sharing.textContent = 'Para colaborar sin cambiar el gobierno de esta Vera, usa Espacios compartidos.';
    boundary.append(title, explanation, sharing); host.append(boundary);
    return;
  }

  const people = document.createElement('section'); people.className = 'sharing-group';
  const peopleTitle = document.createElement('h4'); peopleTitle.textContent = 'Personas'; people.append(peopleTitle);
  const list = document.createElement('ul'); list.className = 'sharing-list';
  for (const person of view.people) {
    const row = document.createElement('li');
    const identity = document.createElement('span'); identity.textContent = person.name;
    const facts = document.createElement('small');
    facts.textContent = `${person.roles.join(', ') || 'sin acceso'} · ${person.authenticators} passkey · ${person.activeSessions} sesiones`;
    identity.append(facts); row.append(identity);
    const actions = document.createElement('span'); actions.className = 'sharing-permissions';
    if (person.activeSessions > 0) {
      const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Cerrar sesiones';
      close.onclick = () => void sharingRequest(`/collective-participants/${encodeURIComponent(person.participant)}/sessions`, 'DELETE')
        .then(() => drawCollectiveAdministration(host)).catch((error: unknown) => alert(error instanceof Error ? error.message : 'No se pudo revocar.'));
      actions.append(close);
    }
    for (const role of person.roles.filter((one) => one !== 'root_custodian')) {
      const revoke = document.createElement('button'); revoke.type = 'button'; revoke.textContent = `Revocar ${role}`;
      revoke.onclick = () => void sharingRequest(`/collective-participants/${encodeURIComponent(person.participant)}/roles/${encodeURIComponent(role)}`, 'DELETE')
        .then(() => drawCollectiveAdministration(host)).catch((error: unknown) => alert(error instanceof Error ? error.message : 'No se pudo revocar.'));
      actions.append(revoke);
    }
    row.append(actions); list.append(row);
  }
  people.append(list); host.append(people);

  const declaration = document.createElement('section'); declaration.className = 'sharing-group';
  const declarationTitle = document.createElement('h4'); declarationTitle.textContent = 'Declarar persona';
  const declarationNote = document.createElement('p'); declarationNote.className = 'settings-note';
  declarationNote.textContent = 'Primero crea la identidad estable. Después podrás emitirle invitaciones, roles y passkeys sin duplicarla.';
  const declarationForm = document.createElement('form'); declarationForm.className = 'sharing-publish';
  const personName = document.createElement('input'); personName.placeholder = 'Nombre de la persona'; personName.autocomplete = 'name';
  const declare = document.createElement('button'); declare.type = 'submit'; declare.textContent = 'Declarar';
  declarationForm.append(personName, declare); declaration.append(declarationTitle, declarationNote, declarationForm);
  host.append(declaration);
  declarationForm.onsubmit = (event) => void (async () => {
    event.preventDefault(); if (personName.value.trim() === '') { personName.focus(); return; }
    declare.disabled = true;
    try {
      await sharingRequest('/participants', 'POST', { name: personName.value.trim(), kind: 'human' });
      await drawCollectiveAdministration(host);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'No se pudo declarar la identidad.');
      declare.disabled = false;
    }
  })();

  const invite = document.createElement('section'); invite.className = 'sharing-group';
  const inviteTitle = document.createElement('h4'); inviteTitle.textContent = 'Nueva invitación';
  const explanation = document.createElement('p'); explanation.className = 'settings-note';
  explanation.textContent = 'El enlace es secreto, vence y se usa una sola vez. Al aceptarlo, la persona entra y puede registrar su propia passkey.';
  const form = document.createElement('form'); form.className = 'sharing-publish';
  const participant = document.createElement('select');
  for (const person of view.people) {
    const option = document.createElement('option'); option.value = person.participant; option.textContent = person.name;
    participant.append(option);
  }
  const contact = document.createElement('input'); contact.placeholder = 'contacto de entrega (opcional)';
  const role = document.createElement('select');
  for (const [value, label] of [['reader', 'Lectura'], ['editor', 'Edición'],
    ['administrator', 'Administración']] as const) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; role.append(option);
  }
  const create = document.createElement('button'); create.type = 'submit'; create.textContent = 'Crear invitación';
  const result = document.createElement('div'); result.className = 'sharing-invitation-result';
  form.append(participant, contact, role, create); invite.append(inviteTitle, explanation, form, result); host.append(invite);
  form.onsubmit = (event) => void (async () => {
    event.preventDefault(); create.disabled = true;
    try {
      const made = await sharingRequest('/collective-invitations', 'POST', {
        participant: participant.value, role: role.value, intendedContact: contact.value.trim() || undefined,
      });
      const url = new URL(String(made.url), location.origin).href;
      rememberInvitationUrl(String(made.id), url);
      const output = document.createElement('input'); output.readOnly = true; output.value = url;
      const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copiar enlace';
      copy.onclick = () => void navigator.clipboard.writeText(url).then(() => { copy.textContent = 'Copiado'; })
        .catch(() => { output.focus(); output.select(); copy.textContent = 'Enlace seleccionado'; });
      const warning = document.createElement('p'); warning.className = 'settings-note';
      warning.textContent = `Sólo se muestra ahora. Vence ${new Date(made.expiresAt).toLocaleString()}.`;
      result.replaceChildren(output, copy, warning); contact.value = '';
      await drawCollectiveInvitationList(host);
    } catch (error) { alert(error instanceof Error ? error.message : 'No se pudo crear.'); }
    finally { create.disabled = false; }
  })();
  await drawCollectiveInvitationList(host, view);
}

async function drawCollectiveInvitationList(host: HTMLElement, initial?: CollectiveGovernance): Promise<void> {
  host.querySelector('#collective-invitations')?.remove();
  const view = initial ?? await sharingRequest('/collective-governance') as CollectiveGovernance;
  const box = document.createElement('section'); box.id = 'collective-invitations'; box.className = 'sharing-group';
  const title = document.createElement('h4'); title.textContent = 'Invitaciones'; box.append(title);
  const list = document.createElement('ul'); list.className = 'sharing-list';
  for (const invitation of view.invitations) {
    const row = document.createElement('li');
    const text = document.createElement('span');
    text.textContent = `${invitation.intendedContact ?? 'Sin destinatario'} · ${invitation.role} · ${invitation.status}`;
    if (invitation.status === 'pending') {
      const expiry = document.createElement('small'); expiry.textContent = `vence ${new Date(invitation.expiresAt).toLocaleString()}`;
      text.append(expiry);
    }
    row.append(text);
    if (invitation.status === 'pending') {
      const held = rememberedInvitationUrl(invitation.id);
      if (held !== null) {
        const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copiar';
        copy.onclick = () => void navigator.clipboard.writeText(held); row.append(copy);
      }
      const revoke = document.createElement('button'); revoke.type = 'button'; revoke.textContent = 'Revocar';
      revoke.onclick = () => void sharingRequest(`/collective-invitations/${encodeURIComponent(invitation.id)}`, 'DELETE')
        .then(() => { forgetInvitationUrl(invitation.id); void drawCollectiveAdministration(host); })
        .catch((error: unknown) => alert(error instanceof Error ? error.message : 'No se pudo revocar.'));
      row.append(revoke);
    }
    list.append(row);
  }
  if (view.invitations.length === 0) { const empty = document.createElement('li'); empty.textContent = 'Ninguna todavía.'; list.append(empty); }
  box.append(list); host.append(box);
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
    const [spaceView, participantView] = await Promise.all([
      sharingRequest('/shared-spaces'), sharingRequest('/participants'),
    ]);
    const spaces = spaceView.spaces as SharedAdministration[];
    const people = (participantView.participants as ParticipantIdentity[])
      .filter((one) => one.kind === 'human' && one.status === 'active' && (one.credentials?.active ?? 0) > 0);
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

    const privateBox = document.createElement('section'); privateBox.className = 'sharing-group';
    const privateHeading = document.createElement('h3'); privateHeading.textContent = 'Enviar enlace privado';
    const explanation = document.createElement('p'); explanation.className = 'settings-note';
    explanation.textContent = 'La URL sólo localiza la página. Para abrirla, la persona elegida debe confirmar su propia passkey.';
    const personLabel = document.createElement('label'); personLabel.className = 'sharing-field';
    const personName = document.createElement('span'); personName.textContent = 'Persona';
    const participant = document.createElement('select');
    for (const person of people) {
      const option = document.createElement('option'); option.value = person.id; option.textContent = person.name;
      participant.append(option);
    }
    personLabel.append(personName, participant);
    const send = document.createElement('button'); send.type = 'button'; send.textContent = 'Crear enlace privado';
    send.disabled = people.length === 0;
    const result = document.createElement('div'); result.className = 'sharing-invitation-result';
    send.onclick = () => void (async () => {
      send.disabled = true; send.textContent = 'Creando…'; result.replaceChildren();
      try {
        const made = await sharingRequest(`/pages/${encodeURIComponent(page)}/private-invitations`, 'POST', {
          participant: participant.value, lifetimeMs: 604_800_000,
        });
        const url = new URL(String(made.url), location.origin).href;
        const output = document.createElement('input'); output.readOnly = true; output.value = url;
        const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copiar enlace';
        copy.onclick = () => void navigator.clipboard.writeText(url).then(() => { copy.textContent = 'Copiado'; });
        const warning = document.createElement('p'); warning.className = 'settings-note';
        warning.textContent = 'Reenviar el enlace no concede acceso: el destinatario debe usar la passkey de la identidad elegida.';
        result.append(output, copy, warning);
      } catch (error) {
        const failure = document.createElement('p'); failure.className = 'settings-note';
        failure.textContent = error instanceof Error ? error.message : 'No se pudo crear el enlace.';
        result.append(failure);
      } finally { send.disabled = people.length === 0; send.textContent = 'Crear enlace privado'; }
    })();
    privateBox.append(privateHeading, explanation, personLabel, send, result);
    body.append(privateBox);
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
  const traceability = document.createElement('label');
  traceability.className = 'sharing-public-choice';
  const traceabilityInput = document.createElement('input');
  traceabilityInput.type = 'checkbox';
  traceabilityInput.checked = site.transparentBlockTraceability;
  traceability.append(
    traceabilityInput,
    document.createTextNode(' Trazabilidad transparente de bloques'),
  );
  const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Guardar sitio público';
  const saved = document.createElement('span'); saved.className = 'settings-note';
  form.append(title.label, domain.label, entryLabel, traceability, save, saved);
  const persistSite = async (changedTraceability = false): Promise<void> => {
    save.disabled = true;
    traceabilityInput.disabled = true;
    saved.textContent = changedTraceability ? 'Aplicando y reconstruyendo el sitio…' : '';
    const result = await api.configurePublicationSite({ title: title.input.value,
      canonicalDomain: domain.input.value, entryPoint: entry.value || null,
      transparentBlockTraceability: traceabilityInput.checked });
    if ('error' in result) {
      if (changedTraceability) traceabilityInput.checked = site.transparentBlockTraceability;
      saved.textContent = String(result.error);
      save.disabled = false;
      traceabilityInput.disabled = false;
      return;
    }
    await drawSharing(host);
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void persistSite();
  });
  // Es una política de la superficie, no un borrador de formulario: cambiarla
  // la aplica de inmediato. Antes parecía ligada al acto de publicar, pero sólo
  // se guardaba mediante otro botón y era muy fácil dejarla sin persistir.
  traceabilityInput.addEventListener('change', () => void persistSite(true));

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
  const entryLabel = document.createElement('label'); entryLabel.className = 'sharing-field';
  const entryName = document.createElement('span'); entryName.textContent = 'Portada';
  const entry = document.createElement('select');
  const noEntry = document.createElement('option'); noEntry.value = ''; noEntry.textContent = 'Sin portada explícita'; entry.append(noEntry);
  for (const admitted of space.effectivePages) {
    const page = pages.find((one) => one.id === admitted.page);
    if (page === undefined) continue;
    const option = document.createElement('option'); option.value = page.id; option.textContent = page.title;
    option.selected = page.id === space.entryPoint; entry.append(option);
  }
  entryLabel.append(entryName, entry);
  const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Guardar acceso y nombre';
  const saved = document.createElement('span'); saved.className = 'settings-note';
  form.append(name.label, slug.label, publicAccess, combinationLabel, entryLabel, save, saved);
  form.addEventListener('submit', (event) => void (async () => {
    event.preventDefault(); save.disabled = true;
    try {
      await sharingRequest(`/shared-spaces/${encodeURIComponent(space.slug)}`, 'PATCH', {
        name: name.input.value, slug: slug.input.value, criterionCombination: combination.value,
        audience: publicInput.checked ? 'anybody' : 'restricted', entryPoint: entry.value || null,
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

function participantDirectory(host: HTMLElement, participants: ParticipantIdentity[]): HTMLElement {
  const details = document.createElement('details'); details.className = 'sharing-people';
  details.open = true;
  const humans = participants.filter((one) => one.kind === 'human');
  const summary = document.createElement('summary'); summary.textContent = `Identidades declaradas · ${humans.length}`; details.append(summary);
  const note = document.createElement('p'); note.className = 'settings-note';
  note.textContent = 'La persona se declara una sola vez. Después puede recibir varias invitaciones, passkeys, sesiones y permisos sin convertirse en otra identidad.';
  details.append(note);
  const list = document.createElement('ul'); list.className = 'sharing-list';
  for (const person of humans) {
    const row = document.createElement('li'); const text = document.createElement('span');
    text.textContent = person.name;
    const identity = document.createElement('small'); identity.textContent = `${person.id} · ${person.status}`;
    text.append(identity); row.append(text); list.append(row);
  }
  if (humans.length === 0) { const empty = document.createElement('li'); empty.textContent = 'Todavía no hay personas declaradas.'; list.append(empty); }
  const declaration = document.createElement('form'); declaration.className = 'sharing-publish';
  const name = document.createElement('input'); name.placeholder = 'Nombre de la persona'; name.autocomplete = 'name';
  const create = document.createElement('button'); create.type = 'submit'; create.textContent = 'Declarar persona';
  declaration.append(name, create);
  declaration.onsubmit = (event) => void (async () => {
    event.preventDefault(); if (name.value.trim() === '') { name.focus(); return; }
    create.disabled = true;
    try {
      await sharingRequest('/participants', 'POST', { name: name.value.trim(), kind: 'human' });
      await drawSharing(host);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'No se pudo declarar la identidad.');
      create.disabled = false;
    }
  })();
  details.append(list, declaration); return details;
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
  explanation.textContent = 'Elige una identidad ya declarada. El enlace añade acceso a esa persona; no crea otra identidad.';
  const personLabel = document.createElement('label'); personLabel.className = 'sharing-field';
  const personName = document.createElement('span'); personName.textContent = 'Persona';
  const participant = document.createElement('select');
  for (const person of space.people.filter((one) => one.kind === 'human' && one.status === 'active')) {
    const option = document.createElement('option'); option.value = person.id; option.textContent = person.name;
    participant.append(option);
  }
  personLabel.append(personName, participant);
  const contact = field('Contacto de entrega (opcional)', '', 'correo o referencia');
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
        participant: participant.value,
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
  box.append(heading, explanation, personLabel, contact.label, durationLabel, permissions, create, result); return box;
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
  intro.textContent = 'Los archivos guardados en Vera. Puedes renombrarlos, reemplazarlos o eliminarlos; Vera mantiene juntas sus referencias en las páginas.';
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
    image.addEventListener('click', () => openMediaDetails(file));
    preview.append(image);
  } else if (file.mediaType.startsWith('audio/')) {
    const audio = document.createElement('audio');
    audio.src = file.url;
    audio.controls = true;
    audio.addEventListener('dblclick', () => openMediaDetails(file));
    preview.append(audio);
  } else {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'media-preview-button';
    button.textContent = file.mediaType === 'application/pdf' ? 'Previsualizar PDF' : 'Abrir archivo';
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
  remove.title = file.usages.length > 0
    ? `Eliminar el archivo y retirarlo de ${file.usages.length} ${file.usages.length === 1 ? 'bloque' : 'bloques'}`
    : 'Eliminar este archivo';
  remove.addEventListener('click', async () => {
    const named = file.originalName ?? file.path;
    const scope = file.usages.length === 0
      ? 'No está incrustado en ninguna página.'
      : `También desaparecerá de ${file.usages.length} ${file.usages.length === 1 ? 'bloque' : 'bloques'}.`;
    if (!window.confirm(`¿Eliminar definitivamente «${named}»?\n\n${scope}`)) return;
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

function drawStart(
  host: HTMLElement,
  handlers: SettingsHandlers,
  centre: HTMLElement,
  tokens: DesignToken[],
): void {
  heading(host, 'Tu Vera', 'Estado y tareas habituales.');
  const actions = document.createElement('div');
  actions.className = 'settings-destinations';
  actions.append(
    destination('Biblioteca', 'Archivos y materiales de tu cuaderno', () => {
      handlers.onSectionChange('biblioteca');
      renderSettings(centre, tokens, 'biblioteca', handlers);
    }),
    destination('Personas', 'Tu presencia, participantes y bibliotecarios', () => {
      handlers.onSectionChange('personas');
      renderSettings(centre, tokens, 'personas', handlers);
    }),
    destination('Respaldo', 'Descargar o trasladar una copia completa', () => {
      handlers.onSectionChange('sistema');
      renderSettings(centre, tokens, 'sistema', handlers);
    }),
    destination('Registro de actividad', 'Cambios, eliminaciones y restauraciones', handlers.onOpenActivity),
  );
  host.append(actions);
  heading(host, 'Estado');
  const status = document.createElement('div');
  status.className = 'settings-government';
  handlers.drawSummary?.(status);
  host.append(status);
}

function drawLibrary(host: HTMLElement, handlers: SettingsHandlers): void {
  heading(host, 'Biblioteca', 'Los materiales que forman el cuaderno.');
  const actions = document.createElement('div');
  actions.className = 'settings-destinations';
  const shared = handlers.sharedSpace();
  actions.append(destination(
    'Importar documentos',
    shared === null
      ? 'Preparar varios archivos o una carpeta y convertirlos en páginas'
      : `Crear páginas dentro de «${shared.name}» y conservar sus archivos originales`,
    handlers.onImportDocuments,
  ));
  if (shared === null) {
    actions.append(
      destination('Archivos', 'Encontrar, describir y cuidar imágenes, audios y documentos', handlers.onOpenFiles),
      destination('Importar una biblioteca', 'Incorporar páginas y archivos desde un respaldo .vera', () => drawPortability(host)),
    );
  }
  host.append(actions);
}

function drawPeople(host: HTMLElement, handlers: SettingsHandlers): void {
  heading(host, 'Personas', 'Cada participante gobierna su presencia y sus agentes.');
  const administration = document.createElement('div');
  administration.className = 'settings-destinations';
  administration.append(
    destination(
      'Participantes',
      'Perfil de instancia, roles, passkeys, sesiones e invitaciones',
      handlers.onOpenPeople,
    ),
    destination(
      'Bibliotecarios y agentes',
      'Principal humano, constitución, versiones y estado efectivo',
      handlers.onOpenAgents,
    ),
    destination(
      'Espacios compartidos',
      'Publicación, páginas, participantes e invitaciones',
      handlers.onOpenSharing,
    ),
  );
  host.append(administration);
}

async function drawConnections(host: HTMLElement, handlers: SettingsHandlers): Promise<void> {
  heading(host, 'Conexiones', 'Puertas de Vera hacia afuera, entradas autorizadas y canales.');
  const actions = document.createElement('div');
  actions.className = 'settings-destinations';
  actions.append(
    destination('Puerta de conexiones', 'Identidad, alcance, estado y revocación', () => handlers.onOpenPage('VERA: Conexiones')),
    destination('Captura web', 'Extensión y entradas desde el navegador', () => handlers.onOpenPage('VERA: Conexiones')),
    destination('Canales', 'Chat interno, Telegram y futuras puertas', () => handlers.onOpenPage('VERA: Conexiones')),
  );
  host.append(actions);
  heading(host, 'Vera hacia afuera', 'Aplicaciones que abren o procesan los materiales.');
  await drawExternalEditors(host);
}

function drawGovernment(host: HTMLElement, handlers: SettingsHandlers): void {

  heading(
    host,
    'Gobierno de Vera',
    'Las páginas reservadas que definen cómo funciona esta instancia.',
  );
  const government = document.createElement('div');
  government.className = 'settings-government';
  host.append(government);
  handlers.drawMemory?.(government);

}

function drawHelp(host: HTMLElement, handlers: SettingsHandlers): void {
  heading(host, 'Ayuda', 'Manual, gestos y atajos desde el mismo lugar.');
  const actions = document.createElement('div');
  actions.className = 'settings-destinations';
  actions.append(
    destination('Manual de Vera', 'Guía completa y enlazada', () => handlers.onOpenPage('VERA — Manual')),
    destination('Primeros pasos', 'Escribir, importar, relacionar y compartir', () => handlers.onOpenPage('VERA — Manual')),
  );
  host.append(actions);
  drawKeyboard(host);
}

function drawSystem(host: HTMLElement, handlers: SettingsHandlers): void {
  heading(host, 'Sistema', 'Continuidad, actividad e identidad de esta instancia.');
  const actions = document.createElement('div');
  actions.className = 'settings-destinations';
  actions.append(
    destination('Registro de actividad', 'Cambios, eliminaciones y restauraciones', handlers.onOpenActivity),
    destination('Esta Vera', 'Nombre, perfil Personal o Colectiva y ubicación de datos', () => handlers.onOpenPage('Vera — Perfiles de instancia')),
  );
  host.append(actions);
  drawPortability(host);
}

function drawPortability(host: HTMLElement): void {
  const existing = host.querySelector('.settings-backup');
  if (existing !== null) existing.remove();
  const backup = document.createElement('section');
  backup.className = 'settings-backup';
  heading(backup, 'Respaldo y traslado');
  const note = document.createElement('p');
  note.className = 'settings-note';
  note.textContent =
    'Una copia completa en formato .vera contiene el grafo, su registro y todos los archivos. ' +
    'Importar suma contenido y conserva las páginas que ya existen.';

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
  backup.append(note, actions, result);
  host.append(backup);
}

/** Un destino de configuración: una acción clara con su consecuencia debajo. */
function destination(label: string, note: string, open: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'settings-destination';
  const name = document.createElement('strong');
  name.textContent = label;
  const explanation = document.createElement('span');
  explanation.textContent = note;
  button.append(name, explanation);
  button.addEventListener('click', open);
  return button;
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

function downloadDesignTokenPackage(tokens: DesignToken[], name: string): void {
  const colours = tokens.filter((token) => kindOf(token) === 'color');
  const contents = serialiseDesignTokenPackage(colours, new Date(), name);
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const link = document.createElement('a');
  const day = new Date().toISOString().slice(0, 10);
  link.href = url;
  const slug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  link.download = `vera-diseno-${slug || day}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function drawTokenImportPreview(
  host: HTMLElement,
  current: DesignToken[],
  imported: ParsedDesignTokenPackage,
  handlers: SettingsHandlers,
): void {
  host.replaceChildren();
  host.className = 'token-import-preview';

  const title = document.createElement('h4');
  title.textContent = 'Vista previa de la importación';
  const origin = document.createElement('p');
  origin.className = 'settings-note';
  const exported = new Date(imported.package.exportedAt).toLocaleString('es-CL');
  origin.textContent = `${imported.supported.length} tokens compatibles · exportados ${exported}.`;
  host.append(title, origin);

  if (imported.unsupported.length > 0) {
    const warning = document.createElement('p');
    warning.className = 'token-import-warning';
    warning.textContent =
      `${imported.unsupported.length} tokens de otra versión se omitirán: ${imported.unsupported.join(', ')}.`;
    host.append(warning);
  }

  const modeLabel = document.createElement('label');
  modeLabel.className = 'token-import-mode';
  const modeText = document.createElement('span');
  modeText.textContent = 'Cómo aplicarlo';
  const mode = document.createElement('select');
  const choices: { value: TokenImportMode; label: string }[] = [
    { value: 'new', label: 'Añadir como un tema nuevo' },
    { value: 'merge', label: 'Fusionar con los colores del tema actual' },
    { value: 'replace', label: 'Reemplazar los colores del tema actual' },
  ];
  for (const choice of choices) {
    const option = document.createElement('option');
    option.value = choice.value;
    option.textContent = choice.label;
    mode.append(option);
  }
  modeLabel.append(modeText, mode);
  host.append(modeLabel);

  const consequence = document.createElement('p');
  consequence.className = 'settings-note';
  const differences = document.createElement('div');
  differences.className = 'token-import-differences';
  host.append(consequence, differences);

  const actions = document.createElement('div');
  actions.className = 'token-portability-actions';
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'settings-action';
  apply.textContent = 'Aplicar importación';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'settings-reset';
  cancel.textContent = 'Cancelar';
  actions.append(apply, cancel);
  host.append(actions);

  let plan: DesignTokenImportPlan;
  const paint = (): void => {
    plan = planDesignTokenImport(current, imported, mode.value as TokenImportMode);
    consequence.textContent = plan.mode === 'new'
      ? 'Se añadirá un tema nuevo y el actual permanecerá intacto.'
      : plan.mode === 'merge'
        ? 'Sólo cambiarán los tokens presentes en el respaldo; los demás conservarán su valor actual.'
        : 'Los tokens ausentes volverán a la reserva canónica de Vera antes de aplicar el respaldo.';
    differences.replaceChildren();
    const summary = document.createElement('p');
    summary.className = 'token-import-summary';
    summary.textContent = plan.changes.length === 0
      ? 'No hay diferencias que aplicar.'
      : `${plan.changes.length} tokens cambiarán.`;
    differences.append(summary);
    if (plan.changes.length > 0) {
      const details = document.createElement('details');
      details.open = plan.changes.length <= 8;
      const heading = document.createElement('summary');
      heading.textContent = 'Ver valores antes y después';
      const list = document.createElement('ul');
      list.className = 'token-import-list';
      for (const change of plan.changes) {
        const item = document.createElement('li');
        const name = document.createElement('code');
        name.textContent = change.name;
        const values = document.createElement('span');
        values.textContent =
          `claro: ${change.before.light} → ${change.after.light}; ` +
          `oscuro: ${change.before.dark} → ${change.after.dark}`;
        item.append(name, values);
        list.append(item);
      }
      details.append(heading, list);
      differences.append(details);
    }
    apply.disabled = plan.mode !== 'new' && plan.changes.length === 0;
  };

  mode.addEventListener('change', paint);
  apply.addEventListener('click', () => {
    if (plan.mode === 'new') {
      handlers.onDesignImported(imported.package.name, plan.tokens);
      return;
    }
    saveTokenImportBackup(current);
    handlers.onTokensImported(plan.tokens);
  });
  cancel.addEventListener('click', () => host.remove());
  paint();
}

function drawTokenPortability(
  host: HTMLElement,
  tokens: DesignToken[],
  handlers: SettingsHandlers,
): void {
  const section = document.createElement('section');
  section.className = 'token-portability';
  const title = document.createElement('h3');
  title.textContent = 'Respaldo y traslado';
  const note = document.createElement('p');
  note.className = 'settings-note';
  note.textContent =
    'Exporta los valores claros y oscuros en un JSON legible. No incluye documentos, credenciales ni preferencias de este aparato.';
  const actions = document.createElement('div');
  actions.className = 'token-portability-actions';
  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.className = 'settings-action';
  exportButton.textContent = 'Exportar tema…';
  exportButton.addEventListener('click', () => {
    const library = handlers.designs();
    const active = library.designs.find((one) => one.id === library.active) ?? library.designs[0]!;
    downloadDesignTokenPackage(tokens, active.name);
  });
  const importButton = document.createElement('button');
  importButton.type = 'button';
  importButton.className = 'settings-action';
  importButton.textContent = 'Importar tema…';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.hidden = true;
  const status = document.createElement('div');
  status.setAttribute('aria-live', 'polite');
  importButton.addEventListener('click', () => input.click());
  input.addEventListener('change', () => void (async () => {
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) return;
    status.replaceChildren();
    if (file.size > 1_000_000) {
      status.textContent = 'El archivo es demasiado grande para ser un respaldo de tokens.';
      status.className = 'token-import-error';
      return;
    }
    try {
      const imported = parseDesignTokenPackage(await file.text());
      drawTokenImportPreview(status, tokens, imported, handlers);
    } catch (error) {
      status.className = 'token-import-error';
      status.textContent = error instanceof Error ? error.message : 'No se pudo leer el respaldo.';
    }
  })());
  actions.append(exportButton, importButton);

  const backup = loadTokenImportBackup();
  if (backup !== null) {
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'settings-reset';
    restore.textContent = 'Deshacer la última importación';
    restore.addEventListener('click', () => {
      clearTokenImportBackup();
      handlers.onTokensImported(backup);
    });
    actions.append(restore);
  }

  section.append(title, note, actions, input, status);
  host.append(section);
}

function drawAppearance(
  host: HTMLElement,
  tokens: DesignToken[],
  handlers: SettingsHandlers,
): void {
  const scheme = handlers.scheme();

  const commonHeading = document.createElement('h3');
  commonHeading.textContent = 'Lectura e interfaz';
  const commonNote = document.createElement('p');
  commonNote.className = 'settings-note';
  commonNote.textContent = 'Tipografías y medidas rigen toda Vera. Se conservan al cambiar de tema o de esquema.';
  host.append(commonHeading, commonNote);

  const library = handlers.designs();
  // @guarantee NamedDesignsAreOperable: todas las operaciones tienen una
  // perilla visible aquí; ninguna exige editar JSON ni metadatos del corpus.
  const active = library.designs.find((one) => one.id === library.active) ?? library.designs[0]!;
  const designs = document.createElement('section');
  designs.className = 'appearance-designs';
  const designsHeading = document.createElement('h3');
  designsHeading.textContent = 'Temas de color';
  const designsNote = document.createElement('p');
  designsNote.className = 'settings-note';
  designsNote.textContent =
    'Cada tema reúne una paleta clara y otra oscura. El esquema visible se elige aparte.';
  const chooserRow = document.createElement('label');
  chooserRow.className = 'settings-field';
  const chooserLabel = document.createElement('span');
  chooserLabel.textContent = 'Tema actual';
  const designChoice = document.createElement('select');
  designChoice.setAttribute('aria-label', 'Tema de color actual');
  for (const design of library.designs) {
    const option = document.createElement('option');
    option.value = design.id;
    option.textContent = design.name;
    option.selected = design.id === library.active;
    designChoice.append(option);
  }
  designChoice.addEventListener('change', () => handlers.onDesignSelected(designChoice.value));
  chooserRow.append(chooserLabel, designChoice);

  const nameRow = document.createElement('label');
  nameRow.className = 'settings-field';
  const nameLabel = document.createElement('span');
  nameLabel.textContent = 'Nombre';
  const name = document.createElement('input');
  name.type = 'text';
  name.value = active.name;
  name.addEventListener('change', () => handlers.onDesignRenamed(name.value));
  nameRow.append(nameLabel, name);

  const actions = document.createElement('div');
  actions.className = 'settings-actions appearance-design-actions';
  const add = document.createElement('button');
  add.type = 'button';
  add.textContent = 'Nuevo';
  add.title = 'Crea un tema con la paleta de origen';
  add.addEventListener('click', () => handlers.onDesignCreated(false));
  const duplicate = document.createElement('button');
  duplicate.type = 'button';
  duplicate.textContent = 'Duplicar';
  duplicate.title = 'Copia el tema actual con otro nombre';
  duplicate.addEventListener('click', () => handlers.onDesignCreated(true));
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Eliminar';
  remove.disabled = library.designs.length < 2;
  remove.title = remove.disabled ? 'Debe quedar al menos un tema' : `Elimina ${active.name}`;
  remove.addEventListener('click', () => handlers.onDesignRemoved());
  actions.append(add, duplicate, remove);
  designs.append(designsHeading, designsNote, chooserRow, nameRow, actions);

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
    'El tema modifica sus colores y conserva las medidas generales.';

  const list = document.createElement('div');
  list.className = 'tokens';
  const advanced = document.createElement('details');
  advanced.className = 'appearance-advanced';
  const advancedSummary = document.createElement('summary');
  advancedSummary.textContent = 'Colores del tema';
  const advancedList = document.createElement('div'); advancedList.className = 'tokens';
  advanced.append(advancedSummary, advancedList);

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
    (kind === 'color' ? advancedList : list).append(row);
  }

  // La muestra pertenece al umbral entre elegir el tema y editar sus colores:
  // primero se fijan las medidas generales y el tema; después se mira el
  // resultado; recién entonces se abre la paleta. Ponerla al comienzo hacía
  // parecer que era una explicación previa, no una consecuencia viva.
  host.append(list, designs, chooser, intro, appearancePreview(), advanced);
  drawTokenPortability(host, tokens, handlers);

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'settings-reset';
  reset.textContent = 'Restituir los colores del tema';
  reset.addEventListener('click', () => handlers.onReset());
  host.append(reset);
}

function appearancePreview(): HTMLElement {
  const preview = document.createElement('section');
  preview.className = 'appearance-preview';
  preview.setAttribute('aria-label', 'Muestra viva de texto y mapa');

  const reading = document.createElement('article');
  reading.className = 'appearance-preview-text';
  const readingLabel = document.createElement('strong'); readingLabel.textContent = 'Texto';
  const heading = document.createElement('h4'); heading.textContent = 'Biblioteca viva';
  const paragraph = document.createElement('p');
  paragraph.textContent = 'La medida rige toda Vera.';
  const code = document.createElement('code'); code.textContent = 'tipo:: documento';
  reading.append(readingLabel, heading, paragraph, code);

  const map = document.createElement('article');
  map.className = 'appearance-preview-map';
  const mapLabel = document.createElement('strong'); mapLabel.textContent = 'Mapa';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 280 86'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Tres páginas relacionadas');
  svg.innerHTML = `
    <line x1="54" y1="43" x2="142" y2="22"></line>
    <line x1="54" y1="43" x2="226" y2="62"></line>
    <line x1="142" y1="22" x2="226" y2="62"></line>
    <text class="central" x="54" y="47" text-anchor="middle">Vera</text>
    <text x="142" y="26" text-anchor="middle">Fuente</text>
    <text x="226" y="66" text-anchor="middle">Idea</text>`;
  map.append(mapLabel, svg);
  preview.append(reading, map);
  return preview;
}
