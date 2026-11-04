import { randomUUID } from 'node:crypto';

import type { VeraGraph } from '@vera/core';
import { saveParticipant, type Store } from '@vera/store';
import { activeManifest, establishAgentPrincipal } from './agent-manifests.ts';
import { ensureTerritoryPolicy } from './library-clearance.ts';

export interface OwnerLibrarianBinding {
  id: string;
  owner: string;
  agent: string;
  name: string;
  harness: string;
}

export interface OwnerLibrarianCandidate {
  agent: string;
  name: string;
}

export interface OwnerLibrarianHistoryEntry {
  id: string;
  agent: string;
  name: string;
  status: 'active' | 'replaced';
  designatedAt: number;
}

export function activeOwnerLibrarian(store: Store): OwnerLibrarianBinding | null {
  const held = store.db.prepare(`SELECT l.id,l.owner_id,l.agent_id,p.name,h.id AS harness_id
    FROM owner_librarians l
    JOIN participants p ON p.id=l.agent_id
    JOIN librarian_harnesses h ON h.librarian_id=l.id AND h.status='active'
    WHERE l.instance_id=(SELECT id FROM instances WHERE graph_id=?) AND l.status='active'`)
    .get(store.graphId) as {
      id: string; owner_id: string; agent_id: string; name: string; harness_id: string;
    } | undefined;
  return held === undefined ? null : {
    id: held.id, owner: held.owner_id, agent: held.agent_id, name: held.name, harness: held.harness_id,
  };
}

export function eligibleOwnerLibrarians(store: Store): OwnerLibrarianCandidate[] {
  const active = activeOwnerLibrarian(store);
  if (active === null) return [];
  const rows = store.db.prepare(`SELECT p.id,p.name
    FROM participants p
    JOIN agent_principals ap ON ap.agent_id=p.id AND ap.status='active'
    WHERE p.kind='agent' AND p.status='active' AND ap.human_id=? AND p.id<>?
      AND EXISTS (SELECT 1 FROM agent_manifests m WHERE m.agent_id=p.id AND m.status='active')
    ORDER BY lower(p.name),p.id`).all(active.owner, active.agent) as Array<{ id: string; name: string }>;
  return rows.map((row) => ({ agent: row.id, name: row.name }));
}

export function ownerLibrarianHistory(store: Store): OwnerLibrarianHistoryEntry[] {
  const rows = store.db.prepare(`SELECT l.id,l.agent_id,p.name,l.status,l.designated_at
    FROM owner_librarians l JOIN participants p ON p.id=l.agent_id
    WHERE l.instance_id=(SELECT id FROM instances WHERE graph_id=?)
    ORDER BY l.designated_at DESC,l.id DESC`).all(store.graphId) as Array<{
      id: string; agent_id: string; name: string; status: 'active' | 'replaced'; designated_at: number;
    }>;
  return rows.map((row) => ({
    id: row.id, agent: row.agent_id, name: row.name, status: row.status, designatedAt: row.designated_at,
  }));
}

export function replaceOwnerLibrarian(store: Store, owner: string, successor: string): OwnerLibrarianBinding {
  const current = activeOwnerLibrarian(store);
  if (current === null) throw new Error('esta Vera todavía no tiene agente de biblioteca');
  if (current.owner !== owner) throw new Error('sólo la persona dueña puede designar el agente de biblioteca');
  if (successor === current.agent) throw new Error('ese agente ya ocupa el oficio');
  const candidate = store.db.prepare(`SELECT p.id,p.name
    FROM participants p JOIN agent_principals ap ON ap.agent_id=p.id AND ap.status='active'
    WHERE p.id=? AND p.kind='agent' AND p.status='active' AND ap.human_id=?`).get(successor, owner) as
    { id: string; name: string } | undefined;
  if (candidate === undefined) throw new Error('el sucesor debe ser un agente activo de la misma persona principal');
  if (activeManifest(store, successor) === null) throw new Error('el sucesor necesita un manifiesto activo');

  const openRequest = store.db.prepare(`SELECT r.id FROM agent_requests r
    JOIN agent_conversations c ON c.id=r.conversation_id
    WHERE c.graph_id=? AND c.agent_id=? AND r.status IN ('queued','working') LIMIT 1`)
    .get(store.graphId, current.agent);
  const openGate = store.db.prepare(`SELECT g.id FROM librarian_dialectic_gates g
    JOIN agent_conversations c ON c.id=g.conversation_id
    WHERE c.graph_id=? AND c.agent_id=? AND g.status IN ('open','responding') LIMIT 1`)
    .get(store.graphId, current.agent);
  const running = store.db.prepare(`SELECT r.id FROM librarian_runtime_runs r
    WHERE r.instance_id=(SELECT id FROM instances WHERE graph_id=?)
      AND r.agent_id=? AND r.status='running' LIMIT 1`).get(store.graphId, current.agent);
  if (openRequest !== undefined || openGate !== undefined || running !== undefined) {
    throw new Error(`${current.name} todavía tiene trabajo abierto; termina ese turno antes de reemplazarle`);
  }

  const instance = store.db.prepare('SELECT id FROM instances WHERE graph_id=? AND owner_id=?')
    .get(store.graphId, owner) as { id: string } | undefined;
  if (instance === undefined) throw new Error('la instancia no pertenece a esta persona dueña');
  const harness = store.db.prepare(`SELECT id,version FROM librarian_harnesses
    WHERE librarian_id=? AND status='active'`).get(current.id) as { id: string; version: string } | undefined;
  if (harness === undefined) throw new Error('el oficio activo no tiene harness vigente');

  const librarianId = `owner-librarian:${randomUUID()}`;
  const harnessId = `librarian-harness:${randomUUID()}`;
  const now = Date.now();
  store.db.exec('BEGIN');
  try {
    store.db.prepare("UPDATE owner_librarians SET status='replaced' WHERE id=? AND status='active'")
      .run(current.id);
    store.db.prepare("UPDATE librarian_harnesses SET status='withdrawn' WHERE id=? AND status='active'")
      .run(harness.id);
    store.db.prepare(`UPDATE agent_conversations SET status='closed'
      WHERE graph_id=? AND agent_id=? AND status='active'`).run(store.graphId, current.agent);
    store.db.prepare(`INSERT INTO owner_librarians
      (id,instance_id,owner_id,agent_id,status,designated_at)
      VALUES (?,?,?,?,'active',?)`).run(librarianId, instance.id, owner, successor, now);
    store.db.prepare(`INSERT INTO librarian_harnesses
      (id,instance_id,librarian_id,version,status,attached_by,attached_at)
      VALUES (?,?,?,?,'active',?,?)`).run(harnessId, instance.id, librarianId, harness.version, owner, now);
    store.db.prepare(`UPDATE librarian_runtime_configs
      SET librarian_id=?,agent_id=?,updated_by=?,updated_at=? WHERE instance_id=?`)
      .run(librarianId, successor, owner, now, instance.id);
    store.db.exec('COMMIT');
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
  return { id: librarianId, owner, agent: successor, name: candidate.name, harness: harnessId };
}

/**
 * Constituye la bibliotecaria de la persona dueña de una Vera nueva.
 *
 * La relación de principal pertenece al agente y a su persona. El harness es
 * infraestructura de Vera: se registra y versiona por separado, sin conceder
 * por sí solo territorio ni un comodín de herramientas.
 */
export function ensureOwnerLibrarian(
  store: Store,
  graph: VeraGraph,
  owner: string,
  requestedName: string,
): OwnerLibrarianBinding {
  const held = activeOwnerLibrarian(store);
  if (held !== null) {
    if (held.owner !== owner) throw new Error('el agente de biblioteca activo pertenece a otra persona dueña');
    return held;
  }

  const name = requestedName.trim();
  if (name === '') throw new Error('el agente de biblioteca necesita un nombre');
  const instance = store.db.prepare('SELECT id,owner_id FROM instances WHERE graph_id=?')
    .get(store.graphId) as { id: string; owner_id: string } | undefined;
  if (instance === undefined || instance.owner_id !== owner) {
    throw new Error('sólo la persona dueña puede constituir su agente de biblioteca');
  }

  const agent = `participant:${randomUUID()}`;
  const librarian = `owner-librarian:${randomUUID()}`;
  const harness = `librarian-harness:${randomUUID()}`;
  const now = Date.now();
  saveParticipant(store, { id: agent, name, kind: 'agent' });
  graph.addParticipant({ id: agent, name, kind: 'agent' });
  graph.admit(agent);
  establishAgentPrincipal(store, agent, owner, owner);
  store.db.exec('BEGIN');
  try {
    store.db.prepare(`INSERT INTO owner_librarians
      (id,instance_id,owner_id,agent_id,status,designated_at)
      VALUES (?,?,?,?,'active',?)`).run(librarian, instance.id, owner, agent, now);
    store.db.prepare(`INSERT INTO librarian_harnesses
      (id,instance_id,librarian_id,version,status,attached_by,attached_at)
      VALUES (?,?,?,'vera-librarian-harness:2','active',?,?)`)
      .run(harness, instance.id, librarian, owner, now);
    store.db.exec('COMMIT');
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
  // Constituir el oficio no concede superficies. La bibliotecaria empieza en
  // la biblioteca general y la persona amplía su territorio deliberadamente.
  // La bibliotecaria de la persona dueña ya atendía el corpus completo antes
  // de existir el clearance. Constituirla conserva ese alcance explícitamente;
  // la persona puede estrecharlo después desde Administración.
  ensureTerritoryPolicy(store, agent, owner, { mode: 'all', includeGeneral: true });
  return { id: librarian, owner, agent, name, harness };
}
