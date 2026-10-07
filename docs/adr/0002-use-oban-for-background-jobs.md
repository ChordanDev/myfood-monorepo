# Use Oban for background jobs

Status: accepted

The backend needs periodic maintenance work, starting with pruning expired/revoked sessions and old rate-limit events from the Slice 1 4R audit. We will use Oban OSS with the existing Postgres database instead of Quantum or a custom `Process.send_after` worker. Oban gives persisted jobs, retry/error handling, cron scheduling, and deterministic test helpers without adding Redis or another infrastructure service. Quantum and custom timers were rejected because their schedules are process-local and can be lost on restarts, which is a poor fit for maintenance jobs that protect database growth.

For the MVP, duplicate cron execution across multiple app replicas is acceptable because the current workers are idempotent pruning deletes. If the app later runs multi-replica production workloads with external side effects, revisit Oban.Pro, leader election, or a dedicated worker deployment. Tests should use manual Oban testing mode and a clock abstraction so pruning boundaries stay deterministic. Environment schedules may differ: dev can run pruning more frequently for manual verification, while production uses the operational cadence documented in config.
