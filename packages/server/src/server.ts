// Servidor local de Vera.
//
// Es deliberadamente pequeño: sin framework, sobre el HTTP que trae Node. La
// única entrada de escritura es POST /operations, que valida contra @vera/core
// y sólo entonces persiste. No hay ningún camino que escriba en la base sin
// pasar por ahí.

import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { hostname, userInfo } from 'node:os';

import {
  TESTIMONY_KEY,
  VeraGraph,
  isTrail,
  readTrail,
  type Trail,
  answersIn,
  checkInvariants,
  FIELD_KINDS,
  SPECIAL_KIND,
  invert,
  nextToRedo,
  nextToUndo,
  inverseOf,
  namesFromRoles,
  readObjectDeclarations,
  readPropertyDeclarations,
  readPropertyNames,
  readQuery,
  referencedTitles,
  canonicalUrl,
  suggestedPathFor,
  titleKey,
  writeQuery,
  STARTER_RELATIONS,
  CHANGE_KINDS as CORE_CHANGE_KINDS,
  CONTRIBUTION_CHANNELS,
} from '@vera/core';
import type {
  Change,
  ContributionChannel,
  DeclaredBlock,
  Operation,
  OriginEvidence,
  ParticipantId,
} from '@vera/core';
import {
  createRecording,
  foldedOnPage,
  loadGraph,
  discardAudio,
  describeMedia,
  deleteOrphanMedia,
  listedMedia,
  mediaByHash,
  mediaReferences,
  openStore,
  placeRecording,
  recordOperation,
  recordMedia,
  recordingById,
  recordings,
  recordingsInPage,
  removeRecording,
  restoreAudio,
  removePublication,
  savePublication,
  saveParticipant,
  saveSite,
  saveWorkspace,
  setFold,
  setTranscript,
  setSpokenOrigin,
  spokenOriginsOnPage,
  workspaceOf,
  type Store,
} from '@vera/store';
import { composeBooklet, composePaper, toPdf } from './paper.ts';
import { HASH, hashBytes, mediaTypeFor, objectPath, putObject, sniffMediaType } from '@vera/store/objects';
import { activityOf } from './activity.ts';
import { forgetSecret, revealSecret, saveSecret, secretsOf, useSecret } from '@vera/store/secrets';
import { clientsSeen, exposuresOf, recordExposure, whoRead } from '@vera/store/exposures';
import { parseDocument } from '@vera/importer/document';
import {
  SCOPES,
  bearerOf,
  issueCredential,
  listCredentials,
  resolveSecret,
  revokeCredential,
  credentialById,
  scopeRefusal,
  type Credential,
  type Scope,
} from './credentials.ts';
import {
  answerLibrarianRequest,
  claimLibrarianRequest,
  createLibrarianRequest,
  librarianRequest,
  librarianRequestsFor,
  markLibrarianDispatched,
  pendingLibrarianDispatches,
  removeLibrarianRequest,
} from './librarian.ts';
import type { Reading } from './model.ts';
import {
  ask,
  readPage,
  mergeReadings,
  modelPresence,
  proposeHierarchy,
  MOST_PASSES,
  READABLE_CHARS,
  STARTER_TYPES,
} from './model.ts';
import { relevantConcepts, type ConceptCandidate } from './ontology-context.ts';
import { LOCAL_MODEL, LOCAL_MODEL_NAME, promptFor, readAnswer } from './answer.ts';
import { formalizationOf, mentionsOf } from './mentions.ts';
import { CLIENT_KEY, MCP_KIND, mcpPage } from './mcp-page.ts';
import { mcpConnect } from './mcp-connect.ts';
import {
  confinementOf,
  confinements,
  discardRequests,
  fenceRefusal,
  grantConfinement,
  withdrawConfinement,
} from './confinement.ts';
import {
  BIBLIOGRAPHY_NAMES,
  blocksFor,
  propertiesFor,
  servicePages,
  titleFor,
} from './services.ts';
import { children, item, search, whoami, type ZoteroItem } from './zotero.ts';
import { youtubeTranscript, youtubeTranscriptChoices } from './youtube-transcript.ts';
import { readLinks } from './process.ts';
import { describeStructure, readingPasses, readStructure } from './structure.ts';
import { describePlan, planTabularity } from './tabularity.ts';
import { transcribeAudio } from './transcribe.ts';
import { renderPage } from '@vera/store/projection';
import {
  p5FrameDocument,
  p5RuntimePath,
  projectPublicSiteAtomically,
} from '@vera/store/public-projection';
import { makeVeraFile, readVeraFile } from './vera-file.ts';
import {
  administrationOf,
  addSharedSpaceCriterion,
  changeGrantPermissions,
  createSharedProposal,
  createSharedSpace,
  decideSharedProposal,
  deleteInvitation,
  includeManualPage,
  inspectInvitation,
  inviteToSpace,
  DEFAULT_INVITATION_LIFETIME,
  pageBelongsToSharedSpace,
  propertyMatchesSharedSpaceCriterion,
  redeemInvitation,
  removeManualPage,
  removeSharedSpaceCriterion,
  revokeGrant,
  revokeInvitation,
  revokeParticipantSessions,
  sharedSpaceBySlug,
  sharedProposal,
  sharedSpaces,
  updateSharedSpace,
  type SharedPermission,
} from './shared-spaces.ts';
import {
  authenticationOptions,
  ceremonyFor,
  finishAuthentication,
  finishRegistration,
  participantForSession,
  registrationOptions,
  revokeSession,
} from './human-auth.ts';
import { completeOwnerBootstrapIfDue } from './owner-bootstrap.ts';

const CHANGE_KINDS = new Set<string>(CORE_CHANGE_KINDS);

/*
 * Cuántas páginas viajan en una respuesta.
 *
 * Una pregunta puede seleccionar dos mil, y ninguna pantalla las lee. Se manda un
 * tramo y se dice cuántas quedaron fuera: recortar en silencio convertiría «hay
 * doscientas» en «hay doscientas y son éstas».
 */
const MOST_ANSWERS = 200;

/**
 * La lectura pública no suplanta a una persona del grafo.
 *
 * Es una identidad de frontera: sirve para decidir y auditar el alcance de una
 * petición, pero no se admite como participante ni puede firmar operaciones.
 */
const ANYBODY = 'participant:anybody' as ParticipantId;

// Del dominio y no repetida aquí: una lista copiada es una lista que se queda
// atrás el día que el vocabulario crece, y el borde HTTP rechazaría por
// desconocido algo que @vera/core acepta.
const CHANNELS: ReadonlySet<string> = new Set<string>(CONTRIBUTION_CHANNELS);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.md': 'text/markdown; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  // Las fuentes las sirve Vera. Sin su tipo declarado viajan como binario
  // cualquiera, y aunque el navegador suele tragárselo por el `format()` del
  // @font-face, no hay razón para servir algo diciendo que no se sabe qué es.
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

/*
 * Cuánto puede guardarse cada archivo del cliente.
 *
 * Sin decirlo, el navegador lo decide por su cuenta con una heurística, y una
 * Vera instalada como aplicación puede quedarse corriendo una versión de hace
 * días sin ninguna forma de enterarse. Que el código nuevo llegue a quien ya la
 * tiene abierta no es una optimización: es la diferencia entre arreglar algo y
 * que el arreglo exista sólo en el repositorio.
 *
 * La regla es el prefijo, no la forma del nombre. Todo lo que vite compila cae
 * en `/build/` con una huella en el nombre: no puede cambiar de contenido sin
 * cambiar de ruta, así que guardarlo un año no puede servir nunca una versión
 * equivocada. Fuera de ahí —el index, el manifiesto, el propio service worker,
 * los iconos, las fuentes— los nombres se repiten entre versiones, y por eso
 * hay que volver a preguntar por ellos cada vez.
 */
const FINGERPRINTED = '/build/';
const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

export interface ServerOptions {
  databasePath: string;
  /** Raíz de archivos estáticos del cliente. */
  webRoot?: string;
  /** Almacén de objetos direccionado por hash, donde viven los binarios. */
  objectsRoot?: string;
  owner?: { id: ParticipantId; name: string };
  /**
   * En qué puerto quedó escuchando, para poder decirlo.
   *
   * El servidor no lo necesitaba: lo abre `listen` y quien maneja una petición
   * nunca se lo pregunta. Hace falta para la página de la puerta, que tiene que
   * dictar el `VERA_URL` que va en el formulario de cada IA, y ese valor no se
   * puede adivinar desde dentro de un manejador.
   */
  port?: number;
  librarianHook?: { url: string; token: string };
  /**
   * Por dónde se alcanza esta Vera desde otro equipo, si alguien lo declaró.
   *
   * Vera escucha en loopback y quien la publica elige el frente. Esa dirección
   * la sabe quien la configuró; el proceso que corre detrás no.
   */
  reachableAt?: string;
  /** Credencial cifrada para una puerta MCP lanzada por ssh. No contiene el secreto. */
  remoteMcpCredential?: { client: string; file: string; name: string };
  /** Sitio estático que esta instancia publica, si su dueño lo configuró. */
  publicSite?: { title: string; canonicalDomain: string };
  /** Origen loopback de la única ruta MCP expuesta por el dominio público. */
  publicMcpOrigin?: string;
  /** Directorio estable que Tailscale Serve o el alojamiento público sirven. */
  publicOutput?: string;
  /** Iconos y manifiesto que acompañan a la proyección pública. */
  publicBranding?: string;
  /** Puerto loopback que sirve sólo la proyección, para una vista previa privada. */
  publicPreviewPort?: number;
  /** Dirección privada que el dueño puede abrir para ver esa proyección. */
  publicPreviewUrl?: string;
}

export interface VeraServer {
  handle(request: IncomingMessage, response: ServerResponse): void;
  /** La misma aplicación, atravesando obligatoriamente la frontera pública. */
  handlePublic(request: IncomingMessage, response: ServerResponse): void;
  graph: VeraGraph;
  store: Store;
  close(): void;
}

interface SubmitBody {
  originId?: unknown;
  participant?: unknown;
  channel?: unknown;
  evidence?: unknown;
  change?: unknown;
}

interface SubmitBatchBody {
  originId?: unknown;
  participant?: unknown;
  changes?: unknown;
}

const MAX_BATCH_CHANGES = 1_000;
const MAX_BATCH_BYTES = 2 * 1024 * 1024;

/** Quién resultó ser quien escribe, y por qué canal se registra lo que escriba. */
interface Submitter {
  participant: ParticipantId;
  channel: ContributionChannel | null;
  credential: Credential | null;
}

/**
 * Decide quién está escribiendo.
 *
 * @invariant IdentityComesFromTheCredential. Con credencial, el participante
 * sale de ella; lo que el cuerpo diga sólo puede coincidir o ser rechazado.
 * Nunca se honra una identidad distinta de la que la credencial nombra.
 *
 * Sin credencial se sigue asumiendo el dueño, que es lo que v0 hace desde el
 * principio y lo que docs/architecture.md declara: la aplicación corre en
 * localhost con un único participante propietario y su identidad todavía no se
 * demuestra. Lo que cambia hoy es que esa vía ya no puede escribir como otro:
 * para firmar como el bibliotecario hace falta su credencial.
 */
function authorise(
  store: Store,
  graph: VeraGraph,
  header: string | undefined,
  claimed: unknown,
  changeKind: string,
): { error: string; status: number } | Submitter {
  const secret = bearerOf(header);

  if (secret === null) {
    const owner = graph.owner;
    if (owner === null) return { error: 'this graph has no owner', status: 500 };
    if (typeof claimed === 'string' && claimed !== '' && claimed !== owner) {
      return {
        status: 403,
        error:
          `sin credencial sólo se escribe como ${owner}. ` +
          `Para escribir como ${claimed} hace falta su credencial.`,
      };
    }
    return { participant: owner, channel: null, credential: null };
  }

  const resolved = resolveSecret(store, secret);
  if (!resolved.ok) return { error: resolved.detail, status: 401 };

  const credential = resolved.credential;
  if (typeof claimed === 'string' && claimed !== '' && claimed !== credential.participant) {
    return {
      status: 403,
      error: `la credencial escribe como ${credential.participant}, no como ${claimed}`,
    };
  }

  const refusal = scopeRefusal(credential, changeKind);
  if (refusal !== null) return { error: refusal, status: 403 };

  // @invariant ChannelFollowsParticipantKind: el canal se deriva de qué es quien
  // escribe, no se lee del cuerpo. Un agente no puede presentar su generación
  // como texto tecleado ni aunque lo pida.
  const kind = graph.participant(credential.participant)?.kind;
  return {
    participant: credential.participant,
    channel: kind === 'agent' ? 'agent_generation' : null,
    credential,
  };
}

const EXCERPT = 140;

/** Una línea legible del bloque, sin arrastrar transcripciones enteras. */
function excerpt(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length <= EXCERPT ? flat : `${flat.slice(0, EXCERPT).trimEnd()}…`;
}

/** Valida la forma del cuerpo antes de dejarlo entrar al dominio. */
/**
 * A qué página tocó un cambio.
 *
 * Lo pregunta `GET /ops`, y es lo que convierte una lista de identificadores en
 * una respuesta útil: quien lleva un cursor quiere saber si lo que pasó le pasó a
 * la página que tiene delante. @guarantee KnowingIsCheapAndTakingIsNot.
 *
 * `pageOf` resuelve un bloque a su página, y puede no saber: un `remove_block` se
 * pregunta cuando el bloque ya no está. Se contesta nulo, que quien pregunta sabe
 * leer como «no se puede saber» y no como «ninguna».
 */
export function pageTouchedBy(
  change: Change,
  subjectId: string | null,
  pageOf: (block: string) => string | undefined,
): string | null {
  switch (change.kind) {
    case 'create_page':
      return subjectId;
    case 'rename_page':
    case 'set_page_visibility':
    case 'recover_page_origin':
    case 'remove_page':
      return change.page;
    case 'create_block':
    case 'move_block':
      return change.page;
    case 'edit_block':
    case 'remove_block':
    case 'set_block_gloss':
      return pageOf(change.block) ?? null;
    case 'set_property':
    case 'remove_property':
      // Una propiedad cuelga de una página o de un bloque, y sólo de uno de los dos.
      return change.page ?? (change.block === undefined ? null : (pageOf(change.block) ?? null));
    default:
      return null;
  }
}

function readOperation(body: SubmitBody): { error: string } | {
  originId: string;
  channel: ContributionChannel;
  evidence?: OriginEvidence;
  change: Change;
} {
  if (typeof body.originId !== 'string' || body.originId === '') {
    return { error: 'originId must be a non-empty string' };
  }
  // `participant` ya no se exige ni se cree: quien escribe lo decide authorise()
  // a partir de la credencial. Si el cuerpo lo trae, es una afirmación que se
  // comprueba, y afirmarlo distinto se rechaza allí (@invariant
  // IdentityComesFromTheCredential).
  if (body.participant !== undefined && typeof body.participant !== 'string') {
    return { error: 'participant, if given, must be a string' };
  }
  const channel = body.channel ?? 'typed_text';
  if (typeof channel !== 'string' || !CHANNELS.has(channel)) {
    return { error: `channel must be one of ${[...CHANNELS].join(', ')}` };
  }
  const change = body.change;
  if (typeof change !== 'object' || change === null) return { error: 'change must be an object' };
  const kind = (change as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || !CHANGE_KINDS.has(kind)) {
    return { error: `change.kind must be one of ${[...CHANGE_KINDS].join(', ')}` };
  }

  let evidence: OriginEvidence | undefined;
  if (body.evidence !== undefined && body.evidence !== null) {
    const raw = body.evidence as { reference?: unknown; capturedAt?: unknown };
    if (typeof raw.reference !== 'string' || typeof raw.capturedAt !== 'number') {
      return { error: 'evidence needs a reference string and a capturedAt number' };
    }
    evidence = { reference: raw.reference, capturedAt: raw.capturedAt };
  }

  return {
    originId: body.originId,
    channel: channel as ContributionChannel,
    change: change as Change,
    ...(evidence === undefined ? {} : { evidence }),
  };
}

export function createVeraServer(options: ServerOptions): VeraServer {
  const store = openStore({ path: options.databasePath, graphName: 'mind' });

  const dispatchLibrarianRequest = async (id: string): Promise<void> => {
    if (options.librarianHook === undefined) {
      markLibrarianDispatched(store, id, false, 'el puente con OpenClaw no está configurado');
      return;
    }
    try {
      const wake = await fetch(options.librarianHook.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.librarianHook.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ requestId: id }),
        signal: AbortSignal.timeout(10_000),
      });
      markLibrarianDispatched(store, id, wake.ok, wake.ok ? undefined : `OpenClaw respondió ${wake.status}`);
    } catch (error) {
      markLibrarianDispatched(store, id, false, error instanceof Error ? error.message : 'OpenClaw no respondió');
    }
  };
  const retryLibrarianDispatches = setInterval(() => {
    for (const id of pendingLibrarianDispatches(store)) void dispatchLibrarianRequest(id);
  }, 30_000);
  retryLibrarianDispatches.unref();

  /*
   * El grafo en memoria se reconstruye del log al arrancar y responde las
   * lecturas; el disco conserva la verdad.
   *
   * Y por eso puede volver a reconstruirse: `let` y no `const` porque cuando
   * persistir falla hay que rehacerlo. Ver más abajo, donde se recoge ese fallo.
   */
  let graph = loadGraph(store, 'mind');

  /*
   * Persistir puede fallar por algo que el dominio no vio venir. La
   * transacción revierte sola, pero sin este intento la excepción subía hasta
   * el proceso, o —peor— dejaba la memoria diciendo un cambio que el disco ya
   * no tiene.
   *
   * @invariant IdempotentOrderedApplication (change-application.allium):
   * aplicación todo-o-nada. El dominio ya mutó `graph` quando esto se llama;
   * si `recordOperation` lanza, sólo el disco revierte, así que reconstruir
   * `graph` del log es la única forma de que memoria y disco vuelvan a decir
   * lo mismo. Cada llamador decide qué hacer con el mensaje de fallo según su
   * propio idioma (lanzar, devolver `null`, devolver `{ error }`).
   */
  const persist = (operation: Operation): string | null => {
    try {
      recordOperation(store, graph, operation);
      return null;
    } catch (error) {
      graph = loadGraph(store, 'mind');
      return error instanceof Error ? error.message : String(error);
    }
  };

  /*
   * De quién es este grafo lo dice el grafo, no la configuración.
   *
   * Un grafo con historia ya tiene dueño: es quien firmó lo que hay dentro, y
   * eso no lo puede cambiar una variable de entorno sin volver falsa la
   * procedencia de todo lo escrito. La configuración sólo decide para un grafo
   * que todavía no tiene a nadie, que es el caso de quien acaba de instalar.
   *
   * Antes había un nombre escrito aquí, así que toda instalación nueva nacía
   * firmando como el dueño de la primera. Ya no hay ninguno: sin grafo previo y
   * sin `VERA_OWNER`, Vera se planta en vez de inventar una identidad, porque
   * escribir durante días como otra persona es un error que no avisa.
   */
  const established = graph.owner;
  let owner: { id: ParticipantId; name: string };
  if (established !== null) {
    owner = { id: established, name: graph.participant(established)?.name ?? established };
  } else if (options.owner !== undefined) {
    owner = options.owner;
    saveParticipant(store, { id: owner.id, name: owner.name, kind: 'human' });
    graph.addParticipant({ id: owner.id, name: owner.name, kind: 'human' });
    graph.admit(owner.id);
  } else {
    throw new Error(
      'este grafo todavía no tiene dueño y nadie dijo quién es: ' +
        'declara VERA_OWNER y VERA_OWNER_NAME en .env, o corre `npm run setup`',
    );
  }

  const webRoot = options.webRoot === undefined ? null : resolve(options.webRoot);
  const objectsRoot = options.objectsRoot === undefined ? null : resolve(options.objectsRoot);

  const publicSite = () => {
    const owned = graph.sites().filter((site) => site.owner === owner.id);
    const declared = options.publicSite === undefined
      ? undefined
      : graph.siteByDomain(options.publicSite.canonicalDomain);
    return declared ?? (owned.length === 1 ? owned[0] : undefined);
  };

  const publicPageIds = (): ReadonlySet<string> => {
    const site = publicSite();
    return new Set(
      site === undefined
        ? []
        : graph.publicationsOf(site.id)
            // Las páginas que gobiernan Vera no forman parte de su discurso
            // público aunque alguien las marque por error.
            .filter((one) =>
              !graph.propertiesOf(one.page).some((property) => property.key === SPECIAL_KIND),
            )
            .map((one) => one.page),
    );
  };

  const isPublicPage = (page: string): boolean => publicPageIds().has(page);

  /** La publicación que ocupa una ruta canónica legible del sitio. */
  const publicationAtPath = (pathname: string) => {
    const site = publicSite();
    if (site === undefined) return undefined;
    let wanted: string;
    try {
      wanted = decodeURIComponent(pathname).replace(/^\/+|\/+$/g, '');
    } catch {
      return undefined;
    }
    return graph.publicationsOf(site.id).find((publication) => publication.path === wanted);
  };

  /** Sólo los objetos nombrados desde una publicación explícita pueden salir. */
  const publicMediaHashes = (pages: ReadonlySet<string> = publicPageIds()): ReadonlySet<string> =>
    new Set(
      [...pages].flatMap((page) =>
        [
          ...assetsOf(page).map((asset) => asset.url.slice('/media/'.length)),
          ...recordingsInPage(store, page).flatMap((recording) =>
            recording.audioHash === null ? [] : [recording.audioHash],
          ),
        ],
      ),
    );

  const publicationView = (pageId: string) => {
    const site = publicSite();
    const page = graph.page(pageId);
    if (page === undefined) return null;
    const title = site?.title ?? options.publicSite?.title;
    const domain = site?.canonicalDomain ?? options.publicSite?.canonicalDomain;
    if (title === undefined || domain === undefined) return null;
    const publication = site === undefined
      ? undefined
      : graph.publicationsOf(site.id).find((candidate) => candidate.page === pageId);
    const path = publication?.path ?? suggestedPathFor(page.title);
    return {
      site: site?.id ?? null,
      siteTitle: title,
      canonicalDomain: domain,
      path,
      url: canonicalUrl(domain, path),
      publishedAt: publication?.publishedAt ?? null,
      entryPoint: site?.entryPoint === pageId,
    };
  };

  /** La página VERA:Publicación lee esta vista; no guarda una segunda copia. */
  const publicationSiteView = () => {
    const site = publicSite();
    const title = site?.title ?? options.publicSite?.title ?? '';
    const canonicalDomain = site?.canonicalDomain ?? options.publicSite?.canonicalDomain ?? '';
    const publications = site === undefined
      ? []
      : graph.publicationsOf(site.id).map((publication) => {
          const page = graph.page(publication.page);
          return {
            page: publication.page,
            title: page?.title ?? publication.page,
            path: publication.path,
            url: canonicalUrl(site.canonicalDomain, publication.path),
            firstRevision: publication.firstRevision,
            publishedAt: publication.publishedAt,
            publishedBy: publication.publishedBy,
            entryPoint: site.entryPoint === publication.page,
          };
        });
    let previewUrl = options.publicPreviewUrl ?? null;
    if (
      previewUrl === null &&
      options.reachableAt !== undefined &&
      options.publicPreviewPort !== undefined
    ) {
      try {
        const reachable = new URL(options.reachableAt);
        const labels = reachable.hostname.split('.');
        labels[0] = hostname().split('.')[0] ?? hostname();
        reachable.hostname = labels.join('.');
        reachable.port = String(options.publicPreviewPort);
        reachable.pathname = '/';
        reachable.search = '';
        reachable.hash = '';
        previewUrl = reachable.toString();
      } catch {
        // Una dirección operativa mal declarada no invalida la configuración
        // editorial: simplemente no se ofrece un enlace que no se conoce.
      }
    }
    return {
      site: site?.id ?? null,
      title,
      canonicalDomain,
      entryPoint: site?.entryPoint ?? null,
      previewUrl,
      publications,
    };
  };

  /** La base nunca se sirve: sólo este directorio reemplazado atómicamente. */
  const rebuildPublicSite = (): void => {
    if (options.publicOutput === undefined) return;
    const site = publicSite();
    if (site === undefined) return;
    projectPublicSiteAtomically(graph, resolve(options.publicOutput), {
      site,
      publications: graph.publicationsOf(site.id),
      ...(options.publicBranding === undefined
        ? {}
        : { brandingAssets: resolve(options.publicBranding) }),
    });
  };

  // Las rutas del grafo y su objeto. Se leen una vez: el mapa cambia cuando se
  // ingiere un medio, no cuando se lee una página.
  const media = mediaReferences(store);

  // Si ya había publicaciones, el proceso vuelve a dejar su proyección al día
  // antes de aceptar peticiones. Una salida vieja no se sirve como si fuera la
  // revisión vigente.
  rebuildPublicSite();

  /*
   * El vocabulario de relaciones, leído de donde manda.
   *
   * Vive en la página de ontología, bajo un bloque que empiece por «Relaciones»,
   * con un término por hijo y su recíproco detrás de un separador:
   *
   *     Relaciones iniciales
   *       profundiza · es profundizada por
   *       se opone a · se opone a
   *
   * Sin esa página, o sin ese bloque, rige lo que Vera trae —@invariant
   * DefaultsLiveInTheCode—, que es un mínimo para que explicar una relación no
   * exija antes construir un vocabulario.
   */
  /*
   * La página que gobierna el vocabulario.
   *
   * Se encuentra por `special-kind`, que es la única palabra que Vera no puede
   * dejar que declare el corpus: es con la que se encuentra la página donde el
   * corpus declara las demás.
   */
  const ontologyPage = () => governing('ontology');

  /*
   * Los hijos del bloque de la ontología que empieza por esa palabra.
   *
   * Se le quitan las almohadillas antes de mirar: un apartado de una página se
   * escribe como encabezado, y exigir el texto desnudo hacía que declarar algo
   * bien escrito no sirviera de nada — sin decirlo, además.
   */
  const opens = (content: string, opening: RegExp): boolean =>
    opening.test(content.trim().replace(/^#{1,6}\s+/, ''));

  const declared = (opening: RegExp): string[] => {
    const ontology = ontologyPage();
    if (ontology === undefined) return [];
    const heading = graph.blocksOf(ontology.id).find((block) => opens(block.content, opening));
    if (heading === undefined) return [];
    return graph
      .blocksOf(ontology.id)
      .filter((block) => block.parent === heading.stableId)
      .map((block) => block.content.trim())
      .filter((line) => line !== '');
  };

  /*
   * Cómo llama este corpus a las propiedades que el dominio necesita conocer.
   *
   * Se lee al arrancar y cada vez que hace falta, porque la página que las
   * declara se edita como cualquier otra y cambiarla no debería pedir reiniciar.
   */
  /*
   * Las páginas que dicen de qué está hecho este corpus.
   *
   * Se buscan por lo que declaran gobernar y no por su título: una página se
   * puede llamar como quiera y seguir siendo la de las propiedades. Ver
   * specs/special-pages.allium.
   */
  const governing = (kind: string) =>
    graph
      .pages()
      .find((candidate) =>
        graph
          .propertiesOf(candidate.id)
          .some((property) => property.key === SPECIAL_KIND && property.value === kind),
      );

  /**
   * Las páginas que gobiernan Vera son permanentes y deliberadas.
   *
   * Se acepta tanto la junta canónica `special-kind` como la declaración humana
   * `tipo=página especial`: durante una migración una puede llegar antes que la
   * otra, y en esa ventana conviene proteger de más, no de menos.
   */
  const isSpecialPage = (pageId: string): boolean => {
    const folded = (value: string): string =>
      value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
    const names = propertyNames();
    return graph.propertiesOf(pageId).some(
      (property) =>
        property.key === SPECIAL_KIND ||
        (folded(property.key) === folded(names.kind) && folded(property.value) === 'pagina especial'),
    );
  };

  /*
   * Los bloques de una página especial que declaran algo.
   *
   * Un bloque declara cuando lleva propiedades colgando; la prosa que lo rodea
   * —lo que alguien escribió para explicar de qué va la página, por qué se
   * decidió tal cosa— no lleva ninguna y por eso no se lee como una declaración.
   * Así la página no necesita apartados con nombres mágicos, y quien la escribe
   * puede ordenarla como quiera.
   */
  const declaredIn = (kind: string): DeclaredBlock[] => {
    const page = governing(kind);
    if (page === undefined) return [];
    return graph
      .blocksOf(page.id)
      .map((block) => ({
        // Se nombra el bloque para que lo declarado se pueda corregir donde se
        // lee. Ver `DeclaredBlock.block`.
        block: block.stableId,
        content: block.content,
        properties: graph
          .propertiesOf(block.stableId)
          .map((one) => ({ key: one.key, value: one.value })),
      }))
      .filter((block) => block.content.trim() !== '' && block.properties.length > 0);
  };

  /** Cada propiedad de este corpus, con qué clase de campo es. */
  const declaredProperties = () => readPropertyDeclarations(declaredIn('properties'));

  /** Cada clase de cosa, con qué propiedades la constituyen. */
  const declaredObjects = () => readObjectDeclarations(declaredIn('objects'));

  /*
   * Cómo llama este corpus a lo que el dominio necesita conocer.
   *
   * De las dos páginas donde puede estar dicho, porque los papeles no son todos
   * de claves: `kind` o `topic` nombran una propiedad y se declaran en
   * «Propiedades»; `day` nombra la clase con que nace un día, que es un valor de
   * `tipo` y por tanto una clase de «Objetos». Leer sólo la primera obligaba a
   * escribir `bitácora` allí como si fuera una clave, y quedaba declarada dos
   * veces —bien como clase, mal como propiedad—.
   *
   * Y si no hay ninguna, la lista de la ontología, que es como se declaraba
   * antes. Un corpus que ya lo escribió así no tiene por qué enterarse de que
   * Vera cambió de sitio.
   */
  const propertyNames = () => {
    const roles = [...declaredProperties(), ...declaredObjects()].filter(
      (one) => one.role !== null,
    );
    if (roles.length > 0) return namesFromRoles(roles);
    return readPropertyNames(declared(/^Nombres de propiedades/i));
  };

  /*
   * Qué páginas vinieron de fuera, y de qué ítem cada una.
   *
   * Se deriva del corpus y no de una tabla: la procedencia está escrita en la
   * página que vino —`fuente:: zotero`, `zotero:: ABCD1234`— y por eso sobrevive
   * a exportar el corpus, a reconstruirlo del log y a mirarlo con un editor de
   * texto. Una tabla aparte diciendo lo mismo es una tabla que un día dice otra
   * cosa.
   */
  const broughtFrom = (source: string): Map<string, { page: string; version: number }> => {
    const found = new Map<string, { page: string; version: number }>();
    for (const page of graph.pages()) {
      const properties = graph.propertiesOf(page.id);
      const from = properties.find((one) => one.key === BIBLIOGRAPHY_NAMES.source);
      if (from === undefined || from.value.trim().toLowerCase() !== source) continue;
      const key = properties.find((one) => one.key === BIBLIOGRAPHY_NAMES.key);
      if (key === undefined) continue;
      const version = properties.find((one) => one.key === BIBLIOGRAPHY_NAMES.version);
      found.set(key.value.trim(), {
        page: page.id,
        version: Number(version?.value ?? 0) || 0,
      });
    }
    return found;
  };

  /*
   * Traer un ítem: se vuelve una página, o refresca la que ya era.
   *
   * Escribe por la puerta de siempre —una operación por cambio, con su autor y
   * su secuencia— y por el canal `import`, que es lo que este acto es: material
   * que viene de fuera. Firma quien es dueño del grafo, porque es quien pidió
   * traerlo; el ítem no lo escribió nadie de aquí, y eso lo dice la procedencia
   * que la página lleva puesta.
   */
  const bringItem = (
    found: ZoteroItem,
    library: string,
    notes: readonly string[],
  ): { page: string; title: string; created: boolean; refreshed: boolean } => {
    const stamp = Date.now();
    let step = 0;
    const write = (change: Change): string | null => {
      const outcome = graph.submitOperation({
        originId: `zotero:${found.key}:${stamp}:${(step += 1)}`,
        participant: owner.id,
        channel: 'import',
        change,
      });
      if (outcome.status !== 'applied') return null;
      if (persist(outcome.operation) !== null) return null;
      return outcome.operation.subjectId;
    };

    const kind = propertyNames().kind;
    const held = broughtFrom('zotero').get(found.key);
    const properties = propertiesFor(found, library, kind, 'Referencia');

    if (held !== undefined) {
      /*
       * Ya estaba. Se refresca sólo si Zotero tiene algo más nuevo.
       *
       * Y se refrescan las propiedades, no los bloques: lo que alguien escribió
       * en esa página después de traerla es suyo, y una sincronización que lo
       * pisara convertiría el corpus en una copia de Zotero. @guarantee
       * VeraAggregatesResearchContext.
       */
      if (found.version > held.version) {
        for (const property of properties) {
          write({
            kind: 'set_property',
            page: held.page,
            propertyKey: property.key,
            propertyValue: property.value,
          });
        }
      }
      return {
        page: held.page,
        title: graph.page(held.page)?.title ?? found.title,
        created: false,
        refreshed: found.version > held.version,
      };
    }

    const title = titleFor(found, (name) => graph.pageTitled(name) !== undefined);
    const made = write({ kind: 'create_page', title, visibility: 'private' });
    if (made === null) throw new Error('el dominio rechazó crear la página del ítem');
    for (const property of properties) {
      write({
        kind: 'set_property',
        page: made,
        propertyKey: property.key,
        propertyValue: property.value,
      });
    }
    const blocks = blocksFor(found, notes);
    blocks.forEach((content, index) => {
      write({ kind: 'create_block', page: made, parent: null, position: index, content });
    });
    return { page: made, title, created: true, refreshed: false };
  };

  /*
   * Los medios que una página nombra, con a qué objeto resuelve cada ruta.
   *
   * El bloque conserva su `../assets/foo.png` —lo que mantiene portable la
   * proyección Markdown— y aquí viaja a qué apunta. Lo necesitan la vista de la
   * página y el papel del que sale un PDF.
   */
  /**
   * La página leída como recorrido, si dice serlo.
   *
   * Nada de esto se guarda: los nodos son las referencias que el texto lleva, las
   * conectivas son lo que queda del texto al quitarlas y los cruces son los pares
   * de nodos consecutivos. Se calcula al mirar, y por eso un cruce a campo través
   * puede contestar distinto mañana sin que el recorrido se toque.
   *
   * Ver packages/core/src/trail.ts y specs/trail.allium.
   */
  const trailOf = (pageId: string): Trail | null => {
    if (isSpecialPage(pageId)) return null;
    const names = propertyNames();
    if (!isTrail(graph.propertiesOf(pageId), names)) return null;
    const intent = graph
      .propertiesOf(pageId)
      .find((one) => one.key.trim().toLowerCase() === 'propósito');
    return readTrail({
      page: pageId,
      intent: intent?.value.trim() ?? null,
      blocks: graph.blocksOf(pageId).map((block) => ({
        stableId: block.stableId,
        parent: block.parent,
        position: block.position,
        content: block.content,
        testimony:
          graph
            .propertiesOf(block.stableId)
            .find((one) => one.key.trim().toLowerCase() === TESTIMONY_KEY)
            ?.value ?? null,
        citedCrossing:
          graph.propertiesOf(block.stableId)
            .find((one) => one.key.trim().toLowerCase() === 'conectiva')
            ?.value ?? null,
        citedRevision:
          graph.propertiesOf(block.stableId)
            .find((one) => one.key.trim().toLowerCase() === 'revisión de conectiva')
            ?.value ?? null,
      })),
      resolve: (title) => graph.pageTitled(title)?.id ?? null,
      /*
       * Sin contar los enlaces que salen del propio recorrido. Un recorrido
       * enlaza a todas sus paradas —es lo que lo hace encontrable desde cada
       * una— y contarlos haría que todo cruce fuera por camino por construcción.
       */
      linked: (a, b) =>
        graph
          .backlinks(b)
          .some((link) => link.sourcePage === a && link.sourcePage !== pageId) ||
        graph
          .backlinks(a)
          .some((link) => link.sourcePage === b && link.sourcePage !== pageId),
      relation: (from, to) => {
        const crossing = graph.crossingsOut(from).find((one) => one.toPage === to);
        if (crossing === undefined) return null;
        const revision = graph.revisions()
          .filter((one) => one.crossing === crossing.stableId)
          .at(-1)?.operation;
        if (revision === undefined) return null;
        return { id: crossing.stableId, revision, content: crossing.said };
      },
    });
  };

  const assetsOf = (pageId: string): { path: string; url: string; mediaType: string; description: string | null; alternativeText: string | null }[] => {
    const text = graph
      .blocksOf(pageId)
      .map((block) => block.content)
      .join('\n');
    return media
      // El editor escribe los blancos codificados para que el destino Markdown
      // sea inequívoco; el almacén conserva el nombre humano. Ambas grafías
      // nombran la misma referencia y tienen que hacer viajar el objeto.
      .filter((entry) => text.includes(entry.path) || text.includes(entry.path.replace(/ /g, '%20')))
      .map((entry) => ({ ...entry, url: `/media/${entry.hash}` }));
  };

  /*
   * De qué servidores acepta este corpus una incrustación.
   *
   * Ninguno por omisión: que algo de fuera corra dentro de una página propia no
   * puede decidirlo quien pegó la dirección —una dirección se copia sin mirar—,
   * así que lo decide el corpus, en la página que ya gobierna el resto de su
   * vocabulario. Ver specs/executable-content-sandbox.allium.
   */
  const embedHosts = (): string[] =>
    declared(/^Incrustaciones/i)
      .map((line) => line.replace(/^[-*·]\s*/, '').trim())
      // Un renglón puede llevar una explicación detrás del servidor; lo que vale
      // es la primera palabra, que es la que nombra a quien aloja.
      .map((line) => (line.split(/[\s—·]/)[0] ?? '').trim().toLowerCase())
      // Y sólo cuenta si tiene forma de servidor, para que el apartado pueda
      // llevar prosa entre los renglones sin que una frase acabe leyéndose como
      // un permiso.
      .filter((host) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host));
  graph.namesProperties(propertyNames());

  const relationVocabulary = (): { name: string; inverse: string }[] => {
    const ontology = ontologyPage();
    if (ontology === undefined) return STARTER_RELATIONS;

    const heading = graph
      .blocksOf(ontology.id)
      .find((block) => opens(block.content, /^Relaciones/i));
    if (heading === undefined) return STARTER_RELATIONS;

    const written = graph
      .blocksOf(ontology.id)
      .filter((block) => block.parent === heading.stableId)
      .map((block) => block.content.split(/\s+[·/|]\s+/).map((one) => one.trim()))
      .filter((pair) => pair[0] !== undefined && pair[0] !== '')
      // Un término sin recíproco escrito es su propio recíproco: se lee igual
      // desde los dos lados, que es lo que un simétrico hace.
      .map((pair) => ({ name: pair[0] as string, inverse: pair[1] ?? (pair[0] as string) }));

    return written.length > 0 ? written : STARTER_RELATIONS;
  };

  const send = (response: ServerResponse, status: number, payload: unknown): void => {
    const body = JSON.stringify(payload);
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
    });
    response.end(body);
  };

  const serveStatic = (
    response: ServerResponse,
    pathname: string,
    publicResponse = false,
  ): boolean => {
    if (webRoot === null) return false;
    const wanted = pathname === '/' ? '/index.html' : pathname;
    // normalize + prefijo: sin esto, `..` en la ruta saldría del directorio.
    const target = join(webRoot, normalize(wanted));
    if (!target.startsWith(webRoot) || !existsSync(target) || !statSync(target).isFile()) {
      return false;
    }
    response.writeHead(200, {
      'content-type': MIME[extname(target)] ?? 'application/octet-stream',
      'cache-control': wanted.startsWith(FINGERPRINTED) ? IMMUTABLE : REVALIDATE,
      ...(publicResponse
        ? {
            'content-security-policy':
              "default-src 'self'; connect-src 'self'; img-src 'self' data: blob: https:; " +
              "media-src 'self' blob:; frame-src 'self' data: https:; style-src 'self' 'unsafe-inline'; " +
              "script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
            'x-content-type-options': 'nosniff',
          }
        : {}),
    });
    createReadStream(target).pipe(response);
    return true;
  };

  /**
   * Quién está leyendo.
   *
   * Igual que al escribir: sale de la credencial y no de lo que diga quien
   * pide. Sin credencial es el dueño, que es lo que hoy es cierto —la
   * aplicación corre en localhost— y se anota como lo que es, sin credencial,
   * en vez de disimular la ausencia.
   */
  const reader = (
    header: string | undefined,
  ):
    | { ok: true; participant: ParticipantId; credential: string | null }
    | { ok: false; detail: string } => {
    const secret = bearerOf(header);
    if (secret === null) return { ok: true, participant: owner.id, credential: null };
    const resolved = resolveSecret(store, secret);
    /*
     * Una credencial que no resuelve se rechaza. No asciende.
     *
     * Antes caía al dueño, igual que la ausencia de credencial, y las dos cosas
     * no son la misma. No traer ninguna es lo que hoy es cierto en casa —la
     * aplicación corre en localhost y las personas todavía no se autentican—, y
     * se registra como lo que es. Traer una que está revocada, vencida o
     * inventada es otra cosa: es alguien presentando una llave que ya no abre, y
     * dársela por buena convertía la revocación en una operación sin efecto —el
     * cliente revocado seguía leyendo, ahora con el nombre del dueño encima— y
     * ensuciaba el único registro que promete decir quién leyó qué.
     *
     * Escribir ya lo hacía bien: `authorise` devuelve 401 desde el primer día.
     * Esto es leer poniéndose al día con escribir.
     */
    if (!resolved.ok) return { ok: false, detail: resolved.detail };
    return {
      ok: true,
      participant: resolved.credential.participant,
      credential: resolved.credential.id,
    };
  };

  /** Qué cliente dice ser. Se registra y no se cree. */
  const clientOf = (request: IncomingMessage): string | null => {
    const said =
      request.headers['mcp-name'] ??
      request.headers['x-vera-client'] ??
      request.headers['user-agent'];
    const one = Array.isArray(said) ? said[0] : said;
    return one === undefined ? null : one.slice(0, 200);
  };

  const handle = async (
    request: IncomingMessage,
    response: ServerResponse,
    forcedPublic = false,
  ): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const cookie = (name: string): string => {
      for (const part of (request.headers.cookie ?? '').split(';')) {
        const [key, ...value] = part.trim().split('=');
        if (key === name) return decodeURIComponent(value.join('='));
      }
      return '';
    };

    /*
     * Un origen público no es una segunda aplicación: es esta misma Vera bajo
     * otra autoridad. El dominio canónico decide la frontera en producción y
     * el segundo listener loopback la fuerza para la previsualización privada.
     * Una cabecera del cliente nunca puede elegirla.
     */
    const host = (request.headers.host ?? '').split(':')[0]?.toLowerCase() ?? '';
    let canonicalHost = '';
    try {
      canonicalHost = new URL(publicSite()?.canonicalDomain ?? '').hostname.toLowerCase();
    } catch {
      canonicalHost = '';
    }
    const publicOrigin = forcedPublic || (canonicalHost !== '' && host === canonicalHost);
    const publicAccess = publicOrigin;

    /*
     * La puerta pública es una sola grieta deliberada en el origen público.
     *
     * Se reenvía antes del guard de `anybody`, porque éste rechaza todo POST;
     * pero sólo para la ruta exacta y sólo hacia un origen loopback declarado.
     * El proceso MCP vuelve a comprobar el bearer antes de hablar protocolo.
     * Ninguna otra ruta, incluida /operations, comparte este reenvío.
     */
    if (publicOrigin && path === '/mcp' && options.publicMcpOrigin !== undefined) {
      const target = new URL('/mcp', options.publicMcpOrigin);
      const headers: Record<string, string> = {};
      for (const name of ['authorization', 'content-type', 'accept', 'mcp-session-id', 'mcp-protocol-version', 'x-vera-client']) {
        const value = request.headers[name];
        if (typeof value === 'string') headers[name] = value;
      }
      const upstream = httpRequest(target, { method: request.method, headers }, (fromMcp) => {
        response.writeHead(fromMcp.statusCode ?? 502, {
          ...fromMcp.headers,
          'cache-control': 'no-store',
        });
        fromMcp.pipe(response);
      });
      upstream.setTimeout(30_000, () => upstream.destroy(new Error('MCP timeout')));
      upstream.on('error', () => {
        if (!response.headersSent) send(response, 502, { error: 'la puerta MCP no está disponible' });
        else response.end();
      });
      request.pipe(upstream);
      return;
    }

    // Un espacio elige un subgrafo, no una aplicación distinta. Las rutas bajo
    // `/s/<slug>` llevan el ámbito consigo; las peticiones de la PWA a `/pages`,
    // `/graph`, `/search` y medios lo heredan del documento que las inició.
    //
    // Antes se persistía ese ámbito en una cookie con `Path=/`. Después de leer
    // un espacio, la cookie cercaba también cualquier publicación canónica del
    // mismo dominio: todas las URL públicas parecían llevar de vuelta al poema.
    // El referente no sobrevive como autoridad global y sólo puede estrechar la
    // lectura a otro espacio que ya sea público.
    const pathSpace = /^\/s\/([^/]+)(?:\/.*)?$/.exec(path);
    let referringSpace: RegExpExecArray | null = null;
    try {
      const referred = request.headers.referer;
      referringSpace = referred === undefined
        ? null
        : /^\/s\/([^/]+)(?:\/.*)?$/.exec(new URL(referred).pathname);
    } catch {
      referringSpace = null;
    }
    const scopedSegment = pathSpace?.[1] ?? referringSpace?.[1] ?? null;
    const scopedSlug = scopedSegment === null ? null : decodeURIComponent(scopedSegment);
    const scopedSpace = scopedSlug === null ? null : sharedSpaceBySlug(store, scopedSlug);
    const scopedParticipant = publicAccess
      ? participantForSession(store, cookie('vera_session'))
      : null;
    const scopedGrant = scopedSpace === null || scopedParticipant === null
      ? undefined
      : store.db.prepare(`SELECT permissions FROM access_grants
          WHERE space_id=? AND participant_id=? AND status='active'`)
        .get(scopedSpace.id, scopedParticipant) as { permissions: string } | undefined;
    const canReadScopedSpace = scopedSpace !== null && scopedSpace.status === 'active' && (
      scopedSpace.audience === 'anybody' ||
      String(scopedGrant?.permissions ?? '').split(',').includes('read')
    );
    const scopedPermissions = String(scopedGrant?.permissions ?? '').split(',');
    const canEditScopedSpace = canReadScopedSpace && scopedParticipant !== null &&
      scopedPermissions.includes('edit');
    const canContributeScopedSpace = canReadScopedSpace && scopedParticipant !== null &&
      scopedPermissions.includes('contribute');
    const publicScopedSpace = canReadScopedSpace ? scopedSpace : null;
    const scopedPageIds = publicScopedSpace === null
      ? publicPageIds()
      : new Set(graph.pages().filter((page) => pageBelongsToSharedSpace(graph, publicScopedSpace, page.id))
        .map((page) => page.id));
    const isPublicPage = (page: string): boolean => scopedPageIds.has(page);
    if (publicAccess && pathSpace !== null) {
      // Retira la cookie de versiones anteriores; ya no gobierna el ámbito.
      response.setHeader('set-cookie', 'vera_public_space=; Path=/; Max-Age=0; SameSite=Lax');
    }

    const publicReadThroughBody = request.method === 'POST' && path === '/query';
    // La invitación nace precisamente para alguien que todavía no pertenece a
    // Vera. Su canje y la ceremonia WebAuthn deben, por tanto, poder ocurrir en
    // el origen público sin convertir ese origen en una superficie de escritura
    // general.
    const publicAdmission = request.method === 'POST' && (
      /^\/invitations\/[^/]+\/redeem$/.test(path) ||
      path === '/human-auth/registration/options' ||
      path === '/human-auth/registration/verify'
    );
    const publicSharedEdit = request.method === 'POST' && path === '/operations' &&
      publicScopedSpace !== null && canEditScopedSpace;
    const publicSharedContribution = request.method === 'POST' && path === '/shared-proposals' &&
      publicScopedSpace !== null && canContributeScopedSpace;
    if (publicAccess && request.method !== 'GET' && request.method !== 'HEAD' &&
      !publicReadThroughBody && !publicAdmission && !publicSharedEdit && !publicSharedContribution) {
      send(response, 405, { error: 'anybody sólo puede leer' });
      return;
    }

    if (publicAccess) {
      const canonicalPublication = publicationAtPath(path);
      const sharedSegments = pathSpace;
      const sharedSlug = sharedSegments === null ? null : decodeURIComponent(sharedSegments[1] ?? '');
      const publicSharedSpace = sharedSlug === null ? null : sharedSpaceBySlug(store, sharedSlug);
      const publicSharedPath = publicSharedSpace !== null && canReadScopedSpace;
      const safe =
        path === '/' ||
        path === '/health' ||
        path === '/pages' ||
        path === '/search' ||
        path === '/query' ||
        path === '/p5-frame.html' ||
        path === '/p5.min.js' ||
        path.startsWith('/pages/') ||
        path.startsWith('/graph/') ||
        path.startsWith('/media/') ||
        path.startsWith('/invite/') ||
        /^\/invitations\/[^/]+$/.test(path) ||
        publicAdmission ||
        publicSharedEdit ||
        publicSharedContribution ||
        publicSharedPath ||
        (publicScopedSpace !== null && path.startsWith('/p/')) ||
        canonicalPublication !== undefined ||
        path.startsWith('/build/') ||
        path.startsWith('/assets/') ||
        /^\/(?:manifest\.webmanifest|sw\.js|favicon\.ico|apple-touch-icon\.png|icon-[^/]+|fonts\/)/.test(path);
      if (!safe) {
        send(response, 404, { error: 'not found' });
        return;
      }
    }

    /*
     * Quién lee, resuelto una vez y antes de nada.
     *
     * Antes que el enrutado, para que valga en todas las superficies y no en las
     * que alguien se acuerde de comprobar: una credencial muerta no debe abrir ni
     * una página, ni el índice, ni la ontología.
     *
     * Y una sola vez por petición, porque `resolveSecret` marca la credencial
     * como usada: resolverla dos veces contaría dos usos donde hubo uno.
     */
    const who = publicAccess
      ? { ok: true as const, participant: ANYBODY, credential: null }
      : reader(request.headers.authorization);
    if (!who.ok) {
      /*
       * No se anota en el registro de exposición, y no por descuido.
       *
       * Ese registro dice qué memoria salió y hacia quién, y aquí no salió nada.
       * Anotarlo exigiría además ponerle un participante —la columna no admite
       * vacío— y el único a mano sería el dueño, que es exactamente la mentira
       * que este arreglo viene a quitar. Un registro de intentos rechazados es
       * otra cosa y va con la identidad, no con la exposición.
       */
      send(response, 401, { error: who.detail });
      return;
    }

    /*
     * Anotar que algo salió.
     *
     * @invariant NoDeliveryWithoutItsRecord: se anota antes de escribir en el
     * cable. Al revés, un proceso que se cae entre responder y anotar convierte
     * una lectura en una lectura invisible, que es justo lo que este registro
     * existe para que no pase.
     */
    const note = (
      surface: string,
      subject: string,
      volume: number,
      delivered: readonly string[] = [],
      outcome = 'served',
    ): void => {
      // `anybody` no es un participante del grafo. El registro nominal actual
      // exige uno; el tráfico público tendrá su contador agregado sin inventar
      // una autoría ni una membresía.
      if (publicAccess) return;
      recordExposure(store, {
        participant: who.participant,
        credential: who.credential,
        client: clientOf(request),
        surface,
        subject,
        delivered,
        outcome,
        volume,
        at: Date.now(),
      });
    };

    /** Entregar memoria: se anota lo que sale, y después sale. */
    const deliver = (
      payload: unknown,
      about: { surface: string; subject: string; delivered?: readonly string[] },
    ): void => {
      const body = JSON.stringify(payload);
      note(about.surface, about.subject, body.length, about.delivered ?? []);
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
      });
      response.end(body);
    };

    const librarianAgent = 'participant:cotito' as ParticipantId;
    const canAnswerAsLibrarian = (): boolean => {
      if (who.participant !== librarianAgent || who.credential === null) return false;
      return credentialById(store, who.credential)?.scopes.includes('write') ?? false;
    };
    const readSmallJson = async (): Promise<Record<string, unknown>> => {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > 64 * 1024) throw new Error('el cuerpo excede 64 KiB');
        chunks.push(bytes);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    };

    if (request.method === 'POST' && path === '/librarian/requests') {
      if (graph.participant(who.participant)?.kind !== 'human') {
        send(response, 403, { error: 'sólo una persona puede solicitar al bibliotecario' });
        return;
      }
      let body: Record<string, unknown>;
      try { body = await readSmallJson(); }
      catch (error) { send(response, 400, { error: error instanceof Error ? error.message : 'JSON inválido' }); return; }
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      const pageId = typeof body.pageId === 'string' ? body.pageId : '';
      const blockId = typeof body.blockId === 'string' ? body.blockId : null;
      const page = graph.page(pageId);
      const block = blockId === null ? undefined : graph.block(blockId);
      if (text === '') { send(response, 400, { error: 'el pedido no puede estar vacío' }); return; }
      if (page === undefined || (blockId !== null && (block === undefined || block.page !== page.id))) {
        send(response, 404, { error: 'la página o el bloque ya no existe' });
        return;
      }
      const blocks = graph.blocksOf(page.id);
      const snapshot = JSON.stringify({
        page: {
          id: page.id,
          title: page.title,
          revision: graph.revisions().filter((one) => one.page === page.id).at(-1)?.operation ?? null,
        },
        focus: block === undefined ? null : { id: block.stableId, content: block.content, parent: block.parent },
        blocks: blocks.map((one) => ({ id: one.stableId, parent: one.parent, position: one.position, content: one.content })),
      });
      const created = createLibrarianRequest(store, {
        askedBy: who.participant,
        agent: librarianAgent,
        modality: block === undefined ? 'page' : 'block',
        text,
        sourcePageId: page.id,
        sourceBlockId: block?.stableId ?? null,
        contextSnapshot: snapshot,
      });
      await dispatchLibrarianRequest(created.id);
      send(response, 201, librarianRequest(store, created.id));
      return;
    }

    if (request.method === 'GET' && path === '/librarian/requests') {
      const pageId = url.searchParams.get('page');
      const block = url.searchParams.has('block') ? url.searchParams.get('block') : undefined;
      if (pageId === null || graph.page(pageId) === undefined) {
        send(response, 400, { error: 'falta una página válida' });
        return;
      }
      deliver(librarianRequestsFor(store, pageId, block), {
        surface: 'GET /librarian/requests', subject: pageId, delivered: [pageId, ...(block ? [block] : [])],
      });
      return;
    }

    const librarianMatch = /^\/librarian\/requests\/([^/]+)(?:\/(claim|reply))?$/.exec(path);
    if (librarianMatch !== null) {
      const id = decodeURIComponent(librarianMatch[1] ?? '');
      const action = librarianMatch[2] ?? null;
      const current = librarianRequest(store, id);
      if (current === undefined) { send(response, 404, { error: 'la solicitud no existe' }); return; }
      if (request.method === 'GET' && action === null) {
        if (who.participant !== current.askedBy && who.participant !== librarianAgent) {
          send(response, 403, { error: 'la solicitud pertenece a otra conversación' }); return;
        }
        deliver(current, { surface: 'GET /librarian/requests/:id', subject: id, delivered: [id] });
        return;
      }
      if (request.method === 'DELETE' && action === null) {
        if (who.participant !== current.askedBy) {
          send(response, 403, { error: 'sólo quien hizo la solicitud puede eliminarla' }); return;
        }
        removeLibrarianRequest(store, id);
        send(response, 200, { status: 'removed', id });
        return;
      }
      if (request.method === 'POST' && action === 'claim') {
        if (!canAnswerAsLibrarian()) { send(response, 403, { error: 'se necesita la credencial del bibliotecario con escritura' }); return; }
        const claimed = claimLibrarianRequest(store, id);
        if (claimed?.status !== 'working') { send(response, 409, { error: 'la solicitud ya no está en cola' }); return; }
        send(response, 200, claimed);
        return;
      }
      if (request.method === 'POST' && action === 'reply') {
        if (!canAnswerAsLibrarian()) { send(response, 403, { error: 'se necesita la credencial del bibliotecario con escritura' }); return; }
        let body: Record<string, unknown>;
        try { body = await readSmallJson(); }
        catch (error) { send(response, 400, { error: error instanceof Error ? error.message : 'JSON inválido' }); return; }
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        const changes = Array.isArray(body.changes) ? body.changes as Change[] : [];
        if (text === '') { send(response, 400, { error: 'la respuesta no puede estar vacía' }); return; }
        if (current.modality === 'block') {
          const replacement = changes.length === 1 ? changes[0] : undefined;
          if (
            replacement?.kind !== 'edit_block' ||
            replacement.block !== current.sourceBlockId
          ) {
            send(response, 400, {
              error: 'un pedido sobre un bloque debe reemplazar ese mismo bloque con una única operación edit_block',
            });
            return;
          }
          let focus: { id?: string; content?: string } | null;
          try {
            focus = (JSON.parse(current.contextSnapshot) as {
              focus?: { id?: string; content?: string } | null;
            }).focus ?? null;
          } catch {
            send(response, 409, { error: 'el contexto original del bloque no se puede comprobar' }); return;
          }
          const source = current.sourceBlockId === null ? undefined : graph.block(current.sourceBlockId);
          if (source === undefined || focus?.id !== source.stableId || focus.content !== source.content) {
            send(response, 409, {
              error: 'el bloque cambió después del pedido; el bibliotecario no puede reemplazar una versión antigua',
            });
            return;
          }
          const outcome = graph.submitOperation({
            originId: `librarian:${current.id}:replacement`,
            participant: who.participant,
            channel: 'agent_generation',
            change: replacement,
          });
          if (outcome.status === 'rejected') {
            send(response, 422, { error: outcome.reason }); return;
          }
          if (outcome.status === 'applied') {
            const failure = persist(outcome.operation);
            if (failure !== null) { send(response, 500, { error: failure }); return; }
          }
          const answered = answerLibrarianRequest(store, { id, answeredBy: who.participant, text, changes: [] });
          if (answered === undefined) { send(response, 409, { error: 'la solicitud no está esperando respuesta' }); return; }
          send(response, 201, answered);
          return;
        }
        const answered = answerLibrarianRequest(store, { id, answeredBy: who.participant, text, changes });
        if (answered === undefined) { send(response, 409, { error: 'la solicitud no está esperando respuesta' }); return; }
        send(response, 201, answered);
        return;
      }
    }

    if (request.method === 'POST' && path === '/operations/batch') {
      const chunks: Buffer[] = [];
      let size = 0;
      request.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size <= MAX_BATCH_BYTES) chunks.push(chunk);
      });
      request.on('end', () => {
        if (size > MAX_BATCH_BYTES) {
          send(response, 413, { status: 'rejected', reason: `el lote excede ${MAX_BATCH_BYTES} bytes` });
          return;
        }
        let body: SubmitBatchBody;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as SubmitBatchBody;
        } catch {
          send(response, 400, { error: 'the body must be JSON' });
          return;
        }
        if (typeof body.originId !== 'string' || body.originId.trim() === '') {
          send(response, 400, { error: 'originId must be a non-empty string' });
          return;
        }
        if (!Array.isArray(body.changes) || body.changes.length === 0) {
          send(response, 400, { error: 'changes must be a non-empty array' });
          return;
        }
        if (body.changes.length > MAX_BATCH_CHANGES) {
          send(response, 413, {
            status: 'rejected',
            reason: `el lote contiene ${body.changes.length} cambios; el máximo es ${MAX_BATCH_CHANGES}`,
          });
          return;
        }

        const inputs = body.changes.map((change, at) =>
          readOperation({ originId: `${body.originId}:${at}`, participant: body.participant, change }));
        const malformed = inputs.find((input) => 'error' in input);
        if (malformed !== undefined && 'error' in malformed) {
          send(response, 400, malformed);
          return;
        }
        const submissions = inputs as Exclude<(typeof inputs)[number], { error: string }>[];
        const existing = submissions.map((input) =>
          graph.operations().find((operation) => operation.originId === input.originId));
        if (existing.every((operation) => operation !== undefined)) {
          const same = existing.every((operation, at) =>
            JSON.stringify(operation?.submission.change) === JSON.stringify(submissions[at]?.change));
          if (!same) {
            send(response, 409, { status: 'rejected', reason: 'ese origen de lote ya nombra otros cambios' });
            return;
          }
          send(response, 200, {
            status: 'duplicate',
            operations: existing.map((operation) => ({
              sequence: operation?.sequence,
              subjectId: operation?.subjectId,
            })),
          });
          return;
        }
        if (existing.some((operation) => operation !== undefined)) {
          send(response, 409, { status: 'rejected', reason: 'el origen del lote coincide con un prefijo incompleto' });
          return;
        }

        const trial = graph.replayFromLog();
        const applied: Operation[] = [];
        let submitter: Submitter | null = null;
        for (const input of submissions) {
          const who = authorise(store, trial, request.headers.authorization, body.participant, input.change.kind);
          if ('error' in who) {
            send(response, who.status, { status: 'rejected', reason: who.error });
            return;
          }
          submitter ??= who;
          const fence = who.credential === null ? null : confinementOf(store, who.credential.id);
          if (fence !== null) {
            const refusal = fenceRefusal(
              store, fence, who.participant, input.change,
              (block) => trial.block(block)?.page ?? null,
            );
            if (refusal !== null) {
              send(response, refusal.status, { status: 'rejected', reason: refusal.error });
              return;
            }
          }
          const outcome = trial.submitOperation({
            ...input,
            participant: who.participant,
            ...(who.channel === null ? {} : { channel: who.channel }),
          });
          if (outcome.status !== 'applied') {
            send(response, outcome.status === 'duplicate' ? 409 : 422, {
              status: 'rejected',
              reason: outcome.status === 'duplicate' ? 'un cambio del lote ya existe' : outcome.reason,
            });
            return;
          }
          applied.push(outcome.operation);
        }

        store.db.exec('BEGIN');
        try {
          for (const operation of applied) recordOperation(store, trial, operation);
          store.db.exec('COMMIT');
          graph = trial;
        } catch (error) {
          store.db.exec('ROLLBACK');
          send(response, 500, {
            status: 'rejected',
            reason: 'no se pudo persistir el lote; no se aplicó ningún cambio',
            detail: error instanceof Error ? error.message : String(error),
          });
          return;
        }
        send(response, 201, {
          status: 'applied',
          operations: applied.map((operation) => ({
            sequence: operation.sequence,
            subjectId: operation.subjectId,
          })),
        });
      });
      return;
    }

    if (request.method === 'POST' && path === '/operations') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        let body: SubmitBody;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as SubmitBody;
        } catch {
          send(response, 400, { error: 'the body must be JSON' });
          return;
        }

        const input = readOperation(body);
        if ('error' in input) {
          send(response, 400, input);
          return;
        }

        // Quién escribe se decide aquí y no se lee del cuerpo. Antes de esto, el
        // cuerpo declaraba su propio participante: cualquiera que alcanzara el
        // puerto podía firmar como Herbert o como el bibliotecario.
        const who = publicSharedEdit && scopedParticipant !== null
          ? { participant: scopedParticipant, channel: null, credential: null } satisfies Submitter
          : authorise(
              store,
              graph,
              request.headers.authorization,
              body.participant,
              input.change.kind,
            );
        if ('error' in who) {
          send(response, who.status, { status: 'rejected', reason: who.error });
          return;
        }

        if (publicSharedEdit) {
          const touched = pageTouchedBy(input.change, null, (block) => graph.block(block)?.page);
          if (touched === null || !scopedPageIds.has(touched)) {
            send(response, 403, {
              status: 'rejected',
              reason: 'el permiso de edición sólo alcanza páginas de este espacio compartido',
            });
            return;
          }
        }

        /*
         * Y si esa credencial está cercada, si el cambio cabe dentro del cerco.
         *
         * Aquí y no en `authorise`, que decide identidad y alcance y sólo mira la
         * clase del cambio: el cerco necesita saber sobre qué página se escribe,
         * y eso está en el cambio entero.
         *
         * @invariant TheFenceIsInTheCredentialAndNotInTheDoor: se comprueba en la
         * única puerta de escritura y no en la herramienta MCP. El mismo secreto
         * entra por aquí sin pasar por ninguna herramienta, y un límite que sólo
         * comprueba la herramienta es una sugerencia dirigida a quien ya decidió
         * obedecerla. Ver specs/confined-writing.allium.
         */
        const fence =
          who.credential === null ? null : confinementOf(store, who.credential.id);
        if (fence !== null) {
          const refusal = fenceRefusal(
            store,
            fence,
            who.participant,
            input.change,
            (block) => graph.block(block)?.page ?? null,
          );
          if (refusal !== null) {
            send(response, refusal.status, { status: 'rejected', reason: refusal.error });
            return;
          }
        }

        const protectedPage = pageTouchedBy(
          input.change,
          null,
          (block) => graph.block(block)?.page,
        );
        if (protectedPage !== null && isSpecialPage(protectedPage)) {
          if (input.change.kind === 'remove_page') {
            send(response, 422, {
              status: 'rejected',
              reason: 'una página especial gobierna Vera y no se puede eliminar',
            });
            return;
          }
          if (
            input.change.kind === 'set_property' &&
            input.change.page === protectedPage &&
            input.change.propertyKey.trim().toLocaleLowerCase('es') ===
              propertyNames().kind.trim().toLocaleLowerCase('es') &&
            input.change.propertyValue.trim().toLocaleLowerCase('es') === 'argumento'
          ) {
            send(response, 422, {
              status: 'rejected',
              reason: 'una página especial no se puede leer como recorrido',
            });
            return;
          }
        }

        const outcome = graph.submitOperation({
          ...input,
          participant: who.participant,
          ...(who.channel === null ? {} : { channel: who.channel }),
        });
        if (outcome.status === 'rejected') {
          send(response, 422, { status: 'rejected', reason: outcome.reason });
          return;
        }
        if (outcome.status === 'duplicate') {
          // Reenviar no aplica dos veces: se devuelve lo que ya había.
          send(response, 200, {
            status: 'duplicate',
            sequence: outcome.operation.sequence,
            subjectId: outcome.operation.subjectId,
          });
          return;
        }

        // Persistir puede fallar por algo que el dominio no vio venir. La
        // transacción revierte sola, pero sin este intento la excepción subía
        // hasta el proceso y se llevaba el servidor por delante: una operación
        // que no se puede guardar tiene que devolver un error, no un reinicio.
        try {
          recordOperation(store, graph, outcome.operation);
        } catch (error) {
          /*
           * La memoria vuelve a ser la del disco.
           *
           * El dominio ya había aplicado el cambio cuando la escritura falló, y
           * la transacción sólo revierte el disco: sin esto quedaba un bloque
           * que existía en memoria y en ninguna parte más. Se dibujaba como
           * cualquier otro, todo lo que colgara de él fallaba con un error que
           * hablaba de otra cosa, y al reiniciar desaparecía sin que nadie
           * hubiera borrado nada.
           *
           * Reconstruir del log cuesta unos segundos y ocurre casi nunca. La
           * alternativa —seguir sirviendo un grafo que no es el que está
           * guardado— cuesta que ya no se sepa cuál de los dos es Vera.
           */
          graph = loadGraph(store, 'mind');
          send(response, 500, {
            error: 'no se pudo persistir la operación',
            detail: error instanceof Error ? error.message : String(error),
          });
          return;
        }

        /*
         * Una página plantada por una credencial cercada nace marcada.
         *
         * @invariant TheKindAndTheSourceComeFromTheFence: las dos propiedades las
         * pone Vera y no viajan en el cambio. Un agente que pudiera mandarlas
         * escribiría una página que dice ser de otra clase y venir de otra parte,
         * y las dos cosas son justamente lo que el cerco existe para fijar.
         *
         * Entran por la misma puerta y como operaciones suyas, así que quedan en
         * el registro con su autor y su sitio en la secuencia, como todo lo
         * demás. Si alguna fallara, la página existe igual y sin marca: es un
         * resultado pobre y legible, y mejor que una página que no llegó a nacer.
         */
        if (fence !== null && input.change.kind === 'create_page') {
          const born = outcome.subjectId;
          const names = propertyNames();
          const mark = (key: string, value: string, step: number): void => {
            const stamped = graph.submitOperation({
              originId: `${input.originId}:${step}`,
              participant: who.participant,
              ...(who.channel === null ? {} : { channel: who.channel }),
              change: { kind: 'set_property', page: born, propertyKey: key, propertyValue: value },
            });
            if (stamped.status === 'applied') recordOperation(store, graph, stamped.operation);
          };
          mark(names.kind, fence.kind, 1);
          if (fence.source !== null) mark(BIBLIOGRAPHY_NAMES.source, fence.source, 2);
        }

        const touched = pageTouchedBy(
          input.change,
          outcome.subjectId,
          (block) => graph.block(block)?.page,
        );
        const site = publicSite();
        if (
          touched !== null &&
          site !== undefined &&
          graph.publicationsOf(site.id).some((publication) => publication.page === touched)
        ) {
          try {
            rebuildPublicSite();
          } catch (error) {
            console.error('la proyección pública quedó en su versión anterior:', error);
          }
        }

        send(response, 201, {
          status: 'applied',
          sequence: outcome.operation.sequence,
          subjectId: outcome.subjectId,
        });
      });
      return;
    }

    // -----------------------------------------------------------------------
    // Agentes y credenciales (agent-participation.allium)
    // -----------------------------------------------------------------------
    //
    // Administrar credenciales es cosa del dueño: surface CredentialAdministration.
    // Mientras la identidad humana no se demuestre, «el dueño» es quien llega sin
    // credencial, que es la misma asunción con la que v0 lleva funcionando. Lo
    // que no puede pasar —y ya no pasa— es que un portador de credencial se
    // emita otra: @invariant SovereignOwnerCredentials.

    const ownerOnly = (): { error: string } | null =>
      bearerOf(request.headers.authorization) === null
        ? null
        : { error: 'sólo el dueño administra credenciales, y no lo hace con una credencial' };

    /*
     * Resolver juntas las decisiones sobre las páginas marcadas.
     *
     * Es una sola petición, no una operación opaca: cada bloque, página y marca
     * sigue saliendo por submitOperation y conserva su lugar propio en el
     * registro. Se valida el lote entero antes de tocar nada para que una página
     * ya resuelta no deje las demás decisiones a medias.
     */
    if (request.method === 'POST' && path === '/mcp/discards') {
      const blocked = ownerOnly();
      if (blocked !== null) {
        send(response, 403, blocked);
        return;
      }
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        let body: { decisions?: unknown };
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
        } catch {
          send(response, 400, { error: 'the body must be JSON' });
          return;
        }
        if (!Array.isArray(body.decisions) || body.decisions.length === 0) {
          send(response, 400, { error: 'decisions must be a non-empty array' });
          return;
        }

        const markKey = propertyNames().discard_request;
        const seen = new Set<string>();
        const plans: {
          page: string;
          decision: 'delete' | 'keep';
          blocks: ReturnType<typeof graph.blocksOf>;
        }[] = [];
        for (const raw of body.decisions) {
          const said = raw as { page?: unknown; decision?: unknown };
          const page = typeof said.page === 'string' ? said.page : '';
          const decision = said.decision;
          if (page === '' || (decision !== 'delete' && decision !== 'keep')) {
            send(response, 400, { error: 'each decision needs a page and delete or keep' });
            return;
          }
          if (seen.has(page)) {
            send(response, 400, { error: `la página ${page} aparece dos veces` });
            return;
          }
          seen.add(page);
          if (graph.page(page) === undefined) {
            send(response, 409, { error: `la página ${page} ya no existe` });
            return;
          }
          const marked = graph
            .propertiesOf(page)
            .some((one) => one.key.trim().toLowerCase() === markKey.trim().toLowerCase());
          if (!marked) {
            send(response, 409, { error: `la página ${page} ya no está marcada para borrar` });
            return;
          }
          if (decision === 'delete' && isSpecialPage(page)) {
            send(response, 422, { error: `la página especial ${page} no se puede eliminar` });
            return;
          }
          plans.push({ page, decision, blocks: graph.blocksOf(page) });
        }

        const stamp = Date.now();
        let step = 0;
        const write = (change: Change): void => {
          const outcome = graph.submitOperation({
            originId: `discard-review:${stamp}:${(step += 1)}`,
            participant: owner.id,
            channel: 'typed_text',
            change,
          });
          if (outcome.status !== 'applied') {
            throw new Error(outcome.status === 'rejected' ? outcome.reason : 'operación duplicada');
          }
          const failure = persist(outcome.operation);
          if (failure !== null) throw new Error(failure);
        };

        try {
          for (const plan of plans) {
            if (plan.decision === 'keep') {
              write({ kind: 'remove_property', page: plan.page, propertyKey: markKey });
              continue;
            }

            const parents = new Map(plan.blocks.map((block) => [block.stableId, block.parent]));
            const depthOf = (id: string): number => {
              let depth = 0;
              let at = parents.get(id) ?? null;
              while (at !== null && depth < 1000) {
                depth += 1;
                at = parents.get(at) ?? null;
              }
              return depth;
            };
            const deepestFirst = [...plan.blocks].sort(
              (left, right) => depthOf(right.stableId) - depthOf(left.stableId),
            );
            for (const block of deepestFirst) {
              write({ kind: 'remove_block', block: block.stableId });
            }
            write({ kind: 'remove_page', page: plan.page });
          }
          rebuildPublicSite();
        } catch (error) {
          graph = loadGraph(store, 'mind');
          send(response, 500, {
            error: 'no se pudieron aplicar todas las decisiones',
            detail: error instanceof Error ? error.message : String(error),
          });
          return;
        }

        send(response, 200, {
          applied: plans.map(({ page, decision }) => ({ page, decision })),
        });
      });
      return;
    }

    const publicationPage = path.startsWith('/publications/')
      ? decodeURIComponent(path.slice('/publications/'.length))
      : null;

    /** La configuración editorial del único sitio que esta instancia proyecta. */
    if (request.method === 'GET' && path === '/publication-site') {
      send(response, 200, publicationSiteView());
      return;
    }

    if (request.method === 'PUT' && path === '/publication-site') {
      const blocked = ownerOnly();
      if (blocked !== null) {
        send(response, 403, blocked);
        return;
      }
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        let body: { title?: unknown; canonicalDomain?: unknown; entryPoint?: unknown };
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
        } catch {
          send(response, 400, { error: 'the body must be JSON' });
          return;
        }
        if (typeof body.title !== 'string' || typeof body.canonicalDomain !== 'string') {
          send(response, 400, { error: 'title and canonicalDomain must be strings' });
          return;
        }
        if (body.entryPoint !== null && typeof body.entryPoint !== 'string') {
          send(response, 400, { error: 'entryPoint must be a page id or null' });
          return;
        }

        store.db.exec('SAVEPOINT configure_public_site');
        try {
          let site = publicSite();
          if (site === undefined) {
            site = graph.createSite({
              owner: owner.id,
              title: body.title,
              canonicalDomain: body.canonicalDomain,
            });
          } else {
            graph.configureSite({
              site: site.id,
              participant: owner.id,
              title: body.title,
              canonicalDomain: body.canonicalDomain,
            });
          }
          graph.setSiteEntryPoint({
            site: site.id,
            participant: owner.id,
            page: body.entryPoint as string | null,
          });
          saveSite(store, site);
          store.db.exec('RELEASE configure_public_site');
        } catch (error) {
          store.db.exec('ROLLBACK TO configure_public_site');
          store.db.exec('RELEASE configure_public_site');
          graph = loadGraph(store, 'mind');
          send(response, 422, { error: error instanceof Error ? error.message : String(error) });
          return;
        }
        try {
          rebuildPublicSite();
          send(response, 200, publicationSiteView());
        } catch (error) {
          send(response, 200, {
            ...publicationSiteView(),
            projectionError: error instanceof Error ? error.message : String(error),
          });
        }
      });
      return;
    }

    /** Publicar es un acto del dueño distinto de declarar la página pública. */
    if (request.method === 'POST' && publicationPage !== null) {
      const blocked = ownerOnly();
      if (blocked !== null) {
        send(response, 403, blocked);
        return;
      }
      if (publicSite() === undefined && options.publicSite === undefined) {
        send(response, 409, { error: 'configura primero el sitio en VERA:Publicación' });
        return;
      }
      const page = graph.page(publicationPage);
      if (page === undefined) {
        send(response, 404, { error: 'no such page' });
        return;
      }
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        let body: { path?: unknown; entryPoint?: unknown } = {};
        try {
          if (chunks.length > 0) {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
          }
        } catch {
          send(response, 400, { error: 'the body must be JSON' });
          return;
        }
        if (body.path !== undefined && typeof body.path !== 'string') {
          send(response, 400, { error: 'path must be a string' });
          return;
        }
        if (body.entryPoint !== undefined && typeof body.entryPoint !== 'boolean') {
          send(response, 400, { error: 'entryPoint must be boolean' });
          return;
        }

        store.db.exec('SAVEPOINT publish_page');
        try {
          let site = publicSite();
          if (site === undefined) {
            site = graph.createSite({
              owner: owner.id,
              title: options.publicSite!.title,
              canonicalDomain: options.publicSite!.canonicalDomain,
            });
            saveSite(store, site);
          }
          const publication =
            graph.publicationsOf(site.id).find((candidate) => candidate.page === page.id) ??
            graph.publish({
              site: site.id,
              page: page.id,
              path: typeof body.path === 'string' && body.path.trim() !== ''
                ? body.path
                : suggestedPathFor(page.title),
              participant: owner.id,
            });
          savePublication(store, publication);
          if (site.entryPoint === null || body.entryPoint === true) {
            graph.setSiteEntryPoint({ site: site.id, page: page.id, participant: owner.id });
            saveSite(store, site);
          }
          store.db.exec('RELEASE publish_page');
        } catch (error) {
          store.db.exec('ROLLBACK TO publish_page');
          store.db.exec('RELEASE publish_page');
          graph = loadGraph(store, 'mind');
          send(response, 422, { error: error instanceof Error ? error.message : String(error) });
          return;
        }

        try {
          rebuildPublicSite();
          send(response, 201, publicationView(page.id));
        } catch (error) {
          // Publicar quedó persistido; la proyección anterior sigue intacta por
          // el reemplazo atómico y puede reconstruirse en el siguiente intento.
          console.error('la publicación se guardó, pero su proyección falló:', error);
          send(response, 201, {
            ...publicationView(page.id),
            projectionError: error instanceof Error ? error.message : String(error),
          });
        }
      });
      return;
    }

    /** Retirar borra la dirección del sitio, no la página del corpus. */
    if (request.method === 'DELETE' && publicationPage !== null) {
      const blocked = ownerOnly();
      if (blocked !== null) {
        send(response, 403, blocked);
        return;
      }
      const site = publicSite();
      const publication = site === undefined
        ? undefined
        : graph.publicationsOf(site.id).find((candidate) => candidate.page === publicationPage);
      if (site === undefined || publication === undefined) {
        send(response, 200, publicationView(publicationPage));
        return;
      }
      store.db.exec('SAVEPOINT withdraw_page');
      try {
        graph.unpublish({ site: site.id, path: publication.path, participant: owner.id });
        removePublication(store, site.id, publication.path);
        saveSite(store, site);
        store.db.exec('RELEASE withdraw_page');
      } catch (error) {
        store.db.exec('ROLLBACK TO withdraw_page');
        store.db.exec('RELEASE withdraw_page');
        graph = loadGraph(store, 'mind');
        send(response, 422, { error: error instanceof Error ? error.message : String(error) });
        return;
      }

      try {
        rebuildPublicSite();
        send(response, 200, publicationView(publicationPage));
      } catch (error) {
        console.error('el retiro se guardó, pero su proyección falló:', error);
        send(response, 200, {
          ...publicationView(publicationPage),
          projectionError: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    /** Crear el primer límite compartido, gobernado por una propiedad de página. */
    if (request.method === 'GET' && path === '/shared-spaces') {
      const blocked = ownerOnly();
      if (blocked !== null) { send(response, 403, blocked); return; }
      const effectivePages = (space: ReturnType<typeof sharedSpaceBySlug> & object) => graph.pages()
        .filter((page) => pageBelongsToSharedSpace(graph, space, page.id)).map((page) => {
          const properties = graph.propertiesOf(page.id);
          const reasons = space.criteria.filter((criterion) => properties.some((property) =>
            propertyMatchesSharedSpaceCriterion(property, criterion)))
            .map((criterion) => `${criterion.key}:: ${criterion.value}`);
          if (space.manualPages.includes(page.id)) reasons.push('inclusión explícita');
          return { page: page.id, reasons };
        });
      send(response, 200, { spaces: sharedSpaces(store).map((space) =>
        administrationOf(store, space, effectivePages(space))) });
      return;
    }

    if (request.method === 'POST' && path === '/shared-spaces') {
      const blocked = ownerOnly();
      if (blocked !== null) { send(response, 403, blocked); return; }
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        let body: Record<string, unknown>;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>; }
        catch { send(response, 400, { error: 'the body must be JSON' }); return; }
        const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
        const slug = typeof body['slug'] === 'string' ? body['slug'].trim() : '';
        const key = typeof body['selectorKey'] === 'string' ? body['selectorKey'].trim() : '';
        const value = typeof body['selectorValue'] === 'string' ? body['selectorValue'].trim() : '';
        const audience = body['audience'] === 'anybody' ? 'anybody' : 'restricted';
        if (name === '' || (key === '') !== (value === '') || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
          send(response, 400, { error: 'el espacio necesita nombre, slug canónico y, si se inicia con criterio, propiedad y valor' }); return;
        }
        try { send(response, 201, createSharedSpace(store, graph.owner!, {
          name, slug, selectorKey: key, selectorValue: value, audience,
        })); }
        catch (error) { send(response, 409, { error: error instanceof Error ? error.message : String(error) }); }
      });
      return;
    }

    if (request.method === 'PATCH' && /^\/shared-spaces\/[^/]+$/.test(path)) {
      const blocked = ownerOnly();
      if (blocked !== null) { send(response, 403, blocked); return; }
      const slugNow = decodeURIComponent(path.split('/')[2] ?? '');
      const space = sharedSpaceBySlug(store, slugNow);
      if (space === null) { send(response, 404, { error: 'el espacio no existe' }); return; }
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          const name = String(body['name'] ?? '').trim();
          const slug = String(body['slug'] ?? '').trim();
          const criterionCombination = body['criterionCombination'] === 'all' ? 'all' : 'any';
          const audience = body['audience'] === 'anybody' ? 'anybody' : 'restricted';
          if (name === '' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
            send(response, 400, { error: 'nombre y slug canónico son obligatorios' }); return;
          }
          send(response, 200, updateSharedSpace(store, space, {
            name, slug, criterionCombination, audience,
          }));
        } catch (error) { send(response, 409, { error: error instanceof Error ? error.message : String(error) }); }
      });
      return;
    }

    if (request.method === 'POST' && /^\/shared-spaces\/[^/]+\/criteria$/.test(path)) {
      const blocked = ownerOnly(); if (blocked !== null) { send(response, 403, blocked); return; }
      const space = sharedSpaceBySlug(store, decodeURIComponent(path.split('/')[2] ?? ''));
      if (space === null) { send(response, 404, { error: 'el espacio no existe' }); return; }
      const chunks: Buffer[] = []; request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          const key = String(body['key'] ?? '').trim(); const value = String(body['value'] ?? '').trim();
          if (key === '' || value === '') { send(response, 400, { error: 'propiedad y valor son obligatorios' }); return; }
          send(response, 201, addSharedSpaceCriterion(store, graph.owner!, space, key, value));
        } catch (error) { send(response, 409, { error: error instanceof Error ? error.message : String(error) }); }
      }); return;
    }

    if (request.method === 'DELETE' && /^\/shared-spaces\/[^/]+\/criteria\/[^/]+$/.test(path)) {
      const blocked = ownerOnly(); if (blocked !== null) { send(response, 403, blocked); return; }
      const parts = path.split('/'); const space = sharedSpaceBySlug(store, decodeURIComponent(parts[2] ?? ''));
      if (space === null) { send(response, 404, { error: 'el espacio no existe' }); return; }
      try {
        const changed = removeSharedSpaceCriterion(store, space, decodeURIComponent(parts[4] ?? ''));
        send(response, changed ? 200 : 404, changed ? { status: 'removed' } : { error: 'el criterio no estaba activo' });
      } catch (error) { send(response, 409, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }

    if (request.method === 'POST' && /^\/shared-spaces\/[^/]+\/pages$/.test(path)) {
      const blocked = ownerOnly(); if (blocked !== null) { send(response, 403, blocked); return; }
      const space = sharedSpaceBySlug(store, decodeURIComponent(path.split('/')[2] ?? ''));
      if (space === null) { send(response, 404, { error: 'el espacio no existe' }); return; }
      const chunks: Buffer[] = []; request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          const page = String(body['page'] ?? '');
          if (graph.page(page) === undefined) { send(response, 404, { error: 'la página no existe' }); return; }
          send(response, 201, { id: includeManualPage(store, graph.owner!, space, page) });
        } catch (error) { send(response, 409, { error: error instanceof Error ? error.message : String(error) }); }
      }); return;
    }

    if (request.method === 'DELETE' && /^\/shared-spaces\/[^/]+\/pages\/[^/]+$/.test(path)) {
      const blocked = ownerOnly(); if (blocked !== null) { send(response, 403, blocked); return; }
      const parts = path.split('/'); const space = sharedSpaceBySlug(store, decodeURIComponent(parts[2] ?? ''));
      if (space === null) { send(response, 404, { error: 'el espacio no existe' }); return; }
      const changed = removeManualPage(store, space, decodeURIComponent(parts[4] ?? ''));
      send(response, changed ? 200 : 404, changed ? { status: 'removed' } : { error: 'la inclusión no estaba activa' });
      return;
    }

    if (request.method === 'DELETE' && /^\/shared-spaces\/[^/]+\/invitations\/[^/]+$/.test(path)) {
      const blocked = ownerOnly();
      if (blocked !== null) { send(response, 403, blocked); return; }
      const parts = path.split('/');
      const space = sharedSpaceBySlug(store, decodeURIComponent(parts[2] ?? ''));
      if (space === null) { send(response, 404, { error: 'el espacio no existe' }); return; }
      const changed = revokeInvitation(store, space, decodeURIComponent(parts[4] ?? ''));
      send(response, changed ? 200 : 409, changed ? { status: 'revoked' } : { error: 'la invitación ya no estaba pendiente' });
      return;
    }

    if (request.method === 'DELETE' && /^\/shared-spaces\/[^/]+\/invitations\/[^/]+\/permanent$/.test(path)) {
      const blocked = ownerOnly();
      if (blocked !== null) { send(response, 403, blocked); return; }
      const parts = path.split('/');
      const space = sharedSpaceBySlug(store, decodeURIComponent(parts[2] ?? ''));
      if (space === null) { send(response, 404, { error: 'el espacio no existe' }); return; }
      const changed = deleteInvitation(store, space, decodeURIComponent(parts[4] ?? ''));
      send(response, changed ? 200 : 404, changed ? { status: 'deleted' } : { error: 'la invitación no existe' });
      return;
    }

    if (request.method === 'DELETE' && /^\/shared-spaces\/[^/]+\/grants\/[^/]+$/.test(path)) {
      const blocked = ownerOnly();
      if (blocked !== null) { send(response, 403, blocked); return; }
      const parts = path.split('/');
      const space = sharedSpaceBySlug(store, decodeURIComponent(parts[2] ?? ''));
      if (space === null) { send(response, 404, { error: 'el espacio no existe' }); return; }
      const changed = revokeGrant(store, space, decodeURIComponent(parts[4] ?? ''));
      send(response, changed ? 200 : 409, changed ? { status: 'revoked' } : { error: 'el acceso ya no estaba activo' });
      return;
    }

    if (request.method === 'PATCH' && /^\/shared-spaces\/[^/]+\/grants\/[^/]+$/.test(path)) {
      const blocked = ownerOnly(); if (blocked !== null) { send(response, 403, blocked); return; }
      const parts = path.split('/'); const space = sharedSpaceBySlug(store, decodeURIComponent(parts[2] ?? ''));
      if (space === null) { send(response, 404, { error: 'el espacio no existe' }); return; }
      const chunks: Buffer[] = []; request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          const permissions = Array.isArray(body['permissions'])
            ? body['permissions'].filter((one): one is SharedPermission => ['read', 'contribute', 'edit'].includes(String(one))) : [];
          const changed = changeGrantPermissions(store, space, decodeURIComponent(parts[4] ?? ''), permissions);
          send(response, changed ? 200 : 404, changed ? { permissions } : { error: 'el acceso no estaba activo' });
        } catch (error) { send(response, 409, { error: error instanceof Error ? error.message : String(error) }); }
      }); return;
    }

    if (request.method === 'DELETE' && /^\/shared-spaces\/[^/]+\/participants\/[^/]+\/sessions$/.test(path)) {
      const blocked = ownerOnly();
      if (blocked !== null) { send(response, 403, blocked); return; }
      const parts = path.split('/');
      const space = sharedSpaceBySlug(store, decodeURIComponent(parts[2] ?? ''));
      if (space === null) { send(response, 404, { error: 'el espacio no existe' }); return; }
      const count = revokeParticipantSessions(store, space, decodeURIComponent(parts[4] ?? ''));
      send(response, 200, { status: 'revoked', sessions: count });
      return;
    }

    if (request.method === 'POST' && path === '/shared-proposals') {
      if (publicScopedSpace === null || scopedParticipant === null || !canContributeScopedSpace) {
        send(response, 403, { error: 'esta identidad no puede proponer cambios aquí' }); return;
      }
      const chunks: Buffer[] = []; request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          const originId = String(body['originId'] ?? '').trim();
          const channel = body['channel'] === 'drawn' || body['channel'] === 'walked' ? body['channel'] : 'typed_text';
          const change = body['change'] as Change | undefined;
          if (originId === '' || change === undefined) {
            send(response, 400, { error: 'la propuesta necesita originId y change' }); return;
          }
          const page = pageTouchedBy(change, null, (block) => graph.block(block)?.page);
          if (page === null || !pageBelongsToSharedSpace(graph, publicScopedSpace, page)) {
            send(response, 403, { error: 'la propuesta debe actuar sobre una página de este espacio' }); return;
          }
          const proposal = createSharedProposal(store, publicScopedSpace, scopedParticipant, page, originId, channel, change);
          send(response, 201, { status: 'awaiting_review', proposal: proposal.id, page });
        } catch (error) { send(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
      }); return;
    }

    if (request.method === 'POST' && /^\/shared-spaces\/[^/]+\/proposals\/[^/]+\/(accept|reject)$/.test(path)) {
      const blocked = ownerOnly(); if (blocked !== null) { send(response, 403, blocked); return; }
      const parts = path.split('/'); const space = sharedSpaceBySlug(store, decodeURIComponent(parts[2] ?? ''));
      if (space === null) { send(response, 404, { error: 'el espacio no existe' }); return; }
      const proposal = sharedProposal(store, space, decodeURIComponent(parts[4] ?? ''));
      if (proposal === null || proposal.status !== 'awaiting_review') {
        send(response, 409, { error: 'la propuesta ya no está pendiente' }); return;
      }
      const decision = parts[5] === 'accept' ? 'accepted' : 'rejected';
      if (decision === 'accepted') {
        const outcome = graph.submitOperation({ originId: `proposal:${proposal.id}`,
          participant: proposal.author as ParticipantId, channel: proposal.channel, change: proposal.change as Change });
        if (outcome.status === 'rejected') { send(response, 422, { error: outcome.reason }); return; }
        if (outcome.status === 'applied') {
          const failure = persist(outcome.operation);
          if (failure !== null) { send(response, 500, { error: 'no se pudo persistir la operación', detail: failure }); return; }
        }
      }
      const changed = decideSharedProposal(store, space, proposal.id, graph.owner!, decision);
      send(response, changed ? 200 : 409, changed ? { status: decision } : { error: 'la propuesta ya no está pendiente' });
      return;
    }

    if (request.method === 'GET' && /^\/shared-spaces\/[^/]+\/pages$/.test(path)) {
      const blocked = ownerOnly();
      if (blocked !== null) { send(response, 403, blocked); return; }
      const slug = decodeURIComponent(path.split('/')[2] ?? '');
      const space = sharedSpaceBySlug(store, slug);
      if (space === null) { send(response, 404, { error: 'el espacio no existe' }); return; }
      const pages = graph.pages().filter((page) => pageBelongsToSharedSpace(graph, space, page.id));
      send(response, 200, { space, pages: pages.map((page) => ({ id: page.id, title: page.title })) });
      return;
    }

    if (request.method === 'POST' && /^\/shared-spaces\/[^/]+\/invitations$/.test(path)) {
      const blocked = ownerOnly();
      if (blocked !== null) { send(response, 403, blocked); return; }
      const slug = decodeURIComponent(path.split('/')[2] ?? '');
      const space = sharedSpaceBySlug(store, slug);
      if (space === null) { send(response, 404, { error: 'el espacio no existe' }); return; }
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        let body: Record<string, unknown>;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>; }
        catch { send(response, 400, { error: 'the body must be JSON' }); return; }
        const permissions = Array.isArray(body['permissions'])
          ? body['permissions'].filter((one): one is SharedPermission => ['read', 'contribute', 'edit'].includes(String(one))) : [];
        try {
          const invitation = inviteToSpace(store, graph.owner!, space, permissions,
            typeof body['intendedContact'] === 'string' ? body['intendedContact'] : undefined,
            typeof body['lifetimeMs'] === 'number' ? body['lifetimeMs'] : DEFAULT_INVITATION_LIFETIME);
          const invitationPath = `/invite/${encodeURIComponent(invitation.id)}?secret=${encodeURIComponent(invitation.secret)}`;
          const canonicalDomain = publicSite()?.canonicalDomain ?? options.publicSite?.canonicalDomain;
          const invitationUrl = canonicalDomain === undefined
            ? invitationPath
            : new URL(invitationPath, `${canonicalDomain.replace(/\/$/, '')}/`).toString();
          send(response, 201, { ...invitation, space: space.name, url: invitationUrl });
        } catch (error) { send(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
      });
      return;
    }

    if (request.method === 'GET' && /^\/invitations\/[^/]+$/.test(path)) {
      const invitation = decodeURIComponent(path.split('/')[2] ?? '');
      const proof = url.searchParams.get('secret') ?? '';
      const view = inspectInvitation(store, invitation, proof);
      if (view === null) { send(response, 404, { error: 'la invitación no existe o el secreto no coincide' }); return; }
      send(response, 200, view);
      return;
    }

    if (request.method === 'POST' && /^\/invitations\/[^/]+\/redeem$/.test(path)) {
      const invitation = decodeURIComponent(path.split('/')[2] ?? '');
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        let body: Record<string, unknown>;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>; }
        catch { send(response, 400, { error: 'the body must be JSON' }); return; }
        const proof = typeof body['secret'] === 'string' ? body['secret'] : '';
        const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
        if (proof === '' || name === '') { send(response, 400, { error: 'el canje necesita secret y name' }); return; }
        try {
          const redeemed = redeemInvitation(store, invitation, proof, name);
          graph.addParticipant({ id: redeemed.participant, name, kind: 'human' });
          graph.admit(redeemed.participant);
          send(response, 201, redeemed);
        } catch (error) { send(response, 409, { error: error instanceof Error ? error.message : String(error) }); }
      });
      return;
    }

    const ceremony = () => ceremonyFor(request.headers.host ?? 'localhost',
      typeof request.headers['x-forwarded-proto'] === 'string' ? request.headers['x-forwarded-proto'] : undefined);
    const setHumanSession = (secret: string, expiresAt: number): void => {
      const secure = ceremony().origin.startsWith('https:') ? '; Secure' : '';
      response.setHeader('set-cookie', `vera_session=${encodeURIComponent(secret)}; Path=/; HttpOnly; SameSite=Strict${secure}; Expires=${new Date(expiresAt).toUTCString()}`);
    };

    if (request.method === 'POST' && path === '/human-auth/registration/options') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => void (async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          send(response, 200, await registrationOptions(store, String(body['enrollment'] ?? ''),
            String(body['secret'] ?? ''), ceremony()));
        } catch (error) { send(response, 409, { error: error instanceof Error ? error.message : String(error) }); }
      })());
      return;
    }

    if (request.method === 'POST' && path === '/human-auth/registration/verify') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => void (async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, any>;
          const made = await finishRegistration(store, String(body['enrollment'] ?? ''),
            String(body['secret'] ?? ''), body['response']);
          completeOwnerBootstrapIfDue(store, owner.id, made.participant);
          setHumanSession(made.secret, made.expiresAt);
          send(response, 201, { participant: made.participant, expiresAt: made.expiresAt });
        } catch (error) { send(response, 409, { error: error instanceof Error ? error.message : String(error) }); }
      })());
      return;
    }

    if (request.method === 'POST' && path === '/human-auth/authentication/options') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => void (async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          send(response, 200, await authenticationOptions(store, String(body['participant'] ?? ''), ceremony()));
        } catch (error) { send(response, 409, { error: error instanceof Error ? error.message : String(error) }); }
      })());
      return;
    }

    if (request.method === 'POST' && path === '/human-auth/authentication/verify') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => void (async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, any>;
          const made = await finishAuthentication(store, String(body['participant'] ?? ''), body['response']);
          setHumanSession(made.secret, made.expiresAt);
          send(response, 201, { expiresAt: made.expiresAt });
        } catch (error) { send(response, 409, { error: error instanceof Error ? error.message : String(error) }); }
      })());
      return;
    }

    if (request.method === 'POST' && path === '/human-auth/logout') {
      const gone = revokeSession(store, cookie('vera_session'));
      response.setHeader('set-cookie', 'vera_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
      send(response, gone ? 200 : 401, gone ? { status: 'revoked' } : { error: 'no había una sesión activa' });
      return;
    }

    if (request.method === 'GET' && /^\/s\/[^/]+\/api\/pages(?:\/[^/]+)?$/.test(path)) {
      const segments = path.split('/');
      const slug = decodeURIComponent(segments[2] ?? '');
      const space = sharedSpaceBySlug(store, slug);
      if (space === null || space.status !== 'active') { send(response, 404, { error: 'el espacio no existe' }); return; }
      if (space.audience !== 'anybody') {
        const participant = participantForSession(store, cookie('vera_session'));
        if (participant === null) { send(response, 401, { error: 'hace falta una sesión humana activa' }); return; }
        const grant = store.db.prepare(`SELECT permissions FROM access_grants
          WHERE space_id=? AND participant_id=? AND status='active'`).get(space.id, participant) as any;
        if (grant === undefined || !String(grant.permissions).split(',').includes('read')) {
          send(response, 403, { error: 'esta identidad no puede leer este espacio' }); return;
        }
      }
      const inside = (page: { id: string }): boolean => pageBelongsToSharedSpace(graph, space, page.id);
      if (segments.length === 6) {
        const named = decodeURIComponent(segments[5] ?? '');
        const page = graph.page(named) ?? graph.pageTitled(named);
        if (page === undefined || !inside(page)) { send(response, 404, { error: 'la página no existe en este espacio' }); return; }
        const blocks = graph.blocksOf(page.id);
        send(response, 200, { space: { name: space.name, slug: space.slug }, page: {
          id: page.id, title: page.title,
          properties: graph.propertiesOf(page.id).map(({ key, value }) => ({ key, value })),
          blocks: blocks.map(({ stableId, parent, position, content }) => ({ stableId, parent, position, content }))
            .sort((a, b) => a.position - b.position),
          blockProperties: Object.fromEntries(blocks.map((block) => [block.stableId,
            graph.propertiesOf(block.stableId).map(({ key, value }) => ({ key, value }))])),
        }});
        return;
      }
      send(response, 200, { space: { name: space.name, slug: space.slug },
        pages: graph.pages().filter(inside).map(({ id, title }) => ({ id, title })) });
      return;
    }

    /** Quién dice ser quien llama, para que un agente pueda comprobarlo. */
    if (request.method === 'GET' && path === '/agents/whoami') {
      const secret = bearerOf(request.headers.authorization);
      if (secret === null) {
        send(response, 200, { participant: graph.owner, kind: 'human', scopes: null });
        return;
      }
      const resolved = resolveSecret(store, secret);
      if (!resolved.ok) {
        send(response, 401, { error: resolved.detail, reason: resolved.reason });
        return;
      }
      send(response, 200, {
        participant: resolved.credential.participant,
        kind: graph.participant(resolved.credential.participant)?.kind ?? null,
        scopes: resolved.credential.scopes,
        label: resolved.credential.label,
      });
      return;
    }

    /** Admitir un agente en el grafo. rule OwnerInvitesParticipant. */
    if (request.method === 'POST' && path === '/agents') {
      const blocked = ownerOnly();
      if (blocked !== null) {
        send(response, 403, blocked);
        return;
      }
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        let body: { id?: unknown; name?: unknown };
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
        } catch {
          send(response, 400, { error: 'the body must be JSON' });
          return;
        }
        const id = typeof body.id === 'string' ? body.id.trim() : '';
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (id === '' || name === '') {
          send(response, 400, { error: 'un agente necesita id y name' });
          return;
        }
        if (graph.participant(id) !== undefined) {
          send(response, 409, { error: `${id} ya participa en este grafo` });
          return;
        }
        try {
          saveParticipant(store, { id, name, kind: 'agent' });
          graph.addParticipant({ id, name, kind: 'agent' });
          graph.admit(id);
        } catch (error) {
          send(response, 500, {
            error: 'no se pudo admitir el agente',
            detail: error instanceof Error ? error.message : String(error),
          });
          return;
        }
        send(response, 201, { id, name, kind: 'agent', status: 'active' });
      });
      return;
    }

    /*
     * Conectar una IA nueva, de una vez.
     *
     * Son cinco escrituras —admitir el participante, emitir la credencial,
     * cercarla, escribir su fila en la página de la puerta y ponerle sus
     * propiedades— y ninguna sirve sola: un participante sin credencial no entra,
     * una credencial sin fila lee sin que nadie sepa quién es, y una fila sin
     * credencial es una intención. Pedirlas por separado dejaría a alguien a
     * medias sin manera de saber por dónde iba.
     *
     * Va aquí y no en la herramienta MCP porque es un acto del dueño sobre su
     * corpus, y porque el bloque de la fila entra por la puerta de siempre, con
     * su autor y su sitio en la secuencia, como cualquier edición hecha a mano.
     *
     * El trato es grueso a propósito. `read`, `write` y `discard` son el
     * vocabulario del código —«deliberadamente grueso», dice credentials.ts— y
     * aun así son tres decisiones donde quien conecta una IA tiene una: qué clase
     * de trato es éste. Tres tratos con nombre se pueden leer y decidir; tres
     * casillas obligan a saberse qué implica cada una antes de poder contestar.
     */
    if (request.method === 'POST' && path === '/mcp/connections') {
      const blocked = ownerOnly();
      if (blocked !== null) {
        send(response, 403, blocked);
        return;
      }
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        let body: {
          name?: unknown;
          client?: unknown;
          deal?: unknown;
          kind?: unknown;
          source?: unknown;
          says?: unknown;
        };
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
        } catch {
          send(response, 400, { error: 'the body must be JSON' });
          return;
        }

        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const client = typeof body.client === 'string' ? body.client.trim() : '';
        const deal = typeof body.deal === 'string' ? body.deal.trim() : '';
        if (name === '' || client === '') {
          send(response, 400, {
            error: 'una conexión necesita un nombre y con qué palabra se declara el cliente',
          });
          return;
        }
        const DEALS: Record<string, { scopes: Scope[]; permission: string; fenced: boolean }> = {
          leer: { scopes: ['read'], permission: 'leer', fenced: false },
          propio: { scopes: ['read', 'write'], permission: 'escribe en lo suyo', fenced: true },
          todo: { scopes: ['read', 'write', 'discard'], permission: 'todo', fenced: false },
        };
        const chosen = DEALS[deal];
        if (chosen === undefined) {
          send(response, 400, { error: `el trato es uno de ${Object.keys(DEALS).join(', ')}` });
          return;
        }
        const kind = typeof body.kind === 'string' ? body.kind.trim() : '';
        if (chosen.fenced && kind === '') {
          send(response, 400, {
            error: 'para escribir en lo suyo hace falta decir qué clase de página puede crear',
          });
          return;
        }

        const door = governing(MCP_KIND);
        if (door === undefined) {
          send(response, 409, {
            error: 'no hay página que gobierne la puerta MCP, y la conexión vive en ella',
          });
          return;
        }
        const owner = graph.owner;
        if (owner === null) {
          send(response, 500, { error: 'this graph has no owner' });
          return;
        }

        /*
         * La identidad se deriva del nombre con que se declara el cliente.
         *
         * Pedirla aparte sería pedir dos veces lo mismo con dos formas distintas,
         * y la forma exacta —`participant:chatgpt`— es una convención del
         * almacén que no tiene por qué saberse para conectar una IA.
         */
        const participant = `participant:${client.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`;
        if (graph.participant(participant) === undefined) {
          saveParticipant(store, { id: participant, name, kind: 'agent' });
          graph.addParticipant({ id: participant, name, kind: 'agent' });
          graph.admit(participant);
        }

        let issued;
        try {
          issued = issueCredential(store, {
            participant,
            scopes: chosen.scopes,
            label: name,
            issuedBy: owner,
            expiresAt: null,
          });
        } catch (error) {
          send(response, 500, {
            error: 'no se pudo emitir la credencial',
            detail: error instanceof Error ? error.message : String(error),
          });
          return;
        }

        const source = typeof body.source === 'string' && body.source.trim() !== ''
          ? body.source.trim()
          : client;
        if (chosen.fenced) {
          grantConfinement(store, {
            token: issued.credential.id,
            kind,
            source,
            grantedBy: owner,
          });
        }

        /*
         * Y su fila, colgando del apartado que las reúne.
         *
         * Se busca el encabezado por lo que dice y no por su posición: la página
         * es de quien la escribe y puede reordenarla. Si no aparece, la fila va al
         * final de la página, que es peor sitio y sigue siendo la página.
         */
        const stamp = Date.now();
        let step = 0;
        const write = (change: Change): string | null => {
          const outcome = graph.submitOperation({
            originId: `connection:${issued.credential.id}:${(step += 1)}`,
            participant: owner,
            channel: 'typed_text',
            change,
          });
          if (outcome.status !== 'applied') return null;
          if (persist(outcome.operation) !== null) return null;
          return outcome.subjectId;
        };

        const blocks = graph.blocksOf(door.id);
        const heading = blocks.find((one) =>
          /^conexiones/i.test(one.content.trim().replace(/^#{1,6}\s+/, '')),
        );
        const parent = heading?.stableId ?? null;
        const position = blocks.filter((one) => one.parent === parent).length;

        const row = write({ kind: 'create_block', page: door.id, parent, position, content: name });
        if (row === null) {
          send(response, 500, { error: 'la credencial quedó emitida pero su fila no se pudo escribir' });
          return;
        }
        write({ kind: 'set_property', block: row, propertyKey: CLIENT_KEY, propertyValue: client });
        write({ kind: 'set_property', block: row, propertyKey: 'participante', propertyValue: participant });
        write({ kind: 'set_property', block: row, propertyKey: 'permiso', propertyValue: chosen.permission });
        if (typeof body.says === 'string' && body.says.trim() !== '') {
          write({ kind: 'set_property', block: row, propertyKey: 'qué', propertyValue: body.says.trim() });
        }

        // @guarantee TheSecretIsShownOnce: la única vez que el secreto sale de
        // aquí. No se vuelve a poder leer, y decirlo es parte de entregarlo.
        send(response, 201, {
          ...issued.credential,
          secret: issued.secret,
          block: row,
          participant,
          client,
          stamp,
        });
      });
      return;
    }

    if (request.method === 'GET' && path === '/agents/credentials') {
      const blocked = ownerOnly();
      if (blocked !== null) {
        send(response, 403, blocked);
        return;
      }
      /*
       * @guarantee TheSecretIsShownOnce: aquí nunca hay secretos que mostrar.
       *
       * El cerco viaja con su credencial y no en otra petición. @guarantee
       * AFenceIsReadWhereTheCredentialIsRead: un permiso que hay que ir a buscar
       * a otra pantalla es un permiso que se olvida de revisar.
       */
      const fenced = new Map(confinements(store).map((one) => [one.token, one]));
      send(
        response,
        200,
        listCredentials(store).map((one) => ({
          ...one,
          confinement: fenced.get(one.id) ?? null,
        })),
      );
      return;
    }

    /*
     * Cercar una credencial, y quitarle el cerco.
     *
     * Cosa del dueño, como emitirla: @invariant AFenceIsGrantedByAPerson. Y
     * quitar el cerco es ampliar un permiso, no retirarlo —una credencial sin
     * cerco escribe donde quiera—, así que pasa por la misma puerta.
     */
    if (request.method === 'POST' && /^\/agents\/credentials\/[^/]+\/confinement$/.test(path)) {
      const blocked = ownerOnly();
      if (blocked !== null) {
        send(response, 403, blocked);
        return;
      }
      const token = decodeURIComponent(path.split('/')[3] ?? '');
      if (!listCredentials(store).some((one) => one.id === token)) {
        send(response, 404, { error: `no existe la credencial ${token}` });
        return;
      }
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        let body: { kind?: unknown; source?: unknown };
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
        } catch {
          send(response, 400, { error: 'the body must be JSON' });
          return;
        }
        const kind = typeof body.kind === 'string' ? body.kind.trim() : '';
        if (kind === '') {
          send(response, 400, {
            error: 'un cerco concede una clase de página, y hace falta decir cuál',
          });
          return;
        }
        const owner = graph.owner;
        if (owner === null) {
          send(response, 500, { error: 'this graph has no owner' });
          return;
        }
        const source =
          typeof body.source === 'string' && body.source.trim() !== '' ? body.source.trim() : null;
        send(response, 200, grantConfinement(store, { token, kind, source, grantedBy: owner }));
      });
      return;
    }

    if (request.method === 'DELETE' && /^\/agents\/credentials\/[^/]+\/confinement$/.test(path)) {
      const blocked = ownerOnly();
      if (blocked !== null) {
        send(response, 403, blocked);
        return;
      }
      const token = decodeURIComponent(path.split('/')[3] ?? '');
      send(response, withdrawConfinement(store, token) ? 200 : 404, {
        token,
        confined: false,
      });
      return;
    }

    if (request.method === 'POST' && path === '/agents/credentials') {
      const blocked = ownerOnly();
      if (blocked !== null) {
        send(response, 403, blocked);
        return;
      }
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        let body: { participant?: unknown; scopes?: unknown; label?: unknown; expiresAt?: unknown };
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
        } catch {
          send(response, 400, { error: 'the body must be JSON' });
          return;
        }

        const participant = typeof body.participant === 'string' ? body.participant : '';
        const held = graph.participant(participant);
        if (held === undefined) {
          send(response, 404, { error: `no existe el participante ${participant}` });
          return;
        }
        if (held.kind !== 'agent') {
          send(response, 400, {
            error: 'las credenciales son para agentes; una persona no se autentica con un token',
          });
          return;
        }

        const asked = Array.isArray(body.scopes) ? body.scopes : [];
        const scopes = asked.filter((s): s is Scope => SCOPES.includes(s as Scope));
        if (scopes.length !== asked.length || scopes.length === 0) {
          send(response, 400, { error: `scopes debe ser un subconjunto de ${SCOPES.join(', ')}` });
          return;
        }

        const owner = graph.owner;
        if (owner === null) {
          send(response, 500, { error: 'this graph has no owner' });
          return;
        }

        try {
          const issued = issueCredential(store, {
            participant,
            scopes,
            label: typeof body.label === 'string' && body.label !== '' ? body.label : participant,
            issuedBy: owner,
            expiresAt: typeof body.expiresAt === 'number' ? body.expiresAt : null,
          });
          // La única vez que el secreto viaja. No se vuelve a poder leer.
          send(response, 201, { ...issued.credential, secret: issued.secret });
        } catch (error) {
          send(response, 500, {
            error: 'no se pudo emitir la credencial',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      });
      return;
    }

    if (request.method === 'POST' && /^\/agents\/credentials\/[^/]+\/revoke$/.test(path)) {
      const blocked = ownerOnly();
      if (blocked !== null) {
        send(response, 403, blocked);
        return;
      }
      const id = decodeURIComponent(path.split('/')[3] ?? '');
      const revoked = revokeCredential(store, id);
      if (revoked === null) {
        send(response, 404, { error: `no existe la credencial ${id}` });
        return;
      }
      send(response, 200, revoked);
      return;
    }

    // -----------------------------------------------------------------------
    // La cascada de validación desde la voz
    // -----------------------------------------------------------------------
    //
    // Tres cosas y nada más: grabar, transcribir —cuantas veces se quiera— y
    // borrar el audio. No hay estado que avanzar ni paso que completar; lo demás
    // es la edición ordinaria de un bloque ordinario.

    /*
     * Una copia portable del grafo entero: estado, registro y objetos.
     *
     * No es la proyección Markdown. Ésta conserva también la historia y los
     * bytes, y por eso vuelve como un único archivo propio de Vera.
     */
    if (request.method === 'GET' && path === '/graph.vera') {
      try {
        const body = Buffer.from(JSON.stringify(makeVeraFile(store, graph, objectsRoot)));
        const day = new Date().toISOString().slice(0, 10);
        response.writeHead(200, {
          'content-type': 'application/vnd.vera.graph+json',
          'content-length': body.byteLength,
          'content-disposition': `attachment; filename="vera-${day}.vera"`,
          'cache-control': 'no-store',
        });
        response.end(body);
      } catch (error) {
        send(response, 500, {
          error: 'no se pudo construir el archivo Vera',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    /*
     * Incorporar otro archivo Vera al corpus abierto.
     *
     * Es aditivo. Las identidades reciben un espacio propio y los títulos que
     * ya existen se distinguen, igual que al importar un documento. Así un
     * archivo nunca reemplaza contenido existente por el mero hecho de abrirlo.
     */
    if (request.method === 'POST' && path === '/import/vera') {
      const chunks: Buffer[] = [];
      let size = 0;
      let tooLarge = false;
      request.on('data', (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > 1024 * 1024 * 1024) tooLarge = true;
        else chunks.push(chunk);
      });
      request.on('end', () => {
        if (tooLarge) return send(response, 413, { error: 'el archivo .vera supera 1 GB' });
        const file = readVeraFile(Buffer.concat(chunks));
        if ('error' in file) return send(response, 422, file);
        if (graph.owner === null) return send(response, 409, { error: 'el corpus no tiene dueño' });
        if (file.assets.length > 0 && objectsRoot === null) {
          return send(response, 409, { error: 'esta instancia no tiene almacén de objetos' });
        }

        const namespace =
          `${file.exportedAt.toString(36)}-${Date.now().toString(36)}-` +
          Buffer.from(file.graph.id).toString('base64url').slice(0, 12);
        const pageIds = new Map<string, string>();
        const blockIds = new Map<string, string>();
        const titles = new Map<string, string>();
        for (const page of file.graph.pages) {
          let id = `import:${namespace}:${page.id}`;
          for (let attempt = 2; graph.page(id) !== undefined; attempt += 1) id = `import:${namespace}:${attempt}:${page.id}`;
          pageIds.set(page.id, id);
          let title = page.title;
          for (let attempt = 2; graph.pageTitled(title) !== undefined || [...titles.values()].includes(title); attempt += 1) {
            title = `${page.title} (${attempt})`;
          }
          titles.set(page.title, title);
          for (const block of page.blocks) {
            let blockId = `import:${namespace}:${block.id}`;
            for (let attempt = 2; graph.block(blockId) !== undefined || [...blockIds.values()].includes(blockId); attempt += 1) {
              blockId = `import:${namespace}:${attempt}:${block.id}`;
            }
            blockIds.set(block.id, blockId);
          }
        }

        const assetPaths = new Map<string, string>();
        try {
          for (const asset of file.assets) {
            const bytes = Buffer.from(asset.bytes, 'base64');
            if (bytes.byteLength !== asset.byteSize || hashBytes(bytes) !== asset.hash) {
              return send(response, 422, { error: `el asset ${asset.path} no coincide con su hash o tamaño` });
            }
            const stored = putObject(objectsRoot as string, bytes);
            let wanted = asset.path;
            const occupied = media.find((one) => one.path === wanted);
            if (occupied !== undefined && occupied.hash !== stored.hash) {
              const dot = wanted.lastIndexOf('.');
              wanted = dot < 1
                ? `${wanted}-${stored.hash.slice(0, 8)}`
                : `${wanted.slice(0, dot)}-${stored.hash.slice(0, 8)}${wanted.slice(dot)}`;
            }
            assetPaths.set(asset.path, wanted);
            recordMedia(store, {
              path: wanted,
              hash: stored.hash,
              mediaType: asset.mediaType,
              byteSize: stored.byteSize,
              at: file.exportedAt,
              originalName: asset.originalName ?? asset.path,
            });
            describeMedia(store, stored.hash, {
              description: asset.description,
              alternativeText: asset.alternativeText,
            });
            if (!media.some((one) => one.path === wanted)) {
              media.push({ path: wanted, hash: stored.hash, mediaType: asset.mediaType, description: asset.description, alternativeText: asset.alternativeText });
            }
          }
        } catch (error) {
          return send(response, 422, { error: error instanceof Error ? error.message : String(error) });
        }

        let made = 0;
        const write = (change: Change): string => {
          const outcome = graph.submitOperation({
            originId: `vera-file:${namespace}:${made}`,
            participant: graph.owner as ParticipantId,
            channel: 'import',
            change,
          });
          if (outcome.status === 'rejected') throw new Error(outcome.reason);
          if (outcome.status === 'applied') {
            const failure = persist(outcome.operation);
            if (failure !== null) throw new Error(failure);
          }
          made += 1;
          return outcome.operation.subjectId;
        };
        const replace = (content: string): string => {
          let rewritten = content;
          for (const [before, after] of assetPaths) rewritten = rewritten.split(before).join(after);
          for (const [before, after] of titles) {
            if (before !== after) rewritten = rewritten.split(`[[${before}]]`).join(`[[${after}]]`);
          }
          for (const [before, after] of blockIds) rewritten = rewritten.split(`((${before}))`).join(`((${after}))`);
          return rewritten;
        };

        try {
          for (const page of file.graph.pages) {
            const pageId = pageIds.get(page.id) as string;
            write({ kind: 'create_page', title: titles.get(page.title) as string, visibility: page.visibility, stableId: pageId });
            if (page.originCreatedAt !== null) write({ kind: 'recover_page_origin', page: pageId, originCreatedAt: page.originCreatedAt });
            for (const property of page.properties) write({ kind: 'set_property', page: pageId, propertyKey: property.key, propertyValue: property.value });
            const pending = [...page.blocks];
            const created = new Set<string>();
            while (pending.length > 0) {
              const at = pending.findIndex((block) => block.parent === null || created.has(block.parent));
              if (at < 0) throw new Error(`la página «${page.title}» tiene padres de bloque inexistentes o circulares`);
              const block = pending.splice(at, 1)[0] as (typeof page.blocks)[number];
              const blockId = blockIds.get(block.id) as string;
              write({
                kind: 'create_block',
                page: pageId,
                parent: block.parent === null ? null : (blockIds.get(block.parent) as string),
                position: block.position,
                content: replace(block.content),
                stableId: blockId,
              });
              created.add(block.id);
              for (const property of block.properties) write({ kind: 'set_property', block: blockId, propertyKey: property.key, propertyValue: property.value });
              if (block.gloss !== null) write({ kind: 'set_block_gloss', block: blockId, content: replace(block.gloss) });
            }
          }
        } catch (error) {
          return send(response, 422, {
            error: 'el archivo empezó a importarse pero contiene un cambio incompatible',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
        send(response, 201, { pages: file.graph.pages.length, assets: file.assets.length, operations: made });
      });
      return;
    }

    if (request.method === 'POST' && path === '/media') {
      const chunks: Buffer[] = [];
      let size = 0;
      let tooLarge = false;
      request.on('data', (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > 50 * 1024 * 1024) tooLarge = true;
        else chunks.push(chunk);
      });
      request.on('end', () => {
        if (tooLarge) return send(response, 413, { error: 'el archivo supera los 50 MB' });
        const bytes = Buffer.concat(chunks);
        if (bytes.byteLength === 0) return send(response, 400, { error: 'no llegó ningún archivo' });
        if (objectsRoot === null) return send(response, 500, { error: 'esta instancia no tiene almacén de objetos' });

        const original = decodeURIComponent(String(request.headers['x-filename'] ?? 'archivo')).trim() || 'archivo';
        const clean = original.replace(/^.*[\\/]/, '').replace(/[^\p{L}\p{N}._ -]/gu, '_');
        const declared = String(request.headers['content-type'] ?? '').split(';')[0] ?? '';
        const mediaType = sniffMediaType(bytes) ?? (declared && declared !== 'application/octet-stream' ? declared : mediaTypeFor(original));
        if (!(mediaType.startsWith('image/') || mediaType.startsWith('audio/') || mediaType === 'application/pdf')) {
          return send(response, 415, { error: 'Vera admite imágenes, audios y PDF' });
        }
        const stored = putObject(objectsRoot, bytes);
        let asset = `../assets/${clean}`;
        const occupied = media.find((one) => one.path === asset);
        if (occupied !== undefined && occupied.hash !== stored.hash) {
          const dot = clean.lastIndexOf('.');
          asset = dot < 1
            ? `../assets/${clean}-${stored.hash.slice(0, 8)}`
            : `../assets/${clean.slice(0, dot)}-${stored.hash.slice(0, 8)}${clean.slice(dot)}`;
        }
        recordMedia(store, { path: asset, hash: stored.hash, mediaType, byteSize: stored.byteSize, at: Date.now(), originalName: original });
        const held = media.findIndex((one) => one.path === asset);
        const entry = { path: asset, hash: stored.hash, mediaType, description: null, alternativeText: null };
        if (held < 0) media.push(entry);
        else media[held] = entry;
        send(response, 201, { path: asset, url: `/media/${stored.hash}`, mediaType, byteSize: stored.byteSize, originalName: original });
      });
      return;
    }

    if (request.method === 'GET' && path === '/media') {
      send(
        response,
        200,
        listedMedia(store).map((entry) => ({ ...entry, url: `/media/${entry.hash}` })),
      );
      return;
    }

    if (request.method === 'PATCH' && path.startsWith('/media/')) {
      const hash = path.slice('/media/'.length);
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        let body: { description?: unknown; alternativeText?: unknown };
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
        } catch {
          return send(response, 400, { error: 'metadatos inválidos' });
        }
        const clean = (value: unknown): string | null => {
          if (typeof value !== 'string') return null;
          const trimmed = value.trim();
          return trimmed === '' ? null : trimmed.slice(0, 4000);
        };
        const updated = describeMedia(store, hash, {
          description: clean(body.description),
          alternativeText: clean(body.alternativeText),
        });
        if (updated === null) return send(response, 404, { error: 'no existe ese archivo' });
        for (const entry of media) {
          if (entry.hash !== hash) continue;
          entry.description = updated.description;
          entry.alternativeText = updated.alternativeText;
        }
        send(response, 200, updated);
      });
      return;
    }

    if (request.method === 'DELETE' && path.startsWith('/media/')) {
      const hash = path.slice('/media/'.length);
      if (!HASH.test(hash)) return send(response, 400, { error: 'hash inválido' });
      const usages = listedMedia(store).find((entry) => entry.hash === hash)?.usages;
      if (usages === undefined) return send(response, 404, { error: 'no existe ese archivo' });
      if (usages.length > 0) {
        return send(response, 409, { error: 'el archivo todavía está enlazado desde bloques', usages });
      }
      const removed = deleteOrphanMedia(store, hash);
      if (!removed.deleted) return send(response, 409, { error: 'el archivo todavía pertenece a una grabación' });
      if (removed.deleteObject && objectsRoot !== null) {
        const file = objectPath(objectsRoot, hash);
        if (existsSync(file)) unlinkSync(file);
      }
      for (let at = media.length - 1; at >= 0; at -= 1) {
        if (media[at]?.hash === hash) media.splice(at, 1);
      }
      send(response, 200, { deleted: true });
      return;
    }

    if (request.method === 'POST' && path === '/recordings') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const audio = Buffer.concat(chunks);
        if (audio.byteLength === 0) {
          send(response, 400, { error: 'no llegó audio' });
          return;
        }
        if (objectsRoot === null) {
          send(response, 500, { error: 'esta instancia no tiene almacén de objetos' });
          return;
        }

        const mediaType = String(request.headers['content-type'] ?? 'audio/webm').split(';')[0] ?? 'audio/webm';
        const duration = Number(request.headers['x-duration-ms'] ?? '');
        // El bloque donde se estaba escribiendo cuando se habló, si se habló
        // dentro de un documento. Va en una cabecera porque el cuerpo son los
        // bytes del audio y no cabe nada más.
        const inBlock = String(request.headers['x-in-block'] ?? '').trim();

        // El audio entra al mismo almacén direccionado por contenido que todo
        // lo demás: grabar dos veces lo mismo no lo guarda dos veces.
        const stored = putObject(objectsRoot, audio);
        const at = Date.now();
        recordMedia(store, {
          path: `recording/${stored.hash}`,
          hash: stored.hash,
          mediaType,
          byteSize: stored.byteSize,
          at,
        });

        // Quien habla y cuándo. Sin autenticación se asume el propietario, y la
        // referencia lo dice en vez de fingir que está probado.
        const recording = createRecording(store, {
          audioHash: stored.hash,
          mediaType,
          durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
          evidence: {
            reference: `speaker:${owner.id} (asumido, sin autenticación)`,
            capturedAt: at,
          },
          capturedBy: owner.id,
          placedInBlock: inBlock === '' ? null : inBlock,
        });

        if ('error' in recording) {
          send(response, 422, recording);
          return;
        }

        send(response, 201, recording);
      });
      return;
    }

    /*
     * Importar un documento: entra un archivo y sale una página.
     *
     * Ver specs/document-import.allium. El cuerpo son los bytes del archivo y el
     * nombre viaja en una cabecera, igual que en `/recordings`: no cabe nada más
     * al lado de un binario.
     *
     * Se lee entero antes de escribir nada. Si el archivo no se puede leer, el
     * grafo queda exactamente como estaba —@invariant NoPageSurvivesARefusal—, en
     * vez de dejar una página vacía con el nombre del archivo que alguien tenga
     * que ir a borrar después.
     */
    if (request.method === 'POST' && path === '/import') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const bytes = Buffer.concat(chunks);
        if (bytes.byteLength === 0) {
          send(response, 400, { error: 'no llegó ningún archivo' });
          return;
        }

        const filename = decodeURIComponent(String(request.headers['x-filename'] ?? '')).trim();
        if (filename === '') {
          send(response, 400, { error: 'el archivo tiene que venir con su nombre' });
          return;
        }
        const mediaType = String(request.headers['content-type'] ?? '').split(';')[0] ?? '';

        const parsed = parseDocument(bytes, filename, mediaType);
        if ('error' in parsed) {
          send(response, 422, parsed);
          return;
        }

        /*
         * El título sale del documento, y si no, de su nombre.
         *
         * @invariant ImportNeverMergesIntoAnExistingPage: cuando el título ya
         * está tomado, la importación nace aparte y con un título que la
         * distingue. Escribir dentro de una página que alguien ya tenía es una
         * pérdida que no se deshace mirando el registro.
         */
        const wanted = parsed.title ?? filename.replace(/\.[^.]+$/, '');
        let title = wanted;
        for (let attempt = 2; graph.pageTitled(title) !== undefined; attempt += 1) {
          title = `${wanted} (${attempt})`;
        }

        const write = (change: Change): string | { error: string } => {
          const outcome = graph.submitOperation({
            originId: `import:${Date.now()}:${made}`,
            participant: owner.id,
            // No lo escribió quien pulsó el botón y no lo escribió la máquina: lo
            // trajo. @invariant EverythingArrivesAsImport.
            channel: 'import',
            change,
          });
          if (outcome.status === 'rejected') return { error: outcome.reason };
          // Un duplicado no se vuelve a persistir: la operación ya está en el
          // registro y su sujeto es el mismo.
          if (outcome.status === 'applied') {
            const failure = persist(outcome.operation);
            if (failure !== null) return { error: failure };
          }
          made += 1;
          return outcome.operation.subjectId;
        };

        let made = 0;
        const page = write({ kind: 'create_page', title, visibility: 'private' });
        if (typeof page !== 'string') {
          send(response, 422, page);
          return;
        }

        /*
         * De profundidades a padres.
         *
         * El padre de un trozo es el último trozo de profundidad menor que vino
         * antes que él. `open` guarda, para cada profundidad, cuál es ese bloque;
         * un trozo más somero borra lo que colgaba de él, porque lo que venga
         * después ya no es hijo de aquello.
         */
        const open = new Map<number, string>();
        let written = 0;
        for (const piece of parsed.pieces) {
          const depth = Math.max(0, piece.depth);
          let parent: string | null = null;
          for (let above = depth - 1; above >= 0; above -= 1) {
            const found = open.get(above);
            if (found !== undefined) {
              parent = found;
              break;
            }
          }
          const block = write({
            kind: 'create_block',
            page,
            parent,
            position: Number.MAX_SAFE_INTEGER,
            content: piece.content,
          });
          if (typeof block !== 'string') continue;
          open.set(depth, block);
          for (const level of [...open.keys()]) if (level > depth) open.delete(level);
          written += 1;
        }

        send(response, 201, {
          page,
          title,
          blocks: written,
          format: parsed.format,
          losses: parsed.losses,
        });
      });
      return;
    }

    /*
     * Transcribir escribe el texto del bloque.
     *
     * No deja una propuesta en un cajón que alguien tenga que aceptar: deja el
     * texto donde el texto va, por una operación ordinaria y firmada como lo que
     * es. Canal `authenticated_voice` con la evidencia de la grabación, que es lo
     * que el registro guardará de por vida sobre este texto.
     *
     * Volver a transcribir es esta misma ruta otra vez: reemplaza el texto y no
     * toca el audio.
     */
    if (request.method === 'POST' && /^\/recordings\/[^/]+\/transcribe$/.test(path)) {
      const id = decodeURIComponent(path.split('/')[2] ?? '');
      const held = recordingById(store, id);
      if (held === null) {
        send(response, 404, { error: 'no such recording' });
        return;
      }
      if (held.audioHash === null || objectsRoot === null) {
        send(response, 422, { error: 'esta grabación ya no tiene audio que transcribir' });
        return;
      }
      if (held.placedInBlock === null) {
        send(response, 422, { error: 'esta grabación no tiene bloque donde escribir' });
        return;
      }
      const block = held.placedInBlock;

      const audio = readFileSync(objectPath(objectsRoot, held.audioHash));
      void transcribeAudio(audio).then((outcome) => {
        if ('error' in outcome) {
          send(response, 502, outcome);
          return;
        }
        try {
          const written = graph.submitOperation({
            // Cada transcripción es una operación distinta: volver a transcribir
            // no puede confundirse con un reenvío de la anterior.
            originId: `voice:${id}:${Date.now()}`,
            participant: owner.id,
            channel: 'authenticated_voice',
            evidence: held.evidence,
            change: { kind: 'edit_block', block, content: outcome.text },
          });
          if (written.status !== 'applied') {
            send(response, 422, { error: `no se pudo escribir la transcripción: ${written.status}` });
            return;
          }
          const failure = persist(written.operation);
          if (failure !== null) throw new Error(failure);
          setSpokenOrigin(store, block, id);
          const kept = setTranscript(store, id, outcome.text);
          send(response, 200, { recording: kept, block, text: outcome.text });
        } catch (error) {
          send(response, 500, {
            error: 'no se pudo escribir la transcripción',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      });
      return;
    }

    // Borrar el audio. En cualquier momento, transcrito o no, y sólo cuando se
    // pide exactamente eso. Exigir haber recorrido una cascada entera hacía a
    // Vera dueña de una grabación que no es suya.
    if (request.method === 'DELETE' && /^\/recordings\/[^/]+\/audio$/.test(path)) {
      const id = decodeURIComponent(path.split('/')[2] ?? '');
      const outcome = discardAudio(store, id);
      send(response, 'error' in outcome ? 422 : 200, outcome);
      return;
    }

    if (request.method === 'POST' && /^\/recordings\/[^/]+\/audio\/restore$/.test(path)) {
      const id = decodeURIComponent(path.split('/')[2] ?? '');
      const outcome = restoreAudio(store, id);
      if ('error' in outcome) return send(response, 422, outcome);
      if (objectsRoot === null || outcome.audioHash === null || !existsSync(objectPath(objectsRoot, outcome.audioHash))) {
        // No promete recuperación cuando sólo sobrevivió la ficha catalográfica.
        discardAudio(store, id);
        return send(response, 410, { error: 'los bytes de este audio ya no están en el almacén' });
      }
      send(response, 200, outcome);
      return;
    }

    /*
     * Quitar la grabación entera, y no sólo su audio.
     *
     * Faltaba. `DELETE …/audio` suelta los bytes y deja la fila, y no había
     * ninguna ruta que borrara una grabación: una que perdiera su bloque quedaba
     * en la lista de voz sin lugar para siempre, porque nada podía sacarla de
     * ahí. Desde ahora el bloque se lleva la suya al morir, y esto queda para lo
     * que haya que barrer de antes.
     */
    if (request.method === 'DELETE' && /^\/recordings\/[^/]+$/.test(path)) {
      const id = decodeURIComponent(path.split('/')[2] ?? '');
      const outcome = removeRecording(store, id);
      send(response, 'error' in outcome ? 404 : 200, outcome);
      return;
    }

    // Dónde queda una grabación en la escritura. Se puede dar o quitar mientras
    // no se haya asentado; después el lugar es el de su contenido.
    if (request.method === 'POST' && /^\/recordings\/[^/]+\/place$/.test(path)) {
      const id = decodeURIComponent(path.split('/')[2] ?? '');
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        let body: { block?: unknown } = {};
        try {
          if (chunks.length > 0) body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          send(response, 400, { error: 'the body must be JSON' });
          return;
        }
        const block = typeof body.block === 'string' && body.block !== '' ? body.block : null;
        const outcome = placeRecording(store, id, block);
        send(response, 'error' in outcome ? 422 : 200, outcome);
      });
      return;
    }

    // La presentación recordada de quien pregunta.
    //
    // @guarantee RememberedSessionPresentation: va con el participante y no con
    // el navegador, para que ajustar el sistema de diseño en una máquina no haya
    // que repetirlo en la siguiente.
    // Procesar una página: leerla y decir qué se ve en ella.
    //
    // Deliberado y sobre una página concreta, nunca de oficio. Salen
    // proposiciones y ninguna decisión: no escribe contenido, no cambia una
    // propiedad y no asienta un tipo.
    if (request.method === 'POST' && /^\/pages\/[^/]+\/process$/.test(path)) {
      const id = decodeURIComponent(path.split('/')[2] ?? '');
      const page = graph.page(id) ?? graph.pageTitled(id);
      if (page === undefined) {
        send(response, 404, { error: 'no such page' });
        return;
      }
      if (isSpecialPage(page.id)) {
        send(response, 422, {
          error: 'una página especial gobierna Vera y no se procesa automáticamente',
        });
        return;
      }

      const text = graph
        .blocksOf(page.id)
        .map((block) => block.content)
        .join('\n');

      // La ontología estructurada manda. La lista antigua se conserva como
      // respaldo para corpus que todavía no migraron sus páginas especiales.
      // @invariant DefaultsLiveInTheCode.
      const objects = declaredObjects();
      const ontologyProperties = declaredProperties();
      const ontology = graph
        .pages()
        .find((candidate) =>
          graph
            .propertiesOf(candidate.id)
            .some((property) => property.key === 'special-kind' && property.value === 'ontology'),
        );
      const vocabulary = objects.length > 0
        ? objects.map((object) => object.name)
        : ontology === undefined
          ? STARTER_TYPES
          : (() => {
              // Los tipos son los hijos del bloque que los encabeza. Se leen del
              // texto porque la página es la fuente: si dice otra cosa mañana,
              // mañana rige otra cosa.
              const heading = graph
                .blocksOf(ontology.id)
                .find((block) => opens(block.content, /^Tipos iniciales/i));
              if (heading === undefined) return STARTER_TYPES;
              const listed = graph
                .blocksOf(ontology.id)
                .filter((block) => block.parent === heading.stableId)
                .flatMap((block) => block.content.split('·'))
                .map((word) => word.trim())
                .filter((word) => word !== '' && word.length < 40 && !word.includes(' a propósito'));
              return listed.length > 0 ? listed : STARTER_TYPES;
            })();

      /*
       * El vocabulario conceptual se recupera desde Vera, no desde el modelo.
       *
       * Se prepara un catálogo con identidad estable y evidencia barata: uso
       * como `concepto`, enlaces entrantes, vínculo desde esta página y una
       * glosa tomada de su primer bloque. Para cada pase se ordena de nuevo por
       * afinidad con ese texto; Qwen ve como máximo 24 candidatos, no dos mil.
       */
      const topicName = propertyNames().topic;
      const uses = new Map<string, number>();
      for (const observed of graph.observedValuesOf(topicName)) {
        const held = graph.pageTitled(observed.value);
        if (held !== undefined) uses.set(held.id, (uses.get(held.id) ?? 0) + observed.uses);
      }
      const linked = new Set(
        graph.links()
          .filter((link) => link.sourcePage === page.id && link.target !== null)
          .map((link) => link.target!),
      );
      const conceptPool: ConceptCandidate[] = graph.pages()
        // Una página relacionada no es por eso un concepto. Sólo entra en este
        // vocabulario si el corpus ya la usó como respuesta de `concepto`; los
        // enlaces sirven para ordenar dentro del vocabulario, no para convertir
        // personas, fechas y proyectos en temas por accidente.
        .filter((candidate) => candidate.id !== page.id && (uses.get(candidate.id) ?? 0) > 0)
        .map((candidate) => {
          const first = graph.blocksOf(candidate.id)
            .find((block) => block.content.trim() !== '')?.content
            .replace(/\s+/g, ' ')
            .slice(0, 140) ?? null;
          return {
            id: candidate.id,
            title: candidate.title,
            uses: uses.get(candidate.id) ?? 0,
            backlinks: graph.backlinks(candidate.id).length,
            linked: linked.has(candidate.id),
            excerpt: first,
          };
        });

      /*
       * Procesar se cuenta mientras pasa, no al terminar.
       *
       * Antes era una sola respuesta al final: leer una página con veinte
       * enlaces y un modelo local tarda, y en todo ese rato la interfaz decía
       * «leyendo…» sin más. Quien mira no puede distinguir eso de algo colgado,
       * y lo que hace entonces es volver a pulsar.
       *
       * Se transmite en NDJSON —una línea por hecho, según ocurre— porque lo que
       * hace falta no es una barra que avanza sino saber qué está haciendo: qué
       * dirección está consultando ahora, cuál no contestó, si el modelo local
       * está ahí. Esa es la verbosidad que sirve.
       */
      response.writeHead(200, {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-store',
      });
      const say = (event: Record<string, unknown>): void => {
        response.write(`${JSON.stringify(event)}\n`);
      };

      const blocks = graph.blocksOf(page.id);
      say({ step: 'reading', blocks: blocks.length, chars: text.length });

      // Dónde vive cada dirección, para poder proponer el arreglo sobre el
      // bloque que la lleva y no sobre la página entera.
      const holder = (url: string): { block: string; content: string } | null => {
        // Sobre un bloque que la puesta en forma acaba de rehacer no se propone
        // nada: el texto que esta sugerencia arreglaría ya no es el suyo.
        const found = blocks.find(
          (block) => !remade.has(block.stableId) && block.content.includes(url),
        );
        return found === undefined ? null : { block: found.stableId, content: found.content };
      };

      /*
       * La forma de la página se lee primero, y se dice antes que nada.
       *
       * Ver specs/page-processing.allium. Son dos preguntas distintas —qué forma
       * tiene esto, y de qué trata— y hasta ahora iban juntas: el modelo recibía
       * todos los bloques concatenados con saltos de línea, sin identidades, sin
       * padres y sin posiciones. Para quien lo recibía no había documento, había
       * una sábana de texto, y de ahí salía que ninguna propuesta sobre la
       * estructura pudiera apuntar a nada.
       *
       * Esta mitad se contesta contando: no tiene modelo, no tiene red, no tiene
       * azar y no se trunca. Por eso ocurre aquí, síncrona, antes de esperar a
       * nadie —@invariant StructureIsReportedBeforeTheModelAnswers— y por eso
       * sigue estando aunque no haya modelo local instalado
       * —@invariant ItWorksWithoutAModel—, que hasta hoy se perdía con él sin
       * ninguna razón.
       *
       * @invariant ReadingDecidesNothing: esto describe la página y no la cambia.
       * Lo que se hace con lo encontrado sigue siendo una pregunta abierta, y las
       * observaciones viajan como observaciones y no como sugerencias aplicables.
       */
      const structure = readStructure(blocks);
      say({
        step: 'structure',
        summary: describeStructure(structure),
        blocks: structure.units.length,
        sections: structure.sections.filter((section) => section.heading !== null).length,
        chars: structure.chars,
        observations: structure.observations,
      });

      /*
       * La puesta en forma, que ocurre sin preguntar.
       *
       * Es la Fase B de «VERA — Procesamiento automático de páginas»: partir
       * párrafos largos, marcar títulos implícitos, enderezar jerarquías
       * torcidas, separar unidades pegadas y borrar los huecos. Ninguna añade ni
       * quita sentido, y por eso pueden aplicarse solas.
       *
       * El plan se calcula aquí y lo aplica el cliente, operación por operación,
       * contra POST /operations. No porque sea más cómodo: es que la única
       * entrada de escritura de Vera es ésa, y un endpoint de lectura que además
       * escribiera en la base abriría una segunda puerta que después nadie
       * audita. Así cada paso lleva su autoría, su canal y su secuencia, como
       * cualquier edición hecha a mano.
       */
      const plan = planTabularity(page.id, blocks, structure);
      say({
        step: 'plan',
        did: describePlan(plan.steps),
        changes: plan.steps.map((step) => step.change),
      });

      /*
       * El sentido de la página se lee de la página, no de su principio.
       *
       * Hasta ahora se le daban al modelo los primeros tres mil caracteres y el
       * resultado se presentaba como la lectura de la página: para una nota es
       * la nota, para una transcripción de dos horas es el saludo del principio.
       * Ahora la página se reparte en pases del tamaño que el modelo aguanta
       * —cortados por las secciones que la lectura estructural ya encontró—, se
       * lee cada uno, y lo que dijeron se junta contando.
       *
       * @invariant TheBeginningIsNotThePage y @invariant WhatDidNotFitIsCounted,
       * de specs/page-processing.allium: si el tope de pases deja algo fuera, se
       * cuenta y aparece en `notDone`.
       */
      const contentOf = new Map(blocks.map((block) => [block.stableId, block.content]));
      const reparto = readingPasses(structure, contentOf, {
        chars: READABLE_CHARS,
        passes: MOST_PASSES,
      });

      const asked: Promise<{ reading: Reading; hierarchy: { changes: Change[]; explanation: string }; notDone: string[] }> = (async () => {
        const notDone: string[] = [];
        if (reparto.left > 0) {
          notDone.push(
            `el modelo leyó ${reparto.passes.length} partes de la página y ${reparto.left} caracteres quedaron sin leer`,
          );
        }

        // Sin modelo no se pregunta ocho veces para fallar ocho veces: se dice
        // una. @invariant TheModelIsLocalOrThereIsNone.
        const presence = await modelPresence();
        if (!presence.ready) {
          say({ step: 'model', state: 'failed', why: 'no hay un modelo local instalado' });
          return {
            reading: { types: [], existingConcepts: [], newConcepts: [] },
            hierarchy: { changes: [], explanation: '' },
            notDone: [...notDone, 'no hay un modelo local instalado'],
          };
        }

        const readings: Reading[] = [];
        for (const pass of reparto.passes) {
          say({
            step: 'model',
            state: 'asking',
            pass: pass.ordinal,
            of: reparto.passes.length,
            section: pass.title,
          });
          const candidates = relevantConcepts(`${page.title}\n${pass.title}\n${pass.text}`, conceptPool);
          const understood = await readPage(page.title, pass.text, vocabulary, {
            objects,
            properties: ontologyProperties,
            candidates,
          });
          if ('error' in understood) {
            // Un pase que falla no cancela los demás: la parte de la página que
            // sí se pudo leer sigue valiendo, y la que no se dice.
            say({ step: 'model', state: 'failed', why: understood.error, pass: pass.ordinal });
            notDone.push(`la parte ${pass.ordinal} de la página no se pudo leer: ${understood.error}`);
            continue;
          }
          readings.push(understood);
        }

        const reading = mergeReadings(readings);
        say({
          step: 'model',
          state: 'done',
          types: reading.types,
          existingConcepts: reading.existingConcepts,
          newConcepts: reading.newConcepts,
        });
        let hierarchy = { changes: [] as Change[], explanation: '' };
        if (structure.observations.some((one) => one.defect === 'flat_list')) {
          say({ step: 'model', state: 'structuring' });
          const proposed = await proposeHierarchy(page.title, blocks);
          if ('error' in proposed) {
            notDone.push(`la estructura latente no se pudo proponer: ${proposed.error}`);
            say({ step: 'model', state: 'structure_failed', why: proposed.error });
          } else {
            const remade = new Set(plan.touched);
            hierarchy = {
              ...proposed,
              changes: proposed.changes.filter(
                (change) =>
                  change.kind === 'move_block' &&
                  !remade.has(change.block) &&
                  (change.parent === null || !remade.has(change.parent)),
              ),
            };
            say({ step: 'model', state: 'structured', moves: hierarchy.changes.length });
          }
        }
        return { reading, hierarchy, notDone };
      })();

      const followed = readLinks(text, {}, (link, done, total) => {
        say({ step: 'link', done, total, url: link.url, title: link.title, kind: link.kind, unreachable: link.unreachable });
      });

      /*
       * Lo que esta página nombra y el corpus ya tiene.
       *
       * Una captura habla de una persona, de un taller o de un proyecto que en
       * Vera ya son páginas, y no las enlaza: queda escrita y no queda
       * encontrable. Desde el otro lado no se llega en absoluto, porque los
       * enlaces entrantes de esa página no la mencionan.
       *
       * Se busca contando y no con el modelo, así que ocurre aquí mismo, sin
       * esperar a nadie y esté o no instalado el binario. Lo que sale son
       * proposiciones: un nombre escrito en una frase no siempre es una
       * referencia a la página que se llama igual, y eso lo decide quien lee.
       */
      const known = graph.pages().map((one) => ({
        id: one.id,
        title: one.title,
        backlinks: graph.backlinks(one.id).length,
      }));
      /*
       * Lo que la forma tocó no se propone en la misma vuelta.
       *
       * Una sugerencia de enlace nombra un bloque y el texto que ese bloque
       * decía; si el plan acaba de partirlo o de marcarlo, ese texto ya no es el
       * suyo, y aplicar la sugerencia encima lo devolvería a como estaba. Se
       * calla y vuelve a proponerse la próxima vez, cuando la página se lea tal
       * como quedó.
       */
      const remade = new Set(plan.touched);
      const settled = blocks
        .filter((block) => !remade.has(block.stableId))
        .map((block) => ({ stableId: block.stableId, content: block.content }));

      /*
       * También se busca en la forma que el plan acaba de declarar.
       *
       * Antes, partir un bloque y proponer un enlace sobre él eran mutuamente
       * excluyentes: la mención se callaba para no volver a escribir el texto
       * monolítico encima de los bloques nuevos. Las unidades estructuradas ya
       * nacen con identidad estable, así que se puede proponer sobre su destino
       * verdadero en esta misma vuelta. El último `edit_block` gana y lo que el
       * plan elimina no vuelve a entrar.
       */
      const projected = new Map<string, string>();
      const removed = new Set<string>();
      for (const step of plan.steps) {
        const change = step.change;
        if (change.kind === 'edit_block') projected.set(change.block, change.content);
        if (change.kind === 'remove_block') removed.add(change.block);
        if (change.kind === 'create_block' && change.stableId !== undefined) {
          projected.set(change.stableId, change.content);
        }
      }
      const afterPlan = [...projected]
        .filter(([stableId]) => !removed.has(stableId))
        .map(([stableId, content]) => ({ stableId, content }));
      const mentions = mentionsOf([...settled, ...afterPlan], known, { self: page.id });

      say({
        step: 'mentions',
        found: mentions.length,
        titles: mentions.map((mention) => mention.title),
      });

      void Promise.all([followed, asked]).then(([linked, understood]) => {
        // @invariant TheModelIsLocalOrThereIsNone y @guarantee
        // ProcessingSaysWhatItDidAndWhatItCouldNot: lo que no se pudo hacer se
        // dice, porque un resultado parcial callado se lee como uno completo.
        const notDone = [...linked.notDone, ...understood.notDone];

        say({
          step: 'done',
          page: page.id,
          /*
           * Cómo llama este corpus a lo que se va a proponer.
           *
           * Viaja con el resultado en vez de que el cliente se sepa las palabras:
           * quien escribe en otra lengua no tiene por qué recibir sugerencias que
           * escriban `type` en sus páginas.
           */
          names: propertyNames(),
          // La estructura viaja también en el final, para que quien reciba el
          // resultado entero no tenga que haber ido guardando los pasos.
          structure: {
            blocks: structure.units.length,
            sections: structure.sections.length,
            chars: structure.chars,
            observations: structure.observations,
          },
          links: linked.links.map((link) => ({ ...link, ...(holder(link.url) ?? { block: null, content: null }) })),
          types: understood.reading.types,
          /*
           * Cada concepto dice si el corpus ya lo tiene.
           *
           * Un concepto que ya es una página del grafo une esta página a lo que
           * hay; uno que no, abre un nombre nuevo. Son dos cosas distintas y
           * quien revisa tiene que poder distinguirlas de un vistazo: aceptar
           * «diseño» cuando existe «Diseño» y no unirlos parte en dos un
           * vecindario que era uno.
           *
           * Se dice y no se decide: el valor que se propone es el título tal
           * como la página existente se llama, para que aceptar una y aceptar la
           * otra lleven al mismo sitio.
           */
          concepts: [
            ...understood.reading.existingConcepts.map((id) => ({ id, value: null as string | null })),
            ...understood.reading.newConcepts.map((value) => ({ id: null, value })),
          ]
            .map(({ id, value }) => {
              // Una identidad elegida entre candidatos se resuelve por ID. Un
              // nombre nuevo aún puede coincidir exactamente con una página
              // creada entre la recuperación y este cierre; entonces se une.
              const held = id === null ? graph.pageTitled(value ?? '') : graph.page(id);
              return {
                value: held?.title ?? value ?? '',
                page: held?.id ?? null,
                backlinks: held === undefined ? 0 : graph.backlinks(held.id).length,
              };
            })
            // Una página no trata de sí misma. El modelo lo propone a menudo
            // —lee «Amy Pavel» en el título y en cada línea— y aceptarlo sólo
            // añade un valor que no separa esta página de ninguna otra.
            .filter((concept) => concept.page !== page.id),
          mentions: mentions.map((mention) => ({
            title: mention.title,
            page: mention.page,
            block: mention.block,
            content: mention.content,
            next: mention.next,
            written: mention.written,
            backlinks: mention.backlinks,
          })),
          hierarchy: understood.hierarchy,
          notDone,
        });
        response.end();
      });
      return;
    }

    // Las páginas que gobiernan a Vera.
    //
    // @invariant SpecialityIsDeclaredNotGuessed: una página es especial porque
    // lo dice en una propiedad que cualquiera puede leer y cambiar. Vera no
    // guarda una lista privada de títulos que trata distinto, porque una regla
    // que no se puede leer del corpus es una regla contra la que el corpus no se
    // puede auditar.
      /*
       * Las conexiones con servicios de fuera, con lo que se puede saber de
       * ellas sin abrir ninguna.
       *
       * El estado es derivado y no está escrito en ninguna parte: si hay clave
       * lo dice la tabla de secretos, cuándo se usó por última vez también, y
       * cuántas páginas vinieron de ahí se cuenta mirando el corpus. Escribirlo
       * en la página sería tener dos sitios diciendo lo mismo.
       */
      /*
       * De qué está hecho este corpus: sus propiedades y sus objetos.
       *
       * Sale de las dos páginas que lo declaran, leídas cada vez y no cacheadas:
       * se editan como cualquier otra página y cambiarlas no debería pedir
       * reiniciar. Ver specs/controlled-ontology.allium.
       */
      if (path === '/ontology') {
        /*
         * Cuántas veces usa el corpus cada clave, declarada o no.
         *
         * Se cuenta una vez y sirve para las dos listas. Que una propiedad esté
         * declarada no dice que se use —de las treinta y tres de este corpus,
         * diecisiete no aparecen ni una vez— y no decirlo dejaba a quien pone
         * una propiedad eligiendo entre nombres que pesan igual en la pantalla y
         * no pesan igual en la memoria.
         *
         * Sin mirar las páginas que gobiernan: `campo::`, `papel::`,
         * `propiedades::` son la gramática con que se declara, no propiedades
         * del corpus, y contarlas sería pedirle a la ontología que se declare a
         * sí misma para siempre.
         *
         * Se reconocen por llevar `special-kind` y no por una lista de clases
         * escrita aquí. @invariant SpecialityIsDeclaredNotGuessed: la lista
         * enumeraba cinco clases y `governing` devuelve la primera de cada una,
         * así que la página de un servicio —y la segunda de cualquier clase que
         * llegue a tener dos— quedaba fuera, y su `special-kind::` y su
         * `servicio::` se contaban como propiedades del corpus.
         */
        const usesByKey = (): Map<string, number> => {
          const counted = new Map<string, number>();
          const governed = new Set(
            graph
              .pages()
              .filter((page) =>
                graph.propertiesOf(page.id).some((property) => property.key === SPECIAL_KIND),
              )
              .map((page) => page.id),
          );
          const subjects = [
            ...graph.pages().map((one) => one.id),
            ...graph
              .allBlocks()
              .filter((one) => !governed.has(one.page))
              .map((one) => one.stableId),
          ].filter((one) => !governed.has(one));
          /*
           * Tal como está escrita, sin bajarla a minúsculas.
           *
           * `Estado` y `estado` conviven en este corpus, y unirlas aquí
           * escondería justamente lo que hay que ver: dos formas de la misma
           * palabra es una decisión que alguien puede tomar, y no la puede tomar
           * quien no las ve separadas.
           */
          for (const subject of subjects) {
            for (const property of graph.propertiesOf(subject)) {
              const key = property.key.trim();
              if (key === '') continue;
              counted.set(key, (counted.get(key) ?? 0) + 1);
            }
          }
          return counted;
        };

        const counted = usesByKey();
        const declaredNow = declaredProperties();
        const known = new Set(declaredNow.map((one) => one.name.toLowerCase()));

        // Lo declarado sí suma sus variantes: una propiedad declarada es una
        // sola, y cuántas veces se usó es cuántas veces se usó, se escribiera
        // con mayúscula o sin ella.
        const usesOf = (name: string): number => {
          const wanted = name.trim().toLowerCase();
          let total = 0;
          for (const [key, uses] of counted) if (key.toLowerCase() === wanted) total += uses;
          return total;
        };

        send(response, 200, {
          properties: declaredNow.map((one) => ({ ...one, uses: usesOf(one.name) })),
          objects: declaredObjects(),
          names: propertyNames(),
          fields: FIELD_KINDS,
          /*
           * Y las que el corpus usa sin haberlas declarado.
           *
           * No es un reproche: casi todo lo que hay en un corpus vivo llegó sin
           * pedir permiso, y declarar es una decisión que se toma después. Está
           * aquí para que esa decisión se pueda tomar mirando, en vez de tener
           * que acordarse de qué se escribió alguna vez.
           *
           * Van todas y no las sesenta primeras. Se recortaban, y el recorte se
           * notaba justo donde más duele: al poner una propiedad, donde lo que
           * uno busca suele ser precisamente una de las que escribió pocas veces
           * y no recuerda cómo deletreó. El tope que queda es un seguro contra
           * un corpus enfermo, no un criterio.
           */
          undeclared: [...counted]
            .filter(([key]) => !known.has(key.toLowerCase()))
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
            .slice(0, 500)
            .map(([key, uses]) => ({ key, uses })),
        });
        return;
      }

      /*
       * La historia de un bloque: todo lo que dijo, y cuándo.
       *
       * Sale del registro, doblando su propia historia desde que nació. No hay
       * nada que guardar para esto —ya estaba guardado— y aun así no había forma
       * de mirarlo sin abrir la base de datos. Un corpus que promete que nada se
       * pierde tiene que poder enseñarlo, o la promesa hay que creérsela.
       */
      if (path.startsWith('/blocks/') && path.endsWith('/history')) {
        const id = decodeURIComponent(path.slice('/blocks/'.length, -'/history'.length));
        const log = graph.operations();
        const said: {
          sequence: number;
          at: number;
          by: string;
          participant: string;
          channel: string;
          what: string;
          content: string | null;
        }[] = [];
        for (const one of log) {
          const change = one.submission.change;
          const mine =
            (change.kind === 'create_block' && one.subjectId === id) ||
            ((change.kind === 'edit_block' ||
              change.kind === 'move_block' ||
              change.kind === 'remove_block') &&
              change.block === id);
          if (!mine) continue;
          said.push({
            sequence: one.sequence,
            at: one.appliedAt,
            by: graph.participant(one.submission.submittedBy)?.name ?? one.submission.submittedBy,
            participant: one.submission.submittedBy,
            channel: one.submission.channel,
            what:
              change.kind === 'create_block'
                ? 'nació'
                : change.kind === 'edit_block'
                  ? 'se escribió'
                  : change.kind === 'move_block'
                    ? 'se mudó'
                    : 'se borró',
            content:
              change.kind === 'create_block' || change.kind === 'edit_block'
                ? change.content
                : null,
          });
        }
        // La historia de un bloque es todo lo que ese bloque dijo alguna vez,
        // incluido lo que se borró: se lleva más que leerlo.
        deliver(
          {
            block: id,
            alive: graph.block(id) !== undefined,
            now: graph.block(id)?.content ?? null,
            states: said,
          },
          { surface: 'GET /blocks/:id/history', subject: id, delivered: [id] },
        );
        return;
      }

      /*
       * La puerta MCP y quién entra por ella.
       *
       * Lo declarado y lo observado en la misma respuesta, para que la página
       * los pueda poner en la misma fila. Ver mcp-page.ts.
       */
      if (path === '/mcp') {
        const seen = clientsSeen(store);
        const door = mcpPage(graph, SPECIAL_KIND, seen);
        /*
         * Y con qué datos se enchufa una IA a esta instancia.
         *
         * Van con la página y no en una petición aparte porque son la mitad de
         * la respuesta a la única pregunta que se hace ahí: qué entra por esta
         * puerta y cómo se la abre. Se calculan de este despliegue —ver
         * mcp-connect.ts—, así que no se desactualizan.
         */
        const connect = mcpConnect({
          here: import.meta.dirname,
          port: options.port ?? 4173,
          execPath: process.execPath,
          nodeVersion: process.version,
          user: userInfo().username,
          host: hostname(),
          reachableAt: options.reachableAt ?? null,
          publicMcp: options.publicMcpOrigin === undefined
            ? null
            : new URL('/mcp', publicSite()?.canonicalDomain ?? options.publicSite?.canonicalDomain).toString(),
          remoteCredential: options.remoteMcpCredential ?? null,
        });
        /*
         * Y lo que las máquinas pidieron que se fuera.
         *
         * Se dibuja aquí porque aquí está quien lo pidió: la página de la puerta
         * es donde se ve qué entra, qué se le permite y qué hizo. La lista es del
         * corpus y no de la puerta —una persona también puede marcar—, y si algún
         * día se mira desde otro sitio, se mueve.
         */
        const names = propertyNames();
        const marked = discardRequests(store, {
          key: names.discard_request,
          pages: graph.pages().map((one) => ({ id: one.id, title: one.title })),
          propertiesOf: (page) => graph.propertiesOf(page),
          nameOf: (participant) => graph.participant(participant)?.name ?? null,
        });

        send(response, 200, {
          ...(door ?? { id: null, connections: [], undeclared: seen }),
          connect,
          marked,
          markKey: names.discard_request,
        });
        return;
      }

      if (path === '/services') {
        const brought = broughtFrom('zotero');
        send(
          response,
          200,
          servicePages(graph, SPECIAL_KIND).map((service) => ({
            ...service,
            secrets: secretsOf(store, service.id),
            pages: service.service === 'zotero' ? brought.size : 0,
          })),
        );
        return;
      }

    if (request.method === 'GET' && path === '/special-pages') {
      const found = graph
        .pages()
        .map((page) => ({
          page,
          kind: graph
            .propertiesOf(page.id)
            .find((property) => property.key === SPECIAL_KIND)?.value,
        }))
        .filter((entry) => entry.kind !== undefined)
        .map((entry) => ({
          id: entry.page.id,
          title: entry.page.title,
          kind: String(entry.kind).trim().toLowerCase(),
        }));
      send(response, 200, found);
      return;
    }

    if (request.method === 'GET' && path === '/workspace') {
      send(response, 200, workspaceOf(store, owner.id));
      return;
    }

    if (request.method === 'PUT' && path === '/workspace') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          // Se acepta lo que se reconoce y se ignora lo demás: un cliente más
          // nuevo que mande un campo que este servidor no conoce no debe fallar.
          const patch: Parameters<typeof saveWorkspace>[2] = {};
          if (body['layout'] === 'text_only' || body['layout'] === 'graph_only' || body['layout'] === 'split') {
            patch.layout = body['layout'];
          }
          if (typeof body['dividerPosition'] === 'number' && Number.isFinite(body['dividerPosition'])) {
            patch.dividerPosition = Math.min(0.95, Math.max(0.05, body['dividerPosition']));
          }
          if (body['graphView'] === 'graph_2d' || body['graphView'] === 'graph_3d' || body['graphView'] === 'graph_d4') {
            patch.graphView = body['graphView'];
          }
          if (body['colourScheme'] === 'light' || body['colourScheme'] === 'dark') {
            patch.colourScheme = body['colourScheme'];
          }
          if (typeof body['designTokens'] === 'string' || body['designTokens'] === null) {
            patch.designTokens = body['designTokens'];
          }
          if (typeof body['graphReach'] === 'number' && Number.isFinite(body['graphReach'])) {
            patch.graphReach = Math.min(4, Math.max(1, Math.round(body['graphReach'])));
          }
          send(response, 200, saveWorkspace(store, owner.id, patch));
        } catch {
          send(response, 400, { error: 'the body must be JSON' });
        }
      });
      return;
    }

    if (request.method === 'GET' && path === '/recordings') {
      // Con `page`, lo que tiene lugar en ella: es lo que deja ver el audio
      // donde se habló en vez de en un limbo aparte.
      const page = url.searchParams.get('page');
      send(response, 200, page === null ? recordings(store) : recordingsInPage(store, page));
      return;
    }

    if (request.method === 'GET' && /^\/recordings\/[^/]+$/.test(path)) {
      const held = recordingById(store, decodeURIComponent(path.split('/')[2] ?? ''));
      if (held === null) {
        send(response, 404, { error: 'no such recording' });
        return;
      }
      send(response, 200, held);
      return;
    }

    // Plegar no es un cambio del grafo, así que no pasa por /operations: no
    // genera operación ni revisión, y por eso tiene su propia ruta.
    /*
     * Un bloque que se procesa a sí mismo: lo escrito es el pedido.
     *
     * El bloque pasa a ser la respuesta y los ítems cuelgan de él. El pedido no
     * se pierde —queda en las revisiones del bloque, como cualquier edición— y
     * deja de estar a la vista, que es lo que se quiere: después uno vuelve a
     * leer la lista, no lo que pidió.
     *
     * Firma el modelo local y no el bibliotecario, y no es una formalidad: el bibliotecario tiene
     * criterio sobre el corpus y lo que dice se lee como suyo; esto es una
     * máquina contestando una pregunta, y mañana será otra máquina. Ver
     * answer.ts. La autoría del bloque cambia de mano al procesarlo, que es
     * exactamente lo que pasó.
     *
     * Se aplica y ya, sin panel de sugerencias: lo que quedó mal se corrige
     * escribiendo, como todo lo demás en Vera.
     */
    if (request.method === 'POST' && path.startsWith('/blocks/') && path.endsWith('/process')) {
      const id = decodeURIComponent(path.slice('/blocks/'.length, -'/process'.length));
      const block = graph.block(id);
      if (block === undefined) {
        send(response, 404, { error: 'no such block' });
        return;
      }
      const said = block.content.trim();
      if (said === '') {
        send(response, 422, { error: 'un bloque vacío no pide nada' });
        return;
      }

      const context = graph.childrenOf(block.stableId).map((child) => child.content);
      void ask(promptFor(said, context), { maxTokens: 700, timeoutMs: 300_000 }).then((answered) => {
        if ('error' in answered) {
          send(response, 503, answered);
          return;
        }
        const read = readAnswer(answered.text);
        if (read === null) {
          send(response, 502, { error: 'el modelo no contestó nada que se pueda escribir' });
          return;
        }

        /*
         * El modelo entra al grafo la primera vez que contesta.
         *
         * No se crea al arrancar: un grafo donde nunca se procesó un bloque no
         * tiene por qué llevar dentro un participante que no escribió nada.
         */
        if (graph.participant(LOCAL_MODEL) === undefined) {
          saveParticipant(store, { id: LOCAL_MODEL, name: LOCAL_MODEL_NAME, kind: 'agent' });
          graph.addParticipant({ id: LOCAL_MODEL, name: LOCAL_MODEL_NAME, kind: 'agent' });
          graph.admit(LOCAL_MODEL);
        }

        const stamp = Date.now();
        let step = 0;
        const write = (change: Change): string | null => {
          const outcome = graph.submitOperation({
            originId: `local-model:${block.stableId}:${stamp}:${(step += 1)}`,
            participant: LOCAL_MODEL,
            // @invariant TheChannelIsObservedAndNeverDeclared: un agente escribe
            // por este canal y no por otro, y por eso lo escrito se dibuja como
            // lo que es sin que nadie tenga que acordarse de marcarlo.
            channel: 'agent_generation',
            change,
          });
          if (outcome.status !== 'applied') return null;
          if (persist(outcome.operation) !== null) return null;
          return outcome.operation.subjectId;
        };

        try {
          if (write({ kind: 'edit_block', block: block.stableId, content: read.title }) === null) {
            send(response, 422, { error: 'no se pudo escribir la respuesta en el bloque' });
            return;
          }

          /*
           * Los ítems, en orden y colgando de quien les toque.
           *
           * La pila guarda al último bloque escrito de cada nivel: un ítem de
           * nivel dos cuelga del último de nivel uno, que es lo que significa
           * estar sangrado debajo de él. Lo que ya colgaba del bloque se queda
           * donde estaba y lo nuevo nace detrás.
           */
          const stack: string[] = [block.stableId];
          for (const item of read.items) {
            const depth = Math.min(item.depth, stack.length - 1);
            stack.length = depth + 1;
            const parent = stack[depth] ?? block.stableId;
            const made = write({
              kind: 'create_block',
              page: block.page,
              parent,
              // Al final de lo que ya cuelgue de ese padre: lo que hubiera
              // debajo del bloque estaba antes y sigue estando.
              position: graph.childrenOf(parent).length,
              content: item.text,
            });
            if (made === null) break;
            stack.push(made);
          }

          send(response, 200, {
            block: block.stableId,
            title: read.title,
            items: read.items.length,
            participant: LOCAL_MODEL,
          });
        } catch (error) {
          send(response, 500, {
            error: 'no se pudo escribir lo que el modelo contestó',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      });
      return;
    }

    /*
     * Los servicios de fuera, gobernados desde el corpus.
     *
     * Una conexión vive en una página especial que se lee y se edita como
     * cualquier otra —qué servicio, qué biblioteca, qué se trae— y lo único que
     * no está ahí es el secreto, que vive fuera del log porque un log
     * append-only no sabe olvidar. Ver services.ts, secrets.ts y
     * specs/service-connections.allium.
     */
    if (path.startsWith('/services/')) {
      const rest = path.slice('/services/'.length);
      const slash = rest.lastIndexOf('/');
      const named = decodeURIComponent(slash === -1 ? rest : rest.slice(0, slash));
      const what = slash === -1 ? '' : rest.slice(slash + 1);
      const page = graph.page(named) ?? graph.pageTitled(named);
      if (page === undefined) {
        send(response, 404, { error: 'no such page' });
        return;
      }
      const service = servicePages(graph, SPECIAL_KIND).find((one) => one.id === page.id);
      if (service === undefined) {
        send(response, 422, {
          error: `«${page.title}» no declara ser un servicio: le falta special-kind:: service y servicio::`,
        });
        return;
      }

      /*
       * Mirar la clave.
       *
       * Sólo el dueño y nunca con credencial: un agente que puede leer el corpus
       * no puede por eso leer las llaves de las casas de al lado. Y queda
       * anotado en el registro de exposición, porque mirar una clave es
       * exactamente la clase de cosa que uno quiere poder ver que ocurrió.
       *
       * No se manda con la página: viaja sólo cuando se pide, y se pide al
       * pulsar el ojo. Así no está en la respuesta que el navegador cachea ni en
       * la que se copia al depurar.
       */
      if (request.method === 'GET' && what === 'secret') {
        const blocked = ownerOnly();
        if (blocked !== null) {
          send(response, 403, blocked);
          return;
        }
        const name = url.searchParams.get('name') ?? 'clave';
        const clear = revealSecret(store, page.id, name);
        if (clear === null) {
          send(response, 404, { error: 'ahí no había ninguna clave guardada' });
          return;
        }
        note(`GET /services/:id/secret (${name})`, page.id, clear.length, [page.id], 'revealed');
        send(response, 200, { page: page.id, name, secret: clear });
        return;
      }

      /*
       * Guardar el secreto, y olvidarlo.
       *
       * Entra por aquí y no por `POST /operations` a propósito: no es una
       * operación, no genera revisión y no se puede replicar. Olvidarlo lo borra
       * de verdad, que es lo único que «olvidar» significa tratándose de una
       * clave.
       */
      if (request.method === 'PUT' && what === 'secret') {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          let body: { name?: unknown; secret?: unknown };
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
          } catch {
            send(response, 400, { error: 'the body must be JSON' });
            return;
          }
          const secret = typeof body.secret === 'string' ? body.secret.trim() : '';
          const name = typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : 'clave';
          if (secret === '') {
            send(response, 400, { error: 'una clave vacía no es una clave' });
            return;
          }
          saveSecret(store, page.id, name, secret, Date.now());
          send(response, 200, { page: page.id, secrets: secretsOf(store, page.id) });
        });
        return;
      }

      if (request.method === 'DELETE' && what === 'secret') {
        const name = url.searchParams.get('name') ?? 'clave';
        const gone = forgetSecret(store, page.id, name);
        send(response, gone ? 200 : 404, gone ? { page: page.id, secrets: secretsOf(store, page.id) } : { error: 'ahí no había ninguna clave guardada' });
        return;
      }

      // De aquí en adelante hace falta la clave. Sin ella no se pregunta nada:
      // una petición sin credencial a un servicio de fuera es una petición que
      // igualmente le dice que aquí hay alguien.
      const key = useSecret(store, page.id, 'clave', Date.now());
      if (key === null) {
        send(response, 428, { error: `«${page.title}» todavía no tiene una clave guardada` });
        return;
      }
      if (service.service !== 'zotero') {
        send(response, 501, { error: `Vera todavía no sabe hablar con ${service.service}` });
        return;
      }

      /** Con qué biblioteca hablar: la declarada, o la de quien es dueño de la clave. */
      const libraryOf = async (): Promise<string | { error: string }> => {
        if (service.library !== null) return service.library;
        const who = await whoami(key);
        if ('error' in who) return who;
        return `users/${who.userId}`;
      };

      /*
       * Probar la conexión: quién soy y qué puedo.
       *
       * Es esta petición y no una búsqueda vacía: una búsqueda que no devuelve
       * nada no distingue entre una clave mala y una biblioteca vacía.
       */
      if (request.method === 'POST' && what === 'check') {
        void whoami(key).then((who) => {
          if ('error' in who) {
            send(response, 502, who);
            return;
          }
          send(response, 200, {
            page: page.id,
            service: service.service,
            identity: who,
            library: service.library ?? `users/${who.userId}`,
            declared: service.library !== null,
          });
        });
        return;
      }

      /** Buscar en la biblioteca: autor, título, año. */
      if (request.method === 'GET' && what === 'search') {
        const text = (url.searchParams.get('q') ?? '').trim();
        if (text === '') {
          send(response, 400, { error: 'no se busca nada sin decir qué' });
          return;
        }
        void libraryOf().then(async (library) => {
          if (typeof library !== 'string') {
            send(response, 502, library);
            return;
          }
          const found = await search(key, library, text);
          if ('error' in found) {
            send(response, 502, found);
            return;
          }
          /*
           * Cada resultado dice si ya está en el corpus.
           *
           * Sin esto, citar dos veces el mismo libro crea dos páginas, y quien
           * busca no tiene forma de saberlo hasta que ya pasó.
           */
          const here = broughtFrom('zotero');
          send(response, 200, {
            page: page.id,
            library,
            total: found.total,
            items: found.items.map((one) => ({ ...one, alreadyHere: here.get(one.key) ?? null })),
          });
        });
        return;
      }

      /*
       * Traer un ítem: se vuelve una página del corpus, con su procedencia.
       *
       * Si ya estaba, no nace otra: se refresca la que hay cuando Zotero tiene
       * una versión más nueva, y si no, se devuelve tal cual. @invariant
       * ZoteroRecordIdentityIsUniqueWithinLibrary.
       */
      if (request.method === 'POST' && what === 'bring') {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          let body: { item?: unknown };
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
          } catch {
            send(response, 400, { error: 'the body must be JSON' });
            return;
          }
          const itemKey = typeof body.item === 'string' ? body.item.trim() : '';
          if (itemKey === '') {
            send(response, 400, { error: 'no se dijo qué ítem traer' });
            return;
          }
          void libraryOf().then(async (library) => {
            if (typeof library !== 'string') {
              send(response, 502, library);
              return;
            }
            const found = await item(key, library, itemKey);
            if ('error' in found) {
              send(response, 502, found);
              return;
            }
            const notes = await children(key, library, itemKey);
            try {
              const made = bringItem(found, library, 'notes' in notes ? notes.notes : []);
              send(response, 200, made);
            } catch (error) {
              send(response, 500, {
                error: 'no se pudo escribir la página del ítem',
                detail: error instanceof Error ? error.message : String(error),
              });
            }
          });
        });
        return;
      }

      send(response, 404, { error: 'no such service route' });
      return;
    }

    /*
     * Deshacer lo último.
     *
     * No hay pila de deshacer y no hace falta: el registro ya tiene todos los
     * estados anteriores de todo, y deshacer es calcular la operación contraria
     * leyéndolo hacia atrás. Lo que se aplica son operaciones nuevas —queda
     * dicho quién deshizo y cuándo— y por eso deshacer se puede deshacer sin una
     * línea de código más. Ver core/undo.ts y specs/undo.allium.
     *
     * `GET` dice qué se desharía, sin tocar nada, para poder enseñarlo antes de
     * hacerlo. `POST` lo hace.
     */
    if ((request.method === 'GET' || request.method === 'POST') && path === '/undo') {
      const log = graph.operations();
      const world = {
        childrenOf: (block: string) => graph.childrenOf(block).map((one) => one.stableId),
        exists: (block: string) => graph.block(block) !== undefined,
      };

      /*
       * Sólo se deshace lo propio.
       *
       * Deshacer lo que escribió otra mano —un agente, el modelo local— no es
       * deshacer: es corregir a alguien, y eso se hace escribiendo y firmando el
       * cambio con el propio nombre. @invariant TheOnlyHandYouCanUndoIsYourOwn.
       */
      /*
       * Y rehacer es deshacer un deshacer: la misma máquina, otro objetivo.
       *
       * Se distinguen porque si no, pulsar deshacer dos veces rebotaría entre
       * dos estados en vez de caminar hacia atrás.
       */
      const redoing = url.searchParams.get('rehacer') !== null;
      /*
       * Y sobre una página, no sobre el corpus entero.
       *
       * Deshacer es «vuelve esto al momento anterior», y «esto» es la página que
       * se está mirando. Sin acotarlo, dos cosas que ocurren a la vez en sitios
       * distintos —otra ventana, un guion escribiendo mientras alguien teclea—
       * se leen como un solo gesto y deshacer se lleva por delante trabajo ajeno
       * al que se quería deshacer.
       */
      const said = url.searchParams.get('pagina');
      const here = said === null ? undefined : (graph.page(said) ?? graph.pageTitled(said))?.id;
      if (said !== null && here === undefined) {
        send(response, 404, { error: 'no such page' });
        return;
      }
      const scope: { by: string; page?: string } = { by: owner.id };
      if (here !== undefined) scope.page = here;
      const gesture = redoing ? nextToRedo(log, scope) : nextToUndo(log, scope);
      if (gesture.length === 0) {
        send(response, 200, {
          nothing: redoing ? 'no hay nada que rehacer' : 'no hay nada tuyo que deshacer',
        });
        return;
      }

      const undoing = invert(log, gesture, world);
      if ('refusal' in undoing) {
        send(response, 200, { nothing: undoing.refusal, operations: gesture.length });
        return;
      }

      if (request.method === 'GET') {
        send(response, 200, {
          says: undoing.says,
          operations: gesture.length,
          when: gesture.at(-1)?.appliedAt ?? null,
        });
        return;
      }

      const stamp = Date.now();
      let step = 0;
      const done: string[] = [];
      const applied: Operation[] = [];

      const write = (change: Change, why: string): string | null => {
        const outcome = graph.submitOperation({
          originId: `${why}:${gesture.at(-1)?.sequence ?? 0}:${stamp}:${(step += 1)}`,
          participant: owner.id,
          channel: 'typed_text',
          change,
        });
        if (outcome.status !== 'applied') {
          return outcome.status === 'rejected' ? outcome.reason : 'repetido';
        }
        const failure = persist(outcome.operation);
        if (failure !== null) return failure;
        applied.push(outcome.operation);
        return null;
      };

      /*
       * Si un paso falla, se devuelve lo que ya se había aplicado.
       *
       * Media reversión deja un estado que nadie eligió y del que nadie se
       * acuerda —es peor que no haber deshecho nada—, y por eso el plan se
       * calcula entero antes de tocar nada. Aun así, aplicar puede fallar por
       * algo que el plan no vio: entonces se deshace el deshacer, con la misma
       * máquina, y se dice que no se pudo.
       */
      const putBack = (): void => {
        const back = invert(graph.operations(), applied, world);
        if ('refusal' in back) return;
        for (const change of back.changes) {
          const outcome = graph.submitOperation({
            originId: `undo-back:${stamp}:${(step += 1)}`,
            participant: owner.id,
            channel: 'typed_text',
            change,
          });
          if (outcome.status !== 'applied') return;
          if (persist(outcome.operation) !== null) return;
        }
      };

      try {
        for (const change of undoing.changes) {
          const failed = write(change, 'undo');
          if (failed !== null) {
            putBack();
            send(response, 422, {
              error: `no se pudo deshacer: ${failed}. Nada cambió.`,
            });
            return;
          }
          done.push(undoing.says[done.length] ?? '');
        }
      } catch (error) {
        putBack();
        send(response, 500, {
          error: 'no se pudo deshacer. Nada cambió.',
          detail: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      send(response, 200, { done, operations: gesture.length, undone: undoing.undoing });
      return;
    }

    if (request.method === 'POST' && path === '/folds') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        let body: { participant?: unknown; block?: unknown; folded?: unknown };
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
        } catch {
          send(response, 400, { error: 'the body must be JSON' });
          return;
        }

        const block = typeof body.block === 'string' ? body.block : '';
        if (graph.block(block) === undefined) {
          send(response, 404, { error: 'no such block' });
          return;
        }
        // @invariant OnlyParentsFold: un bloque sin hijos no tiene qué plegar.
        if (graph.childrenOf(block).length === 0) {
          send(response, 422, { error: 'a block with no children has nothing to fold' });
          return;
        }

        const who = typeof body.participant === 'string' ? body.participant : owner.id;
        setFold(store, who, block, body.folded === true);
        send(response, 200, { block, folded: body.folded === true });
      });
      return;
    }

    /*
     * Preguntarle al grafo.
     *
     * POST y no GET aunque sea una lectura: la pregunta va en el cuerpo porque en
     * una dirección se guarda —en el historial, en un registro del servidor, en lo
     * que se comparte al copiar el enlace— y una consulta puede nombrar a una
     * persona, una dirección o un asunto que no tiene por qué quedar escrito
     * fuera del corpus.
     *
     * Una pregunta que no se entiende contesta 200 y dice qué no entendió: la
     * petición estaba bien hecha, y devolver cero resultados sería una respuesta
     * —@invariant WhatCannotBeReadSaysSo—.
     */
    if (request.method === 'POST' && path === '/query') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        let body: { source?: unknown; participant?: unknown; sort?: unknown };
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
        } catch {
          send(response, 400, { error: 'the body must be JSON' });
          return;
        }

        const source = typeof body.source === 'string' ? body.source : '';
        const read = readQuery(source);
        if ('error' in read) {
          send(response, 200, { error: read.error, at: read.at, near: read.near });
          return;
        }

        let outcome;
        try {
          const requestedParticipant = typeof body.participant === 'string' && body.participant !== ''
            ? body.participant
            : who.participant;
          outcome = graph.query({
            expression: read.expression,
            // `anybody` no es miembro del grafo privado. La autoridad técnica
            // evalúa, pero `within` fija antes el universo público inducido.
            participant: publicAccess ? owner.id : requestedParticipant,
            ...(publicAccess ? { within: graph.pages().filter((page) => isPublicPage(page.id)).map((page) => page.id) } : {}),
          });
        } catch (problem) {
          send(response, 403, { error: problem instanceof Error ? problem.message : 'refused' });
          return;
        }

        // Dónde lo dice, para las preguntas por texto: una sola muestra por
        // página, que es la que hace falta para saber si el acierto es el bueno.
        const says = new Map<string, { block: string; excerpt: string }>();
        for (const id of outcome.matchingBlocks) {
          const block = graph.block(id);
          if (block === undefined || says.has(block.page)) continue;
          says.set(block.page, { block: id, excerpt: excerpt(block.content) });
        }

        const names = propertyNames();
        const valueOf = (page: string, key: string): string | null =>
          graph.propertiesOf(page).find((property) => property.key === key)?.value ?? null;

        const found = outcome.matchingPages
          .map((id) => graph.page(id))
          .filter((page): page is NonNullable<typeof page> => page !== undefined)
          .map((page) => ({
            id: page.id,
            title: page.title,
            type: valueOf(page.id, names.kind),
            /*
             * Los conceptos, ya partidos.
             *
             * Una página es varias cosas a la vez y el corpus lo escribe con
             * comas; partirlo aquí y no en la pantalla es lo que permite que cada
             * palabra sea un enlace en vez de una cadena que no lleva a ninguna
             * parte. La regla de partir vive en el dominio: si el cliente
             * partiera por su cuenta, las palabras que ofrece y las que dibuja
             * podrían dejar de ser las mismas.
             */
            topic: answersIn(valueOf(page.id, names.topic) ?? ''),
            created: page.createdAt,
            updated: graph.updatedAt(page.id),
            says: says.get(page.id) ?? null,
          }));

        const matchingBlocks = outcome.matchingBlocks.flatMap((id) => {
          const block = graph.block(id);
          if (block === undefined) return [];
          const page = graph.page(block.page);
          if (page === undefined) return [];
          return [{
            id: block.stableId,
            content: block.content,
            parent: block.parent,
            position: block.position,
            page: { id: page.id, title: page.title },
          }];
        });

        if (read.view === 'blocks') {
          send(response, 200, {
            view: 'blocks',
            asked: writeQuery(read.expression, read.view),
            count: matchingBlocks.length,
            blocks: matchingBlocks.slice(0, MOST_ANSWERS),
            more: Math.max(0, matchingBlocks.length - MOST_ANSWERS),
          });
          return;
        }

        /*
         * Ordenar antes de recortar, siempre.
         *
         * Es la diferencia entre ordenar la respuesta y ordenar el trozo de la
         * respuesta que cupo: con dos mil páginas seleccionadas, lo segundo
         * enseñaría las doscientas primeras por título ordenadas por fecha, que
         * no es lo que nadie pidió.
         *
         * Y el orden no se escribe en la pregunta: es cómo se está mirando, no
         * qué se seleccionó. Pulsar una cabecera no debería reescribir el bloque
         * de nadie.
         */
        const sort = body.sort as { by?: unknown; desc?: unknown } | undefined;
        const by = typeof sort?.by === 'string' ? sort.by : 'title';
        const desc = sort?.desc === true;
        const dicho = (value: string | null): string => value ?? '';
        const compare: Record<string, (a: (typeof found)[number], b: (typeof found)[number]) => number> = {
          title: (a, b) => a.title.localeCompare(b.title, 'es'),
          type: (a, b) => dicho(a.type).localeCompare(dicho(b.type), 'es'),
          topic: (a, b) => (a.topic[0] ?? '').localeCompare(b.topic[0] ?? '', 'es'),
          created: (a, b) => a.created - b.created,
          updated: (a, b) => (a.updated ?? 0) - (b.updated ?? 0),
        };
        const order = compare[by] ?? compare['title'];
        // Desempate por título: dos páginas del mismo tipo no pueden bailar entre
        // dos lecturas de la misma pregunta.
        found.sort((a, b) => (order?.(a, b) ?? 0) || a.title.localeCompare(b.title, 'es'));
        if (desc) found.reverse();

        // Se contesta entero cuánto es y se manda un tramo: una pregunta puede
        // seleccionar dos mil páginas, y ninguna pantalla las lee. Lo recortado
        // se declara, como todo lo demás.
        send(response, 200, {
          view: read.view,
          /*
           * La pregunta tal como Vera la entendió.
           *
           * No es un adorno: cuando la respuesta es cero, lo único que quien
           * mira necesita saber es si el corpus no tiene nada o si la pregunta
           * decía otra cosa. Devolver el árbol vuelto a escribir contesta eso sin
           * que haya que adivinarlo —@guarantee AnEmptyAnswerExplainsItself—.
           */
          asked: writeQuery(read.expression, read.view),
          /** Cómo llama este corpus a lo que la tabla enseña en sus columnas. */
          names: { kind: names.kind, topic: names.topic },
          sort: { by, desc },
          count: found.length,
          pages: found.slice(0, MOST_ANSWERS),
          more: Math.max(0, found.length - MOST_ANSWERS),
        });
      });
      return;
    }

    if (request.method === 'GET' && path === '/youtube/transcripts') {
      const source = url.searchParams.get('url') ?? '';
      try {
        send(response, 200, await youtubeTranscriptChoices(source));
      } catch (problem) {
        send(response, 502, { error: problem instanceof Error ? problem.message : 'YouTube no contestó' });
      }
      return;
    }

    if (request.method === 'POST' && path === '/youtube/transcripts') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      let body: { url?: unknown; language?: unknown; source?: unknown };
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
      } catch {
        send(response, 400, { error: 'el cuerpo debe ser JSON' });
        return;
      }
      if (typeof body.url !== 'string' || typeof body.language !== 'string' ||
          (body.source !== 'published' && body.source !== 'automatic')) {
        send(response, 400, { error: 'falta elegir una pista' });
        return;
      }
      try {
        send(response, 200, await youtubeTranscript(body.url, body.language, body.source));
      } catch (problem) {
        send(response, 502, { error: problem instanceof Error ? problem.message : 'YouTube no entregó la pista' });
      }
      return;
    }

    if (request.method !== 'GET') {
      send(response, 405, { error: 'method not allowed' });
      return;
    }

    const participant = publicAccess ? ANYBODY : (url.searchParams.get('participant') ?? owner.id);

    try {
      if (path === '/health') {
        const visiblePages = publicAccess
          ? graph.pages().filter((page) => isPublicPage(page.id))
          : graph.pages();
          const siteEntry = publicScopedSpace === null
            ? (publicSite()?.entryPoint ?? null)
            : graph.pages().filter((page) => isPublicPage(page.id))
                .sort((a, b) => a.title.localeCompare(b.title, 'es'))[0]?.id ?? null;
        send(response, 200, {
          graph: graph.name,
          access: publicAccess ? 'anybody' : 'owner',
          canEdit: publicAccess ? canEditScopedSpace : true,
          canContribute: publicAccess ? canContributeScopedSpace : false,
          canViewOwner: !publicOrigin,
          entryPoint: publicAccess && siteEntry !== null && isPublicPage(siteEntry) ? siteEntry : null,
          /*
           * Cómo llama este corpus a las propiedades que Vera necesita conocer.
           *
           * Viaja aquí porque el cliente las necesita antes de escribir nada
           * —un día nace con su clase puesta— y ésta es la primera petición que
           * hace al arrancar.
           */
          names: propertyNames(),
          embedHosts: embedHosts(),
          pages: visiblePages.length,
          blocks: visiblePages.reduce((count, page) => count + graph.blocksOf(page.id).length, 0),
          // El cursor del log privado no es información de la publicación.
          lastSequence: publicAccess ? 0 : graph.log().lastSequence,
        });
        return;
      }

      if (path === '/pages') {
        const visible = publicAccess
          ? graph.pages().filter((page) => isPublicPage(page.id))
          : graph.pages();
        send(
          response,
          200,
          visible.map((page) => ({
            id: page.id,
            title: page.title,
            visibility: page.visibility,
            publicationPath: publicAccess
              ? publicScopedSpace === null
                ? graph.publicationsOf(publicSite()?.id ?? '').find((one) => one.page === page.id)?.path ?? null
                : `s/${publicScopedSpace.slug}/p/${encodeURIComponent(page.title)}`
              : null,
            blockCount: graph.blocksOf(page.id).length,
            // Cuántas aristas toca. El cliente lo usa para no abrir de entrada
            // una página aislada, que se vería como un grafo vacío.
            linkCount:
              graph.backlinks(page.id).filter((link) => !publicAccess || isPublicPage(link.sourcePage)).length +
              graph
                .blocksOf(page.id)
                .reduce(
                  (n, block) =>
                    n + graph.linksOf(block.stableId).filter(
                      (link) => link.target !== null && (!publicAccess || isPublicPage(link.target)),
                    ).length,
                  0,
                ),
          })),
        );
        return;
      }

      /* El rastro hecho librillo: cada `page` es una parada y conserva el orden. */
      if (path === '/booklet/paper' || path === '/booklet/pdf') {
        const asPdf = path.endsWith('/pdf');
        const ids = url.searchParams.getAll('page').slice(0, 64);
        const bookletPages = ids.map((id) => graph.page(id) ?? graph.pageTitled(id));
        if (ids.length === 0 || bookletPages.some((page) => page === undefined)) {
          send(response, 404, { error: 'el recorrido contiene una página que ya no existe' });
          return;
        }
        const found = bookletPages.filter((page): page is NonNullable<typeof page> => page !== undefined);
        if (publicAccess && found.some((page) => !isPublicPage(page.id))) {
          send(response, 404, { error: 'el recorrido contiene una página que no está publicada' });
          return;
        }
        const title = url.searchParams.get('title')?.trim() || 'Recorrido de Vera';
        note(asPdf ? 'GET /booklet/pdf' : 'GET /booklet/paper', found[0]!.id, 0, found.map((page) => page.id));
        if (!asPdf) {
          void composeBooklet({
            title,
            pages: found.map((page) => ({
              title: page.title,
              blocks: graph.blocksOf(page.id).map((block) => ({
                stableId: block.stableId, parent: block.parent,
                position: block.position, content: block.content,
              })),
              assets: assetsOf(page.id),
              embedHosts: embedHosts(),
              indent: url.searchParams.get('sangria') !== null,
              resolveBlock: (stableId) => {
                const cited = graph.block(stableId);
                if (cited === undefined || (publicAccess && !isPublicPage(cited.page))) return null;
                return { page: graph.page(cited.page)?.title ?? cited.page, excerpt: cited.content };
              },
            })),
          }).then((html) => {
            const body = Buffer.from(html, 'utf8');
            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.byteLength });
            response.end(body);
          }, (error: unknown) => send(response, 500, {
            error: error instanceof Error ? error.message : 'no se pudo componer el librillo',
          }));
          return;
        }
        if (publicAccess && options.publicPreviewPort === undefined) {
          send(response, 503, { error: 'la salida pública para componer PDF no está configurada' });
          return;
        }
        const port = publicAccess ? options.publicPreviewPort! : (request.socket.localPort ?? 4173);
        const query = new URLSearchParams();
        for (const page of found) query.append('page', page.id);
        query.set('title', title);
        if (url.searchParams.get('sangria') !== null) query.set('sangria', '1');
        const where = `http://127.0.0.1:${port}/booklet/paper?${query.toString()}`;
        void toPdf(where).then((made) => {
          if ('error' in made) return send(response, 503, made);
          response.writeHead(200, {
            'content-type': 'application/pdf',
            'content-length': made.pdf.byteLength,
            'content-disposition': `attachment; filename="recorrido-vera.pdf"; filename*=UTF-8''${encodeURIComponent(`${title}.pdf`)}`,
          });
          response.end(made.pdf);
        });
        return;
      }

      // El Markdown de una página, tal como git lo recibiría. Se sirve la misma
      // proyección determinista que baja el corpus a disco: exportar y versionar
      // no pueden dar dos textos distintos.
      /*
       * La página en papel, y el PDF que sale de ella.
       *
       * Dos rutas y no una porque son dos cosas distintas: `/paper` es el
       * documento compuesto, que se puede mirar en una pestaña mientras se
       * decide cómo tiene que verse, y `/pdf` es ese mismo documento pasado por
       * un Chrome sin ventana. Componer aquí y no en el navegador de quien lo
       * pide es lo que hace que el PDF sea siempre el mismo: carta, sin
       * encabezados del sistema y sin depender de la impresora que hubiera
       * configurada. Ver paper.ts.
       */
      if (path.startsWith('/pages/') && (path.endsWith('/paper') || path.endsWith('/pdf'))) {
        const asPdf = path.endsWith('/pdf');
        const named = decodeURIComponent(
          path.slice('/pages/'.length, asPdf ? -'/pdf'.length : -'/paper'.length),
        );
        const page = graph.page(named) ?? graph.pageTitled(named);
        if (page === undefined) {
          send(response, 404, { error: 'no such page' });
          return;
        }
        if (publicAccess && !isPublicPage(page.id)) {
          send(response, 404, { error: 'no such page' });
          return;
        }

        // El papel y el PDF son la página entera, compuesta para irse de aquí.
        // El PDF de verdad se compone pidiéndose el papel a sí mismo por el
        // bucle local, así que ese viaje interno queda anotado también: es la
        // única lectura del registro que no sale a ninguna parte, y verla
        // repetida es la señal de que alguien está bajando páginas en papel.
        note(asPdf ? 'GET /pages/:id/pdf' : 'GET /pages/:id/paper', page.id, 0, [page.id]);

        if (!asPdf) {
          /*
           * Los diagramas se dibujan aquí, y por eso esto espera.
           *
           * @invariant ADiagramIsDrawnOnPaper. Componer el papel deja de ser
           * inmediato en las páginas que traen figuras —hay que arrancar un
           * navegador— y no en las demás: sin diagramas, `composePaper` no llama
           * a nadie y contesta lo mismo que antes.
           *
           * El PDF no paga esto dos veces: se compone pidiéndose este mismo
           * papel, que ya viene con las figuras puestas.
           */
          void composePaper({
            title: page.title,
            blocks: graph.blocksOf(page.id).map((block) => ({
              stableId: block.stableId,
              parent: block.parent,
              position: block.position,
              content: block.content,
            })),
            assets: assetsOf(page.id),
            embedHosts: embedHosts(),
            indent: url.searchParams.get('sangria') !== null,
            /*
             * Lo que dice cada bloque citado, entero.
             *
             * @invariant AQuotedBlockTravelsAsItsWords. Se resuelve aquí porque
             * aquí está el grafo: una cita puede nombrar un bloque de cualquier
             * página, y el papel sólo trae los de ésta.
             */
            resolveBlock: (stableId) => {
              const cited = graph.block(stableId);
              if (cited === undefined || (publicAccess && !isPublicPage(cited.page))) return null;
              const from = graph.page(cited.page);
              return { page: from?.title ?? cited.page, excerpt: cited.content };
            },
          }).then(
            (html) => {
              const body = Buffer.from(html, 'utf8');
              response.writeHead(200, {
                'content-type': 'text/html; charset=utf-8',
                'content-length': body.byteLength,
              });
              response.end(body);
            },
            (error: unknown) => {
              // Componer no debería fallar —lo que puede fallar es dibujar, y eso
              // se contesta con la fuente a la vista— así que si llega aquí es
              // otra cosa y se dice como lo que es.
              send(response, 500, {
                error: error instanceof Error ? error.message : 'no se pudo componer el papel',
              });
            },
          );
          return;
        }

        /*
         * Chrome pide el papel al propio Vera, por el bucle local.
         *
         * Por su dirección y no por un archivo temporal: así las imágenes, las
         * fuentes y los medios se piden por su ruta de siempre y a su propio
         * origen, y mirar el papel en una pestaña y componerlo en un PDF son la
         * misma página y no dos parecidas.
         */
        if (publicAccess && options.publicPreviewPort === undefined) {
          send(response, 503, { error: 'la salida pública para componer PDF no está configurada' });
          return;
        }
        const port = publicAccess
          ? options.publicPreviewPort!
          : (request.socket.localPort ?? 4173);
        const suffix = url.searchParams.get('sangria') !== null ? '?sangria=1' : '';
        const where = `http://127.0.0.1:${port}/pages/${encodeURIComponent(page.id)}/paper${suffix}`;
        void toPdf(where).then((made) => {
          if ('error' in made) {
            send(response, 503, made);
            return;
          }
          response.writeHead(200, {
            'content-type': 'application/pdf',
            'content-length': made.pdf.byteLength,
            // El nombre del archivo va en las dos formas: la simple para quien
            // sólo entienda ASCII y la codificada para el título de verdad, que
            // lleva tildes y rayas.
            'content-disposition':
              `attachment; filename="${page.title.replace(/[^\w .-]/g, '_')}.pdf"; ` +
              `filename*=UTF-8''${encodeURIComponent(`${page.title}.pdf`)}`,
          });
          response.end(made.pdf);
        });
        return;
      }

      if (path.startsWith('/pages/') && path.endsWith('/markdown')) {
        const named = decodeURIComponent(
          path.slice('/pages/'.length, -'/markdown'.length),
        );
        const page = graph.page(named) ?? graph.pageTitled(named);
        if (page === undefined) {
          send(response, 404, { error: 'no such page' });
          return;
        }
        if (publicAccess && !isPublicPage(page.id)) {
          send(response, 404, { error: 'no such page' });
          return;
        }
        const { text } = renderPage(graph, page);
        const body = Buffer.from(text, 'utf8');
        // Esto es la página entera en texto plano, lista para pegarse en otra
        // parte: la forma más completa en que el corpus sale de casa.
        note('GET /pages/:id/markdown', page.id, text.length, [page.id]);
        response.writeHead(200, {
          'content-type': 'text/markdown; charset=utf-8',
          'content-length': body.byteLength,
        });
        response.end(body);
        return;
      }

      if (path.startsWith('/pages/')) {
        const named = decodeURIComponent(path.slice('/pages/'.length));
        // Por identidad primero, por título después. La URL nombra la página por
        // su título porque es lo legible, pero un enlace viejo escrito con el
        // identificador tiene que seguir funcionando después de un renombrado.
        const page = graph.page(named) ?? graph.pageTitled(named);
        if (page === undefined) {
          send(response, 404, { error: 'no such page' });
          return;
        }
        if (publicAccess && !isPublicPage(page.id)) {
          send(response, 404, { error: 'no such page' });
          return;
        }
        const pageBlocks = graph.blocksOf(page.id);

        /*
         * La escritura antes que las lecturas que exigen recorrer el grafo.
         *
         * Esta vista no es un esqueleto: lleva cuanto hace falta para leer,
         * editar y distinguir la procedencia de cada bloque. Lo que deja vacío
         * es lo derivado de otras páginas —retroenlaces, cruces, pertenencia a un
         * concepto y dominios observados—, que el cliente pide después por la
         * ruta completa. @invariant AUsablePageArrivesBeforeItsEnrichment.
         */
        if (url.searchParams.get('stage') === 'readable') {
          deliver({
            id: page.id,
            title: page.title,
            trail: null,
            visibility: page.visibility,
            publication: publicationView(page.id),
            createdAt: page.createdAt,
            originCreatedAt: page.originCreatedAt,
            lastEditedAt: graph.lastEditedAt(page.id),
            properties: graph.propertiesOf(page.id).map((p) => ({ key: p.key, value: p.value })),
            domains: {},
            blocks: pageBlocks.map((block) => ({
              stableId: block.stableId,
              parent: block.parent,
              position: block.position,
              content: block.content,
            })).sort((a, b) => a.position - b.position),
            concept: null,
            blockProperties: Object.fromEntries(
              pageBlocks
                .map((block) => [block.stableId, graph.propertiesOf(block.stableId)] as const)
                .filter(([, said]) => said.length > 0)
                .map(([id, said]) => [id, said.map((one) => ({ key: one.key, value: one.value }))]),
            ),
            assets: assetsOf(page.id),
            blockRefs: (() => {
              const seen = new Set<string>();
              const found: { id: string; page: string; excerpt: string }[] = [];
              for (const block of pageBlocks) {
                for (const match of block.content.matchAll(/\(\(([^()\s]+)\)\)/g)) {
                  const id = match[1] ?? '';
                  if (id === '' || seen.has(id)) continue;
                  seen.add(id);
                  const target = graph.block(id);
                  if (target === undefined || (publicAccess && !isPublicPage(target.page))) continue;
                  found.push({ id, page: target.page, excerpt: excerpt(target.content) });
                }
              }
              return found;
            })(),
            folded: publicAccess ? [] : foldedOnPage(store, participant, page.id),
            pendingLinks: [],
            spokenOrigins: spokenOriginsOnPage(store, page.id),
            recordings: recordingsInPage(store, page.id),
            authorship: Object.fromEntries(
              pageBlocks
                .map((block) => [block.stableId, graph.authorship(block.stableId)] as const)
                .filter(([, hand]) => hand !== undefined)
                .map(([id, hand]) => [id, {
                  participant: hand?.participant,
                  kind: graph.participant(hand?.participant ?? '')?.kind ?? null,
                  channel: hand?.channel,
                  writtenAt: hand?.writtenAt,
                }]),
            ),
            // Las glosas son la voz privada del presentador. Publicar la página
            // publica sus láminas, nunca aquello que quien presenta se dice al
            // margen. No basta con ocultarlas en el cliente: no cruzan la API.
            glosses: publicAccess ? {} : Object.fromEntries(
              pageBlocks
                .map((block) => graph.gloss(block.stableId))
                .filter((gloss) => gloss !== undefined)
                .map((gloss) => [gloss.block, {
                  content: gloss.content,
                  createdAt: gloss.createdAt,
                  updatedAt: gloss.updatedAt,
                }]),
            ),
            backlinks: [],
            references: [],
            crossingsOut: [],
            crossingsIn: [],
          }, {
            surface: 'GET /pages/:id?stage=readable',
            subject: page.id,
            delivered: [page.id],
          });
          return;
        }
        const glossCrossings = graph.glosses().flatMap((gloss) => {
          const block = graph.block(gloss.block);
          if (block === undefined) return [];
          return referencedTitles(gloss.content).map((targetTitle) => {
            const target = graph.pageTitled(targetTitle);
            return {
              stableId: block.stableId,
              connective: block.stableId,
              said: gloss.content,
              blocks: [block],
              fromBlock: block.stableId,
              fromPage: block.page,
              targetTitle,
              toPage: target?.id ?? null,
              sense: 'directed' as const,
              term: null,
              createdAt: block.createdAt,
              updatedAt: block.createdAt,
            };
          });
        });
        const crossingRow = (crossing: (typeof glossCrossings)[number], outgoing: boolean) => ({
          ...crossing,
          revision: null,
          title: outgoing
            ? (crossing.toPage === null
                ? crossing.targetTitle
                : (graph.page(crossing.toPage)?.title ?? crossing.targetTitle))
            : (graph.page(crossing.fromPage)?.title ?? crossing.fromPage),
          reads: null,
          says: excerpt(graph.block(crossing.fromBlock)?.content ?? ''),
        });

        const detail = {
          id: page.id,
          title: page.title,
          /*
           * El recorrido, cuando la página dice que su orden es un argumento.
           *
           * Viaja con la página y no en una petición aparte porque leer un
           * recorrido es leer su página: pedirlo dos veces haría que el texto y
           * su hilo llegaran en momentos distintos y la página parpadeara al
           * abrirse. Cuando la página no lo declara, viaja nulo y no cuesta nada.
           */
          // Un recorrido puede atravesar páginas que no pertenecen al sitio.
          // Hasta tener una proyección parcial honesta, no se entrega a anybody.
          trail: publicAccess ? null : trailOf(page.id),
          visibility: page.visibility,
          publication: publicationView(page.id),
          createdAt: page.createdAt,
          originCreatedAt: page.originCreatedAt,
          lastEditedAt: graph.lastEditedAt(page.id),
          properties: graph.propertiesOf(page.id).map((p) => ({ key: p.key, value: p.value })),
          // Lo que el corpus ya contesta a cada una de estas claves. Es el
          // vocabulario observado, no uno declarado: mientras no haya ontología
          // es lo único que hay, y cuando la haya seguirá siendo la evidencia
          // desde la que se propone. Sólo viajan las claves de esta página.
          domains: publicAccess
            ? {}
            : Object.fromEntries(
                [...new Set(graph.propertiesOf(page.id).map((p) => p.key))].map((key) => [
                  key,
                  graph.observedValuesOf(key),
                ]),
              ),
          blocks: graph
            .blocksOf(page.id)
            .map((block) => ({
              stableId: block.stableId,
              parent: block.parent,
              position: block.position,
              content: block.content,
            }))
            .sort((a, b) => a.position - b.position),
          concept: (() => {
            const names = graph.propertyNames;
            const isConcept = graph.propertiesOf(page.id).some(
              (property) =>
                property.key === names.kind &&
                answersIn(property.value).some((value) => titleKey(value) === titleKey('concepto')),
            );
            if (!isConcept) return null;

            const needle = titleKey(page.title);
            // El índice inverso ya sabe qué páginas enlazan este concepto. No
            // se vuelve a materializar y recorrer la colección completa de
            // enlaces por cada página candidata: en un corpus de dos mil
            // páginas eso multiplicaba decenas de miles de enlaces dos mil
            // veces, retenía gigabytes y hacía parecer caído al servicio.
            const linkedPages = new Set(graph.backlinks(page.id).map((link) => link.sourcePage));
            const members = graph.pages().flatMap((candidate) => {
              if (candidate.id === page.id || (publicAccess && !isPublicPage(candidate.id))) return [];
              const blocks = graph.blocksOf(candidate.id);
              const declared = graph.propertiesOf(candidate.id).some(
                (property) =>
                  property.key === names.topic &&
                  answersIn(property.value).some((value) => titleKey(value) === needle),
              );
              const linked = linkedPages.has(candidate.id);
              const matchingBlock = blocks.find((block) => titleKey(block.content).includes(needle));
              const matchingGloss = blocks
                .map((block) => graph.gloss(block.stableId))
                .find((gloss) => gloss !== undefined && titleKey(gloss.content).includes(needle));
              const mentioned = matchingBlock !== undefined || matchingGloss !== undefined;
              if (!declared && !linked && !mentioned) return [];
              const formalization = !linked && matchingBlock !== undefined
                ? formalizationOf(
                    { stableId: matchingBlock.stableId, content: matchingBlock.content },
                    { id: page.id, title: page.title, backlinks: linkedPages.size },
                  )
                : null;
              return [{
                page: candidate.id,
                title: candidate.title,
                excerpt: excerpt(matchingBlock?.content ?? matchingGloss?.content ?? ''),
                declared,
                linked,
                mentioned,
                formalization,
              }];
            }).sort((a, b) => a.title.localeCompare(b.title));
            return { members };
          })(),
          /*
           * Lo que cuelga de cada bloque.
           *
           * El corpus las trae de Logseq —453 bloques las llevan— y hasta ahora
           * no salían de aquí, así que el cliente no podía enseñar ni el plazo
           * de una tarea ni el testimonio de un cruce. Sólo los bloques que
           * llevan alguna: mandar una entrada vacía por bloque sería doblar el
           * tamaño de una página para decir que no hay nada.
           */
          blockProperties: Object.fromEntries(
            graph
              .blocksOf(page.id)
              .map((block) => [block.stableId, graph.propertiesOf(block.stableId)] as const)
              .filter(([, said]) => said.length > 0)
              .map(([id, said]) => [id, said.map((one) => ({ key: one.key, value: one.value }))]),
          ),
          // Las referencias viajan ya nombradas: el cliente no puede resolver
          // mil títulos de página con mil peticiones más.
          // Sólo los medios que esta página nombra. El bloque conserva su
          // `../assets/foo.png` —lo que mantiene portable la proyección
          // Markdown— y aquí viaja a qué objeto resuelve.
          assets: assetsOf(page.id),
          /*
           * Las dos columnas: lo que esta página afirma sobre otras y lo que
           * otras afirman sobre ella.
           *
           * Separadas y no juntas porque la diferencia es quién lo dijo, que en
           * un corpus con procedencia es la distinción entera. Cada fila lleva
           * el bloque desde el que se afirma: una relación sin su frase es una
           * flecha sin sujeto, dice que hay algo y no qué, y obliga a irse de la
           * página para saberlo —que es lo que un retroenlace sin extracto ya
           * hace hoy—.
           *
           * Un entrante se lee con el recíproco del término y no con el término:
           * lo que A afirma es que contradice a B, y lo que B tiene que leer es
           * que es contradicha por A. Enseñarlo tal cual invertiría el sujeto de
           * la afirmación sin avisar.
           */
          crossingsOut: graph.crossingsOut(page.id)
            .filter((crossing) => !publicAccess || (crossing.toPage !== null && isPublicPage(crossing.toPage)))
            .map((crossing) => ({
            ...crossing,
            revision: graph.revisions()
              .filter((one) => one.crossing === crossing.stableId)
              .at(-1)?.operation ?? null,
            title: crossing.toPage === null ? crossing.targetTitle : (graph.page(crossing.toPage)?.title ?? crossing.targetTitle),
            reads: crossing.term,
            says: crossing.fromBlock === null ? '' : excerpt(graph.block(crossing.fromBlock)?.content ?? ''),
          })).concat(
            glossCrossings
              .filter((crossing) => crossing.fromPage === page.id)
              .filter((crossing) => !publicAccess || (crossing.toPage !== null && isPublicPage(crossing.toPage)))
              .map((crossing) => crossingRow(crossing, true)),
          ),
          crossingsIn: graph.crossingsIn(page.id)
            .filter((crossing) => !publicAccess || isPublicPage(crossing.fromPage))
            .map((crossing) => ({
            ...crossing,
            revision: graph.revisions()
              .filter((one) => one.crossing === crossing.stableId)
              .at(-1)?.operation ?? null,
            title: graph.page(crossing.fromPage)?.title ?? crossing.fromPage,
            reads: inverseOf(crossing.term, relationVocabulary()),
            says: crossing.fromBlock === null ? '' : excerpt(graph.block(crossing.fromBlock)?.content ?? ''),
          })).concat(
            glossCrossings
              .filter((crossing) => crossing.toPage === page.id)
              .filter((crossing) => !publicAccess || isPublicPage(crossing.fromPage))
              .map((crossing) => crossingRow(crossing, false)),
          ),
          // La denominación de origen de los bloques hablados de esta página.
          spokenOrigins: spokenOriginsOnPage(store, page.id),
          // @guarantee NothingSpokenIsStrandedFromTheWriting: lo hablado dentro
          // de esta página viaja con ella, para que se vea donde se habló y no
          // haya que ir a buscarlo a una lista aparte.
          recordings: recordingsInPage(store, page.id),
          // @invariant GeneratedContentIsAlwaysDistinguishable: de qué mano
          // salió el texto de cada bloque. Viaja con la página y no en una
          // petición aparte, porque distinguir lo escrito de lo generado tiene
          // que costar lo mismo que leer, o no se hará.
          //
          // Es cosa distinta de spokenOrigins: uno dice de dónde vinieron las
          // palabras y el otro quién las escribió por última vez. Un bloque
          // dictado por Herbert y reescrito por el bibliotecario aparece en los dos, y
          // nombrando participantes distintos.
          authorship: Object.fromEntries(
            graph
              .blocksOf(page.id)
              .map((block) => [block.stableId, graph.authorship(block.stableId)] as const)
              .filter(([, hand]) => hand !== undefined)
              .map(([id, hand]) => [
                id,
                {
                  participant: hand?.participant,
                  kind: graph.participant(hand?.participant ?? '')?.kind ?? null,
                  channel: hand?.channel,
                  writtenAt: hand?.writtenAt,
                },
              ]),
          ),
          glosses: publicAccess ? {} : Object.fromEntries(
            graph
              .blocksOf(page.id)
              .map((block) => graph.gloss(block.stableId))
              .filter((gloss) => gloss !== undefined)
              .map((gloss) => [
                gloss.block,
                { content: gloss.content, createdAt: gloss.createdAt, updatedAt: gloss.updatedAt },
              ]),
          ),
          // @invariant FoldingIsNotAChange: qué tiene plegado ESTE participante.
          // No sale del registro de operaciones porque nunca entró en él.
          folded: publicAccess ? [] : foldedOnPage(store, participant, page.id),
          // @invariant ReferenceResolvesToItsBlock. Las referencias que esta
          // página nombra viajan resueltas: quién es el bloque, en qué página
          // vive y qué dice. Sin esto el cliente tendría que pedir una por una
          // y una referencia sería más cara de mostrar que de escribir.
          blockRefs: (() => {
            const seen = new Set<string>();
            const found: { id: string; page: string; excerpt: string }[] = [];
            for (const block of graph.blocksOf(page.id)) {
              for (const match of block.content.matchAll(/\(\(([^()\s]+)\)\)/g)) {
                const id = match[1] ?? '';
                if (id === '' || seen.has(id)) continue;
                seen.add(id);
                const target = graph.block(id);
                if (target === undefined || (publicAccess && !isPublicPage(target.page))) continue;
                found.push({ id, page: target.page, excerpt: excerpt(target.content) });
              }
            }
            return found;
          })(),
          // Qué páginas nombradas desde aquí existen ya y cuáles todavía no.
          //
          // Un enlace a una página que aún no está no es un enlace roto: es la
          // intención de escribirla, y el corpus está lleno de ellas a propósito.
          // Pero leerlo igual que uno que lleva a alguna parte hace que el
          // lector descubra la diferencia sólo al pulsarlo.
          pendingLinks: (() => {
            const pending = new Set<string>();
            for (const block of graph.blocksOf(page.id)) {
              for (const link of graph.linksOf(block.stableId)) {
                if (link.target === null || (publicAccess && !isPublicPage(link.target))) {
                  pending.add(link.targetTitle);
                }
              }
            }
            return [...pending];
          })(),
          backlinks: graph.backlinks(page.id)
            .filter((link) => !publicAccess || isPublicPage(link.sourcePage))
            .map((link) => {
            const source = graph.page(link.sourcePage);
            const block = link.sourceBlock === null ? undefined : graph.block(link.sourceBlock);
            return {
              page: link.sourcePage,
              block: link.sourceBlock,
              title: source?.title ?? link.sourcePage,
              excerpt: excerpt(block?.content ?? ''),
            };
          }),
          /*
           * Y las que salen: a quién nombra esta página.
           *
           * Estaban en el texto y en ninguna lista. Un enlace saliente se ve
           * leyendo la página entera; el pie contestaba sólo la mitad de la
           * pregunta —quién habla de esto— y no la otra —de qué habla esto—, que
           * es la que dice de qué es vecina una página sin tener que releerla.
           *
           * Se manda una fila por página nombrada y no una por mención: nombrar
           * cinco veces a la misma página es un dato sobre el texto y no sobre el
           * grafo, y una lista que la repitiera cinco veces se leería como cinco
           * vecinas. La frase que viaja es la primera, que es donde se presenta.
           *
           * Un título que nadie ha escrito viaja igual, con `page` nulo. Es lo
           * que el corpus tiene de más honesto: una página nombrada y todavía sin
           * escribir es una deuda a la vista, no un enlace roto.
           */
          references: (() => {
            const seen = new Map<string, { page: string | null; title: string; block: string; excerpt: string }>();
            for (const block of graph.blocksOf(page.id)) {
              for (const link of graph.linksOf(block.stableId)) {
                const target = link.target === null ? undefined : graph.page(link.target);
                const key = titleKey(target?.title ?? link.targetTitle);
                if (key === '' || seen.has(key)) continue;
                seen.set(key, {
                  page: publicAccess && (link.target === null || !isPublicPage(link.target))
                    ? null
                    : link.target,
                  title: target?.title ?? link.targetTitle,
                  block: block.stableId,
                  excerpt: excerpt(block.content),
                });
              }
            }
            return [...seen.values()];
          })(),
        };
        const enrichment = url.searchParams.get('stage') === 'enrichment';
        deliver(enrichment ? {
          id: detail.id,
          domains: detail.domains,
          concept: detail.concept,
          pendingLinks: detail.pendingLinks,
          backlinks: detail.backlinks,
          references: detail.references,
          crossingsOut: detail.crossingsOut,
          crossingsIn: detail.crossingsIn,
          trail: detail.trail,
        } : detail, {
          surface: enrichment ? 'GET /pages/:id?stage=enrichment' : 'GET /pages/:id',
          subject: page.id,
          // Abrir una página se lleva la página entera y sus bloques: eso es lo
          // que se anota, y no sólo el título por el que se pidió.
          delivered: enrichment
            ? [page.id]
            : [page.id, ...graph.blocksOf(page.id).map((block) => block.stableId)],
        });
        return;
      }

      // Un objeto se nombra por el hash de su contenido, así que su respuesta
      // nunca cambia: se puede cachear para siempre.
      if (path.startsWith('/media/')) {
        const hash = path.slice('/media/'.length);
        if (
          objectsRoot === null ||
          !HASH.test(hash) ||
          (publicAccess && !publicMediaHashes(scopedPageIds).has(hash))
        ) {
          send(response, 404, { error: 'no such media' });
          return;
        }
        const record = mediaByHash(store, hash);
        const file = objectPath(objectsRoot, hash);
        if (record === null || !existsSync(file)) {
          send(response, 404, { error: 'no such media' });
          return;
        }
        response.writeHead(200, {
          'content-type': record.mediaType,
          'content-length': record.byteSize,
          'cache-control': 'public, max-age=31536000, immutable',
          // @invariant ExecutableContentIsolation. Un SVG servido desde este
          // mismo origen es un documento que puede ejecutar guiones y leer lo
          // que el origen tenga. Estas dos cabeceras se lo impiden: sin fuentes
          // permitidas y en un origen opaco, no alcanza nada del grafo.
          'content-security-policy': "default-src 'none'; sandbox",
          'x-content-type-options': 'nosniff',
        });
        createReadStream(file).pipe(response);
        return;
      }

      if (path === '/search') {
        const asked = url.searchParams.get('q') ?? '';
        // La búsqueda pública usa el algoritmo canónico, pero la identidad de
        // frontera `anybody` no se admite al grafo. El resultado se recorta por
        // publicación antes de salir; no se inventa una membresía anónima.
        const outcome = graph.search({ text: asked, participant: publicAccess ? owner.id : participant });
        const hits = publicAccess
          ? outcome.hits.filter((hit) => isPublicPage(hit.page))
          : outcome.hits;
        /*
         * Una búsqueda que devolvió doce extractos expuso doce cosas, y el
         * registro tiene que poder nombrarlas: buscar es la manera barata de
         * llevarse el corpus a trozos sin abrir una sola página.
         */
        deliver(hits, {
          surface: 'GET /search',
          subject: asked,
          delivered: hits.map((hit) => hit.block ?? hit.page),
        });
        return;
      }

      if (path === '/glosses') {
        const asked = url.searchParams.get('q') ?? '';
        const matches = graph
          .glosses()
          .filter((gloss) => asked === '' || gloss.content.toLocaleLowerCase().includes(asked.toLocaleLowerCase()))
          .map((gloss) => ({
            block: gloss.block,
            page: graph.block(gloss.block)?.page ?? null,
            content: gloss.content,
            updatedAt: gloss.updatedAt,
          }));
        deliver(
          { count: graph.glosses().length, matches },
          {
            surface: 'GET /glosses',
            subject: asked,
            delivered: matches.flatMap((match) => [match.block, ...(match.page === null ? [] : [match.page])]),
          },
        );
        return;
      }

      if (path.startsWith('/graph/')) {
        const centre = decodeURIComponent(path.slice('/graph/'.length));
        const depth = Number(url.searchParams.get('depth') ?? '2');
        // El dueño puede mirar el mismo subgrafo publicado sin dejar de ser
        // dueño. Esto filtra sólo el mapa; no cambia la autoridad de la petición.
        const publishedMap = publicAccess || url.searchParams.get('published') === '1';
        if (publishedMap) {
          const centred = graph.page(centre) ?? graph.pageTitled(centre);
          if (centred === undefined || !isPublicPage(centred.id)) {
            send(response, 404, { error: 'no such page' });
            return;
          }

          // El mapa público se calcula sobre el subgrafo inducido. Filtrar un
          // vecindario privado después de recorrerlo revelaría que dos páginas
          // públicas están conectadas por algo oculto.
          const allowed = scopedPageIds;
          const neighbours = new Map<string, Set<string>>();
          for (const id of allowed) neighbours.set(id, new Set());
          for (const id of allowed) {
            for (const block of graph.blocksOf(id)) {
              for (const link of graph.linksOf(block.stableId)) {
                if (link.target === null || !allowed.has(link.target)) continue;
                neighbours.get(id)?.add(link.target);
                neighbours.get(link.target)?.add(id);
              }
            }
          }
          // Un espacio compartido es la figura completa que su pertenencia
          // recorta. Si se redujera al vecindario de la página abierta, una
          // portada deliberadamente aislada ocultaría las demás componentes
          // del espacio —precisamente la estructura que se vino a mirar.
          // El sitio público canónico conserva, en cambio, el mapa local por
          // profundidad que ya tenía.
          const shown = publicScopedSpace === null
            ? (() => {
                const distances = new Map<string, number>([[centred.id, 0]]);
                const queue = [centred.id];
                while (queue.length > 0) {
                  const current = queue.shift()!;
                  const distance = distances.get(current)!;
                  if (distance >= depth) continue;
                  for (const next of neighbours.get(current) ?? []) {
                    if (distances.has(next)) continue;
                    distances.set(next, distance + 1);
                    queue.push(next);
                  }
                }
                return new Set(distances.keys());
              })()
            : new Set(allowed);
          const links: { source: string; target: string }[] = [];
          for (const source of shown) {
            for (const target of neighbours.get(source) ?? []) {
              if (shown.has(target) && source.localeCompare(target) < 0) links.push({ source, target });
            }
          }
          send(response, 200, {
            nodes: [...shown].map((id) => ({
              id,
              name: graph.page(id)?.title ?? id,
              central: id === centred.id,
              distance: id === centred.id ? 0 : 1,
              trail: trailOf(id) !== null,
              degree: neighbours.get(id)?.size ?? 0,
              blockCount: graph.blocksOf(id).length,
              lines: graph.blocksOf(id).map((block) => ({
                block: block.stableId,
                content: block.content,
                gloss: graph.gloss(block.stableId)?.content ?? null,
              })),
            })),
            links,
          });
          return;
        }
        const hood = graph.neighbourhood({ centre, depth, participant });
        // El vecindario entrega títulos y aristas de páginas que nadie pidió por
        // su nombre: pedir profundidad 4 desde una página es llevarse el mapa.
        note(
          'GET /graph/:centre',
          `${centre} · profundidad ${depth}`,
          0,
          hood.nodes.map((node) => node.page),
        );
        // La forma que ya consumen renderGraph y renderGraph3D de constel.
        send(response, 200, {
          nodes: hood.nodes.map((node) => ({
            id: node.page,
            name: graph.page(node.page)?.title ?? node.page,
            central: node.distance === 0,
            distance: node.distance,
            trail: trailOf(node.page) !== null,
            degree: node.degree,
            blockCount: node.blockCount,
            lines: graph.blocksOf(node.page).map((block) => ({
              block: block.stableId,
              content: block.content,
              gloss: graph.gloss(block.stableId)?.content ?? null,
            })),
          })),
          links: [
            ...hood.edges.map((edge) => {
            const written = graph.links().find((link) =>
              link.target !== null && link.sourcePage === edge.source && link.target === edge.target,
            ) ?? graph.links().find((link) =>
              link.target !== null && link.sourcePage === edge.target && link.target === edge.source,
            );
              return {
              source: written?.sourcePage ?? edge.source,
              target: written?.target ?? edge.target,
              block: written?.sourceBlock ?? null,
              targetTitle: written?.target === null || written === undefined
                ? graph.page(edge.target)?.title ?? edge.target
                : graph.page(written.target)?.title ?? written.target,
              kind: written !== undefined && graph.gloss(written.sourceBlock) !== undefined
                ? 'gloss'
                : 'reference',
              };
            }),
            ...graph.crossings()
              .filter((crossing) =>
                crossing.toPage !== null &&
                hood.nodes.some((node) => node.page === crossing.fromPage) &&
                hood.nodes.some((node) => node.page === crossing.toPage),
              )
              .map((crossing) => ({
                source: crossing.fromPage,
                target: crossing.toPage!,
                block: crossing.blocks[0]?.stableId ?? null,
                kind: 'crossing' as const,
                crossing: crossing.stableId,
                blocks: crossing.blocks.map((block) => ({
                  stableId: block.stableId,
                  parent: block.parent,
                  position: block.position,
                  content: block.content,
                })),
                targetTitle: graph.page(crossing.toPage!)?.title ?? crossing.toPage!,
                label: crossing.term,
                explanation: crossing.blocks.map((block) => block.content).join('\n'),
              })),
          ],
        });
        return;
      }

      if (path === '/activity') {
        const folded = activityOf(graph);
        const participant = url.searchParams.get('participant');
        const person = participant === null ? null : graph.participant(participant);
        if (participant !== null && person === undefined) {
          send(response, 404, { error: `no existe el participante ${participant}` });
          return;
        }
        const before = Number(url.searchParams.get('before') ?? Number.POSITIVE_INFINITY);
        const limit = 200;
        const activity = folded.activity
          .filter((one) => one.sequence < before && (participant === null || one.participant === participant))
          .slice(0, limit);
        const more = activity.length === limit;
        send(response, 200, {
          activity,
          deletedPages: folded.deletedPages.filter(
            (one) => participant === null || one.participant === participant,
          ),
          participant: person == null ? null : { id: participant!, name: person.name, kind: person.kind },
          nextBefore: more ? activity[activity.length - 1]?.sequence ?? null : null,
        });
        return;
      }

      if (path === '/ops') {
        const since = Number(url.searchParams.get('since') ?? '0');
        send(
          response,
          200,
          graph
            .operations()
            .filter((op) => op.sequence > since)
            .map((op) => ({
              sequence: op.sequence,
              originId: op.originId,
              kind: op.submission.change.kind,
              subjectId: op.subjectId,
              /*
               * A qué página tocó.
               *
               * Sin esto, quien pregunta «¿qué ha pasado desde mi cursor?» recibe
               * identificadores de bloque sueltos y no puede contestar la única
               * pregunta que le importa —«¿tocaron lo que estoy leyendo?»— sin
               * pedir las páginas, que es justamente lo que preguntar por
               * operaciones venía a evitar. @guarantee KnowingIsCheapAndTakingIsNot.
               *
               * Nulo cuando la operación borró aquello por lo que se preguntaría:
               * de un bloque que ya no está no se puede averiguar dónde vivía, y
               * decirlo es más honesto que callar la operación entera.
               */
              page: pageTouchedBy(op.submission.change, op.subjectId, (id) => graph.block(id)?.page),
              authoredBy: op.submission.submittedBy,
              channel: op.submission.channel,
            })),
        );
        return;
      }

      /*
       * El registro de exposición, para poder mirarlo.
       *
       * Un registro que no se puede leer no vigila nada. Dos preguntas: qué se
       * ha llevado alguien —`?participant=`— y quién se ha llevado esto
       * —`?subject=`—, que es la que uno se hace al encontrar una página que no
       * debería haber salido de casa.
       *
       * Mirar el registro no se anota a sí mismo: haría crecer el registro cada
       * vez que se abre y el registro dejaría de ser sobre el corpus.
       */
      if (path === '/exposures') {
        const subject = url.searchParams.get('subject');
        const who = url.searchParams.get('participant');
        const most = Number(url.searchParams.get('most') ?? '100');
        const found =
          subject !== null
            ? whoRead(store, subject, most)
            : exposuresOf(store, {
                participant: who ?? undefined,
                since: Number(url.searchParams.get('since') ?? '0'),
                most,
              });
        send(response, 200, {
          count: found.length,
          exposures: found.map((one) => ({
            ...one,
            name: graph.participant(one.participant)?.name ?? one.participant,
          })),
        });
        return;
      }

      if (path === '/invariants') {
        send(response, 200, checkInvariants(graph));
        return;
      }

      if (path === '/p5-frame.html') {
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-length': Buffer.byteLength(p5FrameDocument),
          'cache-control': IMMUTABLE,
          'x-content-type-options': 'nosniff',
        });
        response.end(p5FrameDocument);
        return;
      }

      if (path === '/p5.min.js') {
        response.writeHead(200, {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': IMMUTABLE,
          'x-content-type-options': 'nosniff',
        });
        createReadStream(p5RuntimePath).pipe(response);
        return;
      }

      if (serveStatic(response, path, publicAccess)) return;

      // Reserva para las rutas de la aplicación. `/p/Lectogram` no es un archivo
      // y nunca lo será: es la propia aplicación pidiendo abrirse en esa página.
      // Sin esto, escribir la dirección a mano o recargar devolvía un 404, que
      // es tanto como no tener enrutado.
      if (
        webRoot !== null &&
        !path.startsWith('/api') &&
        serveStatic(response, '/index.html', publicAccess)
      ) {
        return;
      }

      send(response, 404, { error: 'not found' });
    } catch (error) {
      send(response, 400, { error: error instanceof Error ? error.message : 'bad request' });
    }
  };

  // El grafo se expone por función y no por valor: puede reconstruirse, y quien
  // lo tuviera capturado se quedaría mirando el de antes.
  return {
    handle: (request, response) => void handle(request, response, false),
    handlePublic: (request, response) => void handle(request, response, true),
    get graph() {
      return graph;
    },
    store,
    close: () => {
      clearInterval(retryLibrarianDispatches);
      store.close();
    },
  };
}

export function listen(options: ServerOptions & { port: number; host?: string }): {
  close(): Promise<void>;
  vera: VeraServer;
} {
  const vera = createVeraServer(options);
  const http = createServer((request, response) => vera.handle(request, response));
  // Loopback por defecto: Vera no autentica y `POST /operations` muta el grafo,
  // así que escuchar en todas las interfaces la deja escribible por cualquiera
  // en la red física. Quien la publique elige el frente (p. ej. tailscale serve,
  // que termina TLS y reenvía desde esta misma máquina).
  http.listen(options.port, options.host ?? '127.0.0.1');
  const preview = options.publicPreviewPort === undefined
    ? null
    : createServer((request, response) => vera.handlePublic(request, response));
  preview?.listen(options.publicPreviewPort, '127.0.0.1');
  const servers = preview === null ? [http] : [http, preview];
  return {
    vera,
    close: async () => {
      await Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((done) => {
              server.close(() => done());
            }),
        ),
      );
      vera.close();
    },
  };
}
