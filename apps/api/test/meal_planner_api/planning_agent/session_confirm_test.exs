defmodule MealPlannerApi.PlanningAgent.SessionConfirmTest do
  @moduledoc """
  Confirming an agent Proposal (issue #423): it becomes Scheduled meals in
  one transaction, idempotently, and never overwrites a final meal.
  """

  use ExUnit.Case, async: false

  import Ecto.Query
  import MealPlannerApi.PlanningAgentFixtures

  alias MealPlannerApi.Persistence.Planning.{PlanningConfirmation, PlanningSession, ScheduledMeal}
  alias MealPlannerApi.PlanningAgent.{FakeOptimizer, Session}
  alias MealPlannerApi.PlanningAgent.Model.Scripted
  alias MealPlannerApi.Repo

  setup do
    sandbox_sessions!()
    on_exit(&FakeOptimizer.reset!/0)
    owner = household!()
    consent!(owner.user)
    recipes = recipes_for_every_slot!(owner.account)
    %{owner: owner, recipes: recipes}
  end

  # Starts a session and runs one turn that presents a Proposal; returns
  # the session and the Proposal event.
  defp proposal!(who) do
    {:ok, %{session_id: id, pid: pid}} =
      Session.start(session_attrs(who),
        model:
          {Scripted,
           script: [
             {:tool_calls, [{"run_optimizer", %{}}]},
             {:tool_calls, [{"present_proposal", %{}}]},
             {:text, "Here is your plan."}
           ]},
        optimizer: FakeOptimizer,
        subscriber: self()
      )

    :ok = Session.send_message(pid, "Plan my days")
    assert_receive {:planning_agent_event, ^id, %{"type" => "proposal"} = proposal}
    assert_receive {:planning_agent_event, ^id, %{"type" => "turn_completed"}}
    %{id: id, pid: pid, proposal: proposal}
  end

  defp scheduled(account) do
    Repo.all(
      from(m in ScheduledMeal,
        where: m.account_id == ^account.id,
        order_by: [m.date, m.slot],
        select: {m.date, m.slot, m.recipe_id, m.is_cooked}
      )
    )
  end

  test "saves the Proposal as Scheduled meals and ends the session", %{
    owner: owner,
    recipes: recipes
  } do
    %{id: id, pid: pid, proposal: proposal} = proposal!(owner)
    ref = Process.monitor(pid)
    proposal_id = proposal["proposal_id"]

    assert {:ok, %{confirmation_id: ^proposal_id, meals_count: 6}} =
             Session.confirm(owner.account.id, owner.membership.id, proposal_id)

    assert_receive {:planning_agent_event, ^id,
                    %{
                      "type" => "proposal_confirmed",
                      "proposal_id" => ^proposal_id,
                      "meals_count" => 6
                    }}

    assert_receive {:planning_agent_event, ^id, %{"type" => "session_ended"}}
    assert_receive {:DOWN, ^ref, :process, ^pid, :normal}

    meals = scheduled(owner.account)
    assert length(meals) == 6

    assert Enum.all?(meals, fn {_date, slot, recipe_id, cooked} ->
             recipe_id == recipes[Atom.to_string(slot)].id and cooked == false
           end)

    assert %PlanningSession{status: :committed} = Repo.get!(PlanningSession, id)

    assert %PlanningConfirmation{planning_session_id: ^id, meals_count: 6} =
             Repo.get!(PlanningConfirmation, proposal_id)
  end

  test "a replayed confirmation answers the same summary and saves nothing twice", %{
    owner: owner
  } do
    %{proposal: %{"proposal_id" => proposal_id}} = proposal!(owner)

    assert {:ok, summary} = Session.confirm(owner.account.id, owner.membership.id, proposal_id)
    assert {:ok, ^summary} = Session.confirm(owner.account.id, owner.membership.id, proposal_id)
    assert {:confirmed, ^summary} = Session.confirmation_status(owner.account.id, proposal_id)

    assert length(scheduled(owner.account)) == 6
    assert Repo.aggregate(PlanningConfirmation, :count) == 1
  end

  test "the status of a Proposal never confirmed, or of another Account, is not found", %{
    owner: owner
  } do
    %{proposal: %{"proposal_id" => proposal_id}} = proposal!(owner)
    {:ok, _summary} = Session.confirm(owner.account.id, owner.membership.id, proposal_id)
    other = household!()

    assert :not_found = Session.confirmation_status(owner.account.id, Ecto.UUID.generate())
    assert :not_found = Session.confirmation_status(other.account.id, proposal_id)
    assert :not_found = Session.confirmation_status(owner.account.id, "not-a-uuid")

    assert {:error, :no_active_session} =
             Session.confirm(other.account.id, other.membership.id, proposal_id)
  end

  test "only the session's Member confirms", %{owner: owner} do
    member = member!(owner.account)
    consent!(member.user)
    %{proposal: %{"proposal_id" => proposal_id}} = proposal!(member)

    assert {:error, :forbidden} =
             Session.confirm(owner.account.id, owner.membership.id, proposal_id)

    assert scheduled(owner.account) == []
  end

  test "a Proposal that is not the one on display is refused and the current one shown again", %{
    owner: owner
  } do
    %{id: id, proposal: proposal} = proposal!(owner)

    assert {:error, :stale_proposal} =
             Session.confirm(owner.account.id, owner.membership.id, Ecto.UUID.generate())

    assert_receive {:planning_agent_event, ^id, ^proposal}
    assert scheduled(owner.account) == []
  end

  test "a Proposal a new restriction forbids is withdrawn, not saved", %{
    owner: owner,
    recipes: recipes
  } do
    %{id: id, proposal: %{"proposal_id" => proposal_id}} = proposal!(owner)

    # Another Member marks the lunch recipe's Ingredient as an allergy.
    [lunch_item] =
      Repo.preload(recipes["lunch"], recipe_ingredients: :ingredient).recipe_ingredients

    exclude!(member!(owner.account).user, lunch_item.ingredient)

    assert {:error, :proposal_invalid} =
             Session.confirm(owner.account.id, owner.membership.id, proposal_id)

    assert_receive {:planning_agent_event, ^id,
                    %{"type" => "proposal_invalidated", "proposal_id" => ^proposal_id}}

    assert scheduled(owner.account) == []
  end

  test "a final meal is never overwritten: the confirmation is refused whole (S11)", %{
    owner: owner,
    recipes: recipes
  } do
    %{proposal: %{"proposal_id" => proposal_id}} = proposal!(owner)
    today = MealPlannerApi.AccountClock.today(owner.account.id)
    scheduled_meal!(owner.account, recipes["dinner"], today, :dinner, %{is_cooked: true})

    assert {:error, :scheduled_meal_cooked} =
             Session.confirm(owner.account.id, owner.membership.id, proposal_id)

    assert [{^today, :dinner, _recipe, true}] = scheduled(owner.account)
    refute Repo.get(PlanningConfirmation, proposal_id)
  end

  test "a meal confirmed not cooked keeps its answer too", %{owner: owner, recipes: recipes} do
    %{proposal: %{"proposal_id" => proposal_id}} = proposal!(owner)
    today = MealPlannerApi.AccountClock.today(owner.account.id)

    scheduled_meal!(owner.account, recipes["lunch"], today, :lunch, %{
      not_cooked_at: DateTime.utc_now()
    })

    assert {:error, :meal_already_confirmed} =
             Session.confirm(owner.account.id, owner.membership.id, proposal_id)

    assert [{^today, :lunch, _recipe, false}] = scheduled(owner.account)
  end

  test "a Proposal over the budget requires approval and cannot be confirmed yet", %{
    owner: owner,
    recipes: recipes
  } do
    # Every recipe's estimated cost is over the whole session budget.
    Enum.each(Map.values(recipes), &recipe_cost!(&1, 100_000))

    %{proposal: proposal} = proposal!(owner)

    assert proposal["status"] == "requires_approval"

    assert [%{"type" => "budget", "estimated_cost_cents" => 600_000} = deviation] =
             proposal["deviations"]

    assert deviation["difference_cents"] == 600_000 - deviation["budget_cents"]
    assert proposal["budget"]["within_budget"] == false

    assert {:error, :approval_required} =
             Session.confirm(owner.account.id, owner.membership.id, proposal["proposal_id"])

    assert scheduled(owner.account) == []
  end
end
