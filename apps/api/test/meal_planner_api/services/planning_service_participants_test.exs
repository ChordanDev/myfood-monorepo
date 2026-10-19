defmodule MealPlannerApi.Services.PlanningServiceParticipantsTest do
  @moduledoc """
  Who `PlanningService.build_candidates/2` plans for (issue #311). With no
  participants in the User map the validator plans for every active member;
  an explicit list in the User map stays the caller's choice.
  """
  use ExUnit.Case, async: false

  import MealPlannerApi.IdentityFixtures

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.HouseholdDietFixtures
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.PlanningService

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()

    %{user: requester, account: account} = insert_identity!(plan: :family_4)
    household = HouseholdDietFixtures.household_diet!(account, requester)
    identity = %{user_id: requester.id, account_id: account.id}

    %{requester: requester, household: household, identity: identity}
  end

  test "an explicit participant_ids narrows the plan to the members it names", %{
    requester: requester,
    household: household,
    identity: identity
  } do
    for key <- [:participant_ids, :user_ids] do
      assert {:ok, candidates} =
               PlanningService.build_candidates(%{key => [requester.id]}, identity)

      offered = candidates |> Map.values() |> List.flatten() |> Enum.map(& &1["recipe_id"])

      assert Enum.all?(household.blocked_recipe_ids, &(&1 in offered))
      assert Enum.all?(household.safe_recipe_ids, &(&1 in offered))
    end
  end

  test "an explicit participant_ids naming an invited member is refused", %{
    requester: requester,
    household: household,
    identity: identity
  } do
    assert {:error, :forbidden} =
             PlanningService.build_candidates(
               %{participant_ids: [requester.id, household.invited.id]},
               identity
             )
  end

  test "a participant_ids that is present but null is refused, not widened", %{
    identity: identity
  } do
    for key <- [:participant_ids, :user_ids] do
      assert {:error, :forbidden} = PlanningService.build_candidates(%{key => nil}, identity)
    end
  end
end
