export interface ProcessInvocationSource {
  definition: string;
  version: number;
  input: string;
  presentation?: ProcessPresentation;
  request?: HttpJsonRequest;
  response?: ProcessResponseMapping;
}

export interface HttpJsonRequest {
  kind: 'json-http';
  connection: string;
  path: string;
  method: 'POST';
  body: unknown;
}

export interface ProcessResponseMapping {
  content: string;
  executor?: string;
  requestId?: string;
  processVersion?: string;
  schemaId?: string;
  schemaVersion?: string;
  model?: string;
}

export interface ProcessResult {
  content: string;
  durationMs: number;
  inputRevision: string;
  executor?: string;
  requestId?: string;
  processVersion?: string;
  schemaId?: string;
  schemaVersion?: string;
  model?: string;
  stages?: readonly [string, string][];
  meaning?: PictosMeaning;
  pictos?: PictosPlan;
}

export interface PictosMeaning {
  title: string;
  speechAct: 'directive' | 'statement' | 'question' | 'expression';
  concepts: { role: PictosElement['role']; label: string }[];
  explanation: string;
}

export interface PictosElement {
  role: 'agent' | 'action' | 'patient' | 'context';
  label: string;
  symbol: string;
}

export interface PictosPlan {
  title: string;
  speechAct: 'directive' | 'statement' | 'question' | 'expression';
  elements: PictosElement[];
  composition: string;
  description: string;
}

export const PICTOS_SYMBOLS = [
  'person', 'hand', 'bed', 'toothbrush', 'tooth', 'cup', 'water', 'food',
  'home', 'book', 'heart', 'arrow', 'place', 'object',
] as const;

const OPEN = '```proceso';

export interface ProcessPresentation {
  family: string;
  name: string;
  inputKind: string;
  outputKind: string;
  executor: string;
}

export function processPresentation(definition: string): ProcessPresentation {
  switch (definition) {
    case 'pictos/comprender': return { family: 'PICTOS', name: 'Comprender', inputKind: 'Texto', outputKind: 'JSON semántico', executor: 'participant:local-model' };
    case 'pictos/componer': return { family: 'PICTOS', name: 'Componer', inputKind: 'JSON semántico', outputKind: 'Árbol visual JSON', executor: 'participant:local-model' };
    case 'pictos/producir': return { family: 'PICTOS', name: 'Producir', inputKind: 'Árbol visual JSON', outputKind: 'SVG autocontenido', executor: 'vera/svg-composer' };
    case 'pictos/frase-visual': return { family: 'PICTOS', name: 'Generar frase visual', inputKind: 'Texto', outputKind: 'SVG autocontenido', executor: 'participant:local-model' };
    default: return { family: 'Vera', name: 'Estructurar texto', inputKind: 'Texto', outputKind: 'JSON', executor: 'vera/worker' };
  }
}

export function presentationOf(invocation: ProcessInvocationSource): ProcessPresentation {
  return invocation.presentation ?? processPresentation(invocation.definition);
}

export function writeProcessBlock(input: string, definition = 'vera/estructura-textual'): string {
  return `${OPEN}\ndefinición: ${definition}\nversión: 1\nentrada: ((${input}))\n\`\`\``;
}

export function writeHttpProcessBlock(
  input: string,
  source: Omit<ProcessInvocationSource, 'input'> & {
    presentation: ProcessPresentation;
    request: HttpJsonRequest;
    response: ProcessResponseMapping;
  },
): string {
  return `${OPEN}\n${JSON.stringify({
    'definición': source.definition,
    'nombre': source.presentation.name,
    'familia': source.presentation.family,
    'versión': source.version,
    'entrada': `((${input}))`,
    'tipo_entrada': source.presentation.inputKind,
    'tipo_salida': source.presentation.outputKind,
    'ejecutor': source.presentation.executor,
    'solicitud': {
      'tipo': source.request.kind,
      'conexión': source.request.connection,
      'ruta': source.request.path,
      'método': source.request.method,
      'cuerpo': source.request.body,
    },
    'respuesta': source.response,
  }, null, 2)}\n\`\`\``;
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

function readJsonProcess(lines: string[]): ProcessInvocationSource | null {
  let parsed: Record<string, unknown>;
  try { parsed = object(JSON.parse(lines.slice(1, -1).join('\n'))) ?? {}; }
  catch { return null; }
  const definition = parsed['definición'];
  const version = parsed['versión'];
  const input = /^\(\(([^)]+)\)\)$/.exec(String(parsed['entrada'] ?? ''))?.[1]?.trim() ?? '';
  const request = object(parsed['solicitud']);
  const response = object(parsed['respuesta']);
  if (
    typeof definition !== 'string' || definition.trim() === '' ||
    !Number.isInteger(version) || Number(version) < 1 || input === '' ||
    typeof parsed['nombre'] !== 'string' || typeof parsed['familia'] !== 'string' ||
    typeof parsed['tipo_entrada'] !== 'string' || typeof parsed['tipo_salida'] !== 'string' ||
    typeof parsed['ejecutor'] !== 'string' || request === null || response === null ||
    request['tipo'] !== 'json-http' || typeof request['conexión'] !== 'string' ||
    typeof request['ruta'] !== 'string' || !String(request['ruta']).startsWith('/') ||
    request['método'] !== 'POST' || request['cuerpo'] === undefined ||
    typeof response['content'] !== 'string'
  ) return null;
  const mapped: ProcessResponseMapping = { content: response['content'] };
  for (const [sourceKey, targetKey] of [
    ['executor', 'executor'], ['requestId', 'requestId'], ['processVersion', 'processVersion'],
    ['schemaId', 'schemaId'], ['schemaVersion', 'schemaVersion'], ['model', 'model'],
  ] as const) {
    const value = response[sourceKey];
    if (value !== undefined) {
      if (typeof value !== 'string') return null;
      mapped[targetKey] = value;
    }
  }
  return {
    definition: definition.trim(), version: Number(version), input,
    presentation: {
      name: parsed['nombre'], family: parsed['familia'],
      inputKind: parsed['tipo_entrada'], outputKind: parsed['tipo_salida'],
      executor: parsed['ejecutor'],
    },
    request: {
      kind: 'json-http', connection: request['conexión'], path: request['ruta'],
      method: 'POST', body: request['cuerpo'],
    },
    response: mapped,
  };
}

export function readProcessBlock(content: string): ProcessInvocationSource | null {
  const lines = content.trim().split(/\r?\n/);
  if (lines[0]?.trim().toLowerCase() !== OPEN || lines.at(-1)?.trim() !== '```') return null;
  if (lines[1]?.trim().startsWith('{')) return readJsonProcess(lines);
  const fields = new Map<string, string>();
  for (const line of lines.slice(1, -1)) {
    const split = line.indexOf(':');
    if (split < 0) continue;
    fields.set(line.slice(0, split).trim().toLowerCase(), line.slice(split + 1).trim());
  }
  const definition = fields.get('definición') ?? '';
  const version = Number(fields.get('versión'));
  const input = /^\(\(([^)]+)\)\)$/.exec(fields.get('entrada') ?? '')?.[1]?.trim() ?? '';
  if (definition === '' || !Number.isInteger(version) || version < 1 || input === '') return null;
  return { definition, version, input };
}

export function looksLikeProcess(content: string): boolean {
  return readProcessBlock(content) !== null;
}

function hexadecimal(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Ejecuta la primera definición incorporada sin darle acceso al DOM ni al grafo.
 * El Worker sólo recibe texto y sólo puede devolver datos serializables.
 */
export async function executeTextStructure(text: string, timeoutMs = 2_000): Promise<ProcessResult> {
  const started = performance.now();
  const revision = hexadecimal(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const source = `self.onmessage = ({ data }) => {
    const text = String(data);
    const lines = text.split(/\\r?\\n/).filter((line) => line.trim() !== '');
    const words = text.trim() === '' ? [] : text.trim().split(/\\s+/);
    const sentences = text.split(/(?<=[.!?])\\s+/).map((part) => part.trim()).filter(Boolean);
    self.postMessage({ source: text, structure: { lines, sentences, words }, measures: { characters: text.length, words: words.length, lines: lines.length } });
  };`;
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  const worker = new Worker(url);
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        worker.terminate();
        reject(new Error('el proceso excedió su plazo'));
      }, timeoutMs);
      worker.addEventListener('message', (event: MessageEvent<unknown>) => {
        window.clearTimeout(timer);
        resolve(event.data);
      }, { once: true });
      worker.addEventListener('error', () => {
        window.clearTimeout(timer);
        reject(new Error('el proceso no pudo ejecutarse'));
      }, { once: true });
      worker.postMessage(text);
    });
    return {
      content: `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``,
      durationMs: Math.max(0, performance.now() - started),
      inputRevision: revision,
    };
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
}

interface PictosAnswer {
  error?: string;
  content?: string;
  plan?: PictosPlan;
  meaning?: PictosMeaning;
  executor?: string;
  requestId?: string;
  processVersion?: string;
  schemaId?: string;
  schemaVersion?: string;
  model?: string;
}

async function executePictosStep(
  endpoint: 'understand' | 'arrange' | 'produce',
  text: string,
): Promise<ProcessResult> {
  const started = performance.now();
  const inputRevision = hexadecimal(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const response = await fetch(`/processes/pictos/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: text }),
  });
  const said = await response.json().catch(() => ({})) as PictosAnswer;
  if (!response.ok || typeof said.content !== 'string') {
    throw new Error(said.error ?? 'PICTOS no devolvió una salida legible');
  }
  return {
    content: said.content,
    durationMs: Math.max(0, performance.now() - started),
    inputRevision,
    executor: endpoint === 'produce' ? 'vera/svg-composer' : 'participant:local-model',
    ...(said.meaning === undefined ? {} : { meaning: said.meaning }),
    ...(said.plan === undefined ? {} : { pictos: said.plan }),
  };
}

function pictosStages(plan: PictosPlan): readonly [string, string][] {
  const roles = plan.elements
    .map((element) => `${element.role} · ${element.label} · ${element.symbol}`)
    .join('\n');
  return [
    ['2 · Comprender', `${plan.speechAct}\n${roles}`],
    ['3 · Componer', plan.composition],
    ['4 · Producir', plan.description],
  ];
}

/**
 * Pide una posibilidad y nada más: el servidor valida el plan del modelo y es
 * quien compone el SVG seguro. Regenerar llama de nuevo a esta misma frontera.
 */
export async function executePictos(text: string): Promise<ProcessResult> {
  const started = performance.now();
  const inputRevision = hexadecimal(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const response = await fetch('/processes/pictos/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: text }),
  });
  const said = await response.json().catch(() => ({})) as PictosAnswer;
  if (!response.ok || typeof said.content !== 'string' || said.plan === undefined) {
    throw new Error(said.error ?? 'PICTOS no devolvió una propuesta legible');
  }
  return {
    content: said.content,
    durationMs: Math.max(0, performance.now() - started),
    inputRevision,
    stages: pictosStages(said.plan),
    pictos: said.plan,
  };
}

/** Recompone una lectura corregida por la persona sin volver a preguntar al modelo. */
export async function composePictos(plan: PictosPlan, previous: ProcessResult): Promise<ProcessResult> {
  const response = await fetch('/processes/pictos/compose', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plan }),
  });
  const said = await response.json().catch(() => ({})) as PictosAnswer;
  if (!response.ok || typeof said.content !== 'string' || said.plan === undefined) {
    throw new Error(said.error ?? 'PICTOS no pudo recomponer el ajuste');
  }
  return {
    ...previous,
    content: said.content,
    stages: pictosStages(said.plan),
    pictos: said.plan,
  };
}

export function executeProcess(invocation: ProcessInvocationSource, text: string): Promise<ProcessResult> {
  if (invocation.request !== undefined && invocation.response !== undefined) {
    return executeHttpJsonProcess(invocation.request, invocation.response, text);
  }
  if (invocation.definition === 'pictos/comprender') return executePictosStep('understand', text);
  if (invocation.definition === 'pictos/componer') return executePictosStep('arrange', text);
  if (invocation.definition === 'pictos/producir') return executePictosStep('produce', text);
  if (invocation.definition === 'pictos/frase-visual') return executePictos(text);
  if (invocation.definition === 'vera/estructura-textual') return executeTextStructure(text);
  return Promise.reject(new Error(`proceso no registrado: ${invocation.definition}`));
}

function inputJson(text: string): unknown {
  const raw = /^```json\s*\n([\s\S]*?)\n```/m.exec(text)?.[1] ?? text;
  try { return JSON.parse(raw); }
  catch { throw new Error('la solicitud necesita una entrada JSON válida'); }
}

function fillInputTemplate(value: unknown, text: string): unknown {
  if (value === '$entrada.texto') return text;
  if (value === '$entrada.json') return inputJson(text);
  if (Array.isArray(value)) return value.map((item) => fillInputTemplate(item, text));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fillInputTemplate(item, text)]));
  }
  return value;
}

function valueAt(value: unknown, path: string): unknown {
  if (path === '$') return value;
  if (!path.startsWith('$.')) return undefined;
  let current = value;
  for (const part of path.slice(2).split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

const contentFrom = (value: unknown): string => typeof value === 'string'
  ? value
  : `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;

async function executeHttpJsonProcess(
  request: HttpJsonRequest,
  mapping: ProcessResponseMapping,
  text: string,
): Promise<ProcessResult> {
  const started = performance.now();
  const inputRevision = hexadecimal(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const response = await fetch('/processes/http-json', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      connection: request.connection,
      path: request.path,
      method: request.method,
      body: fillInputTemplate(request.body, text),
    }),
  });
  const said = await response.json().catch(() => ({})) as { error?: string; response?: unknown };
  if (!response.ok || said.response === undefined) {
    throw new Error(said.error ?? 'el proceso remoto no devolvió una respuesta legible');
  }
  const content = valueAt(said.response, mapping.content);
  if (content === undefined) throw new Error(`la respuesta no contiene ${mapping.content}`);
  const result: ProcessResult = {
    content: contentFrom(content),
    durationMs: Math.max(0, performance.now() - started),
    inputRevision,
  };
  for (const [field, path] of Object.entries(mapping)) {
    if (field === 'content' || path === undefined) continue;
    const value = valueAt(said.response, path);
    if (typeof value === 'string') (result as unknown as Record<string, unknown>)[field] = value;
  }
  return result;
}
