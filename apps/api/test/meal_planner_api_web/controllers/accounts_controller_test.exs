defmodule MealPlannerApiWeb.AccountsControllerTest do
  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.FactoryHelpers

  alias MealPlannerApi.Auth.Guardian
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Repo
  alias MealPlannerApiWeb.MobileFixtures

  # The frozen `CurrentMe` bodies the mobile app is tested against: a User
  # who has not finished Onboarding and one who has. The tests below keep
  # them from drifting away from the route.
  @before_onboarding_fixture "auth/fixtures/currentMeBeforeOnboarding.json"
  @fixture "auth/fixtures/currentMe.json"

  # ─── Phase A — Tenancy Refactor (PR 3c task 3.22) ───────────────────────────
  # See calendar_controller_test.exs (task 3.14) for why a tampered
  # `account_id` claim — rather than a plain "scoped JWT" — is the genuine
  # RED-discriminating case for this codebase.
  describe "GET /api/me — multi-familia tenancy scoping (task 3.22)" do
    test "resolves account via current_membership.account_id, not a tampered account_id claim",
         %{conn: conn} do
      user =
        user_with_memberships(%{email: "accounts_me_tamper@example.com"}, [
          {%{plan: :family_4, name: "Accounts Me Tamper Account A"}, :owner},
          {%{plan: :family_6, name: "Accounts Me Tamper Account B"}, :member}
        ])

      [membership_a, membership_b] = user.memberships

      tampered_claims =
        MealPlannerApi.AccountsMembership.claims_for(user, membership_a)
        |> Map.put("account_id", to_string(membership_b.account_id))

      {:ok, token, _claims} =
        Guardian.encode_and_sign(user, tampered_claims, token_type: "access")

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/me")

      body = json_response(conn, 200)

      assert body["account"]["id"] == membership_a.account_id
      refute body["account"]["id"] == membership_b.account_id
      assert body["account"]["type"] == "family"
      assert body["membership"] == %{"role" => "owner"}
    end
  end

  describe "GET /api/me — mobile CurrentMe shape" do
    setup do
      user =
        user_with_memberships(%{email: "accounts_me_shape@example.com", name: "Me Shape"}, [
          {%{plan: :individual, name: "Accounts Me Shape"}, :owner}
        ])

      [membership] = user.memberships
      %{user: user, membership: membership, token: issue_access_v2_token(user, membership)}
    end

    test "an account inside its trial gets the whole body with access granted", %{
      conn: conn,
      user: user,
      membership: membership,
      token: token
    } do
      trial_ends_at = put_trial!(membership.account_id, 7 * 86_400)

      assert conn |> get_me(token, "/api/me") |> json_response(200) == %{
               "user" => %{
                 "id" => user.id,
                 "email" => "accounts_me_shape@example.com",
                 "displayName" => "Me Shape",
                 "householdSize" => nil,
                 "cookingSkill" => nil
               },
               "account" => %{
                 "id" => membership.account_id,
                 "type" => "individual",
                 "trialEndsAt" => DateTime.to_iso8601(trial_ends_at),
                 "timezone" => nil,
                 "subscriptionStatus" => "none",
                 "access" => %{"canUseApp" => true, "reason" => nil}
               },
               "membership" => %{"role" => "owner"},
               "onboarding" => %{"isComplete" => false}
             }
    end

    test "an account past its trial still gets 200, with access denied in the body", %{
      conn: conn,
      membership: membership,
      token: token
    } do
      trial_ends_at = put_trial!(membership.account_id, -86_400)

      body = conn |> get_me(token, "/api/me") |> json_response(200)

      assert body["account"] == %{
               "id" => membership.account_id,
               "type" => "individual",
               "trialEndsAt" => DateTime.to_iso8601(trial_ends_at),
               "timezone" => nil,
               "subscriptionStatus" => "none",
               "access" => %{"canUseApp" => false, "reason" => "trial_expired"}
             }
    end

    test "onboarding is complete once the user has finished it", %{
      conn: conn,
      user: user,
      token: token
    } do
      user
      |> Ecto.Changeset.change(onboarding_completed_at: DateTime.utc_now())
      |> Repo.update!()

      body = conn |> get_me(token, "/api/me") |> json_response(200)

      assert body["onboarding"] == %{"isComplete" => true}
    end

    test "has exactly the key sets of the frozen mobile fixture before Onboarding", %{
      conn: conn,
      token: token
    } do
      fixture = MobileFixtures.read!(@before_onboarding_fixture)

      assert Map.keys(fixture) == ["account", "membership", "onboarding", "user"]
      assert fixture["onboarding"] == %{"isComplete" => false}

      body = conn |> get_me(token, "/api/me") |> json_response(200)

      assert MobileFixtures.key_shape(body) == MobileFixtures.key_shape(fixture)
      assert body["onboarding"] == fixture["onboarding"]
    end

    test "has exactly the key sets of the frozen mobile fixture after Onboarding", %{
      conn: conn,
      user: user,
      membership: membership,
      token: token
    } do
      fixture = MobileFixtures.read!(@fixture)

      assert Map.keys(fixture) == ["account", "membership", "onboarding", "user"]

      put_trial!(membership.account_id, 7 * 86_400)

      Account
      |> Repo.get!(membership.account_id)
      |> Ecto.Changeset.change(timezone: fixture["account"]["timezone"])
      |> Repo.update!()

      user
      |> Ecto.Changeset.change(
        name: fixture["user"]["displayName"],
        household_size: fixture["user"]["householdSize"],
        cooking_skill: fixture["user"]["cookingSkill"],
        onboarding_completed_at: DateTime.utc_now()
      )
      |> Repo.update!()

      body = conn |> get_me(token, "/api/me") |> json_response(200)

      assert MobileFixtures.key_shape(body) == MobileFixtures.key_shape(fixture)
      # Everything but the identifiers and the trial date is the fixture's.
      assert Map.drop(body["user"], ["id", "email"]) == Map.drop(fixture["user"], ["id", "email"])
      assert body["membership"] == fixture["membership"]
      assert body["onboarding"] == fixture["onboarding"]

      assert Map.drop(body["account"], ["id", "trialEndsAt"]) ==
               Map.drop(fixture["account"], ["id", "trialEndsAt"])
    end

    test "GET /api/auth/me returns the same body", %{conn: conn, token: token} do
      me = conn |> get_me(token, "/api/me") |> json_response(200)
      alias_body = conn |> get_me(token, "/api/auth/me") |> json_response(200)

      assert alias_body == me
      assert Map.keys(alias_body) == ["account", "membership", "onboarding", "user"]
    end
  end

  defp get_me(conn, token, path) do
    conn
    |> put_req_header("authorization", "Bearer " <> token)
    |> get(path)
  end

  # Persists a 7-day trial window ending `ends_in_seconds` from now and
  # returns the stored `trial_ends_at`.
  defp put_trial!(account_id, ends_in_seconds) do
    ends_at = DateTime.add(DateTime.utc_now(), ends_in_seconds, :second)

    account =
      Account
      |> Repo.get!(account_id)
      |> Account.changeset(%{
        trial_started_at: DateTime.add(ends_at, -7 * 86_400, :second),
        trial_ends_at: ends_at
      })
      |> Repo.update!()

    account.trial_ends_at
  end
end
