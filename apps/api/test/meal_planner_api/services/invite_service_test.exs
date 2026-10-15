defmodule MealPlannerApi.Services.InviteServiceTest do
  @moduledoc """
  Tests for `MealPlannerApi.Services.InviteService` — Phase A — Tenancy
  Refactor, PR 2a task 2.7.

  Coverage:
    * `mint_token/0` produces a plaintext ≥ 40 chars and a 64-char hex
      hash (SHA-256 lower-case hex)
    * `hash_token/1` is a stable hashing function usable by external
      callers (e.g. tests, future API surface)
    * `create_invite_row/2` reuses a user whose email differs only in
      case, and stores new emails normalized

  Accepting an invite is covered by the `AccountsMembership.accept_invite/2`
  tests.
  """
  use ExUnit.Case, async: false

  import MealPlannerApi.FactoryHelpers

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Accounts.User, as: PersistenceUser
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.InviteService

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()
  end

  describe "mint_token/0" do
    test "produces a plaintext of at least 40 chars and a 64-char hex hash" do
      {plaintext, hash} = InviteService.mint_token()

      assert is_binary(plaintext)
      assert String.length(plaintext) >= 40
      assert is_binary(hash)
      assert String.length(hash) == 64
      assert hash == String.downcase(hash)
      # 64-char hex hash: every char is a hex digit.
      assert Regex.match?(~r/^[0-9a-f]+$/, hash)
    end

    test "produces unique plaintexts across calls" do
      {a, _} = InviteService.mint_token()
      {b, _} = InviteService.mint_token()
      refute a == b
    end
  end

  describe "hash_token/1" do
    test "is stable and round-trips with mint_token/0" do
      {plaintext, hash} = InviteService.mint_token()
      assert InviteService.hash_token(plaintext) == hash
    end

    test "produces different hashes for different plaintexts" do
      {a, ha} = InviteService.mint_token()
      {b, hb} = InviteService.mint_token()
      assert ha != hb
      # And both round-trip.
      assert InviteService.hash_token(a) == ha
      assert InviteService.hash_token(b) == hb
    end
  end

  describe "create_invite_row/2" do
    test "reuses the user whose email differs only in case, and stores new emails normalized" do
      owner =
        user_with_memberships(%{email: "row-owner@example.com"}, [
          {%{plan: :family_4, name: "F"}, :owner}
        ])

      [owner_membership] = owner.memberships
      registered = user_with_memberships(%{email: "row-invitee@example.com"}, [])

      assert {:ok, %{membership: reused}} =
               InviteService.create_invite_row(owner_membership, "Row-Invitee@Example.com ")

      assert reused.user_id == registered.id

      assert {:ok, %{membership: created}} =
               InviteService.create_invite_row(owner_membership, " Row-New@Example.COM")

      assert Repo.get!(PersistenceUser, created.user_id).email == "row-new@example.com"
    end
  end
end
