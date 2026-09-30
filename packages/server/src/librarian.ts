import { randomUUID } from 'node:crypto';

import type { Change, ParticipantId } from '@vera/core';
import type { Store } from '@vera/store';

export type LibrarianRequestStatus = 'queued' | 'working' | 'answered' | 'failed' | 'cancelled';

export interface LibrarianRequest {
  id: string;
  conversationId: string;
  askedBy: ParticipantId;
  modality: 'block' | 'page';
  text: string;
  sourcePageId: string | null;
  sourceBlockId: string | null;
  contextSnapshot: string;
  status: LibrarianRequestStatus;
  dispatchStatus: 'pending' | 'delivered' | 'failed';
  dispatchAttempts: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  lastDispatchAt: number | null;
  failureReason: string | null;
  reply: null | {
    id: string;
    answeredBy: ParticipantId;
    text: string;
    createdAt: number;
    proposal: null | {
      id: string;
      changes: Change[];
      status: 'proposed' | 'accepted' | 'rejected';
    };
  };
}

interface RequestRow {
  id: string;
  conversation_id: string;
  asked_by: ParticipantId;
  modality: 'block' | 'page';
  text: string;
  source_page_id: string | null;
  source_block_id: string | null;
  context_snapshot: string;
  status: LibrarianRequestStatus;
  dispatch_status: 'pending' | 'delivered' | 'failed';
  dispatch_attempts: number;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  last_dispatch_at: number | null;
  failure_reason: string | null;
  reply_id: string | null;
  answered_by: ParticipantId | null;
  reply_text: string | null;
  reply_created_at: number | null;
  proposal_id: string | null;
  changes_json: string | null;
  proposal_status: 'proposed' | 'accepted' | 'rejected' | null;
}

function conversation(store: Store, human: ParticipantId, agent: ParticipantId, now: number): string {
  const existing = store.db.prepare(`SELECT id FROM agent_conversations
    WHERE graph_id=? AND human_id=? AND agent_id=? AND status='active'`).get(
    store.graphId, human, agent,
  ) as { id: string } | undefined;
  if (existing !== undefined) return existing.id;
  const id = `conversation:${randomUUID()}`;
  store.db.prepare(`INSERT INTO agent_conversations
    (id, graph_id, human_id, agent_id, title, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?)`).run(
    id, store.graphId, human, agent, 'Herbert y el bibliotecario', now,
  );
  return id;
}

export function createLibrarianRequest(store: Store, input: {
  askedBy: ParticipantId;
  agent: ParticipantId;
  modality: 'block' | 'page';
  text: string;
  sourcePageId: string;
  sourceBlockId?: string | null;
  contextSnapshot: string;
  now?: number;
}): LibrarianRequest {
  const now = input.now ?? Date.now();
  const id = `agent-request:${randomUUID()}`;
  const conversationId = conversation(store, input.askedBy, input.agent, now);
  store.db.prepare(`INSERT INTO agent_requests (
    id, conversation_id, graph_id, asked_by, modality, text, source_page_id,
    source_block_id, context_snapshot, retry_of, status, dispatch_status,
    dispatch_attempts, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'queued', 'pending', 0, ?)`).run(
    id, conversationId, store.graphId, input.askedBy, input.modality, input.text,
    input.sourcePageId, input.sourceBlockId ?? null, input.contextSnapshot, now,
  );
  return librarianRequest(store, id)!;
}

const SELECT_REQUEST = `SELECT r.*,
  a.id AS reply_id, a.answered_by, a.text AS reply_text, a.created_at AS reply_created_at,
  p.id AS proposal_id, p.changes_json, p.status AS proposal_status
  FROM agent_requests r
  LEFT JOIN agent_replies a ON a.request_id=r.id
  LEFT JOIN agent_operation_proposals p ON p.reply_id=a.id`;

function fromRow(row: RequestRow): LibrarianRequest {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    askedBy: row.asked_by,
    modality: row.modality,
    text: row.text,
    sourcePageId: row.source_page_id,
    sourceBlockId: row.source_block_id,
    contextSnapshot: row.context_snapshot,
    status: row.status,
    dispatchStatus: row.dispatch_status,
    dispatchAttempts: row.dispatch_attempts,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    lastDispatchAt: row.last_dispatch_at,
    failureReason: row.failure_reason,
    reply: row.reply_id === null ? null : {
      id: row.reply_id,
      answeredBy: row.answered_by!,
      text: row.reply_text!,
      createdAt: row.reply_created_at!,
      proposal: row.proposal_id === null ? null : {
        id: row.proposal_id,
        changes: JSON.parse(row.changes_json ?? '[]') as Change[],
        status: row.proposal_status!,
      },
    },
  };
}

export function librarianRequest(store: Store, id: string): LibrarianRequest | undefined {
  const row = store.db.prepare(`${SELECT_REQUEST} WHERE r.graph_id=? AND r.id=?`).get(
    store.graphId, id,
  ) as RequestRow | undefined;
  return row === undefined ? undefined : fromRow(row);
}

export function librarianRequestsFor(
  store: Store,
  sourcePageId: string,
  sourceBlockId?: string | null,
  askedBy?: string,
): LibrarianRequest[] {
  const blockClause = sourceBlockId === undefined ? '' : ' AND r.source_block_id IS ?';
  const askerClause = askedBy === undefined ? '' : ' AND r.asked_by=?';
  const parameters: (string | null)[] = [store.graphId, sourcePageId];
  if (sourceBlockId !== undefined) parameters.push(sourceBlockId);
  if (askedBy !== undefined) parameters.push(askedBy);
  const rows = store.db.prepare(
    `${SELECT_REQUEST} WHERE r.graph_id=? AND r.source_page_id=?${blockClause}${askerClause} ORDER BY r.created_at DESC`,
  ).all(...parameters) as unknown as RequestRow[];
  return rows.map(fromRow);
}

export function markLibrarianDispatched(store: Store, id: string, delivered: boolean, reason?: string): void {
  store.db.prepare(`UPDATE agent_requests SET dispatch_status=?, dispatch_attempts=dispatch_attempts+1,
    last_dispatch_at=?, failure_reason=? WHERE graph_id=? AND id=? AND status='queued'`).run(
    delivered ? 'delivered' : 'failed', Date.now(), delivered ? null : (reason ?? 'no se pudo despertar al bibliotecario'),
    store.graphId, id,
  );
}

export function pendingLibrarianDispatches(store: Store, now = Date.now()): string[] {
  const rows = store.db.prepare(`SELECT id FROM agent_requests
    WHERE graph_id=? AND status='queued' AND dispatch_status!='delivered'
      AND dispatch_attempts < 5
      AND (last_dispatch_at IS NULL OR last_dispatch_at <= ?)
    ORDER BY created_at ASC LIMIT 20`).all(store.graphId, now - 30_000) as { id: string }[];
  return rows.map((row) => row.id);
}

export function claimLibrarianRequest(store: Store, id: string): LibrarianRequest | undefined {
  store.db.prepare(`UPDATE agent_requests SET status='working', started_at=?, failure_reason=NULL
    WHERE graph_id=? AND id=? AND status='queued'`).run(Date.now(), store.graphId, id);
  return librarianRequest(store, id);
}

export function answerLibrarianRequest(store: Store, input: {
  id: string;
  answeredBy: ParticipantId;
  text: string;
  changes?: Change[];
  now?: number;
}): LibrarianRequest | undefined {
  const current = librarianRequest(store, input.id);
  if (current === undefined || current.status !== 'working' || current.reply !== null) return undefined;
  const now = input.now ?? Date.now();
  const reply = `agent-reply:${randomUUID()}`;
  store.db.exec('BEGIN');
  try {
    store.db.prepare(`INSERT INTO agent_replies (id, request_id, answered_by, text, created_at)
      VALUES (?, ?, ?, ?, ?)`).run(reply, input.id, input.answeredBy, input.text, now);
    if ((input.changes?.length ?? 0) > 0) {
      store.db.prepare(`INSERT INTO agent_operation_proposals
        (id, reply_id, proposed_by, changes_json, status, proposed_at)
        VALUES (?, ?, ?, ?, 'proposed', ?)`).run(
        `agent-proposal:${randomUUID()}`, reply, input.answeredBy, JSON.stringify(input.changes), now,
      );
    }
    store.db.prepare(`UPDATE agent_requests SET status='answered', finished_at=? WHERE id=?`).run(now, input.id);
    store.db.exec('COMMIT');
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
  return librarianRequest(store, input.id);
}

export function removeLibrarianRequest(store: Store, id: string): boolean {
  const removed = store.db.prepare(`DELETE FROM agent_requests WHERE graph_id=? AND id=?`).run(
    store.graphId, id,
  );
  return removed.changes === 1;
}
