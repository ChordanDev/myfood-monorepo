# Channels for server-pushed updates, HTTP for request and response

Status: accepted

The API grew a Phoenix channel next to most of its HTTP controllers, and nothing recorded which transport a feature should use. We decided that a feature gets a channel only when the server has to send something the client did not just ask for: an answer that arrives in pieces (an LLM reply streamed as it is produced), the progress of work that outlives the request (a Generation run and its proposals), or a change made by another User or device of the same Account. An operation that is one request and one reply goes over HTTP, even when a channel exists for that feature. When an HTTP write has to reach others, it commits first and then broadcasts on the topic.

The reason is cost on both sides. On a mobile network a socket adds failure modes HTTP does not have: a reply lost on reconnect cannot be told from a request that never arrived, and state kept in socket assigns is gone after a reconnect. And two transports for the same operation are two implementations that drift apart; the recipe swap bug in issue #111 is reachable only through the channel copy of a write the app does over HTTP.

Whether a channel is justified is judged by what it delivers, not by whether a client joins it today.

## Applied to the current channels

- `planning`: stays. Generation progress and proposals are pushed.
- `ai_chat`: stays. It is the only path that streams an LLM answer.
- `calendar`: stays, for Accounts shared between several Users.
- `shopping`: stays. It pushes Cart and Inventory changes made by another User or device of the same Account, and repeats no HTTP operation.
- `cooking`: removed (issue #166). It repeats the five operations of `CookingController` and replies only to the caller.

## Considered options

- **Everything over channels.** One transport, but every plain read and write inherits the reconnect and lost-reply problems above.
- **HTTP only, with polling.** Simplest client, but it cannot stream an LLM answer and makes shared Accounts wait for the next poll.

## Consequences

- The calendar channel writes through functions the HTTP path does not use. Under this rule its writes should go through the same code as the HTTP calendar routes, with the channel carrying the notification.
- A new channel event needs an answer to one question: does it reach someone who did not send the request, or arrive in pieces? If neither, it is an HTTP route.
