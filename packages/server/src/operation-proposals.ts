// Propuestas durables de cambios que todavía no pertenecen al corpus.

import { randomUUID } from 'node:crypto';
import type { Change, ContributionChannel, ParticipantId } from '@vera/core';
import type { Store } from '@vera/store';

export type ReviewProposalStatus = 'awaiting_review' | 'accepted' | 'rejected' | 'conflicted';

export interface OperationReviewProposal {
  id: string;
  proposedBy: ParticipantId;
  proposedByName: string;
  originId: string;
  channel: ContributionChannel;
  page: string;
  pageTitle: string;
  block: string;
  change: Change;
  targetRevision: string;
  originalContent: string;
  purpose: string;
  status: ReviewProposalStatus;
  proposedAt: number;
  decidedBy: ParticipantId | null;
  decidedByName: string | null;
  decidedAt: number | null;
}

interface ProposalRow {
  id: string; proposed_by: string; proposed_by_name: string; origin_id: string; channel: string;
  page_id: string; page_title: string | null; block_id: string; change_json: string; target_revision: string;
  original_content: string; purpose: string; status: ReviewProposalStatus; proposed_at: number;
  decided_by: string | null; decided_by_name: string | null; decided_at: number | null;
}

const read = (row: ProposalRow): OperationReviewProposal => ({
  id: row.id,
  proposedBy: row.proposed_by as ParticipantId,
  proposedByName: row.proposed_by_name,
  originId: row.origin_id,
  channel: row.channel as ContributionChannel,
  page: row.page_id,
  pageTitle: row.page_title ?? row.page_id,
  block: row.block_id,
  change: JSON.parse(row.change_json) as Change,
  targetRevision: row.target_revision,
  originalContent: row.original_content,
  purpose: row.purpose,
  status: row.status,
  proposedAt: row.proposed_at,
  decidedBy: row.decided_by as ParticipantId | null,
  decidedByName: row.decided_by_name,
  decidedAt: row.decided_at,
});

const select = `SELECT q.*, proposer.name AS proposed_by_name, reviewer.name AS decided_by_name,
    page.title AS page_title
  FROM operation_review_proposals q
  JOIN participants proposer ON proposer.id=q.proposed_by
  LEFT JOIN participants reviewer ON reviewer.id=q.decided_by
  LEFT JOIN pages page ON page.id=q.page_id`;

export function operationReviewProposals(store: Store): OperationReviewProposal[] {
  return (store.db.prepare(`${select} WHERE q.graph_id=? ORDER BY q.proposed_at DESC`).all(
    store.graphId,
  ) as unknown as ProposalRow[]).map(read);
}

export function operationReviewProposal(store: Store, id: string): OperationReviewProposal | null {
  const row = store.db.prepare(`${select} WHERE q.graph_id=? AND q.id=?`).get(
    store.graphId, id,
  ) as unknown as ProposalRow | undefined;
  return row === undefined ? null : read(row);
}

export function createOperationReviewProposal(store: Store, input: {
  proposedBy: ParticipantId;
  originId: string;
  channel: ContributionChannel;
  page: string;
  block: string;
  change: Change;
  targetRevision: string;
  originalContent: string;
  purpose: string;
  now?: number;
}): { proposal: OperationReviewProposal; duplicate: boolean } {
  const id = `review-proposal:${randomUUID()}`;
  const proposedAt = input.now ?? Date.now();
  try {
    store.db.prepare(`INSERT INTO operation_review_proposals
      (id,graph_id,proposed_by,origin_id,channel,page_id,block_id,change_json,target_revision,
       original_content,purpose,status,proposed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'awaiting_review',?)`).run(
        id, store.graphId, input.proposedBy, input.originId, input.channel, input.page, input.block,
        JSON.stringify(input.change), input.targetRevision, input.originalContent, input.purpose, proposedAt,
      );
  } catch (error) {
    const existing = operationReviewProposals(store).find(
      (one) => one.proposedBy === input.proposedBy && one.originId === input.originId,
    );
    if (existing === undefined || JSON.stringify(existing.change) !== JSON.stringify(input.change)
      || existing.targetRevision !== input.targetRevision || existing.purpose !== input.purpose) throw error;
    return { proposal: existing, duplicate: true };
  }
  const proposal = operationReviewProposal(store, id);
  if (proposal === null) throw new Error('la propuesta recién creada no se pudo volver a leer');
  return { proposal, duplicate: false };
}

export function decideOperationReviewProposal(store: Store, input: {
  id: string;
  reviewer: ParticipantId;
  status: Exclude<ReviewProposalStatus, 'awaiting_review'>;
  now?: number;
}): boolean {
  return Number(store.db.prepare(`UPDATE operation_review_proposals
    SET status=?,decided_by=?,decided_at=? WHERE graph_id=? AND id=? AND status='awaiting_review'`).run(
      input.status, input.reviewer, input.now ?? Date.now(), store.graphId, input.id,
    ).changes) === 1;
}
