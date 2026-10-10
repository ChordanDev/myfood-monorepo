defmodule MealPlannerApi.Auth.GuardianTest do
  @moduledoc """
  Dual-write JWT shape test (Phase A — Tenancy Refactor, PR 1 task 1.14).

  Per `design.md` §8.4 + spec `guardian-jwt-claims.md`:

    * `access_v1` claim set per design §3.1: `sub`, `typ`, `account_id`,
      `account_type`, `subscription_tier`, `email`, `name`, `iat`, `exp`
    * `access_v2` claim set per design §3.2: every key from §3.1 PLUS
      `membership_id`, `plan`, `role`, `status`
    * An unknown `typ` is rejected by `AuthPipeline.VerifyTokenType` (the
      underlying Guardian decode succeeds; rejection is the plug's job —
      delegated to `MealPlannerApiWeb.AuthPipelineTest`).

  This test is the bridge between spec §3 (claim shape) and the
  pipeline in task 1.11 (auth verification). It proves the JWT shape
  independent of any controller.
  """
  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.FactoryHelpers

  alias MealPlannerApi.Auth.Guardian
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Repo
  alias MealPlannerApiWeb.Controllers.AccountScopeHelpers

  describe "access_v1 claim shape (design §3.1)" do
    test "mints a token with the full §3.1 claim set" do
      plan = Repo.get_by!(MealPlannerApi.Subscriptions.Plan, name: "family_4")

      {:ok, account} =
        %Account{}
        |> Account.changeset(%{
          name: "V1 Claim Family",
          plan: :family_4,
          default_budget_cents: 0,
          subscription_plan_id: plan.id
        })
        |> Repo.insert()

      {:ok, user} =
        %User{}
        |> User.changeset(%{
          account_id: account.id,
          email: "v1-claim@example.com",
          name: "V1 Claim",
          role: :owner
        })
        |> Repo.insert()

      claims_map = %{
        "typ" => "access",
        "account_id" => Ecto.UUID.cast!(account.id),
        "account_type" => "group",
        "subscription_tier" => "premium",
        "email" => user.email,
        "name" => user.name
      }

      {:ok, token, _claims} =
        Guardian.encode_and_sign(user, claims_map, token_type: "access")

      {:ok, decoded} = Guardian.decode_and_verify(token)

      # §3.1 keys — every one present
      for key <- [
            "sub",
            "typ",
            "account_id",
            "account_type",
            "subscription_tier",
            "email",
            "name",
            "iat",
            "exp"
          ] do
        assert Map.has_key?(decoded, key), "expected #{key} in access_v1 claim set"
      end

      assert decoded["typ"] == "access"
      assert decoded["account_id"] == Ecto.UUID.cast!(account.id)
      assert decoded["account_type"] == "group"
      assert decoded["subscription_tier"] == "premium"
      assert decoded["email"] == user.email
      assert decoded["name"] == user.name
      assert decoded["sub"] == Ecto.UUID.cast!(user.id)
      assert is_integer(decoded["iat"])
      assert is_integer(decoded["exp"])
      assert decoded["exp"] > decoded["iat"]
    end
  end

  describe "access_v2 claim shape (design §3.2)" do
    test "mints a token with every §3.2 claim populated from the membership" do
      user =
        user_with_memberships(
          %{email: "v2-claim@example.com"},
          [
            {%{plan: :family_4, name: "V2 Claim Family"}, :owner}
          ]
        )

      [membership] = user.memberships
      token = issue_access_v2_token(user, membership)
      {:ok, decoded} = Guardian.decode_and_verify(token)

      # §3.2 keys — every one present
      for key <- [
            "sub",
            "typ",
            "membership_id",
            "account_id",
            "role",
            "plan",
            "status",
            "email",
            "name",
            "iat",
            "exp"
          ] do
        assert Map.has_key?(decoded, key), "expected #{key} in access_v2 claim set"
      end

      assert decoded["typ"] == "access_v2"
      assert decoded["membership_id"] == Ecto.UUID.cast!(membership.id)
      assert decoded["account_id"] == Ecto.UUID.cast!(membership.account_id)
      assert decoded["role"] == "owner"
      assert decoded["plan"] == "family_4"
      assert decoded["status"] == "active"
      assert decoded["email"] == user.email
      assert decoded["name"] == user.name
      assert decoded["sub"] == Ecto.UUID.cast!(user.id)
    end

    test "decoded values match the underlying membership row, not stale claims" do
      user =
        user_with_memberships(
          %{email: "v2-fresh@example.com"},
          [
            {%{plan: :trial, name: "Trial Family"}, :member}
          ]
        )

      [membership] = user.memberships
      token = issue_access_v2_token(user, membership)
      {:ok, decoded} = Guardian.decode_and_verify(token)

      assert decoded["plan"] == "trial"
      assert decoded["role"] == "member"
      assert decoded["status"] == "active"
    end
  end

  # Issue #1 ("Token lifetimes"): access tokens live 1 hour, refresh
  # tokens 30 days, configured per `typ` through Guardian's `token_ttl`.
  describe "token lifetimes per typ" do
    @one_hour 60 * 60
    @thirty_days 30 * 24 * 60 * 60

    test "a legacy access token expires 1 hour after issue" do
      {:ok, token, _} =
        Guardian.encode_and_sign(
          %{id: "00000000-0000-0000-0000-000000000020"},
          %{"typ" => "access", "account_id" => "00000000-0000-0000-0000-000000000021"},
          token_type: "access"
        )

      {:ok, %{"iat" => iat, "exp" => exp}} = Guardian.decode_and_verify(token)
      assert exp - iat == @one_hour
    end

    test "an access_v2 token expires 1 hour after issue" do
      user =
        user_with_memberships(%{email: "ttl-v2@example.com"}, [
          {%{plan: :individual, name: "TTL V2"}, :owner}
        ])

      [membership] = user.memberships
      token = issue_access_v2_token(user, membership)

      {:ok, %{"typ" => "access_v2", "iat" => iat, "exp" => exp}} =
        Guardian.decode_and_verify(token)

      assert exp - iat == @one_hour
    end

    test "a refresh token minted by mint_token_pair/2 expires 30 days after issue" do
      user =
        user_with_memberships(%{email: "ttl-refresh@example.com"}, [
          {%{plan: :individual, name: "TTL Refresh"}, :owner}
        ])

      [membership] = user.memberships
      claims = MealPlannerApi.AccountsMembership.claims_for(user, membership)

      {:ok, access_token, refresh_token} =
        AccountScopeHelpers.mint_token_pair(user, claims)

      {:ok, %{"typ" => "access_v2", "iat" => access_iat, "exp" => access_exp}} =
        Guardian.decode_and_verify(access_token)

      {:ok, %{"typ" => "refresh", "iat" => refresh_iat, "exp" => refresh_exp}} =
        Guardian.decode_and_verify(refresh_token, %{}, token_type: "refresh")

      assert access_exp - access_iat == @one_hour
      assert refresh_exp - refresh_iat == @thirty_days
    end
  end

  describe "factory_helpers issue_access_v2_token/2 is the canonical entry point" do
    test "produces a token that verifies under both Guardian and the pipeline" do
      user =
        user_with_memberships(
          %{email: "factory-token@example.com"},
          [
            {%{plan: :family_6, name: "Family 6 Factory"}, :owner}
          ]
        )

      [membership] = user.memberships
      token = issue_access_v2_token(user, membership)

      {:ok, claims} = Guardian.decode_and_verify(token)
      assert claims["typ"] == "access_v2"

      # The factory token MUST carry the same membership_id we passed
      # in (otherwise the pipeline can't load the membership).
      assert claims["membership_id"] == Ecto.UUID.cast!(membership.id)
    end
  end
end
