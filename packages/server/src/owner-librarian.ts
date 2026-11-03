import { randomUUID } from 'node:crypto';

import type { VeraGraph } from '@vera/core';
import { saveParticipant, type Store } from '@vera/store';
import { establishAgentPrincipal } from './agent-manifests.ts';
import { ensureTerritoryPolicy } from './library-clearance.ts';

export interface OwnerLibrarianBinding {
  id: string;
  owner: string;
  agent: string;
  name: string;
  harness: string;
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
    if (held.owner !== owner) throw new Error('la bibliotecaria activa pertenece a otra persona dueña');
    return held;
  }

  const name = requestedName.trim();
  if (name === '') throw new Error('la bibliotecaria necesita un nombre');
  const instance = store.db.prepare('SELECT id,owner_id FROM instances WHERE graph_id=?')
    .get(store.graphId) as { id: string; owner_id: string } | undefined;
  if (instance === undefined || instance.owner_id !== owner) {
    throw new Error('sólo la persona dueña puede constituir su bibliotecaria');
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
