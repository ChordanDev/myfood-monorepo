defmodule MealPlannerApi.Repo.Migrations.SeedIndividualAndFamily4Plans do
  @moduledoc """
  Inserts the `individual` and `family_4` reference Plans.

  `20260625000002_alter_accounts_to_plan_enum.exs` inserts `family_6` and
  `trial` and says the other two rows were "preserved from the prior
  migration". That was wrong: no migration ever inserted them, they only
  came from `priv/repo/seeds.exs`. A database built by migrations alone
  therefore had no `individual` row, and sign-up, which attaches every new
  Account to that Plan, answered 500.

  Rows that already exist (an environment that ran the seeds) are left as
  they are: `ON CONFLICT (name) DO NOTHING`.

  The insert lives in `insert_plans/1` so a test can run it against the
  sandboxed repo without going through the Migrator.
  """
  use Ecto.Migration

  @plans [
    %{name: "individual", max_users: 1, max_planning_days: 7},
    %{name: "family_4", max_users: 4, max_planning_days: 7}
  ]

  def up, do: insert_plans(repo())

  @doc """
  Inserts the Plans that `repo` does not hold yet; a Plan whose name already
  exists keeps its id and its values.
  """
  @spec insert_plans(Ecto.Repo.t()) :: :ok
  def insert_plans(repo) do
    Enum.each(@plans, fn plan ->
      {:ok, uuid_binary} = Ecto.UUID.dump(Ecto.UUID.generate())

      # `log: false` keeps the query parameters out of the migration output.
      repo.query!(
        """
        INSERT INTO subscription_plans (id, name, max_users, max_planning_days, revenuecat_entitlement_id, inserted_at, updated_at)
        VALUES ($1, $2, $3, $4, NULL, $5, $5)
        ON CONFLICT (name) DO NOTHING
        """,
        [uuid_binary, plan.name, plan.max_users, plan.max_planning_days, DateTime.utc_now()],
        log: false
      )
    end)
  end

  # The rows are intentionally kept. Accounts reference them with
  # `on_delete: :restrict`, so deleting a Plan that is in use would fail, and
  # an environment may have had these rows (from the seeds) before this
  # migration ran, in which case they are not this migration's to remove.
  def down, do: :ok
end
