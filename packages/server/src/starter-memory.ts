import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { type Change, VeraGraph } from '@vera/core';
import { loadGraph, openStore, recordOperation, saveParticipant } from '@vera/store';

export const STARTER_MEMORY_VERSION = 1;
export const DISTRIBUTION_PARTICIPANT = 'participant:vera-distribution';

interface StarterChange {
  readonly id: string;
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
  property('connections', 'tipo', 'configuración'),
  property('connections', 'special-kind', 'connections'),
  block('connections', 'connections-title', 0, '# Conexiones'),
  block('connections', 'connections-intro', 1,
    'Esta página gobierna qué inteligencias pueden entrar a Vera, con qué identidad y con qué alcance. La memoria sigue siendo local aunque actives un puente remoto.'),
  block('connections', 'connections-list', 2, '## Conexiones autorizadas'),
  block('connections', 'connections-conecta', 3,
    'Vera Conecta permanece desactivada hasta que la persona propietaria la activa aquí. La dirección pública identifica una instalación, pero nunca autoriza por sí sola.'),

  page('principles', 'VERA — Principios'),
  property('principles', 'tipo', 'documentación'),
  block('principles', 'principles-title', 0, '# Principios'),
  block('principles', 'principles-sovereign', 1, '**Soberanía.** La memoria pertenece a una persona; las herramientas y agentes participan bajo su autoridad.'),
  block('principles', 'principles-authorship', 2, '**Autoría.** Toda contribución conserva quién la produjo y por qué canal llegó.'),
  block('principles', 'principles-malleable', 3, '**Maleabilidad.** La estructura sirve al pensamiento y puede cambiar sin entregar el control del corpus.'),
  block('principles', 'principles-publication', 4, '**Publicación deliberada.** Lo privado no se vuelve público por accidente ni por comodidad técnica.'),
  block('principles', 'principles-portable', 5, '**Portabilidad.** Programa y memoria son cosas distintas: actualizar Vera no reemplaza ni secuestra el corpus.'),
  block('principles', 'principles-accountable', 6, '**Auditabilidad.** Las transformaciones importantes son visibles, atribuibles y recuperables.'),
];

export interface InitializeStarterMemoryOptions {
  readonly databasePath: string;
  readonly owner: { readonly id: string; readonly name: string };
}

export interface StarterMemoryReport {
  readonly version: number;
  readonly applied: number;
  readonly duplicates: number;
  readonly pages: number;
  readonly blocks: number;
}

export function initializeStarterMemory(options: InitializeStarterMemoryOptions): StarterMemoryReport {
  if (options.databasePath !== ':memory:') mkdirSync(dirname(options.databasePath), { recursive: true });
  const store = openStore({ path: options.databasePath, graphName: 'mind' });
  try {
    const graph = loadGraph(store, 'mind');
    const established = graph.owner;
    if (established !== null && established !== options.owner.id) {
      throw new Error(`la memoria ya pertenece a ${established}; no se puede reinicializar como ${options.owner.id}`);
    }
    if (established === null) {
      saveParticipant(store, { ...options.owner, kind: 'human' });
      graph.addParticipant({ ...options.owner, kind: 'human' });
      graph.admit(options.owner.id);
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
    for (const entry of STARTER_CHANGES) {
      const outcome = graph.submitOperation({
        originId: `starter-memory:v${STARTER_MEMORY_VERSION}:${entry.id}`,
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
