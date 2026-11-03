import { randomUUID } from 'node:crypto';

import type { Store } from '@vera/store';
import { activeManifest } from './agent-manifests.ts';
import type { LibrarianRequest } from './librarian.ts';

export const LIBRARIAN_RUNTIME_ID = 'vera:embedded-librarian';
export const LIBRARIAN_RUNTIME_LABEL = 'Vera · bibliotecaria embebida';

export type LibrarianRuntimePermission = 'read_request_context' | 'reply' | 'daily_round';
export type LibrarianRuntimeStatus = 'unconstituted' | 'stopped' | 'ready' | 'degraded' | 'working';

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
  routine: { enabled: boolean; hour: number; timezone: string };
  updatedBy: string;
  updatedAt: number;
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
      routine_enabled,routine_hour,routine_timezone,updated_by,updated_at
    FROM librarian_runtime_configs WHERE instance_id=?`).get(binding.instance_id) as {
      enabled: number; model_id: string | null; endpoint: string | null; secret_reference: string | null;
      permissions_json: string; routine_enabled: number; routine_hour: number; routine_timezone: string;
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
      routine_enabled,routine_hour,routine_timezone,updated_by,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(instance_id) DO UPDATE SET librarian_id=excluded.librarian_id,agent_id=excluded.agent_id,
      enabled=excluded.enabled,model_id=excluded.model_id,endpoint=excluded.endpoint,
      secret_reference=excluded.secret_reference,permissions_json=excluded.permissions_json,
      routine_enabled=excluded.routine_enabled,routine_hour=excluded.routine_hour,
      routine_timezone=excluded.routine_timezone,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).run(
        binding.instance_id, binding.librarian_id, binding.agent_id, input.enabled ? 1 : 0, model,
        endpoint, secretReference, JSON.stringify(permissions), input.routine.enabled ? 1 : 0,
        input.routine.hour, input.routine.timezone.trim() || 'local', input.updatedBy, now,
      );
  return librarianRuntimeConfiguration(store)!;
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
  request: LibrarianRequest): string {
  return [
    'Eres la bibliotecaria de esta biblioteca Vera. Responde en español claro, breve y afirmativo.',
    'Tu principal es una persona. No inventes acciones ni herramientas. No reveles razonamiento privado.',
    'El contexto siguiente fue congelado cuando la persona hizo la solicitud; distingue hechos, inferencias y dudas.',
    manifestPrompt(store, config.agent),
    `Solicitud: ${request.text}`,
    `Contexto solicitado: ${request.contextSnapshot}`,
    'Devuelve sólo la respuesta que leerá la persona, en Markdown.',
  ].join('\n\n');
}

export function librarianRoutinePrompt(store: Store, config: LibrarianRuntimeConfiguration,
  libraryDigest: string): string {
  return [
    'Eres la bibliotecaria de esta biblioteca Vera y realizas una ronda gobernada.',
    'Señala como máximo cinco asuntos concretos que merezcan atención. Si no hay ninguno, responde exactamente: SIN_NOVEDAD.',
    'No cambies el corpus ni supongas herramientas. Devuelve observaciones públicas, nunca razonamiento privado.',
    manifestPrompt(store, config.agent),
    `Estado acotado de la biblioteca: ${libraryDigest}`,
  ].join('\n\n');
}
