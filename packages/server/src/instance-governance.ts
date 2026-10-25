import { randomBytes } from 'node:crypto';
import type { Store } from '@vera/store';
import { digestOf } from './credentials.ts';

export type InstanceProfile = 'personal' | 'collective';
export type CollectiveRole = 'root_custodian' | 'administrator' | 'editor' |
  'contributor' | 'reader' | 'publisher';
/** Roles cuya autoridad ya tiene una puerta completa en este corte. */
export type InvitableCollectiveRole = 'administrator' | 'editor' | 'reader';

export interface CollectiveGovernanceView {
  profile: InstanceProfile;
  participant: string;
  roles: CollectiveRole[];
  people: Array<{ participant: string; name: string; roles: CollectiveRole[];
    authenticators: number; activeSessions: number }>;
  invitations: Array<{ id: string; role: InvitableCollectiveRole; intendedContact: string | null;
    status: 'pending' | 'redeemed' | 'revoked' | 'expired'; issuedAt: number; expiresAt: number;
    redeemedBy: string | null }>;
}

const opaque = (prefix: string): string => `${prefix}${randomBytes(32).toString('base64url')}`;
const identifier = (prefix: string): string => `${prefix}:${randomBytes(8).toString('hex')}`;
const INSTANCE_ID = 'instance:1';
const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export function ensureInstanceProfile(store: Store, owner: string, requested: InstanceProfile | undefined,
  newGraph: boolean): InstanceProfile {
  const held = store.db.prepare('SELECT id,profile FROM instances WHERE graph_id=?')
    .get(store.graphId) as { id: string; profile: InstanceProfile } | undefined;
  if (held !== undefined) {
    if (requested !== undefined && requested !== held.profile) {
      throw new Error(`esta instancia ya es ${held.profile}; cambiar de perfil exige migrar a otro corpus`);
    }
    return held.profile;
  }

  // Una instalación anterior ya habitada era personal aunque aún no tuviera la
  // fila que hoy lo dice. No se permite convertirla en el lugar por accidente.
  const profile: InstanceProfile = newGraph ? (requested ?? 'personal') : 'personal';
  if (!newGraph && requested === 'collective') {
    throw new Error('un corpus personal existente no se convierte en colectivo en el lugar; crea otra instancia');
  }

  const now = Date.now();
  store.db.exec('BEGIN');
  try {
    store.db.prepare('INSERT INTO instances (id,graph_id,owner_id,profile) VALUES (?,?,?,?)')
      .run(INSTANCE_ID, store.graphId, owner, profile);
    store.db.prepare(`INSERT INTO instance_governance_grants
      (id,instance_id,participant_id,role,status,granted_by,granted_at)
      VALUES (?,?,?,'root_custodian','active',?,?)`)
      .run(identifier('governance'), INSTANCE_ID, owner, owner, now);
    store.db.prepare(`INSERT INTO instance_governance_grants
      (id,instance_id,participant_id,role,status,granted_by,granted_at)
      VALUES (?,?,?,'administrator','active',?,?)`)
      .run(identifier('governance'), INSTANCE_ID, owner, owner, now);
    store.db.exec('COMMIT');
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
  return profile;
}

export function instanceProfile(store: Store): InstanceProfile {
  const row = store.db.prepare('SELECT profile FROM instances WHERE graph_id=?').get(store.graphId) as
    { profile: InstanceProfile } | undefined;
  return row?.profile ?? 'personal';
}

export function collectiveRoles(store: Store, participant: string): CollectiveRole[] {
  return (store.db.prepare(`SELECT g.role FROM instance_governance_grants g
    JOIN instances i ON i.id=g.instance_id
    WHERE i.graph_id=? AND g.participant_id=? AND g.status='active' ORDER BY g.role`)
    .all(store.graphId, participant) as Array<{ role: CollectiveRole }>).map((one) => one.role);
}

export function canReadCollective(store: Store, participant: string): boolean {
  // Custodiar el disco no concede por sí solo autoridad editorial.
  return collectiveRoles(store, participant).some((role) => role !== 'root_custodian');
}

export function canWriteCollective(store: Store, participant: string): boolean {
  const roles = collectiveRoles(store, participant);
  return roles.includes('administrator') || roles.includes('editor');
}

export function isCollectiveAdministrator(store: Store, participant: string): boolean {
  return collectiveRoles(store, participant).includes('administrator');
}

export function inviteToCollective(store: Store, issuedBy: string, role: InvitableCollectiveRole,
  intendedContact?: string): { id: string; secret: string; expiresAt: number } {
  if (instanceProfile(store) !== 'collective') throw new Error('esta instancia no es colectiva');
  if (!isCollectiveAdministrator(store, issuedBy)) throw new Error('sólo un administrador puede invitar');
  const instance = store.db.prepare('SELECT id FROM instances WHERE graph_id=?').get(store.graphId) as
    { id: string };
  const id = identifier('collective-invitation');
  const secret = opaque('vera_collective_inv_');
  const now = Date.now();
  const expiresAt = now + INVITATION_LIFETIME_MS;
  store.db.prepare(`INSERT INTO collective_invitations
    (id,instance_id,issued_by,role,proof_digest,intended_contact,status,issued_at,expires_at)
    VALUES (?,?,?,?,?,?,'pending',?,?)`)
    .run(id, instance.id, issuedBy, role, digestOf(secret), intendedContact ?? null, now, expiresAt);
  return { id, secret, expiresAt };
}

export function collectiveGovernanceView(store: Store, participant: string): CollectiveGovernanceView {
  const people = (store.db.prepare(`SELECT p.id AS participant,p.name,
      COUNT(DISTINCT CASE WHEN a.status='active' THEN a.credential_id END) AS authenticators,
      COUNT(DISTINCT CASE WHEN s.status='active' AND s.expires_at>? THEN s.id END) AS active_sessions
    FROM participants p
    JOIN memberships m ON m.participant_id=p.id AND m.graph_id=? AND m.status='active'
    LEFT JOIN human_authenticators a ON a.participant_id=p.id
    LEFT JOIN human_sessions s ON s.participant_id=p.id
    WHERE p.kind='human' AND p.status='active'
    GROUP BY p.id,p.name ORDER BY lower(p.name),p.id`).all(Date.now(), store.graphId) as Array<{
      participant: string; name: string; authenticators: number; active_sessions: number;
    }>).map((person) => ({
      participant: person.participant,
      name: person.name,
      roles: collectiveRoles(store, person.participant),
      authenticators: Number(person.authenticators),
      activeSessions: Number(person.active_sessions),
    }));
  const invitations = (store.db.prepare(`SELECT id,role,intended_contact,status,issued_at,expires_at,redeemed_by
    FROM collective_invitations WHERE instance_id=(SELECT id FROM instances WHERE graph_id=?)
    ORDER BY issued_at DESC`).all(store.graphId) as Array<any>).map((invitation) => ({
      id: invitation.id,
      role: invitation.role as InvitableCollectiveRole,
      intendedContact: invitation.intended_contact as string | null,
      status: invitation.status === 'pending' && invitation.expires_at <= Date.now()
        ? 'expired' as const
        : invitation.status,
      issuedAt: invitation.issued_at as number,
      expiresAt: invitation.expires_at as number,
      redeemedBy: invitation.redeemed_by as string | null,
    }));
  return { profile: instanceProfile(store), participant, roles: collectiveRoles(store, participant),
    people, invitations };
}

export function revokeCollectiveInvitation(store: Store, id: string): boolean {
  return Number(store.db.prepare(`UPDATE collective_invitations SET status='revoked'
    WHERE id=? AND instance_id=(SELECT id FROM instances WHERE graph_id=?) AND status='pending'`)
    .run(id, store.graphId).changes) > 0;
}

export function revokeCollectiveSessions(store: Store, participant: string): number {
  return Number(store.db.prepare(`UPDATE human_sessions SET status='revoked',revoked_at=?
    WHERE participant_id=? AND status='active'`).run(Date.now(), participant).changes);
}

export function revokeCollectiveRole(store: Store, participant: string, role: CollectiveRole): void {
  if (role === 'root_custodian') throw new Error('la custodia raíz no se revoca desde la red');
  if (role === 'administrator') {
    const administrators = store.db.prepare(`SELECT COUNT(DISTINCT participant_id) AS amount
      FROM instance_governance_grants WHERE instance_id=(SELECT id FROM instances WHERE graph_id=?)
      AND role='administrator' AND status='active'`).get(store.graphId) as { amount: number };
    const held = store.db.prepare(`SELECT 1 FROM instance_governance_grants
      WHERE instance_id=(SELECT id FROM instances WHERE graph_id=?) AND participant_id=?
      AND role='administrator' AND status='active'`).get(store.graphId, participant);
    if (held !== undefined && administrators.amount <= 1) throw new Error('no se puede revocar al último administrador');
  }
  const changed = store.db.prepare(`UPDATE instance_governance_grants SET status='revoked',revoked_at=?
    WHERE instance_id=(SELECT id FROM instances WHERE graph_id=?) AND participant_id=? AND role=?
    AND status='active'`).run(Date.now(), store.graphId, participant, role).changes;
  if (changed === 0) throw new Error('el rol activo no existe');
  if (!canReadCollective(store, participant)) revokeCollectiveSessions(store, participant);
}

export function inspectCollectiveInvitation(store: Store, id: string, proof: string):
  { id: string; role: InvitableCollectiveRole; status: string; expiresAt: number } | null {
  const row = store.db.prepare(`SELECT id,role,status,expires_at FROM collective_invitations
    WHERE id=? AND proof_digest=?`).get(id, digestOf(proof)) as any;
  if (row === undefined) return null;
  const status = row.status === 'pending' && row.expires_at <= Date.now() ? 'expired' : row.status;
  return { id: row.id, role: row.role, status, expiresAt: row.expires_at };
}

export function redeemCollectiveInvitation(store: Store, id: string, proof: string, name: string): {
  participant: string; role: InvitableCollectiveRole; enrollment: string; enrollmentSecret: string;
} {
  const now = Date.now();
  const row = store.db.prepare(`SELECT * FROM collective_invitations WHERE id=? AND proof_digest=?`)
    .get(id, digestOf(proof)) as any;
  if (row === undefined) throw new Error('la invitación no existe o el secreto no coincide');
  if (row.status !== 'pending' || row.expires_at <= now) throw new Error('la invitación venció o ya fue usada');
  const participant = identifier('participant:person');
  const enrollment = identifier('enrollment');
  const enrollmentSecret = opaque('vera_enroll_');
  store.db.exec('BEGIN');
  try {
    store.db.prepare("INSERT INTO participants (id,name,kind,status) VALUES (?,?,'human','active')")
      .run(participant, name);
    store.db.prepare("INSERT INTO memberships (graph_id,participant_id,status) VALUES (?,?,'active')")
      .run(store.graphId, participant);
    store.db.prepare(`INSERT INTO instance_governance_grants
      (id,instance_id,participant_id,role,status,granted_by,granted_at)
      VALUES (?,?,?,?,'active',?,?)`)
      .run(identifier('governance'), row.instance_id, participant, row.role, row.issued_by, now);
    store.db.prepare(`INSERT INTO authenticator_enrollments
      (id,graph_id,participant_id,authorized_by,proof_digest,status,expires_at)
      VALUES (?,?,?,?,?,'pending',?)`)
      .run(enrollment, store.graphId, participant, row.issued_by, digestOf(enrollmentSecret), now + 15 * 60 * 1000);
    store.db.prepare(`UPDATE collective_invitations SET status='redeemed',redeemed_by=?,redeemed_at=? WHERE id=?`)
      .run(participant, now, id);
    store.db.exec('COMMIT');
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
  return { participant, role: row.role, enrollment, enrollmentSecret };
}
