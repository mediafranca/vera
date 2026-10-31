import { createHash, randomUUID } from 'node:crypto';

import type { VeraGraph } from '@vera/core';
import type { Store } from '@vera/store';

export type ConstitutionRole = 'identity' | 'purpose' | 'practice' | 'memory' | 'governance';

export interface AgentManifestDocument {
  schemaVersion: 1;
  source: 'vera';
  graph: string;
  agent: { id: string; name: string; human: { id: string; name: string } };
  generatedAt: number;
  constitution: Array<{
    page: string;
    title: string;
    role: ConstitutionRole;
    revision: string;
    properties: Array<{ key: string; value: string }>;
    blocks: Array<{ id: string; parent: string | null; position: number; content: string }>;
  }>;
  guarantees: {
    secrets: 'references-only';
    authority: 'human-principal';
    history: 'append-only-manifests';
  };
}

export interface AgentManifestSummary {
  id: string;
  version: number;
  digest: string;
  status: 'draft' | 'active' | 'superseded' | 'failed';
  createdAt: number;
  activatedAt: number | null;
}

export interface AgentAdministrationRow {
  agent: { id: string; name: string; status: string };
  human: { id: string; name: string; status: string } | null;
  sources: Array<{ page: string; title: string; role: ConstitutionRole; position: number }>;
  manifests: AgentManifestSummary[];
}

const participant = (store: Store, id: string): { id: string; name: string; kind: string; status: string } | undefined =>
  store.db.prepare('SELECT id,name,kind,status FROM participants WHERE id=?').get(id) as
    { id: string; name: string; kind: string; status: string } | undefined;

export function establishAgentPrincipal(store: Store, agent: string, human: string, establishedBy: string): void {
  const agentRow = participant(store, agent);
  const humanRow = participant(store, human);
  if (agentRow?.kind !== 'agent' || agentRow.status !== 'active') throw new Error('el agente no existe o no está activo');
  if (humanRow?.kind !== 'human' || humanRow.status !== 'active') throw new Error('el principal debe ser una persona activa');
  const current = store.db.prepare('SELECT human_id,status FROM agent_principals WHERE agent_id=?').get(agent) as
    { human_id: string; status: string } | undefined;
  if (current !== undefined) {
    if (current.human_id === human && current.status === 'active') return;
    throw new Error('el agente ya tiene principal humano; transferirlo exige otro acto de gobierno');
  }
  store.db.prepare(`INSERT INTO agent_principals
    (agent_id,human_id,established_by,established_at,status) VALUES (?,?,?,?, 'active')`)
    .run(agent, human, establishedBy, Date.now());
}

export function humanPrincipal(store: Store, agent: string): string | null {
  const row = store.db.prepare("SELECT human_id FROM agent_principals WHERE agent_id=? AND status='active'")
    .get(agent) as { human_id: string } | undefined;
  return row?.human_id ?? null;
}

export function assertAgentPrincipal(store: Store, human: string, agent: string): void {
  if (humanPrincipal(store, agent) !== human) throw new Error('sólo su principal humano gobierna este agente');
}

const secretLike = (text: string): boolean => [
  /\bvera_ag_[A-Za-z0-9_-]{12,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}\b/i,
  /\b(?:api[_ -]?key|token|secreto|contraseña)\s*[:=]\s*\S{12,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
].some((pattern) => pattern.test(text));

function revisionOf(graph: VeraGraph, page: string): string {
  const revisions = graph.revisions().filter((one) => one.page === page);
  return revisions.at(-1)?.operation ?? 'sin-revisión';
}

export function chooseConstitutionSources(store: Store, graph: VeraGraph, human: string, agent: string,
  sources: Array<{ page: string; role: ConstitutionRole }>): void {
  assertAgentPrincipal(store, human, agent);
  if (sources.length === 0) throw new Error('la constitución necesita al menos una página');
  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.page)) throw new Error('una página constitutiva no se repite');
    seen.add(source.page);
    const page = graph.page(source.page);
    if (page === undefined) throw new Error(`la página ${source.page} no existe`);
    const properties = graph.propertiesOf(page.id);
    if (properties.some((one) => one.key.trim().toLowerCase() === 'special-kind' &&
      one.value.trim().toLowerCase() === 'service')) {
      throw new Error('una página de servicio no puede formar parte de la constitución');
    }
    const text = [page.title, ...properties.flatMap((one) => [one.key, one.value]),
      ...graph.blocksOf(page.id).map((one) => one.content)].join('\n');
    if (secretLike(text)) throw new Error(`la página ${page.title} parece contener un secreto`);
  }

  const now = Date.now();
  store.db.exec('BEGIN');
  try {
    store.db.prepare("UPDATE agent_constitution_pages SET status='removed' WHERE agent_id=? AND status='active'")
      .run(agent);
    const upsert = store.db.prepare(`INSERT INTO agent_constitution_pages
      (agent_id,page_id,role,position,added_by,added_at,status) VALUES (?,?,?,?,?,?,'active')
      ON CONFLICT(agent_id,page_id) DO UPDATE SET role=excluded.role,position=excluded.position,
        added_by=excluded.added_by,added_at=excluded.added_at,status='active'`);
    sources.forEach((source, position) => upsert.run(agent, source.page, source.role, position, human, now));
    store.db.exec('COMMIT');
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
}

function manifestDocument(store: Store, graph: VeraGraph, agent: string): AgentManifestDocument {
  const agentRow = participant(store, agent);
  const principalId = humanPrincipal(store, agent);
  const human = principalId === null ? undefined : participant(store, principalId);
  if (agentRow?.kind !== 'agent' || human?.kind !== 'human') throw new Error('el agente no tiene principal humano');
  const sources = store.db.prepare(`SELECT page_id,role,position FROM agent_constitution_pages
    WHERE agent_id=? AND status='active' ORDER BY position,page_id`).all(agent) as
    Array<{ page_id: string; role: ConstitutionRole; position: number }>;
  if (sources.length === 0) throw new Error('el agente no tiene páginas constitutivas');
  const constitution = sources.map((source) => {
    const page = graph.page(source.page_id);
    if (page === undefined) throw new Error(`falta la página constitutiva ${source.page_id}`);
    return {
      page: page.id,
      title: page.title,
      role: source.role,
      revision: revisionOf(graph, page.id),
      properties: graph.propertiesOf(page.id).map(({ key, value }) => ({ key, value })),
      blocks: graph.blocksOf(page.id).map(({ stableId, parent, position, content }) => ({
        id: stableId, parent, position, content,
      })),
    };
  });
  return {
    schemaVersion: 1,
    source: 'vera',
    graph: store.graphId,
    agent: { id: agentRow.id, name: agentRow.name, human: { id: human.id, name: human.name } },
    generatedAt: Date.now(),
    constitution,
    guarantees: { secrets: 'references-only', authority: 'human-principal', history: 'append-only-manifests' },
  };
}

export function buildManifest(store: Store, graph: VeraGraph, human: string, agent: string): AgentManifestSummary {
  assertAgentPrincipal(store, human, agent);
  const document = manifestDocument(store, graph, agent);
  const content = JSON.stringify(document);
  const digest = createHash('sha256').update(content).digest('hex');
  const version = Number((store.db.prepare('SELECT coalesce(max(version),0)+1 AS version FROM agent_manifests WHERE agent_id=?')
    .get(agent) as { version: number }).version);
  const id = `manifest:${randomUUID()}`;
  const createdAt = Date.now();
  store.db.prepare(`INSERT INTO agent_manifests
    (id,agent_id,version,digest,content,status,created_by,created_at)
    VALUES (?,?,?,?,?,'draft',?,?)`).run(id, agent, version, digest, content, human, createdAt);
  return { id, version, digest, status: 'draft', createdAt, activatedAt: null };
}

export function activateManifest(store: Store, human: string, agent: string, manifest: string): AgentManifestSummary {
  assertAgentPrincipal(store, human, agent);
  const chosen = store.db.prepare(`SELECT id,version,digest,status,created_at,activated_at FROM agent_manifests
    WHERE id=? AND agent_id=?`).get(manifest, agent) as {
      id: string; version: number; digest: string; status: AgentManifestSummary['status'];
      created_at: number; activated_at: number | null;
    } | undefined;
  if (chosen === undefined) throw new Error('el manifiesto no existe');
  if (chosen.status === 'failed') throw new Error('un manifiesto fallido no puede activarse');
  if (chosen.status === 'active') return {
    id: chosen.id, version: chosen.version, digest: chosen.digest, status: chosen.status,
    createdAt: chosen.created_at, activatedAt: chosen.activated_at,
  };
  const prior = store.db.prepare("SELECT id FROM agent_manifests WHERE agent_id=? AND status='active'")
    .get(agent) as { id: string } | undefined;
  const at = Date.now();
  store.db.exec('BEGIN');
  try {
    if (prior !== undefined) store.db.prepare("UPDATE agent_manifests SET status='superseded' WHERE id=?").run(prior.id);
    store.db.prepare(`UPDATE agent_manifests SET status='active',activated_by=?,activated_at=?,supersedes_id=?
      WHERE id=?`).run(human, at, prior?.id ?? null, manifest);
    store.db.exec('COMMIT');
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
  return { id: chosen.id, version: chosen.version, digest: chosen.digest, status: 'active', createdAt: chosen.created_at, activatedAt: at };
}

export function activeManifest(store: Store, agent: string): { summary: AgentManifestSummary; document: AgentManifestDocument } | null {
  const row = store.db.prepare(`SELECT id,version,digest,status,created_at,activated_at,content FROM agent_manifests
    WHERE agent_id=? AND status='active'`).get(agent) as {
      id: string; version: number; digest: string; status: 'active'; created_at: number;
      activated_at: number | null; content: string;
    } | undefined;
  if (row === undefined) return null;
  return {
    summary: { id: row.id, version: row.version, digest: row.digest, status: row.status,
      createdAt: row.created_at, activatedAt: row.activated_at },
    document: JSON.parse(row.content) as AgentManifestDocument,
  };
}

export function agentAdministration(store: Store, graph: VeraGraph): AgentAdministrationRow[] {
  const agents = store.db.prepare("SELECT id,name,status FROM participants WHERE kind='agent' ORDER BY lower(name),id")
    .all() as Array<{ id: string; name: string; status: string }>;
  return agents.map((agent) => {
    const principalId = humanPrincipal(store, agent.id);
    const human = principalId === null ? null : participant(store, principalId) ?? null;
    const sources = store.db.prepare(`SELECT page_id,role,position FROM agent_constitution_pages
      WHERE agent_id=? AND status='active' ORDER BY position,page_id`).all(agent.id) as
      Array<{ page_id: string; role: ConstitutionRole; position: number }>;
    const manifests = store.db.prepare(`SELECT id,version,digest,status,created_at,activated_at FROM agent_manifests
      WHERE agent_id=? ORDER BY version DESC`).all(agent.id) as Array<{
        id: string; version: number; digest: string; status: AgentManifestSummary['status'];
        created_at: number; activated_at: number | null;
      }>;
    return {
      agent,
      human: human === null ? null : { id: human.id, name: human.name, status: human.status },
      sources: sources.map((source) => ({ page: source.page_id, title: graph.page(source.page_id)?.title ?? source.page_id,
        role: source.role, position: source.position })),
      manifests: manifests.map((one) => ({ id: one.id, version: one.version, digest: one.digest,
        status: one.status, createdAt: one.created_at, activatedAt: one.activated_at })),
    };
  });
}
