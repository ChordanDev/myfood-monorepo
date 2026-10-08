defmodule MealPlannerApi.SubscriptionPlanFixtures do
  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Subscriptions.Plan

  # `ensure_plans!/0` replaces on conflict, so these have to be the values the
  # migrations insert (`family_6` comes from
  # `20260625000002_alter_accounts_to_plan_enum.exs`); a different value here
  # rewrites the migrated row for every test that calls it.
  @plans [
    %{name: "individual", max_users: 1, max_planning_days: 7, revenuecat_entitlement_id: nil},
    %{name: "family_4", max_users: 4, max_planning_days: 7, revenuecat_entitlement_id: nil},
    %{
      name: "family_6",
      max_users: 6,
      max_planning_days: 30,
      revenuecat_entitlement_id: "family_6"
    }
  ]

  def ensure_plans! do
    Enum.each(@plans, fn attrs ->
      %Plan{}
      |> Plan.changeset(attrs)
      |> Repo.insert(
        on_conflict:
          {:replace, [:max_users, :max_planning_days, :revenuecat_entitlement_id, :updated_at]},
        conflict_target: [:name]
      )
    end)

    :ok
  end

  @doc """
  Makes sure the Plan called `name` is a committed row, for a test that
  runs outside the SQL sandbox, and removes it again when the test is over.

  `ensure_plans!/0` upserts every Plan: inside a sandbox transaction that is
  rolled back with the test, outside of one it is committed for good and
  rewrites the rows the migrations inserted. This inserts only the Plan the
  test asks for, and only when the database lacks it; a Plan that is already
  there is left untouched.

  Call it from the test process (or from `setup_all`), before creating the
  Accounts that use the Plan: `on_exit` callbacks run last registered first,
  so the Plan is deleted after the test's own cleanup removed those Accounts.
  """
  @spec ensure_committed_plan!(String.t()) :: :ok
  def ensure_committed_plan!(name) do
    if is_nil(Repo.get_by(Plan, name: name)) do
      attrs = Enum.find(@plans, &(&1.name == name)) || raise "no fixture Plan #{inspect(name)}"
      plan = %Plan{} |> Plan.changeset(attrs) |> Repo.insert!()

      ExUnit.Callbacks.on_exit(fn ->
        :ok = Sandbox.checkout(Repo, sandbox: false)
        Repo.delete!(plan)
      end)
    end

    :ok
  end
end
