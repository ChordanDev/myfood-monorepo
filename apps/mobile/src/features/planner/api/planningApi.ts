import { apiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import type { RequestOptions } from '@/api/transport';
import { parseConfirmProposalReply, type ConfirmProposalReply } from '../types/planningEvents';
import type { PlanningLease } from '../types/planningSession';

// The HTTP side of the Planner (issue #28): a proposal is confirmed or rejected over HTTP, and the
// planning topic carries the notification (ADR 0004).
const PLANNING_PATH = '/api/planning';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A 2xx answer this client cannot read is an error like any other unintelligible answer.
function malformed(what: string) {
  return new ApiError('unknown_error', `Malformed ${what} response`);
}

function dataOf(response: unknown): unknown {
  return isRecord(response) ? response.data : undefined;
}

export interface ProposalConfirmation {
  proposalId: string;
  sessionId: string;
}

/**
 * Confirms the proposal in the session that holds its range: its meals are scheduled and the
 * Shopping list is rebuilt, all at once. Asking again is safe: a proposal the server already
 * confirmed answers the result of the first time.
 */
export async function confirmProposal(
  { proposalId, sessionId }: ProposalConfirmation,
  options?: RequestOptions
): Promise<ConfirmProposalReply> {
  const response = await apiClient.post<unknown>(
    `${PLANNING_PATH}/confirm`,
    { proposalId, sessionId },
    { ...options, auth: true, retry: options?.retry ?? true }
  );

  try {
    return parseConfirmProposalReply(dataOf(response));
  } catch {
    throw malformed('confirm');
  }
}

/** Rejects a pending proposal. The answer is the server's word that it was rejected. */
export async function rejectProposal(proposalId: string, options?: RequestOptions): Promise<void> {
  const response = await apiClient.post<unknown>(
    `${PLANNING_PATH}/proposals/${encodeURIComponent(proposalId)}/reject`,
    undefined,
    { ...options, auth: true }
  );
  const data = dataOf(response);

  if (!isRecord(data) || data.status !== 'rejected') throw malformed('reject');
}

/** Keeps the session alive: the server holds it for two minutes past each renewal. */
export async function renewPlanningSession(
  sessionId: string,
  options?: RequestOptions
): Promise<PlanningLease> {
  const response = await apiClient.post<unknown>(
    `${PLANNING_PATH}/sessions/${encodeURIComponent(sessionId)}/activity`,
    undefined,
    { ...options, auth: true }
  );
  const data = dataOf(response);

  if (
    !isRecord(data) ||
    typeof data.sessionId !== 'string' ||
    typeof data.leaseExpiresAt !== 'string'
  ) {
    throw malformed('planning session');
  }

  return { sessionId: data.sessionId, leaseExpiresAt: data.leaseExpiresAt };
}
