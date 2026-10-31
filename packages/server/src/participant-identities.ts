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

export interface ParticipantSummary extends ParticipantIdentity {
  aliases: Array<{ id: string; name: string; status: 'active' | 'suspended' }>;
  roles: string[];
  activity: number;
  credentials: { active: number; revoked: number };
  activeSessions: number;
  permissions: number;
  canErase: boolean;
  retainedBy: string[];
}

const hasTable = (store: Store, table: string): boolean => store.db.prepare(
  `SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?`,
).get(table) !== undefined;

function countFor(store: Store, table: string, column: string, ids: string[]): number {
  if (!hasTable(store, table) || ids.length === 0) return 0;
  const places = ids.map(() => '?').join(',');
  return Number((store.db.prepare(
    `SELECT count(*) AS amount FROM "${table}" WHERE "${column}" IN (${places})`,
  ).get(...ids) as { amount: number }).amount);
}

/** Toda referencia durable, salvo la pertenencia vacía que se retira junto a la identidad. */
function retainedReferences(store: Store, participant: string): Array<{ table: string; column: string; amount: number }> {
  const accessResidue = new Set([
    'access_tokens.participant_id',
    'human_authenticators.participant_id',
    'human_sessions.participant_id',
    'webauthn_challenges.participant_id',
    'authenticator_enrollments.participant_id',
    'access_grants.participant_id',
    'access_invitations.participant_id',
    'access_invitations.redeemed_by',
    'collective_invitations.participant_id',
    'collective_invitations.redeemed_by',
    'instance_governance_grants.participant_id',
    // Declarar un agente crea simultáneamente este vínculo. Si el agente nunca
    // llegó a tener constitución, credencial, manifiesto ni actividad, el
    // vínculo no puede volverlo imborrable por definición. El sentido inverso
    // (`human_id`) sí retiene a la persona mientras tenga agentes a su cargo.
    'agent_principals.agent_id',
  ]);
  const tables = (store.db.prepare(`SELECT name FROM sqlite_schema
    WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{ name: string }>);
  const held: Array<{ table: string; column: string; amount: number }> = [];
  for (const { name } of tables) {
    if (name === 'memberships' || name === 'participants') continue;
    const foreign = store.db.prepare(`PRAGMA foreign_key_list("${name}")`).all() as Array<{
      table: string; from: string;
    }>;
    for (const link of foreign.filter((one) => one.table === 'participants')) {
      if (accessResidue.has(`${name}.${link.from}`)) continue;
      const amount = Number((store.db.prepare(
        `SELECT count(*) AS amount FROM "${name}" WHERE "${link.from}"=?`,
      ).get(participant) as { amount: number }).amount);
      if (amount > 0) held.push({ table: name, column: link.from, amount });
    }
  }
  return held;
}

const retainedLabel = (table: string): string => ({
  operations: 'actividad',
  block_authorship: 'autoría de bloques',
  exposures: 'exposiciones',
  decisions: 'decisiones',
  access_tokens: 'credenciales de agente',
  human_authenticators: 'passkeys',
  human_sessions: 'sesiones',
  access_grants: 'permisos de espacios',
  access_invitations: 'invitaciones de espacios',
  collective_invitations: 'invitaciones de instancia',
  instance_governance_grants: 'roles',
  participant_reconciliations: 'reconciliaciones',
  participant_name_history: 'historia de nombres',
}[table] ?? table.replaceAll('_', ' '));

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

export function participantSummaries(store: Store): ParticipantSummary[] {
  return listParticipants(store).map((participant) => {
    const ids = participantAliases(store, participant.id);
    const aliases = ids.slice(1).map((id) => store.db.prepare(
      `SELECT id,name,status FROM participants WHERE id=?`,
    ).get(id) as { id: string; name: string; status: 'active' | 'suspended' });
    const roles = hasTable(store, 'instance_governance_grants')
      ? (store.db.prepare(`SELECT DISTINCT role FROM instance_governance_grants
          WHERE participant_id IN (${ids.map(() => '?').join(',')}) AND status='active' ORDER BY role`)
        .all(...ids) as Array<{ role: string }>).map((one) => one.role)
      : [];
    const activeTokens = hasTable(store, 'access_tokens') ? Number((store.db.prepare(`SELECT count(*) AS amount
      FROM access_tokens WHERE participant_id IN (${ids.map(() => '?').join(',')}) AND status='active'`)
      .get(...ids) as { amount: number }).amount) : 0;
    const revokedTokens = hasTable(store, 'access_tokens') ? Number((store.db.prepare(`SELECT count(*) AS amount
      FROM access_tokens WHERE participant_id IN (${ids.map(() => '?').join(',')}) AND status='revoked'`)
      .get(...ids) as { amount: number }).amount) : 0;
    const activePasskeys = hasTable(store, 'human_authenticators') ? Number((store.db.prepare(`SELECT count(*) AS amount
      FROM human_authenticators WHERE participant_id IN (${ids.map(() => '?').join(',')}) AND status='active'`)
      .get(...ids) as { amount: number }).amount) : 0;
    const revokedPasskeys = hasTable(store, 'human_authenticators') ? Number((store.db.prepare(`SELECT count(*) AS amount
      FROM human_authenticators WHERE participant_id IN (${ids.map(() => '?').join(',')}) AND status='revoked'`)
      .get(...ids) as { amount: number }).amount) : 0;
    const retained = retainedReferences(store, participant.id);
    return {
      ...participant,
      aliases,
      roles,
      activity: countFor(store, 'operations', 'participant_id', ids),
      credentials: { active: activeTokens + activePasskeys, revoked: revokedTokens + revokedPasskeys },
      activeSessions: hasTable(store, 'human_sessions') ? Number((store.db.prepare(`SELECT count(*) AS amount
        FROM human_sessions WHERE participant_id IN (${ids.map(() => '?').join(',')})
          AND status='active' AND expires_at>?`).get(...ids, Date.now()) as { amount: number }).amount) : 0,
      permissions: hasTable(store, 'access_grants') ? Number((store.db.prepare(`SELECT count(*) AS amount
        FROM access_grants WHERE participant_id IN (${ids.map(() => '?').join(',')}) AND status='active'`)
        .get(...ids) as { amount: number }).amount) : 0,
      canErase: aliases.length === 0 && retained.length === 0,
      retainedBy: [...new Set(retained.map((one) => retainedLabel(one.table)))],
    };
  });
}

export function suspendParticipant(store: Store, changedBy: string, participant: string): ParticipantIdentity {
  const canonical = canonicalParticipant(store, participant);
  const owner = store.db.prepare(`SELECT owner_id FROM instances WHERE graph_id=?`).get(store.graphId) as
    { owner_id: string } | undefined;
  if (owner?.owner_id === canonical || changedBy === canonical) throw new Error('el dueño soberano no se suspende');
  const current = store.db.prepare(`SELECT id,name,kind,status FROM participants WHERE id=?`).get(canonical) as
    { id: string; name: string; kind: ParticipantKind; status: 'active' | 'suspended' } | undefined;
  if (current === undefined) throw new Error('el participante no existe');
  const ids = participantAliases(store, canonical);
  const places = ids.map(() => '?').join(',');
  store.db.exec('BEGIN');
  try {
    store.db.prepare(`UPDATE participants SET status='suspended' WHERE id IN (${places})`).run(...ids);
    store.db.prepare(`UPDATE memberships SET status='suspended' WHERE participant_id IN (${places})`).run(...ids);
    if (hasTable(store, 'access_tokens')) store.db.prepare(`UPDATE access_tokens SET status='revoked',revoked_at=?
      WHERE participant_id IN (${places}) AND status='active'`).run(Date.now(), ...ids);
    if (hasTable(store, 'human_authenticators')) store.db.prepare(`UPDATE human_authenticators SET status='revoked'
      WHERE participant_id IN (${places}) AND status='active'`).run(...ids);
    if (hasTable(store, 'human_sessions')) store.db.prepare(`UPDATE human_sessions SET status='revoked',revoked_at=?
      WHERE participant_id IN (${places}) AND status='active'`).run(Date.now(), ...ids);
    if (hasTable(store, 'webauthn_challenges')) store.db.prepare(
      `DELETE FROM webauthn_challenges WHERE participant_id IN (${places})`,
    ).run(...ids);
    if (hasTable(store, 'authenticator_enrollments')) store.db.prepare(`UPDATE authenticator_enrollments SET status='revoked'
      WHERE participant_id IN (${places}) AND status='pending'`).run(...ids);
    if (hasTable(store, 'access_grants')) store.db.prepare(`UPDATE access_grants SET status='revoked',revoked_at=?
      WHERE participant_id IN (${places}) AND status='active'`).run(Date.now(), ...ids);
    if (hasTable(store, 'instance_governance_grants')) store.db.prepare(`UPDATE instance_governance_grants
      SET status='revoked',revoked_at=? WHERE participant_id IN (${places}) AND status='active'`)
      .run(Date.now(), ...ids);
    if (hasTable(store, 'access_invitations')) store.db.prepare(`UPDATE access_invitations SET status='revoked'
      WHERE participant_id IN (${places}) AND status='pending'`).run(...ids);
    if (hasTable(store, 'collective_invitations')) store.db.prepare(`UPDATE collective_invitations SET status='revoked'
      WHERE participant_id IN (${places}) AND status='pending'`).run(...ids);
    store.db.exec('COMMIT');
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
  return { ...current, status: 'suspended', canonical };
}

export function eraseEmptyParticipant(store: Store, changedBy: string, participant: string): void {
  const canonical = canonicalParticipant(store, participant);
  const owner = store.db.prepare(`SELECT owner_id FROM instances WHERE graph_id=?`).get(store.graphId) as
    { owner_id: string } | undefined;
  if (owner?.owner_id === canonical || changedBy === canonical) throw new Error('el dueño soberano no se elimina');
  if (participantAliases(store, canonical).length > 1) throw new Error('una identidad reconciliada conserva historia');
  const retained = retainedReferences(store, canonical);
  if (retained.length > 0) {
    throw new Error(`la identidad conserva ${[...new Set(retained.map((one) => retainedLabel(one.table)))].join(', ')}`);
  }
  store.db.exec('BEGIN');
  try {
    const erase = (table: string, column: string): void => {
      if (hasTable(store, table)) store.db.prepare(`DELETE FROM "${table}" WHERE "${column}"=?`).run(canonical);
    };
    erase('webauthn_challenges', 'participant_id');
    erase('human_sessions', 'participant_id');
    erase('human_authenticators', 'participant_id');
    erase('authenticator_enrollments', 'participant_id');
    erase('access_grants', 'participant_id');
    erase('access_invitations', 'redeemed_by');
    erase('access_invitations', 'participant_id');
    erase('collective_invitations', 'redeemed_by');
    erase('collective_invitations', 'participant_id');
    erase('instance_governance_grants', 'participant_id');
    erase('access_tokens', 'participant_id');
    erase('agent_principals', 'agent_id');
    store.db.prepare('DELETE FROM memberships WHERE participant_id=?').run(canonical);
    const removed = store.db.prepare('DELETE FROM participants WHERE id=?').run(canonical).changes;
    if (removed !== 1) throw new Error('el participante no existe');
    store.db.exec('COMMIT');
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
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
