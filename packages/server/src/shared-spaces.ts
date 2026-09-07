import { randomBytes } from 'node:crypto';
import { answersIn } from '@vera/core';
import type { Store } from '@vera/store';
import { digestOf } from './credentials.ts';

export type SharedPermission = 'read' | 'contribute' | 'edit';
export interface SharedSpaceCriterion {
  id: string; key: string; value: string; status: 'active' | 'removed';
}
export interface SharedSpace {
  id: string; name: string; slug: string; selectorKey: string; selectorValue: string;
  criterionCombination: 'any' | 'all'; criteria: SharedSpaceCriterion[]; manualPages: string[];
  audience: 'anybody' | 'restricted'; status: 'active' | 'withdrawn'; createdAt: number;
}

export interface SharedSpaceAdministration extends SharedSpace {
  pageCount: number;
  effectivePages: { page: string; reasons: string[] }[];
  invitations: { id: string; permissions: SharedPermission[]; intendedContact: string | null;
    status: 'pending' | 'redeemed' | 'revoked' | 'expired'; issuedAt: number; expiresAt: number }[];
  participants: { grant: string; participant: string; name: string; permissions: SharedPermission[];
    status: 'active' | 'revoked'; grantedAt: number; authenticators: number; activeSessions: number }[];
  proposals: SharedProposal[];
}

export interface SharedProposal {
  id: string; page: string; author: string; authorName: string; originId: string;
  channel: 'typed_text' | 'drawn' | 'walked'; change: unknown;
  status: 'awaiting_review' | 'accepted' | 'rejected'; proposedAt: number;
  reviewedBy: string | null; reviewedAt: number | null;
}

const secret = (prefix: string): string => `${prefix}${randomBytes(32).toString('base64url')}`;
const id = (prefix: string): string => `${prefix}:${randomBytes(8).toString('hex')}`;

export const INVITATION_LIFETIMES = [
  60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
  30 * 24 * 60 * 60 * 1000,
] as const;
export const DEFAULT_INVITATION_LIFETIME = INVITATION_LIFETIMES[2];

export function createSharedSpace(store: Store, owner: string, input: {
  name: string; slug: string; selectorKey?: string; selectorValue?: string;
  audience?: 'anybody' | 'restricted';
}): SharedSpace {
  const held: SharedSpace = { id: id('space'), name: input.name, slug: input.slug,
    selectorKey: input.selectorKey ?? '', selectorValue: input.selectorValue ?? '',
    criterionCombination: 'any', criteria: [], manualPages: [],
    audience: input.audience ?? 'restricted', status: 'active', createdAt: Date.now() };
  const criterion = id('criterion');
  store.db.exec('BEGIN');
  try {
    store.db.prepare(`INSERT INTO shared_spaces
    (id, graph_id, owner_id, name, slug, selector_key, selector_value, audience, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`)
    .run(held.id, store.graphId, owner, held.name, held.slug, held.selectorKey,
      held.selectorValue, held.audience, held.createdAt);
    if (held.selectorKey !== '' && held.selectorValue !== '') {
      store.db.prepare(`INSERT INTO shared_space_criteria
        (id,space_id,selector_key,selector_value,status,added_by,added_at)
        VALUES (?,?,?,?,'active',?,?)`).run(criterion, held.id, held.selectorKey, held.selectorValue, owner, held.createdAt);
    }
    store.db.exec('COMMIT');
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
  held.criteria = held.selectorKey === '' ? [] :
    [{ id: criterion, key: held.selectorKey, value: held.selectorValue, status: 'active' }];
  return held;
}

function hydrateSpace(store: Store, row: any): SharedSpace {
  const criteria = (store.db.prepare(`SELECT id,selector_key,selector_value,status FROM shared_space_criteria
    WHERE space_id=? AND status='active' ORDER BY added_at,id`).all(row.id) as any[]).map((one) => ({
      id: one.id, key: one.selector_key, value: one.selector_value, status: one.status,
    })) as SharedSpaceCriterion[];
  const manualPages = (store.db.prepare(`SELECT page_id FROM shared_space_manual_pages
    WHERE space_id=? AND status='active' ORDER BY added_at,id`).all(row.id) as any[]).map((one) => String(one.page_id));
  return { id: row.id, name: row.name, slug: row.slug,
    selectorKey: criteria[0]?.key ?? row.selector_key, selectorValue: criteria[0]?.value ?? row.selector_value,
    criterionCombination: row.criterion_combination ?? 'any', criteria, manualPages,
    audience: row.audience, status: row.status, createdAt: row.created_at };
}

export function sharedSpaceBySlug(store: Store, slug: string): SharedSpace | null {
  const row = store.db.prepare(`SELECT id, name, slug, selector_key, selector_value,
    audience, status, created_at FROM shared_spaces WHERE graph_id = ? AND slug = ?`)
    .get(store.graphId, slug) as any;
  return row === undefined ? null : hydrateSpace(store, row);
}

export function sharedSpaces(store: Store): SharedSpace[] {
  return (store.db.prepare(`SELECT id,name,slug,selector_key,selector_value,criterion_combination,audience,status,created_at
    FROM shared_spaces WHERE graph_id=? ORDER BY created_at,id`).all(store.graphId) as any[])
    .map((row) => hydrateSpace(store, row));
}

export function updateSharedSpace(store: Store, held: SharedSpace, input: {
  name: string; slug: string; criterionCombination: 'any' | 'all'; audience: 'restricted' | 'anybody';
}): SharedSpace {
  store.db.prepare(`UPDATE shared_spaces SET name=?,slug=?,criterion_combination=?,audience=? WHERE id=?`)
    .run(input.name, input.slug, input.criterionCombination, input.audience, held.id);
  return { ...held, ...input };
}

/** Elimina el límite compartido y todos sus artefactos dependientes.
 * Las páginas del grafo no pertenecen al espacio: sólo se retiran criterios,
 * inclusiones, invitaciones, accesos y propuestas ligados a él. */
export function deleteSharedSpace(store: Store, held: SharedSpace): boolean {
  return Number(store.db.prepare(`DELETE FROM shared_spaces WHERE id=? AND graph_id=?`)
    .run(held.id, store.graphId).changes) > 0;
}

export function addSharedSpaceCriterion(store: Store, owner: string, space: SharedSpace, key: string, value: string): SharedSpaceCriterion {
  if (space.criteria.some((one) => one.key === key && one.value === value)) throw new Error('el criterio ya está activo');
  const criterion = { id: id('criterion'), key, value, status: 'active' as const };
  store.db.prepare(`INSERT INTO shared_space_criteria
    (id,space_id,selector_key,selector_value,status,added_by,added_at) VALUES (?,?,?,?,'active',?,?)`)
    .run(criterion.id, space.id, key, value, owner, Date.now());
  return criterion;
}

export function removeSharedSpaceCriterion(store: Store, space: SharedSpace, criterion: string): boolean {
  return Number(store.db.prepare(`UPDATE shared_space_criteria SET status='removed',removed_at=?
    WHERE id=? AND space_id=? AND status='active'`).run(Date.now(), criterion, space.id).changes) > 0;
}

export function includeManualPage(store: Store, owner: string, space: SharedSpace, page: string): string {
  if (space.manualPages.includes(page)) throw new Error('la página ya está incluida explícitamente');
  const inclusion = id('inclusion');
  store.db.prepare(`INSERT INTO shared_space_manual_pages
    (id,space_id,page_id,status,added_by,added_at) VALUES (?,?,?,'active',?,?)`)
    .run(inclusion, space.id, page, owner, Date.now());
  return inclusion;
}

export function removeManualPage(store: Store, space: SharedSpace, page: string): boolean {
  return Number(store.db.prepare(`UPDATE shared_space_manual_pages SET status='removed',removed_at=?
    WHERE page_id=? AND space_id=? AND status='active'`).run(Date.now(), page, space.id).changes) > 0;
}

export function pageBelongsToSharedSpace(graph: { propertiesOf(id: string): { key: string; value: string }[] },
  space: SharedSpace, page: string): boolean {
  if (space.manualPages.includes(page)) return true;
  const properties = graph.propertiesOf(page);
  const matches = (criterion: SharedSpaceCriterion): boolean => properties.some((property) =>
    propertyMatchesSharedSpaceCriterion(property, criterion));
  return space.criteria.length > 0 && (space.criterionCombination === 'all'
    ? space.criteria.every(matches) : space.criteria.some(matches));
}

export function propertyMatchesSharedSpaceCriterion(property: { key: string; value: string },
  criterion: Pick<SharedSpaceCriterion, 'key' | 'value'>): boolean {
  if (property.key !== criterion.key) return false;
  const sought = criterion.value.trim().toLocaleLowerCase();
  return answersIn(property.value).some((answer) => answer.toLocaleLowerCase() === sought);
}

export function administrationOf(store: Store, space: SharedSpace,
  effectivePages: { page: string; reasons: string[] }[]): SharedSpaceAdministration {
  const now = Date.now();
  store.db.prepare(`UPDATE access_invitations SET status='expired'
    WHERE space_id=? AND status='pending' AND expires_at<=?`).run(space.id, now);
  store.db.prepare(`UPDATE human_sessions SET status='expired'
    WHERE status='active' AND expires_at<=?`).run(now);
  const invitations = (store.db.prepare(`SELECT id,permissions,intended_contact,status,issued_at,expires_at
    FROM access_invitations WHERE space_id=? ORDER BY issued_at DESC`).all(space.id) as any[]).map((row) => ({
      id: row.id, permissions: String(row.permissions).split(',') as SharedPermission[],
      intendedContact: row.intended_contact, status: row.status, issuedAt: row.issued_at, expiresAt: row.expires_at,
    }));
  const participants = (store.db.prepare(`SELECT g.id AS grant,g.participant_id,p.name,g.permissions,g.status,g.granted_at,
      (SELECT count(*) FROM human_authenticators a WHERE a.participant_id=g.participant_id AND a.status='active') AS authenticators,
      (SELECT count(*) FROM human_sessions s WHERE s.participant_id=g.participant_id AND s.status='active' AND s.expires_at>?) AS active_sessions
    FROM access_grants g JOIN participants p ON p.id=g.participant_id
    WHERE g.space_id=? ORDER BY g.granted_at DESC`).all(now, space.id) as any[]).map((row) => ({
      grant: row.grant, participant: row.participant_id, name: row.name,
      permissions: String(row.permissions).split(',') as SharedPermission[], status: row.status,
      grantedAt: row.granted_at, authenticators: Number(row.authenticators), activeSessions: Number(row.active_sessions),
    }));
  const proposals = proposalsForSpace(store, space);
  return { ...space, pageCount: effectivePages.length, effectivePages, invitations, participants, proposals };
}

export function proposalsForSpace(store: Store, space: SharedSpace): SharedProposal[] {
  return (store.db.prepare(`SELECT q.id,q.page_id,q.author_id,p.name AS author_name,q.origin_id,q.channel,
      q.change_json,q.status,q.proposed_at,q.reviewed_by,q.reviewed_at
    FROM shared_proposals q JOIN participants p ON p.id=q.author_id
    WHERE q.space_id=? ORDER BY q.proposed_at DESC,q.id`).all(space.id) as any[]).map((row) => ({
      id: row.id, page: row.page_id, author: row.author_id, authorName: row.author_name,
      originId: row.origin_id, channel: row.channel, change: JSON.parse(row.change_json), status: row.status,
      proposedAt: row.proposed_at, reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at,
    }));
}

export function createSharedProposal(store: Store, space: SharedSpace, author: string,
  page: string, originId: string, channel: 'typed_text' | 'drawn' | 'walked', change: unknown): SharedProposal {
  const proposalId = id('proposal'); const proposedAt = Date.now();
  try {
    store.db.prepare(`INSERT INTO shared_proposals
      (id,space_id,page_id,author_id,origin_id,channel,change_json,status,proposed_at)
      VALUES (?,?,?,?,?,?,?,'awaiting_review',?)`)
      .run(proposalId, space.id, page, author, originId, channel, JSON.stringify(change), proposedAt);
  } catch (error) {
    const existing = proposalsForSpace(store, space).find((one) => one.author === author && one.originId === originId);
    if (existing !== undefined) return existing;
    throw error;
  }
  return { id: proposalId, page, author, authorName: '', originId, channel, change,
    status: 'awaiting_review', proposedAt, reviewedBy: null, reviewedAt: null };
}

export function sharedProposal(store: Store, space: SharedSpace, proposal: string): SharedProposal | null {
  return proposalsForSpace(store, space).find((one) => one.id === proposal) ?? null;
}

export function decideSharedProposal(store: Store, space: SharedSpace, proposal: string,
  owner: string, decision: 'accepted' | 'rejected'): boolean {
  return Number(store.db.prepare(`UPDATE shared_proposals SET status=?,reviewed_by=?,reviewed_at=?
    WHERE id=? AND space_id=? AND status='awaiting_review'`)
    .run(decision, owner, Date.now(), proposal, space.id).changes) > 0;
}

export function revokeInvitation(store: Store, space: SharedSpace, invitation: string): boolean {
  return Number(store.db.prepare(`UPDATE access_invitations SET status='revoked'
    WHERE id=? AND space_id=? AND status='pending'`).run(invitation, space.id).changes) > 0;
}

export function deleteInvitation(store: Store, space: SharedSpace, invitation: string): boolean {
  const row = store.db.prepare(`SELECT redeemed_by FROM access_invitations
    WHERE id=? AND space_id=?`).get(invitation, space.id) as { redeemed_by: string | null } | undefined;
  if (row === undefined) return false;
  store.db.exec('BEGIN IMMEDIATE');
  try {
    if (row.redeemed_by !== null) {
      store.db.prepare(`UPDATE access_grants SET status='revoked',revoked_at=?
        WHERE space_id=? AND participant_id=? AND status='active'`)
        .run(Date.now(), space.id, row.redeemed_by);
    }
    store.db.prepare(`DELETE FROM access_invitations WHERE id=? AND space_id=?`).run(invitation, space.id);
    store.db.exec('COMMIT');
    return true;
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
}

export function revokeGrant(store: Store, space: SharedSpace, grant: string): boolean {
  return Number(store.db.prepare(`UPDATE access_grants SET status='revoked',revoked_at=?
    WHERE id=? AND space_id=? AND status='active'`).run(Date.now(), grant, space.id).changes) > 0;
}

export function changeGrantPermissions(store: Store, space: SharedSpace, grant: string,
  permissions: SharedPermission[]): boolean {
  const unique = [...new Set(permissions)].sort();
  if (unique.length === 0 || !unique.includes('read')) throw new Error('el acceso debe incluir read');
  return Number(store.db.prepare(`UPDATE access_grants SET permissions=?
    WHERE id=? AND space_id=? AND status='active'`).run(unique.join(','), grant, space.id).changes) > 0;
}

export function revokeParticipantSessions(store: Store, space: SharedSpace, participant: string): number {
  const permitted = store.db.prepare(`SELECT 1 FROM access_grants WHERE space_id=? AND participant_id=?`)
    .get(space.id, participant);
  if (permitted === undefined) return 0;
  return Number(store.db.prepare(`UPDATE human_sessions SET status='revoked',revoked_at=?
    WHERE participant_id=? AND status='active'`).run(Date.now(), participant).changes);
}

export function inviteToSpace(store: Store, owner: string, space: SharedSpace,
  permissions: SharedPermission[], intendedContact?: string,
  lifetimeMs = DEFAULT_INVITATION_LIFETIME): { id: string; secret: string; expiresAt: number } {
  const unique = [...new Set(permissions)];
  if (unique.length === 0 || !unique.includes('read')) throw new Error('la invitación debe incluir read');
  if (!(INVITATION_LIFETIMES as readonly number[]).includes(lifetimeMs)) {
    throw new Error('la duración de la invitación no está permitida');
  }
  const proof = secret('vera_inv_');
  const invitation = id('invitation');
  const now = Date.now();
  const expiresAt = now + lifetimeMs;
  store.db.prepare(`INSERT INTO access_invitations
    (id, space_id, issued_by, permissions, proof_digest, intended_contact, status, issued_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
    .run(invitation, space.id, owner, unique.sort().join(','), digestOf(proof),
      intendedContact ?? null, now, expiresAt);
  return { id: invitation, secret: proof, expiresAt };
}

export function inspectInvitation(store: Store, invitation: string, proof: string): any | null {
  const row = store.db.prepare(`SELECT i.id, i.status, i.permissions, i.expires_at,
    s.name, s.slug FROM access_invitations i JOIN shared_spaces s ON s.id=i.space_id
    WHERE i.id=? AND i.proof_digest=?`).get(invitation, digestOf(proof)) as any;
  if (row === undefined) return null;
  const status = row.status === 'pending' && row.expires_at <= Date.now() ? 'expired' : row.status;
  return { id: row.id, space: row.name, slug: row.slug,
    permissions: String(row.permissions).split(','), status, expiresAt: row.expires_at };
}

export function redeemInvitation(store: Store, invitation: string, proof: string, name: string): any {
  const now = Date.now();
  const row = store.db.prepare(`SELECT i.*, s.graph_id, s.owner_id, s.name AS space_name, s.slug AS space_slug
    FROM access_invitations i JOIN shared_spaces s ON s.id=i.space_id
    WHERE i.id=? AND i.proof_digest=?`).get(invitation, digestOf(proof)) as any;
  if (row === undefined) throw new Error('la invitación no existe o el secreto no coincide');
  if (row.status !== 'pending' || row.expires_at <= now) throw new Error('la invitación venció o ya fue usada');
  const participant = id('participant:guest');
  const grant = id('grant');
  const enrollment = id('enrollment');
  const enrollmentSecret = secret('vera_enroll_');
  store.db.exec('BEGIN');
  try {
    store.db.prepare(`INSERT INTO participants (id,name,kind,status) VALUES (?,?,'human','active')`).run(participant, name);
    store.db.prepare(`INSERT INTO memberships (graph_id,participant_id,status) VALUES (?,?,'active')`).run(store.graphId, participant);
    store.db.prepare(`INSERT INTO access_grants
      (id,space_id,participant_id,permissions,status,granted_by,granted_at)
      VALUES (?,?,?,?,'active',?,?)`).run(grant, row.space_id, participant, row.permissions, row.owner_id, now);
    store.db.prepare(`INSERT INTO authenticator_enrollments
      (id,graph_id,participant_id,authorized_by,proof_digest,status,expires_at)
      VALUES (?,?,?,?,?,'pending',?)`).run(enrollment, store.graphId, participant,
        row.owner_id, digestOf(enrollmentSecret), now + 15 * 60 * 1000);
    store.db.prepare(`UPDATE access_invitations SET status='redeemed',redeemed_by=?,redeemed_at=? WHERE id=?`)
      .run(participant, now, invitation);
    store.db.exec('COMMIT');
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
  return { participant, grant, enrollment, enrollmentSecret,
    space: row.space_name, spaceSlug: row.space_slug };
}
