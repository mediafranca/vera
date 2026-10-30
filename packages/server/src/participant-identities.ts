import { randomBytes } from 'node:crypto';
import type { Store } from '@vera/store';

export type ParticipantKind = 'human' | 'agent';

const identifier = (prefix: string): string => `${prefix}:${randomBytes(8).toString('hex')}`;

export interface ParticipantIdentity {
  id: string;
  name: string;
  kind: ParticipantKind;
  status: 'active' | 'suspended';
  canonical: string;
}

export function declareParticipant(store: Store, declaredBy: string, name: string,
  kind: ParticipantKind): ParticipantIdentity {
  const clean = name.trim();
  if (clean === '') throw new Error('la identidad necesita un nombre');
  const authority = store.db.prepare(`SELECT 1 FROM instances WHERE graph_id=? AND owner_id=?`)
    .get(store.graphId, declaredBy);
  if (authority === undefined) throw new Error('sólo el dueño puede declarar participantes');
  const id = identifier(kind === 'human' ? 'participant:person' : 'participant:agent');
  store.db.exec('BEGIN');
  try {
    store.db.prepare(`INSERT INTO participants (id,name,kind,status) VALUES (?,?,?,'active')`)
      .run(id, clean, kind);
    store.db.prepare(`INSERT INTO memberships (graph_id,participant_id,status) VALUES (?,?,'active')`)
      .run(store.graphId, id);
    store.db.exec('COMMIT');
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
  return { id, name: clean, kind, status: 'active', canonical: id };
}

export function canonicalParticipant(store: Store, participant: string): string {
  const visited = new Set<string>();
  let current = participant;
  while (!visited.has(current)) {
    visited.add(current);
    const row = store.db.prepare(`SELECT canonical_id FROM participant_reconciliations WHERE duplicate_id=?`)
      .get(current) as { canonical_id: string } | undefined;
    if (row === undefined) return current;
    current = row.canonical_id;
  }
  throw new Error('la reconciliación de participantes contiene un ciclo');
}

export function participantAliases(store: Store, canonical: string): string[] {
  const target = canonicalParticipant(store, canonical);
  const aliases = (store.db.prepare(`SELECT duplicate_id FROM participant_reconciliations
    WHERE canonical_id=? ORDER BY reconciled_at,duplicate_id`).all(target) as Array<{ duplicate_id: string }>)
    .map((row) => row.duplicate_id);
  return [target, ...aliases];
}

export function listParticipants(store: Store): ParticipantIdentity[] {
  return (store.db.prepare(`SELECT id,name,kind,status FROM participants ORDER BY lower(name),id`).all() as Array<{
    id: string; name: string; kind: ParticipantKind; status: 'active' | 'suspended';
  }>).filter((row) => canonicalParticipant(store, row.id) === row.id).map((row) => ({
    ...row,
    canonical: row.id,
  }));
}

export function renameParticipant(store: Store, changedBy: string, participant: string,
  name: string): ParticipantIdentity {
  const canonical = canonicalParticipant(store, participant);
  const clean = name.trim();
  if (clean === '') throw new Error('la identidad necesita un nombre');
  const current = store.db.prepare(`SELECT id,name,kind,status FROM participants WHERE id=?`).get(canonical) as
    { id: string; name: string; kind: ParticipantKind; status: 'active' | 'suspended' } | undefined;
  if (current === undefined) throw new Error('el participante no existe');
  if (current.name === clean) return { ...current, canonical };
  store.db.exec('BEGIN');
  try {
    store.db.prepare(`INSERT INTO participant_name_history
      (id,participant_id,former_name,new_name,changed_by,changed_at) VALUES (?,?,?,?,?,?)`)
      .run(identifier('participant-name'), canonical, current.name, clean, changedBy, Date.now());
    store.db.prepare(`UPDATE participants SET name=? WHERE id=?`).run(clean, canonical);
    store.db.exec('COMMIT');
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
  return { id: canonical, name: clean, kind: current.kind, status: current.status, canonical };
}

export function reconcileParticipants(store: Store, reconciledBy: string, duplicate: string,
  canonical: string, reason: string): void {
  const source = canonicalParticipant(store, duplicate);
  const target = canonicalParticipant(store, canonical);
  const clean = reason.trim();
  if (source === target) throw new Error('ambas identidades ya resuelven al mismo participante');
  if (clean === '') throw new Error('la reconciliación necesita una razón');
  const rows = store.db.prepare(`SELECT id,kind FROM participants WHERE id IN (?,?)`).all(source, target) as
    Array<{ id: string; kind: ParticipantKind }>;
  if (rows.length !== 2) throw new Error('una de las identidades no existe');
  if (rows[0]!.kind !== rows[1]!.kind) throw new Error('no se reconcilian personas con agentes');
  store.db.exec('BEGIN');
  try {
    store.db.prepare(`INSERT INTO participant_reconciliations
      (duplicate_id,canonical_id,reconciled_by,reason,reconciled_at) VALUES (?,?,?,?,?)`)
      .run(source, target, reconciledBy, clean, Date.now());
    store.db.prepare(`UPDATE participants SET status='suspended' WHERE id=?`).run(source);
    store.db.prepare(`UPDATE memberships SET status='suspended' WHERE graph_id=? AND participant_id=?`)
      .run(store.graphId, source);
    store.db.exec('COMMIT');
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
}
