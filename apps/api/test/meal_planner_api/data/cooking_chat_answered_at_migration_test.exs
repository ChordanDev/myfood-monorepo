defmodule MealPlannerApi.Data.CookingChatAnsweredAtMigrationTest do
  @moduledoc """
  The `answered_at` backfill (issue #322): every question stored before the
  column existed was stored with its answer, so it is answered when it was
  asked.
  """
  use ExUnit.Case, async: false

  import Ecto.Query
  import MealPlannerApi.IdentityFixtures

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Planning
  alias MealPlannerApi.Persistence.Planning.CookingChatMessage
  alias MealPlannerApi.Repo

  @migration MealPlannerApi.Repo.Migrations.AddAnsweredAtToCookingChatMessages
  @migration_path Path.expand(
                    "../../../priv/repo/migrations/20261016100000_add_answered_at_to_cooking_chat_messages.exs",
                    __DIR__
                  )

  setup_all do
    # `mix ecto.migrate` may have compiled the migration in this VM already.
    unless Code.ensure_loaded?(@migration), do: Code.require_file(@migration_path)
    {:ok, migration: @migration}
  end

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()
  end

  test "marks each question with a later answer as answered when it was asked",
       %{migration: migration} do
    session = cooking_session!()
    other = cooking_session!()
    asked = ~U[2026-10-08 12:00:00.000000Z]

    [first, first_answer, second, unanswered] =
      turns!(session, [
        {:user, asked},
        {:assistant, DateTime.add(asked, 1, :microsecond)},
        {:user, DateTime.add(asked, 60, :second)},
        {:user, DateTime.add(asked, 120, :second)}
      ])

    # The answer stored with the second question; the unanswered one has none.
    [second_answer] = turns!(session, [{:assistant, DateTime.add(asked, 61, :second)}])
    # An answer in another session answers nothing here.
    [elsewhere] = turns!(other, [{:user, DateTime.add(asked, 200, :second)}])
    turns!(other, [{:assistant, DateTime.add(asked, 1, :second)}])

    Repo.query!(migration.backfill_sql())

    assert answered_at(first) == first.inserted_at
    assert answered_at(second) == second.inserted_at
    assert answered_at(unanswered) == nil
    assert answered_at(elsewhere) == nil
    assert answered_at(first_answer) == nil
    assert answered_at(second_answer) == nil
  end

  defp answered_at(turn),
    do: Repo.one!(from(m in CookingChatMessage, where: m.id == ^turn.id, select: m.answered_at))

  defp turns!(session, turns) do
    rows =
      for {role, at} <- turns do
        %{
          id: Ecto.UUID.generate(),
          cooking_session_id: session.id,
          role: role,
          content: "#{role} turn",
          inserted_at: at,
          updated_at: at
        }
      end

    Repo.insert_all(CookingChatMessage, rows)
    Enum.map(rows, &struct!(CookingChatMessage, &1))
  end

  defp cooking_session! do
    %{user: user, account: account} = insert_identity!(plan: :family_4)

    {:ok, recipe} =
      Catalog.create_recipe(%{
        account_id: account.id,
        created_by_user_id: user.id,
        name: "Backfill stew #{Ecto.UUID.generate()}",
        source: :user_created,
        servings: 2,
        suitable_for_slots: [:dinner]
      })

    {:ok, meal} =
      Planning.schedule_meal(%{
        account_id: account.id,
        recipe_id: recipe.id,
        date: ~D[2026-10-08],
        slot: :dinner
      })

    {:ok, session} =
      Planning.create_cooking_session(%{
        account_id: account.id,
        scheduled_meal_id: meal.id,
        status: :active
      })

    session
  end
end
