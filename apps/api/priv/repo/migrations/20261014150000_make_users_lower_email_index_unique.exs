defmodule MealPlannerApi.Repo.Migrations.MakeUsersLowerEmailIndexUnique do
  @moduledoc """
  Makes `users_lower_email_index` unique, so two users can no longer hold
  emails that differ only in case.

  Every writer now stores the normalized email and looks users up by
  `lower(email)` (sign-up, email-code login, invites, identity sync), and
  `User.changeset/2` maps this index to an `:email` error.

  Run this audit against production first; it must return no rows, or the
  unique index cannot be built and this migration fails:

      SELECT lower(email), count(*) FROM users GROUP BY 1 HAVING count(*) > 1;
  """

  use Ecto.Migration

  def up do
    # Fails fast instead of queueing every write to `users` behind a lock
    # it cannot get.
    execute("SET LOCAL lock_timeout = '3s'")

    drop(index(:users, ["lower(email)"], name: :users_lower_email_index))
    create(unique_index(:users, ["lower(email)"], name: :users_lower_email_index))
  end

  def down do
    execute("SET LOCAL lock_timeout = '3s'")

    drop(index(:users, ["lower(email)"], name: :users_lower_email_index))
    create(index(:users, ["lower(email)"], name: :users_lower_email_index))
  end
end
