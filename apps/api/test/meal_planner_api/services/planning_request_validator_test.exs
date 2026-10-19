defmodule MealPlannerApi.Services.PlanningRequestValidatorTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.PlanningRequestValidator

  import MealPlannerApi.Generation.ServerTestFixtures

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()
    :ok
  end

  test "accepts only active selected members and normalizes the participant list" do
    account = insert_account("validator account")
    actor = insert_user_with_membership(account, "validator-actor@example.com")

    participant =
      insert_user_with_membership(account, "validator-participant@example.com", :member)

    assert {:ok, %{"participant_ids" => participant_ids}, context} =
             PlanningRequestValidator.validate_request(
               %{"participant_ids" => [participant.id, participant.id]},
               account.id,
               actor.id
             )

    assert participant_ids == [participant.id]
    assert context.participant_ids == [participant.id]
  end

  test "rejects a suspended participant before planning can create writes" do
    account = insert_account("validator suspended account")
    actor = insert_user_with_membership(account, "validator-owner@example.com")
    participant = insert_user_with_membership(account, "validator-suspended@example.com", :member)

    membership = Repo.get_by!(AccountMembership, account_id: account.id, user_id: participant.id)
    {:ok, _} = membership |> AccountMembership.changeset(%{status: :suspended}) |> Repo.update()

    assert {:error, :forbidden} =
             PlanningRequestValidator.validate_request(
               %{"participant_ids" => [participant.id]},
               account.id,
               actor.id
             )
  end

  # Issue #311: a request that names no participants plans for every active
  # member of the Account; an explicit list still narrows the set.
  describe "default participants" do
    test "a request with no participant_ids plans for every active member" do
      account = insert_account("validator household")
      actor = insert_user_with_membership(account, "household-actor@example.com")
      member = insert_user_with_membership(account, "household-member@example.com", :member)
      invited = insert_user_with_membership(account, "household-invited@example.com", :member)
      suspended = insert_user_with_membership(account, "household-gone@example.com", :member)
      set_status!(account, invited, :invited)
      set_status!(account, suspended, :suspended)

      for constraints <- [%{}, %{"request" => "something light"}] do
        assert {:ok, %{"participant_ids" => participant_ids}, context} =
                 PlanningRequestValidator.validate_request(constraints, account.id, actor.id)

        assert Enum.sort(participant_ids) == Enum.sort([actor.id, member.id])
        assert context.participant_ids == participant_ids
      end
    end

    test "an explicit participant_ids still narrows the set to the members it names" do
      account = insert_account("validator narrowing")
      actor = insert_user_with_membership(account, "narrow-actor@example.com")
      _member = insert_user_with_membership(account, "narrow-member@example.com", :member)

      assert {:ok, %{"participant_ids" => [actor_id]}, _context} =
               PlanningRequestValidator.validate_request(
                 %{participant_ids: [actor.id]},
                 account.id,
                 actor.id
               )

      assert actor_id == actor.id
    end

    test "a single-member Account plans for its one member, as before" do
      account = insert_account("validator single")
      actor = insert_user_with_membership(account, "single-actor@example.com")

      assert {:ok, %{"participant_ids" => [actor_id]}, %{participant_ids: [actor_id]}} =
               PlanningRequestValidator.validate_request(%{}, account.id, actor.id)

      assert actor_id == actor.id
    end

    test "an actor who is not an active member is still :forbidden" do
      account = insert_account("validator outsider")
      _owner = insert_user_with_membership(account, "outsider-owner@example.com")
      other_account = insert_account("validator other")
      outsider = insert_user_with_membership(other_account, "outsider@example.com")

      assert {:error, :forbidden} =
               PlanningRequestValidator.validate_request(%{}, account.id, outsider.id)
    end

    test "a participant_ids that is present but empty or null is still :forbidden" do
      account = insert_account("validator empty")
      actor = insert_user_with_membership(account, "empty-actor@example.com")

      for participants <- [[], nil] do
        assert {:error, :forbidden} =
                 PlanningRequestValidator.validate_request(
                   %{"participant_ids" => participants},
                   account.id,
                   actor.id
                 )
      end
    end
  end

  defp set_status!(account, user, status) do
    AccountMembership
    |> Repo.get_by!(account_id: account.id, user_id: user.id)
    |> AccountMembership.changeset(%{status: status})
    |> Repo.update!()
  end
end
