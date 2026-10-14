defmodule MealPlannerApi.Repo.Migrations.AddLowerEmailIndexToUsers do
  @moduledoc """
  Indexes `lower(users.email)`, the expression login and sign-up match an
  email against, so those lookups stop scanning the table.

  The index is not unique. Invites and identity sync store emails as given,
  so rows that differ only in case may already exist, and a unique index
  would fail this migration on them. Once every writer stores the
  normalized email and the data has been checked, it can be made unique.
  """

  use Ecto.Migration

  def change do
    # Fails fast instead of queueing every write to `users` behind a lock
    # it cannot get.
    execute("SET LOCAL lock_timeout = '3s'", "SET LOCAL lock_timeout = '3s'")

    create(index(:users, ["lower(email)"], name: :users_lower_email_index))
  end
end
