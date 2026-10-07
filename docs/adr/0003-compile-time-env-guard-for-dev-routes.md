# Use compile-time env guard for dev-only routes

Status: accepted

The backend router mounts a `/dev/mailbox` Swoosh preview scope behind a configuration flag. The flag is the single barrier keeping the mailbox out of production: a misconfiguration leaving the flag `true` in `config/prod.exs` would expose it publicly. Phoenix route wiring happens at compile time, so we will add a second compile-time guard: the `dev_routes` flag and `Mix.env() == :dev` must both be true for the mailbox route to mount. The guard is exposed through a small predicate so tests can verify the decision logic without pretending router scopes are runtime-dynamic.

This is the smallest safe fix. A fully runtime switch was considered and rejected because Phoenix routers are compiled; making route availability truly runtime-dynamic would require a different design instead of a simple scope guard. This decision intentionally keeps the route absent from non-dev compiled routers. Revisit a different design only if a real operational need requires toggling the mailbox without recompiling.
