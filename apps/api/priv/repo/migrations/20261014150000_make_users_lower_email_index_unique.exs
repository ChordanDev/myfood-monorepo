defmodule MealPlannerApi.Repo.Migrations.MakeUsersLowerEmailIndexUnique do
  @moduledoc """
  Makes `users_lower_email_index` unique, so two users can no longer hold
  emails that differ only in case.

  Every writer now stores the normalized email and looks users up by
  `lower(email)` (sign-up, email-code login, invites, identity sync), and
  `User.changeset/2` maps this index to an `:email` error.

  Deploy it together with the invite and identity normalization, and run
  this audit right before migrating. It must return no rows; if it does,
  the migration fails and changes nothing, and deciding which user keeps
  each email is a business decision:

      SELECT lower(email), count(*) FROM users GROUP BY 1 HAVING count(*) > 1;

  The unique index is built under a temporary name before the old one is
  dropped. The build holds a SHARE lock, which blocks writes to `users`
  but not reads; only the final drop and rename take an ACCESS EXCLUSIVE
  lock, and only until the migration commits.

  Migrations with 15-digit versions sort after this one, so neither
  `mix ecto.rollback --step 1` nor `--to` undoes it alone. To undo only
  this migration:

      [{migration, _}] =
        Code.require_file(
          Application.app_dir(
            :meal_planner_api,
            "priv/repo/migrations/20261014150000_make_users_lower_email_index_unique.exs"
          )
        )

      Ecto.Migrator.down(MealPlannerApi.Repo, 20261014150000, migration)
  """

  use Ecto.Migration

  def up do
    # Fails fast instead of queueing every write to `users` behind a lock
    # it cannot get.
    execute("SET LOCAL lock_timeout = '3s'")

    create(unique_index(:users, ["lower(email)"], name: :users_lower_email_unique_index))
    drop(index(:users, ["lower(email)"], name: :users_lower_email_index))

    rename(index(:users, ["lower(email)"], name: :users_lower_email_unique_index),
      to: :users_lower_email_index
    )
  end

  def down do
    execute("SET LOCAL lock_timeout = '3s'")

    create(index(:users, ["lower(email)"], name: :users_lower_email_plain_index))
    drop(index(:users, ["lower(email)"], name: :users_lower_email_index))

    rename(index(:users, ["lower(email)"], name: :users_lower_email_plain_index),
      to: :users_lower_email_index
    )
  end
end
