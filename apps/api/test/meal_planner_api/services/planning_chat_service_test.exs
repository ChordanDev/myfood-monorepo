defmodule MealPlannerApi.Services.PlanningChatServiceTest do
  use ExUnit.Case, async: false

  import Ecto.Query, warn: false
  import MealPlannerApi.IdentityFixtures

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Planning.{PlanningGenerationRun, PlanningProposal}
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.PlanningChatService

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()

    %{user: user, account: account} = insert_identity!()

    for slot <- [:breakfast, :lunch, :dinner] do
      {:ok, _recipe} =
        Catalog.create_recipe(%{
          account_id: account.id,
          created_by_user_id: user.id,
          name: "Range cap #{slot}",
          source: :user_created,
          servings: 2,
          suitable_for_slots: [slot]
        })
    end

    %{user: user, account: account}
  end

  # The User a controller or channel hands to the service: the persisted
  # User with the tier of the access token and the Account of the membership.
  defp current_user(user, account, subscription_tier) do
    user
    |> Map.put(:subscription_tier, subscription_tier)
    |> Map.put(:account_id, account.id)
  end

  defp range(date_from, date_to), do: %{"date_from" => date_from, "date_to" => date_to}

  defp generation_run_count(account_id) do
    Repo.aggregate(from(r in PlanningGenerationRun, where: r.account_id == ^account_id), :count)
  end

  defp proposal_count(account_id) do
    Repo.aggregate(
      from(p in PlanningProposal,
        join: r in assoc(p, :generation_run),
        where: r.account_id == ^account_id
      ),
      :count
    )
  end

  defp refute_planning_rows(account_id) do
    assert generation_run_count(account_id) == 0
    assert proposal_count(account_id) == 0
  end

  describe "generate_menu/2 date range limit" do
    test "accepts a range of a single day", %{user: user, account: account} do
      assert {:ok, result} =
               PlanningChatService.generate_menu(
                 current_user(user, account, :free),
                 range("2026-06-15", "2026-06-15")
               )

      assert result.date_from == ~D[2026-06-15]
      assert result.date_to == ~D[2026-06-15]

      dates = result.proposal_json.scheduled_meals |> Enum.map(& &1.date) |> Enum.uniq()

      assert dates == ["2026-06-15"]
      assert length(result.proposal_json.scheduled_meals) == 3

      assert generation_run_count(account.id) == 1
      assert proposal_count(account.id) == 1
    end

    test "accepts a range of seven days for a free User", %{user: user, account: account} do
      assert {:ok, result} =
               PlanningChatService.generate_menu(
                 current_user(user, account, :free),
                 range("2026-06-15", "2026-06-21")
               )

      assert result.date_from == ~D[2026-06-15]
      assert result.date_to == ~D[2026-06-21]

      dates = result.proposal_json.scheduled_meals |> Enum.map(& &1.date) |> Enum.uniq()

      assert dates ==
               ~w(2026-06-15 2026-06-16 2026-06-17 2026-06-18 2026-06-19 2026-06-20 2026-06-21)

      assert length(result.proposal_json.scheduled_meals) == 21

      assert generation_run_count(account.id) == 1
      assert proposal_count(account.id) == 1
    end

    test "refuses a range of eight days for a free User and writes nothing", %{
      user: user,
      account: account
    } do
      assert {:error, :invalid_date_range} =
               PlanningChatService.generate_menu(
                 current_user(user, account, :free),
                 range("2026-06-15", "2026-06-22")
               )

      refute_planning_rows(account.id)
    end

    test "accepts a range of seven days for a premium User", %{user: user, account: account} do
      assert {:ok, result} =
               PlanningChatService.generate_menu(
                 current_user(user, account, :premium),
                 range("2026-06-15", "2026-06-21")
               )

      dates = result.proposal_json.scheduled_meals |> Enum.map(& &1.date) |> Enum.uniq()

      assert length(dates) == 7
      assert length(result.proposal_json.scheduled_meals) == 21

      assert generation_run_count(account.id) == 1
      assert proposal_count(account.id) == 1
    end

    test "refuses a range of eight days for a premium User and writes nothing", %{
      user: user,
      account: account
    } do
      assert {:error, :invalid_date_range} =
               PlanningChatService.generate_menu(
                 current_user(user, account, :premium),
                 range("2026-06-15", "2026-06-22")
               )

      refute_planning_rows(account.id)
    end

    test "refuses a range of two years and writes nothing", %{user: user, account: account} do
      for subscription_tier <- [:free, :premium] do
        assert {:error, :invalid_date_range} =
                 PlanningChatService.generate_menu(
                   current_user(user, account, subscription_tier),
                   range("2026-01-01", "2027-12-31")
                 )
      end

      refute_planning_rows(account.id)
    end

    test "still refuses a range that ends before it starts", %{user: user, account: account} do
      assert {:error, :invalid_date_range} =
               PlanningChatService.generate_menu(
                 current_user(user, account, :premium),
                 range("2026-06-21", "2026-06-15")
               )

      refute_planning_rows(account.id)
    end
  end
end
