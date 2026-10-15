import { AUTH_ERROR_MESSAGES, getAuthErrorMessage, KNOWN_AUTH_ERROR_CODES } from '@/api/errors';
import type { ApiError } from '@/api/errors';
import type {
  GenerationErrorPayload,
  GenerationStartedPayload,
  PlanningMessagePayload,
  ProposalReadyPayload,
  SessionCommittedPayload,
  SessionEndedPayload,
  SessionResumedDraftPayload,
} from '../types/planningEvents';

// The state of the first proposal, derived from the events of the planning topic: nothing is
// stored on the server about it. `generating` covers the time between the tap and the answer,
// and the run id is learned from `generation_started`, which can arrive after the events of
// its own run. A generation that gives no answer within `GENERATION_TIME_LIMIT_MS` fails, but its
// late proposal is still taken.

export type PlanningFailure =
  | { kind: 'request'; error: ApiError }
  | { kind: 'generation'; reason: string };

type RunEvent =
  | { type: 'proposal_ready'; payload: ProposalReadyPayload }
  /** A `proposal_ready` that does not parse, with its run id when that much can be read. */
  | { type: 'proposal_unreadable'; payload: { runId: string | null } }
  | { type: 'planning_message'; payload: PlanningMessagePayload }
  | { type: 'generation_error'; payload: GenerationErrorPayload };

/** The events that say the session of the draft is over, which ends its generation too. */
export type SessionEndEvent =
  | { type: 'session_cancelled'; payload: SessionEndedPayload }
  | { type: 'session_expired'; payload: SessionEndedPayload }
  | { type: 'session_lost_lock'; payload: SessionEndedPayload };

export type PlanningDraft =
  | { status: 'idle' }
  | {
      status: 'generating';
      requestId: string;
      /** Clock time of the start request, in milliseconds: the time limit counts from it. */
      startedAt: number;
      runId: string | null;
      /** Learned from `generation_started`; the events that end a session name it. */
      sessionId: string | null;
      message: PlanningMessagePayload | null;
      /** Events of an unknown run, kept until `generation_started` says whose they are. */
      early: RunEvent[];
    }
  | {
      status: 'ready';
      requestId: string;
      /** The session the proposal was generated in: the one a confirm commits. */
      sessionId: string | null;
      proposal: ProposalReadyPayload;
      message: PlanningMessagePayload | null;
    }
  | {
      /** The proposal is the live plan: its meals are scheduled and the Shopping list rebuilt. */
      status: 'committed';
      requestId: string;
      sessionId: string;
      scheduledMealsCount: number;
    }
  | {
      status: 'failed';
      requestId: string;
      /** The session the generation ran in, if known: a retry cancels it first. */
      sessionId: string | null;
      failure: PlanningFailure;
      /** The generation that ran out of time: its events still reduce it, and its proposal wins. */
      timedOut?: Generating;
    };

export type PlanningDraftAction =
  | { type: 'start_requested'; requestId: string; now: number }
  | { type: 'start_rejected'; requestId: string; error: ApiError }
  | { type: 'generation_started'; payload: GenerationStartedPayload }
  | { type: 'session_committed'; payload: SessionCommittedPayload }
  /** The server says, after a join, which session is active and what proposal it holds. */
  | { type: 'session_resumed'; payload: SessionResumedDraftPayload }
  /** The clock read `now`: a generation past its time limit fails. */
  | { type: 'clock_ticked'; now: number }
  /** The User left the proposal: the draft starts over. */
  | { type: 'reset' }
  | SessionEndEvent
  | RunEvent;

export const IDLE_PLANNING_DRAFT: PlanningDraft = { status: 'idle' };

// The topic is shared by the members of the Account, so the events of a run that is not ours
// can arrive: the buffer is bounded and a held event is dropped when its run is another one.
const MAX_EARLY_EVENTS = 10;

/** How long a generation may go without a proposal or an error before the draft fails. */
export const GENERATION_TIME_LIMIT_MS = 90_000;

type Generating = Extract<PlanningDraft, { status: 'generating' }>;
type Failed = Extract<PlanningDraft, { status: 'failed' }>;

/** The clock time at which the generation of `draft` runs out of time, if it is generating. */
export function generationDeadline(draft: PlanningDraft): number | null {
  return draft.status === 'generating' ? draft.startedAt + GENERATION_TIME_LIMIT_MS : null;
}

function failGeneration(draft: Generating, reason: string): Failed {
  return {
    status: 'failed',
    requestId: draft.requestId,
    sessionId: draft.sessionId,
    failure: { kind: 'generation', reason },
  };
}

function applyRunEvent(draft: Generating, action: RunEvent): PlanningDraft {
  switch (action.type) {
    case 'generation_error':
      return failGeneration(draft, action.payload.reason);
    case 'proposal_unreadable':
      return failGeneration(draft, 'proposal_unreadable');
    case 'proposal_ready':
      return {
        status: 'ready',
        requestId: draft.requestId,
        sessionId: draft.sessionId,
        proposal: action.payload,
        message: draft.message,
      };
    case 'planning_message':
      return { ...draft, message: action.payload };
  }
}

// Whether `action` is about the run of `draft`: by the run id, or for an error by the request id.
// An error with neither id comes from a reason-only path of the engine, and a proposal that does
// not parse may not say its run. The Account has at most one generation in flight, so either is
// about the one this draft waits for.
function belongsToRun(draft: Generating, action: RunEvent): boolean {
  const { payload } = action;
  if (action.type === 'generation_error') {
    const { requestId, runId } = action.payload;
    if (requestId === draft.requestId || (requestId === null && runId === null)) return true;
  }
  if (action.type === 'proposal_unreadable' && action.payload.runId === null) return true;
  return draft.runId !== null && payload.runId === draft.runId;
}

function reduceRunEvent(draft: PlanningDraft, action: RunEvent): PlanningDraft {
  if (draft.status === 'ready') {
    return action.type === 'planning_message' &&
      action.payload.proposalId === draft.proposal.proposalId
      ? { ...draft, message: action.payload }
      : draft;
  }
  if (draft.status !== 'generating') return draft;

  if (belongsToRun(draft, action)) return applyRunEvent(draft, action);
  if (draft.runId !== null || draft.early.length >= MAX_EARLY_EVENTS) return draft;
  return { ...draft, early: [...draft.early, action] };
}

// The events a generation answers with, which go on reducing one that ran out of time.
function isGenerationEvent(action: PlanningDraftAction): boolean {
  switch (action.type) {
    case 'start_requested':
    case 'start_rejected':
    case 'session_committed':
    case 'clock_ticked':
    case 'reset':
      return false;
    default:
      return true;
  }
}

// A generation that ran out of time still answers: what it ends in replaces the failure, and
// while it is still generating the failure only learns its session.
function reduceTimedOut(
  draft: Failed,
  timedOut: Generating,
  action: PlanningDraftAction
): PlanningDraft {
  const next = planningDraftReducer(timedOut, action);
  if (next === timedOut) return draft;
  return next.status === 'generating'
    ? { ...draft, sessionId: next.sessionId, timedOut: next }
    : next;
}

// The events of a generation emitted while the socket was down never arrive. After the rejoin the
// server pushes the active session and its pending proposal, which is the one this draft waits
// for when the session is its own and the run, once known, is its own too. Without a proposal the
// generation may still be running, or may have failed: the time limit settles that.
function takeResumedProposal(
  draft: PlanningDraft,
  { sessionId, proposal }: SessionResumedDraftPayload
): PlanningDraft {
  if (draft.status !== 'generating' || proposal === null) return draft;
  if (draft.sessionId !== null && draft.sessionId !== sessionId) return draft;
  if (draft.runId !== null && draft.runId !== proposal.runId) return draft;
  return {
    status: 'ready',
    requestId: draft.requestId,
    sessionId,
    proposal,
    message: draft.message,
  };
}

export function planningDraftReducer(
  draft: PlanningDraft,
  action: PlanningDraftAction
): PlanningDraft {
  if (draft.status === 'failed' && draft.timedOut !== undefined && isGenerationEvent(action)) {
    return reduceTimedOut(draft, draft.timedOut, action);
  }

  switch (action.type) {
    case 'start_requested':
      return {
        status: 'generating',
        requestId: action.requestId,
        startedAt: action.now,
        runId: null,
        sessionId: null,
        message: null,
        early: [],
      };
    case 'start_rejected':
      // The reply says why the start failed, also when a generation_error already did.
      return (draft.status === 'generating' || draft.status === 'failed') &&
        draft.requestId === action.requestId
        ? {
            status: 'failed',
            requestId: action.requestId,
            sessionId: draft.sessionId,
            failure: { kind: 'request', error: action.error },
          }
        : draft;
    case 'generation_started': {
      // A generation that failed before its session was known still learns it: a retry cancels it.
      if (
        draft.status === 'failed' &&
        draft.failure.kind === 'generation' &&
        draft.sessionId === null &&
        draft.requestId === action.payload.requestId
      ) {
        return { ...draft, sessionId: action.payload.sessionId };
      }
      if (
        draft.status !== 'generating' ||
        draft.runId !== null ||
        draft.requestId !== action.payload.requestId
      ) {
        return draft;
      }
      const { early, ...rest } = draft;
      const known: PlanningDraft = {
        ...rest,
        early: [],
        runId: action.payload.runId,
        sessionId: action.payload.sessionId,
      };
      return early.reduce(reduceRunEvent, known);
    }
    case 'session_cancelled':
    case 'session_expired':
    case 'session_lost_lock':
      if (
        (draft.status !== 'generating' && draft.status !== 'ready') ||
        draft.sessionId !== action.payload.sessionId
      ) {
        return draft;
      }
      // A proposal whose session was cancelled was left on purpose: nothing failed.
      if (draft.status === 'ready' && action.type === 'session_cancelled') {
        return IDLE_PLANNING_DRAFT;
      }
      return {
        status: 'failed',
        requestId: draft.requestId,
        sessionId: draft.sessionId,
        failure: { kind: 'generation', reason: action.type },
      };
    case 'session_committed':
      return draft.status === 'ready' && draft.sessionId === action.payload.sessionId
        ? {
            status: 'committed',
            requestId: draft.requestId,
            sessionId: action.payload.sessionId,
            scheduledMealsCount: action.payload.scheduledMealsCount,
          }
        : draft;
    case 'session_resumed':
      return takeResumedProposal(draft, action.payload);
    case 'clock_ticked':
      return draft.status === 'generating' &&
        action.now >= draft.startedAt + GENERATION_TIME_LIMIT_MS
        ? { ...failGeneration(draft, 'generation_timed_out'), timedOut: draft }
        : draft;
    case 'reset':
      return IDLE_PLANNING_DRAFT;
    default:
      return reduceRunEvent(draft, action);
  }
}

/**
 * The assistant message of the first proposal, in the app's words. The `text` of the event is
 * English, so the sentence is built from its summary; the cost is left out because the panel
 * shows it on its own line.
 */
export function describePlanningMessage({
  dayCount,
  mealCount,
}: PlanningMessagePayload['summary']): string {
  const days = dayCount === 1 ? 'día' : 'días';
  const meals = mealCount === 1 ? 'comida' : 'comidas';
  return `Acá tenés tu menú para ${dayCount} ${days}: ${mealCount} ${meals}.`;
}

const GENERIC_GENERATION_FAILURE = 'No pudimos armar tu menú. Probá de nuevo.';

/** What the User reads for a failure, in the app's words. */
export function describePlanningFailure(failure: PlanningFailure): string {
  if (failure.kind === 'generation') {
    const code = failure.reason as keyof typeof AUTH_ERROR_MESSAGES;
    return (
      (KNOWN_AUTH_ERROR_CODES.has(code) ? AUTH_ERROR_MESSAGES[code] : undefined) ??
      GENERIC_GENERATION_FAILURE
    );
  }

  const { error } = failure;
  const ownerName = error.details?.ownerName;
  if (error.code === 'planning_range_locked' && typeof ownerName === 'string') {
    return `${ownerName} ya tiene una planificación en curso para esas fechas.`;
  }
  return getAuthErrorMessage(error);
}
