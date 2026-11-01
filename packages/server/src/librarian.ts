import { randomUUID } from 'node:crypto';

import type { Change, ParticipantId } from '@vera/core';
import type { Store } from '@vera/store';

export type LibrarianRequestStatus = 'queued' | 'working' | 'answered' | 'failed' | 'cancelled';

export interface LibrarianRequest {
  id: string;
  conversationId: string;
  askedBy: ParticipantId;
  modality: 'audio' | 'block' | 'page';
  text: string;
  sourcePageId: string | null;
  sourceBlockId: string | null;
  recordingId: string | null;
  contextSnapshot: string;
  status: LibrarianRequestStatus;
  dispatchStatus: 'pending' | 'delivered' | 'failed';
  dispatchAttempts: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  lastDispatchAt: number | null;
  failureReason: string | null;
  events: Array<{
    id: string;
    kind: 'stage' | 'tool' | 'pending';
    text: string;
    createdBy: ParticipantId;
    createdAt: number;
  }>;
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

export interface LibrarianConversation {
  id: string;
  human: ParticipantId;
  agent: ParticipantId;
  title: string;
  status: 'active' | 'closed';
  createdAt: number;
}

interface RequestRow {
  id: string;
  conversation_id: string;
  asked_by: ParticipantId;
  modality: 'audio' | 'block' | 'page';
  text: string;
  source_page_id: string | null;
  source_block_id: string | null;
  recording_id: string | null;
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

export function createLibrarianConversation(store: Store, input: {
  human: ParticipantId;
  agent: ParticipantId;
  title: string;
  now?: number;
}): LibrarianConversation {
  const now = input.now ?? Date.now();
  const id = `conversation:${randomUUID()}`;
  store.db.exec('BEGIN');
  try {
    store.db.prepare(`UPDATE agent_conversations SET status='closed'
      WHERE graph_id=? AND human_id=? AND agent_id=? AND status='active'`).run(
      store.graphId, input.human, input.agent,
    );
    store.db.prepare(`INSERT INTO agent_conversations
      (id, graph_id, human_id, agent_id, title, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?)`).run(
      id, store.graphId, input.human, input.agent, input.title, now,
    );
    store.db.exec('COMMIT');
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
  return librarianConversation(store, id)!;
}

export function librarianConversation(store: Store, id: string): LibrarianConversation | undefined {
  const row = store.db.prepare(`SELECT id, human_id, agent_id, title, status, created_at
    FROM agent_conversations WHERE graph_id=? AND id=?`).get(store.graphId, id) as ConversationRow | undefined;
  return row === undefined ? undefined : fromConversationRow(row);
}

export function librarianConversations(
  store: Store,
  human: ParticipantId,
  agent: ParticipantId,
): LibrarianConversation[] {
  const rows = store.db.prepare(`SELECT id, human_id, agent_id, title, status, created_at
    FROM agent_conversations WHERE graph_id=? AND human_id=? AND agent_id=?
    ORDER BY status='active' DESC, created_at DESC`).all(
    store.graphId, human, agent,
  ) as unknown as ConversationRow[];
  return rows.map(fromConversationRow);
}

export function activateLibrarianConversation(store: Store, input: {
  id: string;
  human: ParticipantId;
  agent: ParticipantId;
}): LibrarianConversation | undefined {
  const selected = librarianConversation(store, input.id);
  if (selected === undefined || selected.human !== input.human || selected.agent !== input.agent) return undefined;
  store.db.exec('BEGIN');
  try {
    store.db.prepare(`UPDATE agent_conversations SET status='closed'
      WHERE graph_id=? AND human_id=? AND agent_id=? AND status='active'`).run(
      store.graphId, input.human, input.agent,
    );
    store.db.prepare(`UPDATE agent_conversations SET status='active' WHERE graph_id=? AND id=?`).run(
      store.graphId, input.id,
    );
    store.db.exec('COMMIT');
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
  return librarianConversation(store, input.id);
}

export function createLibrarianRequest(store: Store, input: {
  askedBy: ParticipantId;
  agent: ParticipantId;
  modality: 'audio' | 'block' | 'page';
  text: string;
  sourcePageId: string;
  sourceBlockId?: string | null;
  recordingId?: string | null;
  conversationId?: string;
  contextSnapshot: string;
  now?: number;
}): LibrarianRequest {
  const now = input.now ?? Date.now();
  const id = `agent-request:${randomUUID()}`;
  const selected = input.conversationId === undefined ? undefined : librarianConversation(store, input.conversationId);
  const conversationId = selected !== undefined && selected.status === 'active' &&
    selected.human === input.askedBy && selected.agent === input.agent
    ? selected.id
    : conversation(store, input.askedBy, input.agent, now);
  store.db.prepare(`INSERT INTO agent_requests (
    id, conversation_id, graph_id, asked_by, modality, text, source_page_id,
    source_block_id, recording_id, context_snapshot, retry_of, status, dispatch_status,
    dispatch_attempts, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'queued', 'pending', 0, ?)`).run(
    id, conversationId, store.graphId, input.askedBy, input.modality, input.text,
    input.sourcePageId, input.sourceBlockId ?? null, input.recordingId ?? null, input.contextSnapshot, now,
  );
  return librarianRequest(store, id)!;
}

const SELECT_REQUEST = `SELECT r.*,
  a.id AS reply_id, a.answered_by, a.text AS reply_text, a.created_at AS reply_created_at,
  p.id AS proposal_id, p.changes_json, p.status AS proposal_status
  FROM agent_requests r
  LEFT JOIN agent_replies a ON a.request_id=r.id
  LEFT JOIN agent_operation_proposals p ON p.reply_id=a.id`;

interface ConversationRow {
  id: string;
  human_id: ParticipantId;
  agent_id: ParticipantId;
  title: string;
  status: 'active' | 'closed';
  created_at: number;
}

const fromConversationRow = (row: ConversationRow): LibrarianConversation => ({
  id: row.id,
  human: row.human_id,
  agent: row.agent_id,
  title: row.title,
  status: row.status,
  createdAt: row.created_at,
});

/** La conversación activa entre una persona y su agente, sin crearla al leer. */
export function activeLibrarianConversation(
  store: Store,
  human: ParticipantId,
  agent: ParticipantId,
): LibrarianConversation | undefined {
  const row = store.db.prepare(`SELECT id, human_id, agent_id, title, status, created_at
    FROM agent_conversations
    WHERE graph_id=? AND human_id=? AND agent_id=? AND status='active'`).get(
    store.graphId, human, agent,
  ) as ConversationRow | undefined;
  return row === undefined ? undefined : fromConversationRow(row);
}

function fromRow(store: Store, row: RequestRow): LibrarianRequest {
  const eventRows = store.db.prepare(`SELECT id, kind, text, created_by, created_at
    FROM agent_request_events WHERE request_id=? ORDER BY created_at ASC, rowid ASC`).all(row.id) as unknown as Array<{
      id: string; kind: 'stage' | 'tool' | 'pending'; text: string; created_by: ParticipantId; created_at: number;
    }>;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    askedBy: row.asked_by,
    modality: row.modality,
    text: row.text,
    sourcePageId: row.source_page_id,
    sourceBlockId: row.source_block_id,
    recordingId: row.recording_id,
    contextSnapshot: row.context_snapshot,
    status: row.status,
    dispatchStatus: row.dispatch_status,
    dispatchAttempts: row.dispatch_attempts,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    lastDispatchAt: row.last_dispatch_at,
    failureReason: row.failure_reason,
    events: eventRows.map((event) => ({
      id: event.id, kind: event.kind, text: event.text,
      createdBy: event.created_by, createdAt: event.created_at,
    })),
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
  return row === undefined ? undefined : fromRow(store, row);
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
  return rows.map((row) => fromRow(store, row));
}

/** Todos los turnos de una conversación, en orden de lectura. */
export function librarianRequestsInConversation(
  store: Store,
  conversationId: string,
  askedBy?: ParticipantId,
): LibrarianRequest[] {
  const askerClause = askedBy === undefined ? '' : ' AND r.asked_by=?';
  const parameters: string[] = [store.graphId, conversationId];
  if (askedBy !== undefined) parameters.push(askedBy);
  const rows = store.db.prepare(
    `${SELECT_REQUEST} WHERE r.graph_id=? AND r.conversation_id=?${askerClause}
      ORDER BY r.created_at ASC, r.rowid ASC`,
  ).all(...parameters) as unknown as RequestRow[];
  return rows.map((row) => fromRow(store, row));
}

/** Un hito durable y público del trabajo, nunca razonamiento privado. */
export function addLibrarianProgress(store: Store, input: {
  requestId: string;
  kind: 'stage' | 'tool' | 'pending';
  text: string;
  createdBy: ParticipantId;
  now?: number;
}): LibrarianRequest | undefined {
  const request = librarianRequest(store, input.requestId);
  if (request === undefined || request.status !== 'working') return undefined;
  store.db.prepare(`INSERT INTO agent_request_events
    (id, request_id, kind, text, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    `agent-request-event:${randomUUID()}`, input.requestId, input.kind, input.text,
    input.createdBy, input.now ?? Date.now(),
  );
  return librarianRequest(store, input.requestId);
}

export function markLibrarianDispatched(store: Store, id: string, delivered: boolean, reason?: string): void {
  store.db.prepare(`UPDATE agent_requests SET dispatch_status=?, dispatch_attempts=dispatch_attempts+1,
    last_dispatch_at=?, failure_reason=? WHERE graph_id=? AND id=? AND status='queued'`).run(
    delivered ? 'delivered' : 'failed', Date.now(), delivered ? null : (reason ?? 'no se pudo despertar al bibliotecario'),
    store.graphId, id,
  );
}

export function pendingLibrarianDispatches(store: Store, now = Date.now()): string[] {
  const working = store.db.prepare(`SELECT 1 FROM agent_requests
    WHERE graph_id=? AND status='working' LIMIT 1`).get(store.graphId);
  if (working !== undefined) return [];

  const oldest = store.db.prepare(`SELECT id, dispatch_status, last_dispatch_at
    FROM agent_requests
    WHERE graph_id=? AND status='queued'
    ORDER BY created_at ASC, rowid ASC LIMIT 1`).get(store.graphId) as {
      id: string;
      dispatch_status: 'pending' | 'delivered' | 'failed';
      last_dispatch_at: number | null;
    } | undefined;
  if (oldest === undefined) return [];

  // Un despertar entregado reserva el turno mientras el worker lo reclama. Si
  // éste desaparece, la reserva caduca y se reenvía el mismo id durable.
  const retryAfter = oldest.dispatch_status === 'delivered' ? 120_000 : 30_000;
  if (oldest.last_dispatch_at !== null && oldest.last_dispatch_at > now - retryAfter) return [];
  return [oldest.id];
}

export function claimLibrarianRequest(store: Store, id: string): LibrarianRequest | undefined {
  store.db.prepare(`UPDATE agent_requests SET status='working', started_at=?, failure_reason=NULL
    WHERE graph_id=? AND id=? AND status='queued'
      AND NOT EXISTS (
        SELECT 1 FROM agent_requests active
        WHERE active.graph_id=agent_requests.graph_id
          AND active.id!=agent_requests.id
          AND (
            active.status='working'
            OR (active.status='queued' AND active.dispatch_status='delivered')
          )
      )`).run(Date.now(), store.graphId, id);
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
