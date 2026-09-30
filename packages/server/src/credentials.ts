// Credenciales de agente.
//
// Traducido de specs/agent-participation.allium, contrato AgentCredentialing.
//
// Vive en el servidor y no en el dominio porque core.allium excluye
// explícitamente el mecanismo de autenticación: el grafo sabe quién escribió,
// no cómo se demostró que era quien decía ser.
//
// Una credencial no pasa por `submitOperation` y es deliberado. Emitirla no
// cambia lo que el corpus dice, igual que plegar un bloque no lo cambia. El
// registro canónico guarda lo escrito, no los permisos de quien lo escribió.

import { createHash, randomBytes } from 'node:crypto';

import type { Store } from '@vera/store';

/**
 * Lo que una credencial puede hacer.
 *
 * Deliberadamente grueso. Un vocabulario fino como para describir cada tipo de
 * cambio sería el vocabulario de cambios otra vez, y nadie podría leer un token
 * y decir qué permite.
 *
 * `discard` va aparte de `write` porque borrar es el único acto que el grafo no
 * puede enseñarte después. Todo lo demás deja el estado anterior legible en el
 * registro; una eliminación deja una ausencia.
 */
export const SCOPES = ['read', 'write', 'discard', 'capture'] as const;
export type Scope = (typeof SCOPES)[number];

export interface Credential {
  id: string;
  participant: string;
  scopes: Scope[];
  status: 'active' | 'revoked';
  label: string;
  issuedBy: string;
  issuedAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  lastUsedAt: number | null;
}

/** El prefijo hace reconocible un secreto de Vera si aparece donde no debe. */
const PREFIX = 'vera_ag_';

/**
 * @invariant TheSecretIsNeverStored: se guarda lo que prueba el secreto, nunca
 * el secreto. SHA-256 sin sal a propósito: el secreto son 32 bytes de azar, no
 * una contraseña elegida por una persona, así que no hay diccionario que salar
 * y la búsqueda por digest tiene que ser exacta para poder indexarse.
 */
export function digestOf(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

function readScopes(raw: string): Scope[] {
  return raw
    .split(',')
    .filter((scope): scope is Scope => (SCOPES as readonly string[]).includes(scope));
}

interface Row {
  id: string;
  participant_id: string;
  scopes: string;
  status: string;
  label: string;
  issued_by: string;
  issued_at: number;
  expires_at: number | null;
  revoked_at: number | null;
  last_used_at: number | null;
}

function toCredential(row: Row): Credential {
  return {
    id: row.id,
    participant: row.participant_id,
    scopes: readScopes(row.scopes),
    status: row.status === 'revoked' ? 'revoked' : 'active',
    label: row.label,
    issuedBy: row.issued_by,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
  };
}

/**
 * rule OwnerIssuesCredential.
 *
 * Devuelve el secreto en claro, y es la única vez que existe fuera de quien lo
 * recibe: @guarantee TheSecretIsShownOnce. Quien lo pierda necesita una
 * credencial nueva, porque de esta no queda nada de donde sacarlo.
 */
export function issueCredential(
  store: Store,
  input: {
    participant: string;
    scopes: Scope[];
    label: string;
    issuedBy: string;
    expiresAt?: number | null;
  },
): { credential: Credential; secret: string } {
  if (input.scopes.length === 0) {
    throw new Error('una credencial sin alcance no puede hacer nada; no se emite');
  }

  const secret = `${PREFIX}${randomBytes(32).toString('base64url')}`;
  const id = `token:${randomBytes(8).toString('hex')}`;
  const at = Date.now();
  // Ordenados para que dos credenciales con los mismos alcances se lean iguales.
  const scopes = [...new Set(input.scopes)].sort();

  store.db
    .prepare(
      `INSERT INTO access_tokens (
         id, graph_id, participant_id, secret_digest, scopes, status, label,
         issued_by, issued_at, expires_at, revoked_at, last_used_at
       ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, NULL, NULL)`,
    )
    .run(
      id,
      store.graphId,
      input.participant,
      digestOf(secret),
      scopes.join(','),
      input.label,
      input.issuedBy,
      at,
      input.expiresAt ?? null,
    );

  return {
    secret,
    credential: {
      id,
      participant: input.participant,
      scopes,
      status: 'active',
      label: input.label,
      issuedBy: input.issuedBy,
      issuedAt: at,
      expiresAt: input.expiresAt ?? null,
      revokedAt: null,
      lastUsedAt: null,
    },
  };
}

/** rule OwnerRevokesCredential. No toca nada de lo que la credencial escribió. */
export function revokeCredential(store: Store, id: string): Credential | null {
  const at = Date.now();
  store.db
    .prepare(`UPDATE access_tokens SET status = 'revoked', revoked_at = ? WHERE id = ? AND status = 'active'`)
    .run(at, id);
  return credentialById(store, id);
}

export function credentialById(store: Store, id: string): Credential | null {
  const row = store.db
    .prepare(
      `SELECT id, participant_id, scopes, status, label, issued_by, issued_at,
              expires_at, revoked_at, last_used_at
       FROM access_tokens WHERE id = ? AND graph_id = ?`,
    )
    .get(id, store.graphId) as Row | undefined;
  return row === undefined ? null : toCredential(row);
}

/** Lo que el dueño ve. Nunca incluye el secreto, porque ya no existe. */
export function listCredentials(store: Store): Credential[] {
  const rows = store.db
    .prepare(
      `SELECT id, participant_id, scopes, status, label, issued_by, issued_at,
              expires_at, revoked_at, last_used_at
       FROM access_tokens WHERE graph_id = ? ORDER BY issued_at DESC`,
    )
    .all(store.graphId) as unknown as Row[];
  return rows.map(toCredential);
}

export type Refusal =
  | { ok: false; reason: 'unknown'; detail: string }
  | { ok: false; reason: 'revoked'; detail: string }
  | { ok: false; reason: 'expired'; detail: string };

export type Resolution = { ok: true; credential: Credential } | Refusal;

/**
 * Resuelve un secreto presentado a la credencial que nombra.
 *
 * @invariant IdentityComesFromTheCredential: de aquí sale quién es el
 * participante. Quien llama no lo aporta; como mucho lo afirma, y afirmarlo
 * distinto se rechaza más arriba.
 *
 * @invariant RevocationTakesEffectAtOnce: se lee el estado en cada resolución,
 * no se cachea. No hay ventana en la que una credencial retirada siga
 * escribiendo.
 */
export function resolveSecret(store: Store, secret: string): Resolution {
  const digest = digestOf(secret);
  const row = store.db
    .prepare(
      `SELECT id, participant_id, scopes, status, label, issued_by, issued_at,
              expires_at, revoked_at, last_used_at
       FROM access_tokens WHERE secret_digest = ? AND graph_id = ?`,
    )
    .get(digest, store.graphId) as Row | undefined;

  // No se iguala el tiempo de respuesta, y no por descuido: el secreto son 256
  // bits de azar buscados por igualdad exacta sobre un índice. Lo que un
  // atacante podría medir es si un secreto existe, y para aprovecharlo tendría
  // que acertar uno primero. Igualar aquí el tiempo sería ceremonia sobre una
  // puerta que no se abre adivinando.
  if (row === undefined) {
    return { ok: false, reason: 'unknown', detail: 'la credencial no existe' };
  }

  const credential = toCredential(row);
  if (credential.status === 'revoked') {
    return { ok: false, reason: 'revoked', detail: 'la credencial fue retirada' };
  }
  if (credential.expiresAt !== null && credential.expiresAt <= Date.now()) {
    return { ok: false, reason: 'expired', detail: 'la credencial venció' };
  }

  store.db.prepare('UPDATE access_tokens SET last_used_at = ? WHERE id = ?').run(Date.now(), credential.id);
  return { ok: true, credential };
}

/** Los cambios que dejan una ausencia en vez de un estado anterior legible. */
const DISCARDS = new Set(['remove_block', 'remove_page']);

/**
 * @invariant ScopeIsCheckedPerChange: se decide contra cada cambio, no una vez
 * en la puerta. Una credencial que puede escribir no borra por ello.
 *
 * Devuelve null cuando el alcance alcanza, y si no el motivo, porque
 * @guarantee RefusalsSayWhy: un agente que no distingue «no puedes» de «eso no
 * se puede» no sabe si reintentar o corregirse.
 */
export function scopeRefusal(credential: Credential, changeKind: string): string | null {
  if (!credential.scopes.includes('write')) {
    return `la credencial ${credential.label} no tiene alcance write`;
  }
  if (DISCARDS.has(changeKind) && !credential.scopes.includes('discard')) {
    return `la credencial ${credential.label} no tiene alcance discard, y ${changeKind} borra`;
  }
  return null;
}

/** Extrae el secreto de una cabecera `Authorization: Bearer …`. */
export function bearerOf(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const secret = match?.[1]?.trim();
  return secret === undefined || secret === '' ? null : secret;
}
