import { randomUUID } from 'node:crypto';

import type { Store } from '@vera/store';
import type { ContributionLineage } from '@vera/core';
import { activeManifest, type AgentManifestDocument } from './agent-manifests.ts';
import { librarianRequest, librarianRequestsInConversation, type LibrarianRequest } from './librarian.ts';
import { activeOwnerLibrarian } from './owner-librarian.ts';

export const LIBRARIAN_RUNTIME_ID = 'vera:embedded-librarian';
export const LIBRARIAN_RUNTIME_LABEL = 'Vera · agente de biblioteca embebido';

export type LibrarianRuntimePermission = 'read_request_context' | 'reply' | 'daily_round';
export type LibrarianExecutionAdapter = 'embedded_model' | 'external_agent';
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
  adapter: LibrarianExecutionAdapter;
  externalAgent: string | null;
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

export type LibrarianRequestDisposition =
  | { mode: 'answer'; reason: 'ordinary' | 'determined' | 'mixed' | 'contribution' | 'explicit_direct' }
  | { mode: 'challenge'; practice: FormativePractice };

const FORMATIVE_PRACTICES = new Set<FormativePractice>([
  'reading', 'selection', 'interpretation', 'comparison', 'synthesis', 'conclusion',
]);

const folded = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const insignificantTerms = new Set(['como', 'para', 'este', 'esta', 'esto', 'texto', 'pagina', 'puede', 'podemos', 'problema']);
const significantTerms = (text: string): string[] => [...new Set((folded(text)
  .match(/[\p{L}\p{N}\[\]-]{2,}/gu) ?? []).filter((term) => !insignificantTerms.has(term)))];

const formativePracticeMentioned = (said: string): FormativePractice | null => {
  const patterns: ReadonlyArray<readonly [FormativePractice, RegExp]> = [
    ['synthesis', /\b(sintetiza|sintesis|resume|resumen)\b/],
    ['selection', /\b(elige|selecciona|escoge|pasajes? (?:mas )?(?:importantes|decisivos|centrales))\b/],
    ['interpretation', /\b(interpreta|interpretacion|que significa|explica el sentido)\b/],
    ['comparison', /\b(compara|comparacion|contrasta|contraste)\b/],
    ['conclusion', /\b(concluye|conclusion|saca conclusiones)\b/],
    ['reading', /\b(lee|lectura critica|haz una lectura)\b/],
  ];
  return patterns.find(([, pattern]) => pattern.test(said))?.[0] ?? null;
};

/**
 * Decide si la mayéutica aporta formación o sólo interpone un peaje.
 *
 * Buscar, verificar, citar, transcribir, enlazar y completar una referencia
 * son trabajo bibliotecario determinado. Una pista, fuente, hipótesis o
 * criterio ya expresado cuenta como contribución. En ambos casos Lucienne
 * sirve directamente; sólo una delegación de juicio todavía vacía abre el
 * umbral.
 */
export function librarianRequestDispositionFor(text: string): LibrarianRequestDisposition {
  const said = folded(text);
  const practice = formativePracticeMentioned(said);
  const explicitDirect = /\b(directamente|sin preguntas|sin mayeutica|hazlo|procede|resuelvelo|esta vez necesito|necesito que (?:lo )?(?:hagas|resuelvas))\b/.test(said);
  const contribution = /\b(mi lectura|mi interpretacion|mi conclusion|mi hipotesis|mi criterio|creo que|pienso que|para mi|yo veo|propongo que)\b/.test(said) ||
    /https?:\/\//i.test(text) || /["“«][^"”»]{3,}["”»]/.test(text) ||
    /\b(esta fuente|este pasaje|esta cita|esta referencia|a partir de|basandote en|usando)\b/.test(said);
  const libraryScope = /\b(biblioteca|corpus|paginas?|proyectos?|tareas?|frontmatter|metadatos|ontologia|relaciones?|bitacora|doctorado|talleres?)\b/.test(said);
  const determined = /\b(busca|encuentra|localiza|recupera|rastrea|cita|verifica|comprueba|transcribe|copia|enlaza|vincula|ordena|reordena|formatea|normaliza|clasifica|etiqueta|cataloga|inventaria)\b/.test(said) ||
    /\bcompleta (?:la |el |los |las )?(?:fuente|cita|referencia|ficha|metadatos|pagina|entrada)\b/.test(said) ||
    (libraryScope && /\b(explica|resume|sintetiza|sintesis|propone|revisa|analiza|relaciona)\b/.test(said));

  if (explicitDirect) return { mode: 'answer', reason: 'explicit_direct' };
  if (contribution) return { mode: 'answer', reason: 'contribution' };
  if (determined && practice !== null) return { mode: 'answer', reason: 'mixed' };
  if (determined) return { mode: 'answer', reason: 'determined' };
  return practice === null
    ? { mode: 'answer', reason: 'ordinary' }
    : { mode: 'challenge', practice };
}

/** Una investigación amplia del corpus no puede depender de que el modelo decida buscar. */
export function librarianResearchQueryFor(text: string): string | null {
  const said = folded(text);
  if (!/\b(biblioteca|corpus|paginas?|proyectos?|tareas?|frontmatter|metadatos|ontologia|relaciones?|bitacora|doctorado|talleres?)\b/.test(said)) return null;
  const linked = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/.exec(text)?.[1]?.trim();
  if (linked !== undefined && linked !== '') return linked;
  const capital = text.match(/\b[\p{Lu}][\p{Lu}\p{N}._-]{2,}\b/u)?.[0];
  const quoted = /[“«"]([^”»"]{3,})[”»"]/.exec(text)?.[1]?.trim();
  if (quoted !== undefined && quoted !== '') return quoted;
  const ignored = new Set([
    'biblioteca', 'corpus', 'pagina', 'paginas', 'metadatos', 'ontologia', 'relaciones', 'bitacora',
    'explica', 'resume', 'sintesis', 'propuesta', 'reordenamiento', 'etiquetado', 'todas', 'todos',
    'contexto', 'derivados', 'quiero', 'hagas', 'especifico',
  ]);
  const capitalKey = capital === undefined ? null : folded(capital);
  const terms = significantTerms(text).filter((term) => !ignored.has(term) && term !== capitalKey);
  if (capital !== undefined) {
    const contextual = ['doctorado', 'talleres', 'taller', 'diseño', 'diseno', 'participativos', 'participativo',
      'proyectos', 'proyecto', 'tareas', 'tarea'].filter((term) => new RegExp(`\\b${term}\\b`).test(said));
    return [capital, ...contextual.slice(0, 4)].join(' ');
  }
  return terms.length === 0 ? null : terms.slice(0, 4).join(' ');
}

/**
 * Clasifica la relación autoral antes de que la respuesta entre al grafo.
 * La decisión es del harness: el modelo no puede darse a sí mismo una autoría
 * humana ni borrar la fuente que recibió.
 */
export function librarianContributionLineageFor(request: LibrarianRequest): ContributionLineage {
  const said = folded(request.text);
  const relation = /\b(en mi nombre|como si fuera yo|con mi voz|firma(?:do)? por mi|redacta (?:una |un )?(?:carta|correo|mensaje)|escribe por mi)\b/.test(said)
    ? 'mediated'
    : /\b(escribamos|construyamos|desarrollemos|trabajemos juntos|coautor|entre los dos|conmigo)\b/.test(said)
      ? 'coauthored'
      : /\b(ordena|resume|resumen|sintetiza|sintesis|estructura|pasa en limpio|convierte|extrae|organiza|reformula)\b/.test(said)
        ? 'derived'
        : 'direct';
  const source = request.recordingId !== null
    ? { sourceKind: 'recording' as const, sourceReference: request.recordingId }
    : request.modality === 'block' && request.sourceBlockId !== null
      ? { sourceKind: 'block' as const, sourceReference: request.sourceBlockId }
      : { sourceKind: 'conversation' as const, sourceReference: request.id };
  return relation === 'direct'
    ? { relation, ...source }
    : { relation, relatedParticipant: request.askedBy, ...source };
}

/**
 * Reconoce el borde deliberadamente estrecho de la dialéctica v1.
 *
 * El harness compone el desafío; el modelo no decide si puede saltarse el
 * umbral. Las primeras posiciones explícitas cuentan como contribución y
 * siguen fluidas.
 */
export function formativePracticeFor(text: string): FormativePractice | null {
  const disposition = librarianRequestDispositionFor(text);
  return disposition.mode === 'challenge' ? disposition.practice : null;
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
  agent: { id: string; name: string };
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
  const row = store.db.prepare(`SELECT enabled,execution_adapter,external_agent_id,model_id,endpoint,secret_reference,permissions_json,
      dialectic_enabled,routine_enabled,routine_hour,routine_timezone,updated_by,updated_at
    FROM librarian_runtime_configs WHERE instance_id=?`).get(binding.instance_id) as {
      enabled: number; execution_adapter: LibrarianExecutionAdapter; external_agent_id: string | null;
      model_id: string | null; endpoint: string | null; secret_reference: string | null;
      permissions_json: string; dialectic_enabled: number; routine_enabled: number; routine_hour: number; routine_timezone: string;
      updated_by: string; updated_at: number;
    } | undefined;
  if (row === undefined) return null;
  return {
    instance: binding.instance_id,
    librarian: binding.librarian_id,
    agent: binding.agent_id,
    enabled: row.enabled === 1,
    adapter: row.execution_adapter,
    externalAgent: row.external_agent_id,
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
  adapter?: LibrarianExecutionAdapter;
  externalAgent?: string | null;
  model: string | null;
  endpoint: string | null;
  secretReference: string | null;
  permissions: LibrarianRuntimePermission[];
  dialectic: { enabled: boolean };
  routine: { enabled: boolean; hour: number; timezone: string };
}): LibrarianRuntimeConfiguration {
  const binding = activeBinding(store);
  if (binding === null) throw new Error('esta Vera todavía no tiene agente de biblioteca constituido');
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
  const adapter = input.adapter ?? 'embedded_model';
  if (!['embedded_model', 'external_agent'].includes(adapter)) {
    throw new Error('el adaptador del runtime no es reconocible');
  }
  if (adapter === 'external_agent' && input.routine.enabled) {
    throw new Error('la ronda programada todavía requiere el runtime embebido');
  }
  const externalAgent = input.externalAgent?.trim() || null;
  if (input.enabled && adapter === 'external_agent' && externalAgent === null) {
    throw new Error('elige el agente que ejecutará el runtime externo');
  }
  store.db.prepare(`INSERT INTO librarian_runtime_configs
    (instance_id,librarian_id,agent_id,enabled,execution_adapter,external_agent_id,model_id,endpoint,secret_reference,permissions_json,
      dialectic_enabled,routine_enabled,routine_hour,routine_timezone,updated_by,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(instance_id) DO UPDATE SET librarian_id=excluded.librarian_id,agent_id=excluded.agent_id,
      enabled=excluded.enabled,execution_adapter=excluded.execution_adapter,external_agent_id=excluded.external_agent_id,
      model_id=excluded.model_id,endpoint=excluded.endpoint,
      secret_reference=excluded.secret_reference,permissions_json=excluded.permissions_json,
      dialectic_enabled=excluded.dialectic_enabled,
      routine_enabled=excluded.routine_enabled,routine_hour=excluded.routine_hour,
      routine_timezone=excluded.routine_timezone,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).run(
        binding.instance_id, binding.librarian_id, binding.agent_id, input.enabled ? 1 : 0, adapter, externalAgent, model,
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
  if (binding === null) throw new Error('esta Vera todavía no tiene agente de biblioteca constituido');
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
  if (gate.status !== 'open') throw new Error('el agente de biblioteca ya está respondiendo al umbral formativo');
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
  const rows = store.db.prepare(`SELECT r.id,r.agent_id,p.name AS agent_name,r.kind,r.request_id,r.model_id,
      r.manifest_id,r.status,r.started_at,r.finished_at,r.output,r.error
    FROM librarian_runtime_runs r JOIN participants p ON p.id=r.agent_id
    WHERE r.instance_id=? ORDER BY r.started_at DESC,r.id DESC LIMIT ?`)
    .all(binding.instance_id, Math.max(1, Math.min(100, limit))) as Array<{
      id: string; agent_id: string; agent_name: string; kind: 'request' | 'routine'; request_id: string | null; model_id: string;
      manifest_id: string | null; status: 'running' | 'completed' | 'failed'; started_at: number;
      finished_at: number | null; output: string | null; error: string | null;
    }>;
  return rows.map((row) => ({
    id: row.id, agent: { id: row.agent_id, name: row.agent_name },
    kind: row.kind, request: row.request_id, model: row.model_id, manifest: row.manifest_id,
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
  if (binding === null) throw new Error('esta Vera todavía no tiene agente de biblioteca constituido');
  const manifest = activeManifest(store, binding.agent_id)?.summary.id ?? null;
  const id = `librarian-runtime-run:${randomUUID()}`;
  const startedAt = Date.now();
  store.db.prepare(`INSERT INTO librarian_runtime_runs
    (id,instance_id,agent_id,kind,request_id,manifest_id,model_id,status,started_at)
    VALUES (?,?,?,?,?,?,?,'running',?)`).run(
      id, binding.instance_id, binding.agent_id, input.kind, input.request ?? null, manifest, input.model, startedAt,
    );
  const agentName = store.db.prepare('SELECT name FROM participants WHERE id=?').get(binding.agent_id) as
    { name: string } | undefined;
  return { id, agent: { id: binding.agent_id, name: agentName?.name ?? binding.agent_id },
    kind: input.kind, request: input.request ?? null, model: input.model, manifest,
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

const PROMPT_MANIFEST_CHARACTERS = 1_800;

/** Proyecta la constitución al turno sin alterar el manifiesto durable ni su digest. */
export function compactLibrarianManifestDocument(document: AgentManifestDocument, requestText: string,
  maximum = PROMPT_MANIFEST_CHARACTERS): string {
  const complete = JSON.stringify(document);
  if (complete.length <= maximum) return complete;
  const terms = significantTerms(requestText);
  const pages = document.constitution.map((page) => ({ ...page, blocks: [] as typeof page.blocks }));
  const candidates = document.constitution.flatMap((page, pageIndex) => page.blocks.map((block, blockIndex) => {
    const content = folded(block.content);
    const score = terms.reduce((total, term) => total + (content.includes(term) ? term.length : 0), 0) +
      (/^#{1,6}\s/.test(block.content) ? 4 : 0) +
      (/mayeutica|servicio directo|bibliotec|principio|proposito|respuesta/.test(content) ? 40 : 0) +
      (page.role === 'identity' ? 3 : 0) + (blockIndex < 2 ? 2 : 0);
    return { pageIndex, blockIndex, block, score };
  })).sort((a, b) => b.score - a.score || a.pageIndex - b.pageIndex || a.blockIndex - b.blockIndex);
  const render = (): string => JSON.stringify({
    ...document,
    constitution: pages,
    compacted: true,
    omittedBlocks: document.constitution.reduce((total, page) => total + page.blocks.length, 0) -
      pages.reduce((total, page) => total + page.blocks.length, 0),
  });
  for (const candidate of candidates) {
    pages[candidate.pageIndex]!.blocks.push(candidate.block);
    pages[candidate.pageIndex]!.blocks.sort((a, b) => a.position - b.position);
    if (render().length > maximum) {
      pages[candidate.pageIndex]!.blocks.splice(pages[candidate.pageIndex]!.blocks.indexOf(candidate.block), 1);
    }
  }
  return render();
}

function manifestPrompt(store: Store, agent: string, requestText: string): string {
  const manifest = activeManifest(store, agent);
  if (manifest === null) return 'No hay manifiesto constitutivo activo. Declara esta carencia y actúa sólo como agente de biblioteca operativo.';
  return `Manifiesto constitutivo activo (digest ${manifest.summary.digest}):\n` +
    compactLibrarianManifestDocument(manifest.document, requestText);
}

const PROMPT_CONTEXT_CHARACTERS = 1_000;
const PROMPT_CONVERSATION_CHARACTERS = 1_600;

/**
 * La conversación durable es contexto efectivo, no sólo una vista de interfaz.
 * Conserva siempre el comienzo y la cola; cuando omite el medio lo declara.
 */
export function compactLibrarianConversationContext(store: Store, request: LibrarianRequest,
  maximum = PROMPT_CONVERSATION_CHARACTERS): string {
  const turns = librarianRequestsInConversation(store, request.conversationId)
    .filter((turn) => turn.createdAt <= request.createdAt && turn.id !== request.id)
    .map((turn) => [
      `Persona: ${turn.text}`,
      turn.reply === null ? `Agente: (${turn.status})` : `Agente: ${turn.reply.text}`,
    ].join('\n'));
  if (turns.length === 0) return '(primer turno de esta conversación)';
  const whole = turns.join('\n\n');
  if (whole.length <= maximum) return whole;
  const kept: string[] = [turns[0]!];
  let used = kept[0]!.length;
  for (let index = turns.length - 1; index > 0; index -= 1) {
    const turn = turns[index]!;
    if (used + turn.length + 80 > maximum) break;
    kept.splice(1, 0, turn);
    used += turn.length;
  }
  const omitted = Math.max(0, turns.length - kept.length);
  return `${kept[0]}\n\n… ${omitted} turno(s) intermedio(s) omitidos por el harness …\n\n${kept.slice(1).join('\n\n')}`;
}

/** Conserva la instantánea íntegra en el recibo y acota sólo su proyección al modelo. */
export function compactLibrarianPromptContext(snapshot: string, requestText: string,
  maximum = PROMPT_CONTEXT_CHARACTERS): string {
  if (snapshot.length <= maximum) return snapshot;
  try {
    const parsed = JSON.parse(snapshot) as {
      page?: unknown;
      focus?: { id?: string; content?: string; parent?: string | null } | null;
      blocks?: Array<{ id?: string; parent?: string | null; position?: number; content?: string }>;
    };
    const focus = parsed.focus === null || parsed.focus === undefined ? null : {
      ...parsed.focus,
      content: typeof parsed.focus.content !== 'string' || parsed.focus.content.length <= 6_000
        ? parsed.focus.content
        : `${parsed.focus.content.slice(0, 3_000)}…${parsed.focus.content.slice(-3_000)}`,
    };
    const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
    const terms = significantTerms(requestText);
    const indexed = blocks.map((block, index) => {
      const content = typeof block.content === 'string' ? block.content : '';
      const foldedContent = folded(content);
      const score = terms.reduce((total, term) => total + (foldedContent.includes(term) ? term.length : 0), 0) +
        (block.id === focus?.id ? 10_000 : 0) +
        (block.parent === null || /^#{1,6}\s/.test(content) ? 1 : 0);
      const firstMatch = terms.map((term) => foldedContent.indexOf(term)).filter((at) => at >= 0).sort((a, b) => a - b)[0] ?? 0;
      const start = content.length <= 6_000 ? 0 : Math.max(0, firstMatch - 1_000);
      const excerpt = content.length <= 6_000 ? content
        : `${start > 0 ? '…' : ''}${content.slice(start, start + 6_000)}${start + 6_000 < content.length ? '…' : ''}`;
      return { block: { ...block, content: excerpt }, index, score };
    });
    const candidates = [...indexed].sort((a, b) => b.score - a.score || a.index - b.index);
    const selected = new Map<number, (typeof indexed)[number]>();
    const render = (): string => JSON.stringify({
      page: parsed.page,
      focus,
      blocks: [...selected.values()].sort((a, b) => a.index - b.index).map((one) => one.block),
      compacted: true,
      omittedBlocks: Math.max(0, blocks.length - selected.size),
    });
    for (const candidate of candidates) {
      selected.set(candidate.index, candidate);
      if (render().length > maximum) selected.delete(candidate.index);
    }
    return render();
  } catch {
    return `${snapshot.slice(0, Math.max(0, maximum - 80))}\n… contexto acotado por el harness …`;
  }
}

export function librarianRequestPrompt(store: Store, config: LibrarianRuntimeConfiguration,
  request: LibrarianRequest, gate: LibrarianDialecticGate | null = null): string {
  const librarianName = activeOwnerLibrarian(store)?.name ?? 'Agente de biblioteca';
  const opening = gate === null ? null : librarianRequest(store, gate.openingRequest);
  const disposition = librarianRequestDispositionFor(request.text);
  const dialectic = gate === null
    ? (config.dialectic.enabled ? [
        'Dialéctica del agente de biblioteca activa.',
        'El harness no abrió un umbral en este turno: responde directamente y no devuelvas un desafío dialéctico.',
        'Buscar, citar, verificar, transcribir, enlazar, completar metadatos o recuperar una fuente identificable son trabajo bibliotecario determinado: ejecútalo sin pedir una tentativa.',
        'Una pista, hipótesis, fuente o criterio ya aportado cuenta como contribución suficiente.',
        'Si la tarea mezcla trabajo determinado y juicio, completa primero todo lo determinado y formula al final, como máximo, una pregunta breve sólo sobre la decisión personal todavía abierta. No retengas el resultado ya obtenido.',
        'Si la persona pide ejecución directa o insiste, procede sin exigir una fórmula especial ni moralizar.',
        'La mayéutica es una oferta de participación, no una condición de acceso al trabajo bibliotecario.',
        `Clasificación del harness: respuesta directa (${disposition.mode === 'answer' ? disposition.reason : 'umbral ya resuelto por el servidor'}).`,
        'Devuelve Markdown ordinario o JSON válido: {"dialectic":"answer","text":"respuesta final"}.',
      ].join('\n') : 'Dialéctica del agente de biblioteca desactivada: responde directamente.')
    : [
        `Umbral formativo abierto para ${gate.practice}.`,
        `Petición original: ${opening?.text ?? '(no disponible)'}`,
        `Desafío del agente de biblioteca: ${gate.challenge}`,
        gate.closingMode === 'bypass'
          ? 'La persona franqueó explícitamente el umbral. Responde ahora de forma directa, sin reproche ni nuevo desafío.'
          : `La persona ya aportó su tentativa en este turno: ${request.text}`,
        'Entrega ahora la respuesta final: contrasta la tentativa cuando exista, usa el corpus y no abras otro umbral en este turno.',
        'Devuelve Markdown ordinario o JSON válido: {"dialectic":"answer","text":"respuesta final"}.',
      ].join('\n');
  return [
    `Eres ${librarianName}, agente de biblioteca residente de esta Vera. Responde en español claro, preciso y afirmativo.`,
    'No eres un agente externo conectado por MCP: ocupas el oficio bibliotecario dentro de Vera. El harness te entrega su conversación, gobierno, ontología, gramática y herramientas de inspección.',
    'Tu principal es una persona. No inventes acciones ni herramientas. No reveles razonamiento privado.',
    'Antes de afirmar qué contiene o no contiene la biblioteca, usa la evidencia observada. Una ausencia sin búsqueda es un error.',
    'El frontmatter se escribe mediante propiedades estructuradas. En propiedades de enlace guarda el título canónico sin [[corchetes]]; tipo dice qué es la página y concepto dice de qué trata.',
    'Si la respuesta pedida contradice su fuente, atribuye falsamente una voz o exige sostener afirmaciones incompatibles, nombra la incoherencia antes de responder bajo una lectura coherente o pedir la decisión humana material. No presentes la abstención como un derecho personal de la IA.',
    'El contexto siguiente fue congelado cuando la persona hizo la solicitud; distingue hechos, inferencias y dudas.',
    manifestPrompt(store, config.agent, request.text),
    dialectic,
    `Historial efectivo de la conversación:\n${compactLibrarianConversationContext(store, request)}`,
    `Solicitud: ${request.text}`,
    `Contexto solicitado: ${compactLibrarianPromptContext(request.contextSnapshot, request.text)}`,
    'Devuelve sólo la respuesta que leerá la persona, en Markdown.',
  ].join('\n\n');
}
