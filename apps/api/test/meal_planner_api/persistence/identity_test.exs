defmodule MealPlannerApi.Persistence.IdentityTest do
  use ExUnit.Case, async: false

  import Ecto.Query
  import MealPlannerApi.FactoryHelpers

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Persistence.Identity
  alias MealPlannerApi.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()
  end

  # ─── Phase A — Tenancy Refactor (PR 3c task 3.21, prerequisite) ────────────
  #
  # `Identity.ensure_persistent_identity/1` predates the AccountMembership
  # model. Its fast path (`fetch_existing_identity/2`) only short-circuits
  # when the REAL `users.account_id` column equals the target account —
  # but per design.md §2.3 (decision 5.1), `users.account_id` is
  # intentionally nil/unauthoritative for real multi-membership Users
  # (`current_membership` carries tenancy instead). Without this fix,
  # calling `ensure_persistent_identity/1` for a real, multi-membership
  # User falls through to the "mint a NEW shadow User" branch, which
  # inserts a second `users` row with the SAME email and crashes on the
  # `users.email` unique index — a hard blocker for every service that
  # still routes account resolution through this bridge (cooking_service,
  # inventory_service, planning_chat_service, shopping_service,
  # recipe_service — see task 3.21's per-service grep verification in
  # apply-progress.md).
  describe "ensure_persistent_identity/1 — multi-membership fast path (task 3.21 prerequisite)" do
    test "resolves directly via an :active AccountMembership row, without minting a shadow User" do
      user =
        user_with_memberships(%{email: "identity_fastpath@example.com"}, [
          {%{plan: :family_4, name: "Identity Fastpath Account"}, :owner}
        ])

      [membership] = user.memberships

      assert {:ok, %{account_id: account_id, user_id: user_id}} =
               Identity.ensure_persistent_identity(%{
                 id: user.id,
                 account_id: membership.account_id
               })

      # The REAL ids are returned verbatim — no derived "shadow" identity
      # is minted, and (critically) no second `users` row is inserted.
      assert account_id == membership.account_id
      assert user_id == user.id
    end

    test "returns :invalid_identity-shaped :not_found style error when no membership and no legacy account_id match exists" do
      user =
        user_with_memberships(%{email: "identity_fastpath_none@example.com"}, [
          {%{plan: :family_4, name: "Identity Fastpath Other Account"}, :owner}
        ])

      other_user =
        user_with_memberships(%{email: "identity_fastpath_stranger@example.com"}, [
          {%{plan: :individual, name: "Identity Fastpath Stranger Account"}, :owner}
        ])

      [stranger_membership] = other_user.memberships

      # `user` has no membership in `stranger_membership`'s account, and
      # `users.account_id` is nil for both — this must NOT resolve, and
      # must NOT crash trying to mint a shadow identity with `user`'s
      # real (already-taken) email either. It surfaces as an insert
      # error, exactly like any other unresolvable identity — the caller
      # (a controller/service) is expected to have already verified
      # membership before ever reaching this bridge in practice.
      result =
        Identity.ensure_persistent_identity(%{
          id: user.id,
          account_id: stranger_membership.account_id,
          email: user.email
        })

      assert {:error, _reason} = result
    end
  end

  describe "ensure_persistent_identity/1 — email normalization" do
    test "stores the identity's email trimmed and lower-cased" do
      assert {:ok, %{user_id: user_id}} =
               Identity.ensure_persistent_identity(%{
                 id: "external-user-normalized",
                 account_id: "external-account-normalized",
                 email: "  External.User@Example.COM "
               })

      assert Repo.get!(User, user_id).email == "external.user@example.com"
    end

    test "rejects an email that differs only in case from another user's instead of storing it twice" do
      user_with_memberships(%{email: "identity-taken@example.com"}, [])

      assert {:error, %Ecto.Changeset{errors: errors}} =
               Identity.ensure_persistent_identity(%{
                 id: "external-user-case-variant",
                 account_id: "external-account-case-variant",
                 email: "Identity-Taken@Example.com"
               })

      assert {:email, {_message, [{:constraint, :unique} | _]}} = List.keyfind(errors, :email, 0)
    end

    test "an identity without an email is a validation error, not a crash" do
      assert {:error, %Ecto.Changeset{errors: errors}} =
               Identity.ensure_persistent_identity(%{
                 id: "external-user-nil-email",
                 account_id: "external-account-nil-email",
                 email: nil
               })

      assert {:email, {_message, [validation: :required]}} = List.keyfind(errors, :email, 0)
    end

    # A user stored with capitals (an invite from before emails were
    # normalized) whose membership is gone must not get a lower-cased
    # shadow user with an empty account next to the real one.
    test "refuses to mint a shadow user for a stored email that only differs in case" do
      user =
        user_with_memberships(%{email: "Shadow-Case@Example.com"}, [
          {%{plan: :family_4, name: "Shadow Case Account"}, :owner}
        ])

      stranger =
        user_with_memberships(%{email: "shadow-case-stranger@example.com"}, [
          {%{plan: :individual, name: "Shadow Case Stranger Account"}, :owner}
        ])

      [stranger_membership] = stranger.memberships

      assert {:error, %Ecto.Changeset{errors: errors}} =
               Identity.ensure_persistent_identity(%{
                 id: user.id,
                 account_id: stranger_membership.account_id,
                 email: user.email
               })

      assert {:email, {_message, [{:constraint, :unique} | _]}} = List.keyfind(errors, :email, 0)

      assert Repo.aggregate(
               from(u in User, where: fragment("lower(?)", u.email) == "shadow-case@example.com"),
               :count
             ) == 1
    end
  end
end
