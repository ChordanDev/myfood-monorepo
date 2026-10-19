defmodule MealPlannerApi.Repo.Migrations.AddLowerEmailIndexToUsers do
  @moduledoc """
  Indexes `lower(users.email)`, the expression login and sign-up match an
  email against, so those lookups stop scanning the table.

  The index is not unique. Invites and identity sync stored emails as
  given, so rows that differ only in case may already exist, and a unique
  index would fail this migration on them.
  `20261014150000_make_users_lower_email_index_unique` makes it unique and
  ships in the same deploy, so this is no gradual rollout: the safeguard
  against such rows is the manual audit query that migration's moduledoc
  asks to run before migrating.
  """

  use Ecto.Migration

  def change do
    # Fails fast instead of queueing every write to `users` behind a lock
    # it cannot get.
    execute("SET LOCAL lock_timeout = '3s'", "SET LOCAL lock_timeout = '3s'")

    create(index(:users, ["lower(email)"], name: :users_lower_email_index))
  end
end
