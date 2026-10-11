defmodule MealPlannerApi.Persistence.Planning.CookingSessionTest do
  @moduledoc """
  The Cooking session status (issue #126): a session is `active` or
  `completed`, in the schema and in the `cooking_sessions` table itself.
  Pausing belongs to a step event, not to the session.
  """
  use ExUnit.Case, async: false

  import MealPlannerApi.IdentityFixtures

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Planning
  alias MealPlannerApi.Persistence.Planning.CookingSession
  alias MealPlannerApi.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()

    %{user: user, account: account} = insert_identity!()

    {:ok, recipe} =
      Catalog.create_recipe(%{
        account_id: account.id,
        created_by_user_id: user.id,
        name: "Session status recipe",
        source: :user_created,
        servings: 2,
        suitable_for_slots: [:dinner]
      })

    {:ok, meal} =
      Planning.schedule_meal(%{
        account_id: account.id,
        date: ~D[2026-10-08],
        slot: :dinner,
        recipe_id: recipe.id
      })

    %{attrs: %{account_id: account.id, scheduled_meal_id: meal.id}}
  end

  describe "changeset/2" do
    test "the statuses are active and completed" do
      assert Ecto.Enum.values(CookingSession, :status) == [:active, :completed]
    end

    test "a new session is active", %{attrs: attrs} do
      changeset = CookingSession.changeset(%CookingSession{}, attrs)

      assert changeset.valid?
      assert Ecto.Changeset.get_field(changeset, :status) == :active
    end

    test "accepts completed", %{attrs: attrs} do
      changeset = CookingSession.changeset(%CookingSession{}, Map.put(attrs, :status, :completed))

      assert changeset.valid?
    end

    test "refuses paused", %{attrs: attrs} do
      for paused <- [:paused, "paused"] do
        changeset = CookingSession.changeset(%CookingSession{}, Map.put(attrs, :status, paused))

        refute changeset.valid?
        assert {"is invalid", _meta} = changeset.errors[:status]
      end
    end
  end

  describe "cooking_sessions table" do
    test "accepts active and completed", %{attrs: attrs} do
      session = insert_session!(attrs)

      for status <- ["completed", "active"] do
        raw_set_status!(session, status)

        assert Repo.reload!(session).status == String.to_existing_atom(status)
      end
    end

    test "refuses paused", %{attrs: attrs} do
      session = insert_session!(attrs)

      error =
        assert_raise Postgrex.Error, fn ->
          Repo.transaction(fn -> raw_set_status!(session, "paused") end, mode: :savepoint)
        end

      assert error.postgres.code == :check_violation
      assert error.postgres.constraint == "cooking_sessions_status_check"
      assert Repo.reload!(session).status == :active
    end
  end

  defp insert_session!(attrs) do
    %CookingSession{} |> CookingSession.changeset(attrs) |> Repo.insert!()
  end

  defp raw_set_status!(session, status) do
    Repo.query!("UPDATE cooking_sessions SET status = $1 WHERE id = $2", [
      status,
      Ecto.UUID.dump!(session.id)
    ])
  end
end
