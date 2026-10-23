// Cómo el adaptador MCP habla con VERA: por la API, como cualquiera.
//
// No abre la base de datos. Podría —está en el mismo disco— y sería más rápido,
// y sería el error. @invariant MCPIsADoorAndNotASecondMemory: todo lo que MCP
// contesta sale de la API, que es donde viven la autoría, la autorización y el
// registro de exposición. Un adaptador que leyera SQLite directamente sería una
// segunda puerta con sus propias reglas, y las reglas de una memoria no pueden
// depender de por dónde se entró.
//
// De ahí sale también lo que este archivo no tiene: caché. Lo que MCP entrega es
// lo que el corpus dice ahora, no lo que decía cuando el proceso arrancó.
//
// Ver specs/mcp-server.allium.

/** Dónde está Vera y con qué credencial se le habla. */
export interface Connection {
  /** La dirección de la API. Por omisión, la de casa. */
  url: string;
  /**
   * El secreto de la credencial, si hay.
   *
   * Nunca sale de argv: los argumentos de un proceso los lee cualquiera con un
   * `ps`, y una credencial que se puede leer con `ps` es una credencial de
   * todos. Viene del entorno o de un archivo, y de ahí no se mueve.
   */
  token: string | null;
  /**
   * Cómo se llama quien está conectado.
   *
   * Se declara y no se cree: Vera lo anota en el registro de exposición como lo
   * que es, algo que el cliente dijo de sí mismo.
   */
  client: string;
}

export interface Failure {
  error: string;
  status: number;
}

const ok = <T>(value: T): T | Failure => value;

/**
 * Una petición de lectura a Vera.
 */
export async function ask<T>(
  connection: Connection,
  path: string,
  parameters: Record<string, string | number | undefined> = {},
): Promise<T | Failure> {
  const url = new URL(path, connection.url);
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    // Lo que el registro de exposición anotará como cliente declarado.
    'x-vera-client': connection.client,
  };
  if (connection.token !== null) headers.authorization = `Bearer ${connection.token}`;

  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (trouble) {
    /*
     * Vera apagada no es un error del modelo, y decírselo así lo manda a
     * reintentar o a inventarse la respuesta. Se le dice qué pasó y dónde.
     */
    return {
      status: 0,
      error:
        `no hay nadie escuchando en ${connection.url}. Vera no está corriendo, ` +
        `o corre en otro puerto (${String(trouble)})`,
    };
  }

  if (!response.ok) {
    const said = await response.text().catch(() => '');
    return { status: response.status, error: said === '' ? response.statusText : said };
  }
  return ok((await response.json()) as T);
}

/** Ejecuta el lenguaje estructurado sin poner la pregunta sensible en la URL. */
export async function query<T>(
  connection: Connection,
  input: { source: string; cursor: number; limit: number },
): Promise<T | Failure> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-vera-client': connection.client,
  };
  if (connection.token !== null) headers.authorization = `Bearer ${connection.token}`;
  let response: Response;
  try {
    response = await fetch(new URL('/query', connection.url), {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    });
  } catch (trouble) {
    return { status: 0, error: `no hay nadie escuchando en ${connection.url} (${String(trouble)})` };
  }
  const body = await response.json().catch(async () => ({ error: await response.text().catch(() => '') }));
  if (!response.ok) {
    const said = body as { error?: unknown };
    return { status: response.status, error: String(said.error ?? response.statusText) };
  }
  return body as T;
}

export interface WriteResult {
  status: 'applied' | 'duplicate';
  sequence: number;
  subjectId: string;
}

export interface BatchWriteResult {
  status: 'applied' | 'duplicate';
  operations: { sequence: number; subjectId: string }[];
}

export interface ProposalResult {
  status: 'awaiting_review' | 'duplicate';
  proposal: string;
  page: string;
  block: string;
}

/**
 * Escribe por la única puerta canónica. La identidad y el canal no viajan en el
 * cuerpo: Vera los deriva de la credencial.
 */
export async function submit(
  connection: Connection,
  originId: string,
  change: Record<string, unknown>,
  ifRevision?: string,
  ownOnly?: boolean,
): Promise<WriteResult | Failure> {
  if (connection.token === null) {
    return { status: 403, error: 'MCP sólo escribe con una credencial explícita de agente' };
  }
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-vera-client': connection.client,
  };
  headers.authorization = `Bearer ${connection.token}`;

  let response: Response;
  try {
    response = await fetch(new URL('/operations', connection.url), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        originId,
        change,
        ...(ifRevision === undefined ? {} : { ifRevision }),
        ...(ownOnly === undefined ? {} : { ownOnly }),
      }),
    });
  } catch (trouble) {
    return { status: 0, error: `no hay nadie escuchando en ${connection.url} (${String(trouble)})` };
  }

  const body = await response.json().catch(async () => ({ error: await response.text().catch(() => '') }));
  if (!response.ok) {
    const said = body as { error?: unknown; reason?: unknown };
    return {
      status: response.status,
      error: String(said.reason ?? said.error ?? response.statusText),
    };
  }
  return body as WriteResult;
}

/** Deja una corrección ajena en la cola humana; no escribe el corpus. */
export async function propose(
  connection: Connection,
  input: { originId: string; block: string; revision: string; content: string; purpose: string },
): Promise<ProposalResult | Failure> {
  if (connection.token === null) {
    return { status: 403, error: 'MCP sólo propone con una credencial explícita de agente' };
  }
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-vera-client': connection.client,
    authorization: `Bearer ${connection.token}`,
  };
  let response: Response;
  try {
    response = await fetch(new URL('/operation-proposals', connection.url), {
      method: 'POST', headers, body: JSON.stringify(input),
    });
  } catch (trouble) {
    return { status: 0, error: `no hay nadie escuchando en ${connection.url} (${String(trouble)})` };
  }
  const body = await response.json().catch(async () => ({ error: await response.text().catch(() => '') }));
  if (!response.ok) {
    const said = body as { error?: unknown };
    return { status: response.status, error: String(said.error ?? response.statusText) };
  }
  return body as ProposalResult;
}

/** Envía muchos cambios en una sola transacción canónica. */
export async function submitBatch(
  connection: Connection,
  originId: string,
  changes: readonly Record<string, unknown>[],
): Promise<BatchWriteResult | Failure> {
  if (connection.token === null) {
    return { status: 403, error: 'MCP sólo escribe con una credencial explícita de agente' };
  }
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-vera-client': connection.client,
    authorization: `Bearer ${connection.token}`,
  };
  let response: Response;
  try {
    response = await fetch(new URL('/operations/batch', connection.url), {
      method: 'POST',
      headers,
      body: JSON.stringify({ originId, changes }),
    });
  } catch (trouble) {
    return { status: 0, error: `no hay nadie escuchando en ${connection.url} (${String(trouble)})` };
  }
  const body = await response.json().catch(async () => ({ error: await response.text().catch(() => '') }));
  if (!response.ok) {
    const said = body as { error?: unknown; reason?: unknown };
    return { status: response.status, error: String(said.reason ?? said.error ?? response.statusText) };
  }
  return body as BatchWriteResult;
}

export const failed = (value: unknown): value is Failure =>
  typeof value === 'object' && value !== null && 'error' in value && 'status' in value;

/** Lo que Vera contesta sobre sí misma al arrancar. */
export interface Health {
  graph: string;
  pages: number;
  blocks: number;
  lastSequence: number;
}

/** Quién dice Vera que es quien llama. La primera pregunta de una conexión. */
export interface WhoAmI {
  participant: string;
  kind: string | null;
  scopes: readonly string[] | null;
  label?: string;
}

export interface Hit {
  page: string;
  block: string | null;
  field: string;
  excerpt: string;
  rank: number;
}

export interface PageBlock {
  stableId: string;
  parent: string | null;
  position: number;
  content: string;
  depth?: number;
  revision?: string | null;
}

export interface PageWindow {
  root: string | null;
  cursor: number;
  limit: number;
  total: number;
  nextCursor: number | null;
}

export interface Page {
  id: string;
  title: string;
  visibility: string;
  createdAt: number;
  lastEditedAt: number | null;
  properties: { key: string; value: string }[];
  blocks: PageBlock[];
  backlinks: { page: string; block: string | null; title: string; excerpt: string }[];
  references: { page: string | null; title: string; block: string; excerpt: string }[];
  authorship: Record<string, { participant?: string; kind: string | null; channel?: string }>;
  window?: PageWindow;
}

/**
 * Lee la conexión del entorno.
 *
 * `VERA_TOKEN_FILE` antes que `VERA_TOKEN`: un archivo con permisos se copia
 * peor que una variable de entorno, que se hereda a todo lo que el proceso
 * lance. Las dos formas existen porque no todos los clientes MCP saben pasar
 * archivos, y la peor de las dos sigue siendo mejor que argv.
 */
export function connectionFrom(
  env: Record<string, string | undefined>,
  readFile: (path: string) => string,
  decryptCredential: (file: string, name: string) => string = () => '',
): Connection {
  const encrypted = env.VERA_SYSTEMD_CREDENTIAL_FILE;
  const encryptedName = env.VERA_SYSTEMD_CREDENTIAL_NAME;
  const file = env.VERA_TOKEN_FILE;
  let token: string | null = null;
  if (
    encrypted !== undefined &&
    encrypted !== '' &&
    encryptedName !== undefined &&
    encryptedName !== ''
  ) {
    try {
      token = decryptCredential(encrypted, encryptedName).trim();
    } catch (cause) {
      throw new Error(`no se pudo abrir la credencial cifrada «${encryptedName}»`, { cause });
    }
    if (token === '') throw new Error(`la credencial cifrada «${encryptedName}» está vacía`);
  }
  if ((token === null || token === '') && file !== undefined && file !== '') {
    try {
      token = readFile(file).trim();
    } catch {
      token = null;
    }
  }
  if (token === null || token === '') token = env.VERA_TOKEN?.trim() ?? null;
  if (token === '') token = null;
  return {
    url: env.VERA_URL ?? 'http://127.0.0.1:4173',
    token,
    client: env.VERA_CLIENT ?? 'vera-mcp',
  };
}
