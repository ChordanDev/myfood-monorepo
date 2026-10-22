# Planning agent commands go over the planning channel

Status: accepted

ADR 0004 sends an operation that is one request and one reply over HTTP, and the legacy planner confirmed and rejected a proposal that way. The planning agent (issue #423) is a conversation: the Member starts a session, gives AI-processing consent, sends messages and confirms the Proposal on display, and the session's answers arrive in pieces on the `planning:<account_id>` topic. The owner decided on 2026-10-22 that every agent command goes over that channel, consent, confirm and the approvals of later slices included, as it does in myfood, where the agent was built. This is the planning exception to ADR 0004.

The reasons: the session lives in one server process bound to the socket that started it, so a command over HTTP would have to find that process again and prove it belongs to the caller, a second path to the same state; and confirming is the end of the conversation, whose own events (`proposal_confirmed`, `session_ended`) go to the same socket.

ADR 0004's worry about a reply lost on reconnect is answered by the confirmation itself: it is idempotent through the `planning_confirmations` table, whose key is the Proposal's id, so a replayed `confirm` answers the same summary and saves nothing twice, and `confirmation_status` tells a client that lost the reply whether the Proposal was confirmed, also after the session ended.

## Consequences

- The legacy HTTP routes (`POST /api/planning/confirm`, the reject route and the session lease) stay for the legacy planner until it is switched off (#436).
- A new agent command is a channel command; it does not get an HTTP twin.
