import { randomBytes } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import { isoUint8Array } from '@simplewebauthn/server/helpers';
import type { Store } from '@vera/store';
import { digestOf } from './credentials.ts';
import { canonicalParticipant, participantAliases } from './participant-identities.ts';

const opaque = (prefix: string): string => `${prefix}${randomBytes(32).toString('base64url')}`;
const identifier = (prefix: string): string => `${prefix}:${randomBytes(8).toString('hex')}`;

interface Ceremony { rpID: string; origin: string }

const ENROLLMENT_LIFETIME_MS = 15 * 60 * 1000;

function humanParticipant(store: Store, claimed: string): string {
  const rows = store.db.prepare(`SELECT id FROM participants
    WHERE kind='human' AND (status='active' OR id IN (SELECT duplicate_id FROM participant_reconciliations))
      AND (id=? OR lower(name)=lower(?))
    ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END`).all(claimed, claimed, claimed) as Array<{ id: string }>;
  if (rows.length !== 1) throw new Error('la identidad no existe o no es inequívoca');
  const canonical = canonicalParticipant(store, rows[0]!.id);
  const active = store.db.prepare(`SELECT 1 FROM participants p
    JOIN memberships m ON m.participant_id=p.id AND m.graph_id=? AND m.status='active'
    WHERE p.id=? AND p.kind='human' AND p.status='active'`).get(store.graphId, canonical);
  if (active === undefined) throw new Error('la identidad canónica no está activa');
  return canonical;
}

export function ceremonyFor(host: string, forwardedProto?: string): Ceremony {
  const hostname = host.replace(/:\d+$/, '');
  const local = hostname === 'localhost' || hostname === '127.0.0.1';
  const protocol = forwardedProto?.split(',')[0]?.trim() || (local ? 'http' : 'https');
  return { rpID: hostname, origin: `${protocol}://${host}` };
}

function enrollment(store: Store, id: string, proof: string): any {
  const row = store.db.prepare(`SELECT e.*, p.name FROM authenticator_enrollments e
    JOIN participants p ON p.id=e.participant_id WHERE e.id=? AND e.proof_digest=?`)
    .get(id, digestOf(proof)) as any;
  if (row === undefined || row.status !== 'pending' || row.expires_at <= Date.now()) {
    throw new Error('la matrícula no existe, venció o ya fue usada');
  }
  return row;
}

/**
 * Autoriza otra forma de entrada para una persona que ya demostró quién es.
 *
 * La sesión y la matrícula son objetos distintos: la primera prueba la
 * identidad en el dispositivo presente; la segunda sólo permite que otro
 * autenticador se vincule a esa misma identidad. No crea participante,
 * membresía ni permiso.
 */
export function beginDeviceEnrollment(store: Store, participant: string): {
  enrollment: string; secret: string; expiresAt: number;
} {
  const enrollment = identifier('enrollment');
  const secret = opaque('vera_enroll_');
  const expiresAt = Date.now() + ENROLLMENT_LIFETIME_MS;
  store.db.prepare(`INSERT INTO authenticator_enrollments
    (id,graph_id,participant_id,authorized_by,proof_digest,status,expires_at)
    VALUES (?,?,?,?,?,'pending',?)`).run(enrollment, store.graphId, participant,
      participant, digestOf(secret), expiresAt);
  return { enrollment, secret, expiresAt };
}

export async function registrationOptions(store: Store, enrollmentId: string, proof: string,
  ceremony: Ceremony): Promise<unknown> {
  const held = enrollment(store, enrollmentId, proof);
  const existing = store.db.prepare(`SELECT credential_id,transports FROM human_authenticators
    WHERE participant_id=? AND status='active'`).all(held.participant_id) as any[];
  const options = await generateRegistrationOptions({
    rpName: 'Vera', rpID: ceremony.rpID, userName: held.name,
    userID: isoUint8Array.fromUTF8String(held.participant_id),
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    excludeCredentials: existing.map((one) => ({ id: one.credential_id,
      transports: String(one.transports).split(',').filter(Boolean) })) as any,
  });
  store.db.prepare(`DELETE FROM webauthn_challenges WHERE participant_id=? AND purpose='registration'`)
    .run(held.participant_id);
  store.db.prepare(`INSERT INTO webauthn_challenges
    (id,participant_id,purpose,challenge,rp_id,origin,expires_at) VALUES (?,?,'registration',?,?,?,?)`)
    .run(identifier('challenge'), held.participant_id, options.challenge, ceremony.rpID,
      ceremony.origin, Date.now() + 5 * 60 * 1000);
  return options;
}

export function issueSession(store: Store, participant: string): { secret: string; expiresAt: number } {
  const secret = opaque('vera_session_');
  const now = Date.now();
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000;
  store.db.prepare(`INSERT INTO human_sessions
    (id,participant_id,proof_digest,status,began_at,expires_at,last_seen_at)
    VALUES (?,?,?,'active',?,?,?)`).run(identifier('session'), participant, digestOf(secret), now, expiresAt, now);
  return { secret, expiresAt };
}

export async function finishRegistration(store: Store, enrollmentId: string, proof: string,
  response: RegistrationResponseJSON): Promise<{ secret: string; expiresAt: number; participant: string }> {
  const held = enrollment(store, enrollmentId, proof);
  const challenge = store.db.prepare(`SELECT * FROM webauthn_challenges
    WHERE participant_id=? AND purpose='registration' AND expires_at>?`)
    .get(held.participant_id, Date.now()) as any;
  if (challenge === undefined) throw new Error('el desafío de registro venció');
  const verified = await verifyRegistrationResponse({ response, expectedChallenge: challenge.challenge,
    expectedOrigin: challenge.origin, expectedRPID: challenge.rp_id, requireUserVerification: true });
  if (!verified.verified || verified.registrationInfo === undefined) throw new Error('la passkey no pudo verificarse');
  const { credential, credentialDeviceType, credentialBackedUp } = verified.registrationInfo;
  store.db.exec('BEGIN');
  try {
    store.db.prepare(`INSERT INTO human_authenticators
      (credential_id,participant_id,public_key,counter,transports,device_type,backed_up,registered_at,status)
      VALUES (?,?,?,?,?,?,?,?,'active')`).run(credential.id, held.participant_id,
        Buffer.from(credential.publicKey), credential.counter, (credential.transports ?? []).join(','),
        credentialDeviceType, credentialBackedUp ? 1 : 0, Date.now());
    store.db.prepare(`UPDATE authenticator_enrollments SET status='completed' WHERE id=?`).run(enrollmentId);
    store.db.prepare(`DELETE FROM webauthn_challenges WHERE participant_id=? AND purpose='registration'`)
      .run(held.participant_id);
    store.db.exec('COMMIT');
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
  return { ...issueSession(store, held.participant_id), participant: held.participant_id };
}

export async function authenticationOptions(store: Store, participant: string,
  ceremony: Ceremony): Promise<unknown> {
  participant = humanParticipant(store, participant);
  const identities = participantAliases(store, participant);
  const places = identities.map(() => '?').join(',');
  const credentials = store.db.prepare(`SELECT credential_id,transports FROM human_authenticators
    WHERE participant_id IN (${places}) AND status='active'`).all(...identities) as any[];
  if (credentials.length === 0) throw new Error('no hay passkeys activas para esta identidad');
  const options = await generateAuthenticationOptions({ rpID: ceremony.rpID, userVerification: 'required',
    allowCredentials: credentials.map((one) => ({ id: one.credential_id,
      transports: String(one.transports).split(',').filter(Boolean) })) as any });
  store.db.prepare(`DELETE FROM webauthn_challenges WHERE participant_id=? AND purpose='authentication'`)
    .run(participant);
  store.db.prepare(`INSERT INTO webauthn_challenges
    (id,participant_id,purpose,challenge,rp_id,origin,expires_at) VALUES (?,?,'authentication',?,?,?,?)`)
    .run(identifier('challenge'), participant, options.challenge, ceremony.rpID,
      ceremony.origin, Date.now() + 5 * 60 * 1000);
  return options;
}

export async function finishAuthentication(store: Store, participant: string,
  response: AuthenticationResponseJSON): Promise<{ secret: string; expiresAt: number }> {
  participant = humanParticipant(store, participant);
  const challenge = store.db.prepare(`SELECT * FROM webauthn_challenges
    WHERE participant_id=? AND purpose='authentication' AND expires_at>?`).get(participant, Date.now()) as any;
  const identities = participantAliases(store, participant);
  const places = identities.map(() => '?').join(',');
  const row = store.db.prepare(`SELECT * FROM human_authenticators
    WHERE credential_id=? AND participant_id IN (${places}) AND status='active'`)
    .get(response.id, ...identities) as any;
  if (challenge === undefined || row === undefined) throw new Error('el desafío o la passkey no son válidos');
  const credential: WebAuthnCredential = { id: row.credential_id,
    publicKey: new Uint8Array(row.public_key as Uint8Array), counter: row.counter,
    transports: String(row.transports).split(',').filter(Boolean) as any };
  const verified = await verifyAuthenticationResponse({ response, expectedChallenge: challenge.challenge,
    expectedOrigin: challenge.origin, expectedRPID: challenge.rp_id, credential,
    requireUserVerification: true });
  if (!verified.verified) throw new Error('la passkey no pudo verificarse');
  store.db.prepare(`UPDATE human_authenticators SET counter=? WHERE credential_id=?`)
    .run(verified.authenticationInfo.newCounter, row.credential_id);
  store.db.prepare(`DELETE FROM webauthn_challenges WHERE participant_id=? AND purpose='authentication'`)
    .run(participant);
  return issueSession(store, participant);
}

export function participantForSession(store: Store, secret: string): string | null {
  if (!secret.startsWith('vera_session_')) return null;
  const row = store.db.prepare(`SELECT s.id,s.participant_id FROM human_sessions s
    WHERE s.proof_digest=? AND s.status='active' AND s.expires_at>?`)
    .get(digestOf(secret), Date.now()) as any;
  if (row === undefined) return null;
  const participant = canonicalParticipant(store, row.participant_id);
  const active = store.db.prepare(`SELECT 1 FROM participants p
    JOIN memberships m ON m.participant_id=p.id AND m.graph_id=? AND m.status='active'
    WHERE p.id=? AND p.status='active'`).get(store.graphId, participant);
  if (active === undefined) return null;
  store.db.prepare(`UPDATE human_sessions SET last_seen_at=? WHERE id=?`).run(Date.now(), row.id);
  return participant;
}

export function revokeSession(store: Store, secret: string): boolean {
  return Number(store.db.prepare(`UPDATE human_sessions SET status='revoked',revoked_at=?
    WHERE proof_digest=? AND status='active'`).run(Date.now(), digestOf(secret)).changes) > 0;
}
