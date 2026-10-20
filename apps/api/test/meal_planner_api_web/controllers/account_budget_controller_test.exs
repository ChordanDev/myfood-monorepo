defmodule MealPlannerApiWeb.AccountBudgetControllerTest do
  @moduledoc """
  `GET` and `PUT /api/account/budget` through the router (issue #271): every
  member reads the Account's weekly Budget and only the owner changes it.
  Request bodies are sent as JSON text, so a value keeps the JSON type the
  client wrote.
  """
  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.FactoryHelpers

  alias MealPlannerApi.Persistence.Accounts.{Account, AccountMembership, User}
  alias MealPlannerApi.Repo

  @path "/api/account/budget"

  setup do
    previous = Application.get_env(:meal_planner_api, :min_weekly_budget_per_person_cents)
    Application.put_env(:meal_planner_api, :min_weekly_budget_per_person_cents, 10_000)

    on_exit(fn ->
      Application.put_env(:meal_planner_api, :min_weekly_budget_per_person_cents, previous)
    end)

    owner =
      user_with_memberships(%{email: "account_budget@example.com", name: "Owner"}, [
        {%{plan: :family_4, name: "Account Budget"}, :owner}
      ])

    owner |> Ecto.Changeset.change(household_size: 3) |> Repo.update!()

    [membership] = owner.memberships
    {member, member_membership} = add_member!(membership.account_id)

    %{
      membership: membership,
      owner_token: issue_access_v2_token(owner, membership),
      member_token: issue_access_v2_token(member, member_membership)
    }
  end

  describe "GET /api/account/budget" do
    test "answers the tier default when no Budget was set", %{conn: conn, owner_token: token} do
      assert conn |> get_budget(token) |> json_response(200) == %{
               "budget" => %{
                 "weeklyBudgetCents" => 45_000,
                 "isDefault" => true,
                 "minWeeklyBudgetCents" => 30_000,
                 "currency" => "ARS"
               }
             }
    end

    test "a member who is not the owner reads it too", %{conn: conn, member_token: token} do
      assert %{"budget" => %{"weeklyBudgetCents" => 45_000}} =
               conn |> get_budget(token) |> json_response(200)
    end

    test "needs a session", %{conn: conn} do
      assert conn |> get(@path) |> json_response(401)
    end
  end

  describe "PUT /api/account/budget" do
    test "the owner stores the amount and gets the Budget back", %{
      conn: conn,
      membership: membership,
      owner_token: token
    } do
      assert conn |> put_budget(token, %{"weeklyBudgetCents" => 60_000}) |> json_response(200) ==
               %{
                 "budget" => %{
                   "weeklyBudgetCents" => 60_000,
                   "isDefault" => false,
                   "minWeeklyBudgetCents" => 30_000,
                   "currency" => "ARS"
                 }
               }

      assert Repo.get!(Account, membership.account_id).default_budget_cents == 60_000
    end

    test "a later GET reads the stored amount", %{conn: conn, owner_token: token, member_token: m} do
      conn |> put_budget(token, %{"weeklyBudgetCents" => 60_000}) |> json_response(200)

      assert %{"budget" => %{"weeklyBudgetCents" => 60_000, "isDefault" => false}} =
               conn |> get_budget(m) |> json_response(200)
    end

    test "a member who is not the owner gets 403 not_owner", %{
      conn: conn,
      membership: membership,
      member_token: token
    } do
      body = conn |> put_budget(token, %{"weeklyBudgetCents" => 60_000}) |> json_response(403)

      assert body["error"]["code"] == "not_owner"
      assert Repo.get!(Account, membership.account_id).default_budget_cents == 0
    end

    for {label, body} <- [
          {"an amount below the floor", %{"weeklyBudgetCents" => 29_999}},
          {"zero", %{"weeklyBudgetCents" => 0}},
          {"a negative amount", %{"weeklyBudgetCents" => -100}},
          {"a decimal amount", %{"weeklyBudgetCents" => 30_000.5}},
          {"a string", %{"weeklyBudgetCents" => "60000"}},
          {"null", %{"weeklyBudgetCents" => nil}},
          {"no amount", %{}}
        ] do
      test "#{label} answers 422 naming weeklyBudgetCents", %{
        conn: conn,
        membership: membership,
        owner_token: token
      } do
        body = conn |> put_budget(token, unquote(Macro.escape(body))) |> json_response(422)

        assert body["error"]["code"] == "validation_error"
        assert body["error"]["message"] =~ "weeklyBudgetCents"
        assert Repo.get!(Account, membership.account_id).default_budget_cents == 0
      end
    end
  end

  defp get_budget(conn, token) do
    conn
    |> put_req_header("authorization", "Bearer " <> token)
    |> get(@path)
  end

  defp put_budget(conn, token, body) do
    conn
    |> put_req_header("authorization", "Bearer " <> token)
    |> put_req_header("content-type", "application/json")
    |> put(@path, Jason.encode!(body))
  end

  defp add_member!(account_id) do
    user =
      %User{}
      |> User.changeset(%{
        email: "account_budget_member_#{System.unique_integer([:positive])}@example.com",
        name: "Member",
        role: :member
      })
      |> Repo.insert!()

    membership =
      %AccountMembership{}
      |> AccountMembership.changeset(%{
        account_id: account_id,
        user_id: user.id,
        role: :member,
        status: :active,
        joined_at: DateTime.utc_now()
      })
      |> Repo.insert!()

    {user, membership}
  end
end
