import { AUTH_ERROR_MESSAGES, getAuthErrorMessage, KNOWN_AUTH_ERROR_CODES } from '@/api/errors';
import type { ApiError } from '@/api/errors';
import type {
  GenerationErrorPayload,
  GenerationStartedPayload,
  PlanningMessagePayload,
  ProposalReadyPayload,
  SessionEndedPayload,
} from '../types/planningEvents';

// The state of the first proposal, derived from the events of the planning topic: nothing is
// stored on the server about it. `generating` covers the time between the tap and the answer,
// and the run id is learned from `generation_started`, which can arrive after the events of
// its own run.

export type PlanningFailure =
  | { kind: 'request'; error: ApiError }
  | { kind: 'generation'; reason: string };

type RunEvent =
  | { type: 'proposal_ready'; payload: ProposalReadyPayload }
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
      proposal: ProposalReadyPayload;
      message: PlanningMessagePayload | null;
    }
  | {
      status: 'failed';
      requestId: string;
      /** The session the generation ran in, if known: a retry cancels it first. */
      sessionId: string | null;
      failure: PlanningFailure;
    };

export type PlanningDraftAction =
  | { type: 'start_requested'; requestId: string }
  | { type: 'start_rejected'; requestId: string; error: ApiError }
  | { type: 'generation_started'; payload: GenerationStartedPayload }
  | SessionEndEvent
  | RunEvent;

export const IDLE_PLANNING_DRAFT: PlanningDraft = { status: 'idle' };

// The topic is shared by the members of the Account, so the events of a run that is not ours
// can arrive: the buffer is bounded and a held event is dropped when its run is another one.
const MAX_EARLY_EVENTS = 10;

type Generating = Extract<PlanningDraft, { status: 'generating' }>;

function applyRunEvent(draft: Generating, action: RunEvent): PlanningDraft {
  switch (action.type) {
    case 'generation_error':
      return {
        status: 'failed',
        requestId: draft.requestId,
        sessionId: draft.sessionId,
        failure: { kind: 'generation', reason: action.payload.reason },
      };
    case 'proposal_ready':
      return {
        status: 'ready',
        requestId: draft.requestId,
        proposal: action.payload,
        message: draft.message,
      };
    case 'planning_message':
      return { ...draft, message: action.payload };
  }
}

// Whether `action` is about the run of `draft`: by the run id, or for an error by the request id.
// An error with neither id comes from a reason-only path of the engine. The Account has at most
// one generation in flight, so it is the failure of the one this draft waits for.
function belongsToRun(draft: Generating, action: RunEvent): boolean {
  const { payload } = action;
  if (action.type === 'generation_error') {
    const { requestId, runId } = action.payload;
    if (requestId === draft.requestId || (requestId === null && runId === null)) return true;
  }
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

export function planningDraftReducer(
  draft: PlanningDraft,
  action: PlanningDraftAction
): PlanningDraft {
  switch (action.type) {
    case 'start_requested':
      return {
        status: 'generating',
        requestId: action.requestId,
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
      return draft.status === 'generating' && draft.sessionId === action.payload.sessionId
        ? {
            status: 'failed',
            requestId: draft.requestId,
            sessionId: draft.sessionId,
            failure: { kind: 'generation', reason: action.type },
          }
        : draft;
    default:
      return reduceRunEvent(draft, action);
  }
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
