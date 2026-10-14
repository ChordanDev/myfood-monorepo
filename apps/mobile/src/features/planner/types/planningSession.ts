// What the planning topic pushes about the Account's planning session, as the channel sends it
// (camelCase). Only an Account with an active session gets `session_resumed`.

export interface ResumedSessionMessage {
  role: string;
  content: string;
  intentKind: string | null;
}

export interface SessionResumedPayload {
  sessionId: string;
  proposalId: string | null;
  // The pending proposal, as the server serializes it; null when none is pending.
  proposal: unknown;
  // The recent messages of the conversation, oldest first.
  messages: ResumedSessionMessage[];
}

// The server ended the session: its lease lapsed (`session_expired`) or the process that held
// it died (`session_lost_lock`). Either way the conversation cannot continue.
export type SessionOverReason = 'session_expired' | 'session_lost_lock';

export const SESSION_OVER_EVENTS: readonly SessionOverReason[] = [
  'session_expired',
  'session_lost_lock',
];

// The lease of the session after `POST /api/planning/sessions/:sessionId/activity` renewed it.
export interface PlanningLease {
  sessionId: string;
  leaseExpiresAt: string;
}
