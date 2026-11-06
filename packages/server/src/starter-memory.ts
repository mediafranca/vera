import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { type Change, VeraGraph } from '@vera/core';
import { loadGraph, openStore, recordOperation, saveParticipant } from '@vera/store';
import { ensureInstanceProfile, type InstanceProfile } from './instance-governance.ts';
import { activeOwnerLibrarian, ensureOwnerLibrarian } from './owner-librarian.ts';
import { activateManifest, buildManifest, chooseConstitutionSources, type ConstitutionRole } from './agent-manifests.ts';
import { saveLibrarianRuntimeConfiguration } from './librarian-runtime.ts';
import { createSharedSpace } from './shared-spaces.ts';
import {
  STARTER_OBJECT_DEFINITIONS,
  STARTER_PROPERTY_DEFINITIONS,
  STARTER_RELATION_DEFINITIONS,
} from './starter-governance.ts';

export const STARTER_MEMORY_VERSION = 4;
export const DISTRIBUTION_PARTICIPANT = 'participant:vera-distribution';

export type InstallationCapabilityOutcome = 'deferred' | 'configured' | 'unavailable' | 'failed';

export interface StarterInstallationReceipt {
  readonly inference: InstallationCapabilityOutcome;
  readonly voice: InstallationCapabilityOutcome;
  readonly inferenceEndpoint?: string;
  readonly inferenceModel?: string;
  readonly installedAt?: number;
}

interface StarterChange {
  readonly id: string;
  /** La versión en que nació esta operación; no cambia al crecer el starter. */
  readonly version?: number;
  readonly change: Change;
}

const page = (id: string, title: string): StarterChange => ({
  id: `page:${id}`,
  change: { kind: 'create_page', stableId: `page:starter-${id}`, title, visibility: 'private' },
});

const block = (
  pageId: string,
  id: string,
  position: number,
  content: string,
  parent: string | null = null,
): StarterChange => ({
  id: `block:${id}`,
  change: {
    kind: 'create_block',
    stableId: `block:starter-${id}`,
    page: `page:starter-${pageId}`,
    parent: parent === null ? null : `block:starter-${parent}`,
    position,
    content,
  },
});

const property = (pageId: string, key: string, value: string): StarterChange => ({
  id: `property:${pageId}:${key}`,
  change: { kind: 'set_property', page: `page:starter-${pageId}`, propertyKey: key, propertyValue: value },
});

const blockProperty = (blockId: string, key: string, value: string): StarterChange => ({
  id: `block-property:${blockId}:${key}`,
  version: 2,
  change: { kind: 'set_property', block: `block:starter-${blockId}`, propertyKey: key, propertyValue: value },
});

const governedPage = (
  id: string,
  title: string,
  kind: 'properties' | 'objects' | 'relations',
  intro: string,
): StarterChange[] => [
  { ...page(id, title), version: 2 },
  { ...property(id, 'tipo', 'página especial'), version: 2 },
  { ...property(id, 'special-kind', kind), version: 2 },
  { ...block(id, `${id}-title`, 0, `# ${title.replace(/^VERA:\s*/, '')}`), version: 2 },
  { ...block(id, `${id}-intro`, 1, intro), version: 2 },
];

const GOVERNANCE_STARTER_CHANGES: readonly StarterChange[] = [
  ...governedPage(
    'properties',
    'VERA: Propiedades',
    'properties',
    'Vocabulario editable de propiedades. Cada fila dice de qué cuelga una propiedad, cómo se responde y, cuando corresponde, qué papel cumple para Vera.',
  ),
  ...STARTER_PROPERTY_DEFINITIONS.flatMap((definition, index): StarterChange[] => {
    const id = `property-${definition.id}`;
    return [
      { ...block('properties', id, index + 2, definition.name), version: 2 },
      ...(definition.subject === undefined ? [] : [blockProperty(id, 'sujeto', definition.subject)]),
      ...(definition.field === undefined ? [] : [blockProperty(id, 'campo', definition.field)]),
      ...(definition.many === true ? [blockProperty(id, 'varios', 'sí')] : []),
      ...(definition.role === undefined ? [] : [blockProperty(id, 'papel', definition.role)]),
      ...(definition.values === undefined ? [] : [blockProperty(id, 'valores', definition.values.join(', '))]),
      blockProperty(id, 'qué', definition.says),
    ];
  }),

  ...governedPage(
    'objects',
    'VERA: Objetos',
    'objects',
    'Clases iniciales de página y las propiedades que suelen constituirlas. Son formas sugeridas: una página incompleta sigue siendo válida y una instalación puede cambiar este vocabulario.',
  ),
  ...STARTER_OBJECT_DEFINITIONS.flatMap((definition, index): StarterChange[] => {
    const id = `object-${definition.id}`;
    return [
      { ...block('objects', id, index + 2, definition.name), version: 2 },
      ...(definition.properties === undefined ? [] : [blockProperty(id, 'propiedades', definition.properties.join(', '))]),
      ...(definition.role === undefined ? [] : [blockProperty(id, 'papel', definition.role)]),
      blockProperty(id, 'qué', definition.says),
    ];
  }),

  ...governedPage(
    'relations',
    'VERA: Relaciones',
    'relations',
    'Tipos iniciales de relación y su lectura inversa. El vocabulario puede ampliarse sin convertir toda coincidencia textual en una relación estructural.',
  ),
  ...STARTER_RELATION_DEFINITIONS.flatMap((definition, index): StarterChange[] => {
    const id = `relation-${definition.id}`;
    return [
      { ...block('relations', id, index + 2, definition.name), version: 2 },
      blockProperty(id, 'inversa', definition.inverse),
      ...(definition.domain === undefined ? [] : [blockProperty(id, 'dominio', definition.domain.join(', '))]),
      ...(definition.range === undefined ? [] : [blockProperty(id, 'rango', definition.range.join(', '))]),
      ...(definition.symmetric === undefined ? [] : [blockProperty(id, 'simétrica', definition.symmetric ? 'sí' : 'no')]),
      ...(definition.transitive === undefined ? [] : [blockProperty(id, 'transitiva', definition.transitive ? 'sí' : 'no')]),
      blockProperty(id, 'estado', 'aprobada'),
      ...(definition.role === undefined ? [] : [blockProperty(id, 'papel', definition.role)]),
      ...(definition.says === undefined ? [] : [blockProperty(id, 'definición', definition.says)]),
    ];
  }),
];

/**
 * La memoria que recibe una instalación nueva.
 *
 * No es una base binaria copiada ni contenido firmado por su futura dueña. Es
 * una secuencia legible y versionada, atribuida a la distribución de Vera, que
 * se puede reproducir, auditar y reemplazar página por página.
 */
export const STARTER_CHANGES: readonly StarterChange[] = [
  page('home', 'Vera'),
  property('home', 'tipo', 'índice'),
  property('home', 'estado', 'inicial'),
  block('home', 'home-title', 0, '# Vera'),
  block('home', 'home-welcome', 1,
    'Esta es tu memoria: un corpus propio, editable y auditable donde tú y las inteligencias que autorices pueden pensar sin perder procedencia.'),
  block('home', 'home-start', 2, '## Para comenzar'),
  block('home', 'home-links', 0,
    'Abre [[VERA — Primeros pasos]], recorre [[VERA — Manual]], consulta [[VERA — Teclado y atajos]] y luego modifica [[VERA — Página de ejemplo]].',
    'home-start'),
  block('home', 'home-agents', 1,
    'Cuando quieras incorporar un agente, sigue [[VERA — Conectar una inteligencia artificial]].',
    'home-start'),
  block('home', 'home-remote', 2,
    'Para abrir esta misma memoria desde tu teléfono u otro equipo, sigue [[VERA — Acceder desde tus otros dispositivos]].',
    'home-start'),
  block('home', 'home-philosophy', 3, '## Por qué Vera'),
  block('home', 'home-philosophy-link', 0,
    '[[VERA — Principios]] explica por qué la memoria es soberana, la autoría permanece visible y publicar es una decisión, no una consecuencia automática.',
    'home-philosophy'),

  page('first-steps', 'VERA — Primeros pasos'),
  property('first-steps', 'tipo', 'manual'),
  block('first-steps', 'first-title', 0, '# Primeros pasos'),
  block('first-steps', 'first-owner', 1, '1. Confirma tu nombre y que esta memoria te reconoce como su única persona propietaria.'),
  block('first-steps', 'first-write', 2, '2. Crea una página, escribe algunos bloques, enlaza otra página con `[[doble corchete]]` y revisa el historial del bloque.'),
  block('first-steps', 'first-example', 3, '3. Edita [[VERA — Página de ejemplo]]: está hecha para tocarla, moverla y eventualmente borrarla.'),
  block('first-steps', 'first-backup', 4, '4. Exporta un respaldo antes de conectar servicios externos o importar un corpus grande.'),
  block('first-steps', 'first-connect-route', 5,
    '5. Decide desde dónde se conectará cada inteligencia: si puede alcanzar este equipo, usa una credencial local; si vive en Internet, activa Vera Conecta desde [[VERA: Conexiones]].'),
  block('first-steps', 'first-agent', 6, '6. Entrega a cada inteligencia una credencial propia y verifica su identidad antes de permitirle escribir.'),

  page('manual', 'VERA — Manual'),
  property('manual', 'tipo', 'manual'),
  block('manual', 'manual-title', 0, '# Manual'),
  block('manual', 'manual-model', 1, '## Modelo básico'),
  block('manual', 'manual-model-content', 0,
    'Una página reúne bloques. Los enlaces crean el grafo; las propiedades describen; el historial conserva cada transformación y su autoría.',
    'manual-model'),
  block('manual', 'manual-writing', 2, '## Escribir y organizar'),
  block('manual', 'manual-writing-content', 0,
    'Usa la sangría para componer argumentos, tareas y documentos. Arrastra bloques para reordenarlos; enlaza páginas en vez de duplicar contexto.',
    'manual-writing'),
  block('manual', 'manual-history', 3, '## Historia y recuperación'),
  block('manual', 'manual-history-content', 0,
    'El historial de un bloque muestra quién cambió qué y permite comprender su evolución. Borrar no debe confundirse con olvidar sin rastro.',
    'manual-history'),
  block('manual', 'manual-more', 4,
    'Consulta también [[VERA — Teclado y atajos]], [[VERA — Conectar una inteligencia artificial]] y [[VERA — Principios]].'),

  page('keyboard', 'VERA — Teclado y atajos'),
  property('keyboard', 'tipo', 'manual'),
  block('keyboard', 'keyboard-title', 0, '# Teclado y atajos'),
  block('keyboard', 'keyboard-enter', 1, '`Enter` crea el siguiente bloque; `Shift+Enter` inserta un salto dentro del bloque.'),
  block('keyboard', 'keyboard-indent', 2, '`Tab` y `Shift+Tab` aumentan o reducen la sangría cuando el foco está en un bloque.'),
  block('keyboard', 'keyboard-links', 3, 'Escribe `[[` para enlazar o crear una página y `((` para referir un bloque estable.'),
  block('keyboard', 'keyboard-command', 4, 'Escribe `/` al comienzo de un bloque para abrir los comandos disponibles.'),
  block('keyboard', 'keyboard-caveat', 5, 'Los atajos dependen del contexto y del sistema operativo; esta página debe actualizarse junto con la interfaz.'),

  page('remote', 'VERA — Acceder desde tus otros dispositivos'),
  property('remote', 'tipo', 'manual'),
  block('remote', 'remote-title', 0, '# Acceder desde tus otros dispositivos'),
  block('remote', 'remote-intro', 1,
    'Vera vive en este computador. Para abrirla desde tu teléfono u otro equipo sin exponerla a internet, usa Tailscale: una red privada entre tus propios dispositivos.'),
  block('remote', 'remote-steps', 2, '## En resumen'),
  block('remote', 'remote-step-install', 0,
    'Instala Tailscale en este computador y en tu teléfono, con la misma cuenta.', 'remote-steps'),
  block('remote', 'remote-step-serve', 1,
    'En este computador, ejecuta una vez `tailscale serve --bg 4173`.', 'remote-steps'),
  block('remote', 'remote-step-open', 2,
    'Abre la dirección que te entrega Tailscale desde tu teléfono y agrégala a la pantalla de inicio.', 'remote-steps'),
  block('remote', 'remote-caveat', 3,
    'El computador debe estar encendido y Vera abierta para que puedas alcanzarla desde otro lado.'),
  block('remote', 'remote-security', 4,
    'Cualquier dispositivo de tu tailnet tiene el mismo acceso que tú, lectura y escritura completas: no agregues uno en el que no confíes tanto como en este computador.'),

  page('example', 'VERA — Página de ejemplo'),
  property('example', 'tipo', 'ejemplo'),
  property('example', 'estado', 'editable'),
  block('example', 'example-title', 0, '# Una página para intervenir'),
  block('example', 'example-intro', 1, 'Esta página no es documentación sagrada. Cámbiala para aprender cómo responde Vera.'),
  block('example', 'example-task', 2, 'TODO Marca esta tarea como hecha.'),
  block('example', 'example-parent', 3, 'Mueve o pliega este bloque.'),
  block('example', 'example-child', 0, 'Soy un bloque hijo: usa la sangría para cambiar nuestra relación.', 'example-parent'),
  block('example', 'example-link', 4, 'Crea un enlace desde aquí hacia [[Mi primera página]].'),
  block('example', 'example-history', 5, 'Edita esta frase y luego abre su historial para ver ambas versiones.'),

  page('agents', 'VERA — Conectar una inteligencia artificial'),
  property('agents', 'tipo', 'manual'),
  block('agents', 'agents-title', 0, '# Conectar una inteligencia artificial'),
  block('agents', 'agents-principle', 1,
    'Cada agente es un participante distinto. Nunca compartas la credencial de la persona propietaria ni reutilices una misma identidad entre agentes.'),
  block('agents', 'agents-steps', 2, '## Secuencia segura'),
  block('agents', 'agents-credential', 0, '1. Crea una credencial revocable con los alcances mínimos necesarios.', 'agents-steps'),
  block('agents', 'agents-connect', 1, '2. Configura el cliente MCP con la URL de esta Vera y esa credencial.', 'agents-steps'),
  block('agents', 'agents-whoami', 2, '3. Ejecuta `vera_quien_soy` y confirma identidad y alcances antes de leer o escribir.', 'agents-steps'),
  block('agents', 'agents-audit', 3, '4. Revisa la página de contribuciones del agente y revoca la credencial si deja de necesitar acceso.', 'agents-steps'),
  block('agents', 'agents-warning', 3,
    'Las instrucciones exactas cambian entre clientes. Vera debe mostrar recetas verificadas para cada integración compatible, sin guardar secretos dentro del corpus.'),

  page('connections', 'VERA: Conexiones'),
  property('connections', 'tipo', 'página especial'),
  property('connections', 'special-kind', 'connections'),
  block('connections', 'connections-title', 0, '# Conexiones'),
  block('connections', 'connections-intro', 1,
    'Esta página gobierna qué inteligencias pueden entrar a Vera, con qué identidad y con qué alcance. La memoria sigue siendo local aunque actives un puente remoto.'),
  block('connections', 'connections-list', 2, '## Conexiones autorizadas'),
  block('connections', 'connections-conecta', 3,
    'Vera Conecta permanece desactivada hasta que la persona propietaria la activa aquí. La dirección pública identifica una instalación, pero nunca autoriza por sí sola.'),

  page('governance', 'VERA: Gobierno'),
  property('governance', 'tipo', 'página especial'),
  property('governance', 'special-kind', 'governance'),
  block('governance', 'governance-title', 0, '# Gobierno de Vera'),
  block('governance', 'governance-intro', 1,
    'Índice vivo de las páginas que gobiernan esta Vera. La lista se deriva de `special-kind`: no se mantiene a mano ni reemplaza las decisiones escritas en cada página.'),

  page('principles', 'VERA — Principios'),
  property('principles', 'tipo', 'documentación'),
  block('principles', 'principles-title', 0, '# Principios'),
  block('principles', 'principles-sovereign', 1, '**Soberanía.** La memoria pertenece a una persona; las herramientas y agentes participan bajo su autoridad.'),
  block('principles', 'principles-authorship', 2, '**Autoría.** Toda contribución conserva quién la produjo y por qué canal llegó.'),
  block('principles', 'principles-malleable', 3, '**Maleabilidad.** La estructura sirve al pensamiento y puede cambiar sin entregar el control del corpus.'),
  block('principles', 'principles-publication', 4, '**Publicación deliberada.** Lo privado no se vuelve público por accidente ni por comodidad técnica.'),
  block('principles', 'principles-portable', 5, '**Portabilidad.** Programa y memoria son cosas distintas: actualizar Vera no reemplaza ni secuestra el corpus.'),
  block('principles', 'principles-accountable', 6, '**Auditabilidad.** Las transformaciones importantes son visibles, atribuibles y recuperables.'),

  ...GOVERNANCE_STARTER_CHANGES,
];

export interface InitializeStarterMemoryOptions {
  readonly databasePath: string;
  /** Obligatoria sólo cuando la memoria todavía no tiene persona propietaria. */
  readonly owner?: { readonly id: string; readonly name: string };
  readonly profile?: InstanceProfile;
  readonly libraryName?: string;
  readonly ownerLibrarianName?: string;
  readonly initialCollectiveSurfaceName?: string;
  /** Resultado observable del asistente; nunca contiene claves ni otros secretos. */
  readonly installation?: StarterInstallationReceipt;
}

export interface StarterMemoryReport {
  readonly version: number;
  readonly applied: number;
  readonly duplicates: number;
  readonly pages: number;
  readonly blocks: number;
}

function forProfile(entry: StarterChange, profile: InstanceProfile): StarterChange {
  if (profile !== 'collective' || entry.change.kind !== 'create_block') return entry;
  const collective: Record<string, string> = {
    'block:starter-home-welcome': 'Esta es una memoria colectiva: un corpus compartido, editable y auditable donde cada persona y cada inteligencia autorizada conserva su identidad y su autoridad explícita.',
    'block:starter-first-owner': '1. Confirma quién custodia esta instalación, quiénes la administran y que cada persona entra con su propia passkey.',
    'block:starter-remote-security': 'Cada persona entra con su propia sesión y sólo ve o modifica aquello que sus roles activos permiten. Alcanzar el equipo o pertenecer a su tailnet no concede acceso.',
    'block:starter-agents-principle': 'Cada agente es un participante distinto. Nunca reutilices una identidad entre agentes ni confundas sus credenciales revocables con una sesión humana.',
    'block:starter-principles-sovereign': '**Soberanía.** La memoria colectiva pertenece a su comunidad gobernada; las personas, herramientas y agentes participan con autoridad explícita y revocable.',
  };
  const content = collective[entry.change.stableId ?? ''];
  return content === undefined ? entry : { ...entry, change: { ...entry.change, content } };
}

function surfaceSlug(name: string): string {
  const slug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'superficie-colectiva';
}

const localDay = (at: number): string => {
  const date = new Date(at);
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const capabilityLabel = (outcome: InstallationCapabilityOutcome): string => ({
  deferred: 'se dejó para más adelante',
  configured: 'quedó configurada',
  unavailable: 'no estaba disponible en este equipo',
  failed: 'se intentó preparar y falló',
})[outcome];

export function initializeStarterMemory(options: InitializeStarterMemoryOptions): StarterMemoryReport {
  if (options.databasePath !== ':memory:') mkdirSync(dirname(options.databasePath), { recursive: true });
  const store = openStore({ path: options.databasePath, graphName: 'mind' });
  try {
    const graph = loadGraph(store, 'mind');
    const established = graph.owner;
    if (established !== null && options.owner !== undefined && established !== options.owner.id) {
      throw new Error(`la memoria ya pertenece a ${established}; no se puede reinicializar como ${options.owner.id}`);
    }
    if (established === null) {
      if (options.owner === undefined) {
        throw new Error('una memoria nueva necesita una persona propietaria');
      }
      saveParticipant(store, { ...options.owner, kind: 'human' });
      graph.addParticipant({ ...options.owner, kind: 'human' });
      graph.admit(options.owner.id);
    }
    const owner = established ?? options.owner?.id;
    if (owner === undefined) throw new Error('la memoria no declara persona propietaria');
    const newGraph = established === null;
    const profile = ensureInstanceProfile(store, owner, options.profile, newGraph, options.libraryName);
    if (newGraph) {
      ensureOwnerLibrarian(store, graph, owner, options.ownerLibrarianName ?? 'Lucienne');
      if (profile === 'collective') {
        const surfaceName = options.initialCollectiveSurfaceName?.trim() || 'Superficie colectiva';
        createSharedSpace(store, owner, {
          name: surfaceName,
          slug: surfaceSlug(surfaceName),
          audience: 'restricted',
        });
      }
    }

    if (graph.participant(DISTRIBUTION_PARTICIPANT) === undefined) {
      saveParticipant(store, {
        id: DISTRIBUTION_PARTICIPANT,
        name: 'Distribución de Vera',
        kind: 'agent',
      });
      graph.addParticipant({
        id: DISTRIBUTION_PARTICIPANT,
        name: 'Distribución de Vera',
        kind: 'agent',
      });
      graph.admit(DISTRIBUTION_PARTICIPANT);
    }

    let applied = 0;
    let duplicates = 0;
    if (newGraph) {
      const installedAt = options.installation?.installedAt ?? Date.now();
      const day = localDay(installedAt);
      const librarian = activeOwnerLibrarian(store);
      const libraryName = store.db.prepare('SELECT library_name FROM instances LIMIT 1').get() as
        { library_name: string } | undefined;
      const inference = options.installation?.inference ?? 'deferred';
      const voice = options.installation?.voice ?? 'deferred';
      const entries = [
        { id: 'page', change: { kind: 'create_page' as const, stableId: 'page:starter-installation-day', title: day, visibility: 'private' as const } },
        { id: 'type', change: { kind: 'set_property' as const, page: 'page:starter-installation-day', propertyKey: 'tipo', propertyValue: 'bitácora' } },
        { id: 'root', change: { kind: 'create_block' as const, stableId: 'block:starter-installation-root', page: 'page:starter-installation-day', parent: null, position: 0, content: '**Instalación de Vera:** esta bitácora registra cómo quedó constituida la biblioteca.' } },
        { id: 'identity', change: { kind: 'create_block' as const, stableId: 'block:starter-installation-identity', page: 'page:starter-installation-day', parent: 'block:starter-installation-root', position: 0, content: `Se constituyó **${libraryName?.library_name ?? 'Vera'}** como biblioteca ${profile === 'collective' ? 'colectiva' : 'personal'} y se vinculó [[Agente de biblioteca]] como bibliotecaria de su persona fundadora.` } },
        { id: 'capabilities', change: { kind: 'create_block' as const, stableId: 'block:starter-installation-capabilities', page: 'page:starter-installation-day', parent: 'block:starter-installation-root', position: 1, content: `Inferencia: ${capabilityLabel(inference)}. Voz local: ${capabilityLabel(voice)}. Ninguna clave se escribió en el corpus.` } },
        { id: 'settings', change: { kind: 'create_block' as const, stableId: 'block:starter-installation-settings', page: 'page:starter-installation-day', parent: 'block:starter-installation-root', position: 2, content: 'La constitución y las capacidades efectivas pueden revisarse en [[VERA: Gobierno]], [[VERA: Conexiones]] y [[Agente de biblioteca]].' } },
      ];
      if (librarian === null) throw new Error('la instalación no constituyó una bibliotecaria activa');
      for (const entry of entries) {
        const outcome = graph.submitOperation({
          originId: `starter-memory:installation:${owner}:${entry.id}`,
          participant: DISTRIBUTION_PARTICIPANT,
          channel: 'agent_generation',
          change: entry.change,
          submittedAt: installedAt,
        });
        if (outcome.status === 'rejected') throw new Error(`no se pudo registrar la instalación: ${outcome.reason}`);
        if (outcome.status === 'applied') {
          recordOperation(store, graph, outcome.operation);
          applied += 1;
        } else duplicates += 1;
      }
    }
    for (const source of STARTER_CHANGES) {
      const entry = forProfile(source, profile);
      const outcome = graph.submitOperation({
        originId: `starter-memory:v${entry.version ?? 1}:${entry.id}`,
        participant: DISTRIBUTION_PARTICIPANT,
        channel: 'agent_generation',
        change: entry.change,
      });
      if (outcome.status === 'duplicate') {
        duplicates += 1;
        continue;
      }
      if (outcome.status === 'rejected') {
        throw new Error(`no se pudo sembrar ${entry.id}: ${outcome.reason}`);
      }
      recordOperation(store, graph, outcome.operation);
      applied += 1;
    }

    if (newGraph) {
      const librarian = activeOwnerLibrarian(store);
      const personalityTitle = 'Agente de biblioteca';
      if (librarian !== null && graph.pageTitled(personalityTitle) === undefined) {
        const pageId = `page:librarian-personality:${librarian.agent.slice('participant:'.length)}`;
        const entries = [
          { id: 'page', change: { kind: 'create_page' as const, stableId: pageId, title: personalityTitle, visibility: 'private' as const } },
          { id: 'type', change: { kind: 'set_property' as const, page: pageId, propertyKey: 'tipo', propertyValue: 'personalidad de agente' } },
          { id: 'title', change: { kind: 'create_block' as const, stableId: `block:${pageId}:title`, page: pageId, parent: null, position: 0, content: '# Agente de biblioteca' } },
          { id: 'foundation', change: { kind: 'create_block' as const, stableId: `block:${pageId}:foundation`, page: pageId, parent: null, position: 1, content: '## Personalidad y fundamento' } },
          { id: 'maieutics', change: { kind: 'create_block' as const, stableId: `block:${pageId}:maieutics`, page: pageId, parent: `block:${pageId}:foundation`, position: 0, content: '**Servicio primero y mayéutica del agente de biblioteca.** Vive en Vera como bibliotecaria residente: su conversación, gobierno, ontología, gramática de escritura, historia y herramientas de inspección forman parte del oficio y no de una conexión MCP externa. Resuelve directamente búsquedas, recuperación, verificación, transcripción, clasificación, ordenamiento, formato y demás tareas cuyo resultado ya está determinado. Inspecciona el corpus antes de afirmar una presencia o ausencia. Escribe propiedades estructuradas conforme a la ontología —las referencias guardan el título canónico sin `[[corchetes]]`— y mantiene un único apartado diario `**Bitácora de <nombre del agente>:**` para dejar constancia legible de sus intervenciones materiales. Una fuente, cita, pasaje, pista o hipótesis aportada cuenta como contribución suficiente. Reserva la pregunta mayéutica para una delegación vacía de juicio personal —interpretar, comparar, seleccionar, sintetizar o concluir— y formula como máximo una pregunta antes de ayudar. En las peticiones mixtas presta primero el servicio determinado y pregunta sólo por la decisión personal pendiente. Si la persona pide continuar directamente, lo hace sin reproche: la mayéutica es una oferta formativa, no una condición de acceso.' } },
        ];
        for (const entry of entries) {
          const outcome = graph.submitOperation({
            originId: `starter-memory:librarian-personality:${librarian.agent}:${entry.id}`,
            participant: DISTRIBUTION_PARTICIPANT,
            channel: 'agent_generation',
            change: entry.change,
          });
          if (outcome.status === 'rejected') throw new Error(`no se pudo sembrar la personalidad: ${outcome.reason}`);
          if (outcome.status === 'applied') {
            recordOperation(store, graph, outcome.operation);
            applied += 1;
          } else {
            duplicates += 1;
          }
        }
      }
      if (librarian !== null) {
        const sources = [
          { title: 'Agente de biblioteca', role: 'identity' as ConstitutionRole },
          { title: 'VERA — Principios', role: 'purpose' as ConstitutionRole },
          { title: 'VERA: Gobierno', role: 'governance' as ConstitutionRole },
          { title: 'VERA — Conectar una inteligencia artificial', role: 'practice' as ConstitutionRole },
        ].map((source) => {
          const sourcePage = graph.pageTitled(source.title);
          if (sourcePage === undefined) throw new Error(`falta la página rectora ${source.title}`);
          return { page: sourcePage.id, role: source.role };
        });
        chooseConstitutionSources(store, graph, owner, librarian.agent, sources);
        const draft = buildManifest(store, graph, owner, librarian.agent);
        activateManifest(store, owner, librarian.agent, draft.id);
        const remote = options.installation?.inference === 'configured';
        const requestedModel = options.installation?.inferenceModel?.trim();
        saveLibrarianRuntimeConfiguration(store, {
          updatedBy: owner,
          enabled: remote,
          model: remote ? `openai:${requestedModel || 'gpt-5.6-luna'}` : null,
          endpoint: remote ? options.installation?.inferenceEndpoint ?? null : null,
          secretReference: 'VERA_LIBRARIAN_API_KEY',
          permissions: ['read_request_context', 'reply', 'daily_round'],
          dialectic: { enabled: true },
          routine: { enabled: false, hour: 9, timezone: 'local' },
        });
      }
    }

    return {
      version: STARTER_MEMORY_VERSION,
      applied,
      duplicates,
      pages: graph.pages().length,
      blocks: graph.allBlocks().length,
    };
  } finally {
    store.close();
  }
}
