import { randomUUID } from 'node:crypto';

import type { Store } from '@vera/store';
import { activeManifest } from './agent-manifests.ts';
import { librarianRequest, type LibrarianRequest } from './librarian.ts';

export const LIBRARIAN_RUNTIME_ID = 'vera:embedded-librarian';
export const LIBRARIAN_RUNTIME_LABEL = 'Vera · bibliotecaria embebida';

export type LibrarianRuntimePermission = 'read_request_context' | 'reply' | 'daily_round';
export type LibrarianRuntimeStatus = 'unconstituted' | 'stopped' | 'ready' | 'degraded' | 'working';
export type FormativePractice = 'reading' | 'selection' | 'interpretation' | 'comparison' | 'synthesis' | 'conclusion';
export type LibrarianDialecticGateStatus = 'open' | 'responding' | 'fulfilled' | 'bypassed';

const PERMISSIONS = new Set<LibrarianRuntimePermission>([
  'read_request_context', 'reply', 'daily_round',
]);

export interface LibrarianRuntimeConfiguration {
  instance: string;
  librarian: string;
  agent: string;
  enabled: boolean;
  model: string | null;
  endpoint: string | null;
  secretReference: string | null;
  permissions: LibrarianRuntimePermission[];
  dialectic: { enabled: boolean };
  routine: { enabled: boolean; hour: number; timezone: string };
  updatedBy: string;
  updatedAt: number;
}

export interface LibrarianDialecticGate {
  id: string;
  conversation: string;
  openingRequest: string;
  practice: FormativePractice;
  challenge: string;
  status: LibrarianDialecticGateStatus;
  closingRequest: string | null;
  closingMode: 'contribution' | 'bypass' | null;
  openedAt: number;
  closedAt: number | null;
}

export type LibrarianDialecticDecision =
  | { mode: 'answer'; text: string }
  | { mode: 'challenge'; practice: FormativePractice; text: string };

const FORMATIVE_PRACTICES = new Set<FormativePractice>([
  'reading', 'selection', 'interpretation', 'comparison', 'synthesis', 'conclusion',
]);

const folded = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Reconoce el borde deliberadamente estrecho de la dialéctica v1.
 *
 * El modelo compone el desafío; no decide si puede saltarse el umbral. Las
 * primeras posiciones explícitas cuentan como contribución y siguen fluidas.
 */
export function formativePracticeFor(text: string): FormativePractice | null {
  const said = folded(text);
  if (/\b(mi lectura|mi interpretacion|mi conclusion|creo que|pienso que|para mi|yo veo|propongo que)\b/.test(said)) {
    return null;
  }
  const patterns: ReadonlyArray<readonly [FormativePractice, RegExp]> = [
    ['synthesis', /\b(sintetiza|sintesis|resume|resumen)\b/],
    ['selection', /\b(elige|selecciona|escoge|pasajes? (?:mas )?(?:importantes|decisivos|centrales))\b/],
    ['interpretation', /\b(interpreta|interpretacion|que significa|explica el sentido)\b/],
    ['comparison', /\b(compara|comparacion|contrasta|contraste)\b/],
    ['conclusion', /\b(concluye|conclusion|saca conclusiones)\b/],
    ['reading', /\b(lee|lectura critica|haz una lectura)\b/],
  ];
  return patterns.find(([, pattern]) => pattern.test(said))?.[0] ?? null;
}

export function formativeChallenge(practice: FormativePractice): string {
  const challenges: Record<FormativePractice, string> = {
    reading: 'Antes, señala un pasaje que te parezca decisivo y formula una duda concreta. Luego leeré contigo.',
    selection: 'Antes, elige tú dos pasajes decisivos y explica brevemente por qué. Después contrastaré tu selección.',
    interpretation: 'Antes, escribe una interpretación provisional en una frase, aunque todavía dudes. Luego la pondré a prueba con el corpus.',
    comparison: 'Antes, nombra una semejanza y una diferencia que ya veas. Después las contrastaré y ampliaré.',
    synthesis: 'Antes, dime cuáles son para ti las tres ideas centrales, aunque todavía dudes. Luego contrastaré tu lectura y compondré la síntesis contigo.',
    conclusion: 'Antes, formula una conclusión provisional en una frase. Después la contrastaré y ayudaré a precisarla.',
  };
  return challenges[practice];
}

export interface LibrarianRuntimeRun {
  id: string;
  kind: 'request' | 'routine';
  request: string | null;
  model: string;
  manifest: string | null;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  finishedAt: number | null;
  output: string | null;
  error: string | null;
}

interface BindingRow {
  instance_id: string;
  librarian_id: string;
  agent_id: string;
}

function activeBinding(store: Store): BindingRow | null {
  return store.db.prepare(`SELECT i.id AS instance_id,l.id AS librarian_id,l.agent_id
    FROM instances i JOIN owner_librarians l ON l.instance_id=i.id AND l.status='active'
    WHERE i.graph_id=?`).get(store.graphId) as BindingRow | undefined ?? null;
}

function parsePermissions(value: string): LibrarianRuntimePermission[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((one): one is LibrarianRuntimePermission => typeof one === 'string' &&
          PERMISSIONS.has(one as LibrarianRuntimePermission))
      : [];
  } catch {
    return [];
  }
}

export function librarianRuntimeConfiguration(store: Store): LibrarianRuntimeConfiguration | null {
  const binding = activeBinding(store);
  if (binding === null) return null;
  const row = store.db.prepare(`SELECT enabled,model_id,endpoint,secret_reference,permissions_json,
      dialectic_enabled,routine_enabled,routine_hour,routine_timezone,updated_by,updated_at
    FROM librarian_runtime_configs WHERE instance_id=?`).get(binding.instance_id) as {
      enabled: number; model_id: string | null; endpoint: string | null; secret_reference: string | null;
      permissions_json: string; dialectic_enabled: number; routine_enabled: number; routine_hour: number; routine_timezone: string;
      updated_by: string; updated_at: number;
    } | undefined;
  if (row === undefined) return null;
  return {
    instance: binding.instance_id,
    librarian: binding.librarian_id,
    agent: binding.agent_id,
    enabled: row.enabled === 1,
    model: row.model_id,
    endpoint: row.endpoint,
    secretReference: row.secret_reference,
    permissions: parsePermissions(row.permissions_json),
    dialectic: { enabled: row.dialectic_enabled === 1 },
    routine: { enabled: row.routine_enabled === 1, hour: row.routine_hour, timezone: row.routine_timezone },
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

export function saveLibrarianRuntimeConfiguration(store: Store, input: {
  updatedBy: string;
  enabled: boolean;
  model: string | null;
  endpoint: string | null;
  secretReference: string | null;
  permissions: LibrarianRuntimePermission[];
  dialectic: { enabled: boolean };
  routine: { enabled: boolean; hour: number; timezone: string };
}): LibrarianRuntimeConfiguration {
  const binding = activeBinding(store);
  if (binding === null) throw new Error('esta Vera todavía no tiene bibliotecaria constituida');
  const instance = store.db.prepare('SELECT owner_id FROM instances WHERE id=?').get(binding.instance_id) as
    { owner_id: string } | undefined;
  if (instance?.owner_id !== input.updatedBy) throw new Error('sólo la persona dueña gobierna este runtime');
  const model = input.model?.trim() || null;
  if (input.enabled && model === null) throw new Error('elige un modelo antes de iniciar el runtime');
  const endpoint = input.endpoint?.trim() || null;
  if (endpoint !== null) {
    let parsed: URL;
    try { parsed = new URL(endpoint); }
    catch { throw new Error('el endpoint de inferencia no es una URL válida'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('el endpoint debe usar HTTP o HTTPS');
  }
  const secretReference = input.secretReference?.trim() || null;
  if (secretReference !== null && !/^[A-Z][A-Z0-9_]{2,63}$/.test(secretReference)) {
    throw new Error('la referencia del secreto debe ser el nombre de una variable segura');
  }
  if (!Number.isInteger(input.routine.hour) || input.routine.hour < 0 || input.routine.hour > 23) {
    throw new Error('la hora de la ronda debe estar entre 0 y 23');
  }
  const permissions = [...new Set(input.permissions)].filter((one) => PERMISSIONS.has(one));
  if (input.enabled && (!permissions.includes('read_request_context') || !permissions.includes('reply'))) {
    throw new Error('un runtime activo necesita leer el contexto solicitado y responder');
  }
  if (input.routine.enabled && !permissions.includes('daily_round')) {
    throw new Error('activar la ronda exige el permiso daily_round');
  }
  const now = Date.now();
  store.db.prepare(`INSERT INTO librarian_runtime_configs
    (instance_id,librarian_id,agent_id,enabled,model_id,endpoint,secret_reference,permissions_json,
      dialectic_enabled,routine_enabled,routine_hour,routine_timezone,updated_by,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(instance_id) DO UPDATE SET librarian_id=excluded.librarian_id,agent_id=excluded.agent_id,
      enabled=excluded.enabled,model_id=excluded.model_id,endpoint=excluded.endpoint,
      secret_reference=excluded.secret_reference,permissions_json=excluded.permissions_json,
      dialectic_enabled=excluded.dialectic_enabled,
      routine_enabled=excluded.routine_enabled,routine_hour=excluded.routine_hour,
      routine_timezone=excluded.routine_timezone,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).run(
        binding.instance_id, binding.librarian_id, binding.agent_id, input.enabled ? 1 : 0, model,
        endpoint, secretReference, JSON.stringify(permissions), input.dialectic.enabled ? 1 : 0, input.routine.enabled ? 1 : 0,
        input.routine.hour, input.routine.timezone.trim() || 'local', input.updatedBy, now,
      );
  return librarianRuntimeConfiguration(store)!;
}

interface DialecticGateRow {
  id: string;
  conversation_id: string;
  opening_request_id: string;
  practice: FormativePractice;
  challenge: string;
  status: LibrarianDialecticGateStatus;
  closing_request_id: string | null;
  closing_mode: 'contribution' | 'bypass' | null;
  opened_at: number;
  closed_at: number | null;
}

const dialecticGate = (row: DialecticGateRow): LibrarianDialecticGate => ({
  id: row.id,
  conversation: row.conversation_id,
  openingRequest: row.opening_request_id,
  practice: row.practice,
  challenge: row.challenge,
  status: row.status,
  closingRequest: row.closing_request_id,
  closingMode: row.closing_mode,
  openedAt: row.opened_at,
  closedAt: row.closed_at,
});

export function activeDialecticGate(store: Store, conversation: string): LibrarianDialecticGate | null {
  const binding = activeBinding(store);
  if (binding === null) return null;
  const row = store.db.prepare(`SELECT id,conversation_id,opening_request_id,practice,challenge,status,
      closing_request_id,closing_mode,opened_at,closed_at FROM librarian_dialectic_gates
    WHERE instance_id=? AND conversation_id=? AND status IN ('open','responding')`).get(
      binding.instance_id, conversation,
    ) as DialecticGateRow | undefined;
  return row === undefined ? null : dialecticGate(row);
}

export function dialecticGateForRequest(store: Store, request: string): LibrarianDialecticGate | null {
  const row = store.db.prepare(`SELECT id,conversation_id,opening_request_id,practice,challenge,status,
      closing_request_id,closing_mode,opened_at,closed_at FROM librarian_dialectic_gates
    WHERE opening_request_id=? OR closing_request_id=? ORDER BY opened_at DESC LIMIT 1`).get(
      request, request,
    ) as DialecticGateRow | undefined;
  return row === undefined ? null : dialecticGate(row);
}

export function openDialecticGate(store: Store, input: {
  conversation: string;
  openingRequest: string;
  practice: FormativePractice;
  challenge: string;
}): LibrarianDialecticGate {
  const binding = activeBinding(store);
  if (binding === null) throw new Error('esta Vera todavía no tiene bibliotecaria constituida');
  if (!FORMATIVE_PRACTICES.has(input.practice)) throw new Error('la práctica formativa no es reconocible');
  const challenge = input.challenge.trim();
  if (challenge === '') throw new Error('el umbral formativo necesita un desafío explícito');
  const id = `librarian-dialectic-gate:${randomUUID()}`;
  store.db.prepare(`INSERT INTO librarian_dialectic_gates
    (id,instance_id,conversation_id,opening_request_id,practice,challenge,status,opened_at)
    VALUES (?,?,?,?,?,?,'open',?)`).run(
      id, binding.instance_id, input.conversation, input.openingRequest, input.practice, challenge, Date.now(),
    );
  return dialecticGateForRequest(store, input.openingRequest)!;
}

export function reserveDialecticGate(store: Store, input: {
  conversation: string;
  request: string;
  bypass: boolean;
}): LibrarianDialecticGate | null {
  const gate = activeDialecticGate(store, input.conversation);
  if (gate === null) {
    if (input.bypass) throw new Error('no hay un umbral formativo que franquear');
    return null;
  }
  if (gate.status !== 'open') throw new Error('la bibliotecaria ya está respondiendo al umbral formativo');
  const mode = input.bypass ? 'bypass' : 'contribution';
  store.db.prepare(`UPDATE librarian_dialectic_gates SET status='responding',closing_request_id=?,closing_mode=?
    WHERE id=? AND status='open'`).run(input.request, mode, gate.id);
  return dialecticGateForRequest(store, input.request);
}

export function completeDialecticGate(store: Store, request: string): LibrarianDialecticGate | null {
  const gate = dialecticGateForRequest(store, request);
  if (gate === null || gate.closingRequest !== request || gate.status !== 'responding') return gate;
  const status = gate.closingMode === 'bypass' ? 'bypassed' : 'fulfilled';
  store.db.prepare(`UPDATE librarian_dialectic_gates SET status=?,closed_at=? WHERE id=? AND status='responding'`)
    .run(status, Date.now(), gate.id);
  return dialecticGateForRequest(store, request);
}

export function reopenDialecticGate(store: Store, request: string): LibrarianDialecticGate | null {
  const gate = dialecticGateForRequest(store, request);
  if (gate === null || gate.closingRequest !== request || gate.status !== 'responding') return gate;
  store.db.prepare(`UPDATE librarian_dialectic_gates SET status='open',closing_request_id=NULL,closing_mode=NULL
    WHERE id=? AND status='responding'`).run(gate.id);
  return dialecticGateForRequest(store, gate.openingRequest);
}

/** Retira un umbral que nunca alcanzó a quedar visible como respuesta. */
export function abandonDialecticGate(store: Store, request: string): boolean {
  const removed = store.db.prepare(`DELETE FROM librarian_dialectic_gates
    WHERE opening_request_id=? AND status='open' AND closing_request_id IS NULL`).run(request);
  return removed.changes === 1;
}

function jsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function readDialecticDecision(text: string): LibrarianDialecticDecision {
  const parsed = jsonObject(text);
  if (parsed?.['dialectic'] === 'challenge' && typeof parsed['practice'] === 'string' &&
    FORMATIVE_PRACTICES.has(parsed['practice'] as FormativePractice) && typeof parsed['text'] === 'string' &&
    parsed['text'].trim() !== '') {
    return { mode: 'challenge', practice: parsed['practice'] as FormativePractice, text: parsed['text'].trim() };
  }
  if (parsed?.['dialectic'] === 'answer' && typeof parsed['text'] === 'string' && parsed['text'].trim() !== '') {
    return { mode: 'answer', text: parsed['text'].trim() };
  }
  return { mode: 'answer', text: text.trim() };
}

export function librarianRuntimeRuns(store: Store, limit = 20): LibrarianRuntimeRun[] {
  const binding = activeBinding(store);
  if (binding === null) return [];
  const rows = store.db.prepare(`SELECT id,kind,request_id,model_id,manifest_id,status,started_at,
      finished_at,output,error FROM librarian_runtime_runs WHERE instance_id=?
    ORDER BY started_at DESC,id DESC LIMIT ?`).all(binding.instance_id, Math.max(1, Math.min(100, limit))) as Array<{
      id: string; kind: 'request' | 'routine'; request_id: string | null; model_id: string;
      manifest_id: string | null; status: 'running' | 'completed' | 'failed'; started_at: number;
      finished_at: number | null; output: string | null; error: string | null;
    }>;
  return rows.map((row) => ({
    id: row.id, kind: row.kind, request: row.request_id, model: row.model_id, manifest: row.manifest_id,
    status: row.status, startedAt: row.started_at, finishedAt: row.finished_at,
    output: row.output, error: row.error,
  }));
}

export function beginLibrarianRuntimeRun(store: Store, input: {
  kind: 'request' | 'routine';
  request?: string;
  model: string;
}): LibrarianRuntimeRun {
  const binding = activeBinding(store);
  if (binding === null) throw new Error('esta Vera todavía no tiene bibliotecaria constituida');
  const manifest = activeManifest(store, binding.agent_id)?.summary.id ?? null;
  const id = `librarian-runtime-run:${randomUUID()}`;
  const startedAt = Date.now();
  store.db.prepare(`INSERT INTO librarian_runtime_runs
    (id,instance_id,agent_id,kind,request_id,manifest_id,model_id,status,started_at)
    VALUES (?,?,?,?,?,?,?,'running',?)`).run(
      id, binding.instance_id, binding.agent_id, input.kind, input.request ?? null, manifest, input.model, startedAt,
    );
  return { id, kind: input.kind, request: input.request ?? null, model: input.model, manifest,
    status: 'running', startedAt, finishedAt: null, output: null, error: null };
}

export function finishLibrarianRuntimeRun(store: Store, id: string, outcome: {
  output?: string;
  error?: string;
}): LibrarianRuntimeRun {
  const status = outcome.error === undefined ? 'completed' : 'failed';
  store.db.prepare(`UPDATE librarian_runtime_runs SET status=?,finished_at=?,output=?,error=?
    WHERE id=? AND status='running'`).run(
      status, Date.now(), outcome.output ?? null, outcome.error?.slice(0, 2_000) ?? null, id,
    );
  const found = librarianRuntimeRuns(store, 100).find((run) => run.id === id);
  if (found === undefined) throw new Error('la ejecución del runtime no existe');
  return found;
}

function manifestPrompt(store: Store, agent: string): string {
  const manifest = activeManifest(store, agent);
  if (manifest === null) return 'No hay manifiesto constitutivo activo. Declara esta carencia y actúa sólo como bibliotecaria operativa.';
  return `Manifiesto constitutivo activo (digest ${manifest.summary.digest}):\n${JSON.stringify(manifest.document)}`;
}

export function librarianRequestPrompt(store: Store, config: LibrarianRuntimeConfiguration,
  request: LibrarianRequest, gate: LibrarianDialecticGate | null = null): string {
  const opening = gate === null ? null : librarianRequest(store, gate.openingRequest);
  const requiredPractice = gate === null && config.dialectic.enabled ? formativePracticeFor(request.text) : null;
  const dialectic = gate === null
    ? (config.dialectic.enabled ? [
        'Dialéctica bibliotecaria activa.',
        ...(requiredPractice === null ? [] : [
          `El harness reconoce esta petición como delegación formativa de ${requiredPractice}. Debes abrir el umbral; no entregues la respuesta final.`,
        ]),
        'Si la petición delega como práctica central leer, seleccionar, interpretar, comparar, sintetizar o concluir, y la persona todavía no aporta una primera posición, no entregues el trabajo final.',
        'En ese caso devuelve exclusivamente JSON válido: {"dialectic":"challenge","practice":"reading|selection|interpretation|comparison|synthesis|conclusion","text":"un desafío breve, proporcionado y realizable"}.',
        'El desafío pide una tentativa concreta y explica sobriamente qué gesto conserva; no adelanta la síntesis, selección, interpretación ni conclusión.',
        'Las búsquedas, recuperaciones, transcripciones, ordenamientos, formatos y ejecuciones de una decisión ya tomada son operativas: respóndelas directamente.',
        'Para una respuesta directa puedes devolver Markdown ordinario o JSON válido: {"dialectic":"answer","text":"respuesta final"}.',
      ].join('\n') : 'Dialéctica bibliotecaria desactivada: responde directamente.')
    : [
        `Umbral formativo abierto para ${gate.practice}.`,
        `Petición original: ${opening?.text ?? '(no disponible)'}`,
        `Desafío de la bibliotecaria: ${gate.challenge}`,
        gate.closingMode === 'bypass'
          ? 'La persona franqueó explícitamente el umbral. Responde ahora de forma directa, sin reproche ni nuevo desafío.'
          : `La persona ya aportó su tentativa en este turno: ${request.text}`,
        'Entrega ahora la respuesta final: contrasta la tentativa cuando exista, usa el corpus y no abras otro umbral en este turno.',
        'Devuelve Markdown ordinario o JSON válido: {"dialectic":"answer","text":"respuesta final"}.',
      ].join('\n');
  return [
    'Eres la bibliotecaria de esta biblioteca Vera. Responde en español claro, breve y afirmativo.',
    'Tu principal es una persona. No inventes acciones ni herramientas. No reveles razonamiento privado.',
    'El contexto siguiente fue congelado cuando la persona hizo la solicitud; distingue hechos, inferencias y dudas.',
    manifestPrompt(store, config.agent),
    dialectic,
    `Solicitud: ${request.text}`,
    `Contexto solicitado: ${request.contextSnapshot}`,
    'Devuelve sólo la respuesta que leerá la persona, en Markdown.',
  ].join('\n\n');
}
