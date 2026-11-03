import { randomBytes } from 'node:crypto';
import type { Store } from '@vera/store';
import { digestOf } from './credentials.ts';

export interface PageShare {
  id: string;
  page: string;
  status: 'active' | 'revoked' | 'expired';
  issuedAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  lastUsedAt: number | null;
}

const id = (): string => `page-share:${randomBytes(8).toString('hex')}`;
const secret = (): string => `vera_page_${randomBytes(32).toString('base64url')}`;

const expireDueShares = (store: Store): void => {
  store.db.prepare(`UPDATE page_shares SET status='expired'
    WHERE graph_id=? AND status='active' AND expires_at IS NOT NULL AND expires_at<=?`)
    .run(store.graphId, Date.now());
};

const fromRow = (row: any): PageShare => ({
  id: String(row.id),
  page: String(row.page_id),
  status: row.status as PageShare['status'],
  issuedAt: Number(row.issued_at),
  expiresAt: row.expires_at === null ? null : Number(row.expires_at),
  revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
  lastUsedAt: row.last_used_at === null ? null : Number(row.last_used_at),
});

/** El secreto se devuelve en este acto y nunca vuelve a ser legible. */
export function createPageShare(store: Store, owner: string, page: string,
  expiresAt: number | null): PageShare & { secret: string } {
  if (expiresAt !== null && expiresAt <= Date.now()) {
    throw new Error('el vencimiento debe estar en el futuro');
  }
  const proof = secret();
  const share: PageShare = {
    id: id(), page, status: 'active', issuedAt: Date.now(), expiresAt,
    revokedAt: null, lastUsedAt: null,
  };
  store.db.prepare(`INSERT INTO page_shares
    (id,graph_id,page_id,issued_by,secret_digest,status,issued_at,expires_at)
    VALUES (?,?,?,?,?,'active',?,?)`)
    .run(share.id, store.graphId, page, owner, digestOf(proof), share.issuedAt, expiresAt);
  return { ...share, secret: proof };
}

export function pageShares(store: Store, page: string): PageShare[] {
  expireDueShares(store);
  return (store.db.prepare(`SELECT id,page_id,status,issued_at,expires_at,revoked_at,last_used_at
    FROM page_shares WHERE graph_id=? AND page_id=? ORDER BY issued_at DESC,id`)
    .all(store.graphId, page) as any[]).map(fromRow);
}

export function revokePageShare(store: Store, share: string): boolean {
  return Number(store.db.prepare(`UPDATE page_shares SET status='revoked',revoked_at=?
    WHERE id=? AND graph_id=? AND status='active'`)
    .run(Date.now(), share, store.graphId).changes) > 0;
}

/** Resuelve una capacidad presentada como `id.secret`; la posesión es el permiso. */
export function resolvePageShare(store: Store, presented: string | null): PageShare | null {
  if (presented === null) return null;
  const separator = presented.indexOf('.');
  if (separator <= 0) return null;
  const shareId = presented.slice(0, separator);
  const proof = presented.slice(separator + 1);
  if (proof === '') return null;
  expireDueShares(store);
  const row = store.db.prepare(`SELECT id,page_id,status,issued_at,expires_at,revoked_at,last_used_at
    FROM page_shares WHERE id=? AND graph_id=? AND secret_digest=? AND status='active'`)
    .get(shareId, store.graphId, digestOf(proof)) as any;
  if (row === undefined) return null;
  const usedAt = Date.now();
  const previous = row.last_used_at === null ? null : Number(row.last_used_at);
  const refreshed = previous === null || usedAt - previous >= 60_000;
  if (refreshed) {
    store.db.prepare('UPDATE page_shares SET last_used_at=? WHERE id=?').run(usedAt, shareId);
  }
  return { ...fromRow(row), lastUsedAt: refreshed ? usedAt : previous };
}
