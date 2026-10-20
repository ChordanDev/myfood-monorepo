defmodule MealPlannerApi.Services.SocialLoginTest do
  @moduledoc """
  Branches of `MealPlannerApi.Services.SocialLogin` that the HTTP tests in
  `mobile_auth_social_controller_test.exs` do not reach: a session that
  cannot be opened leaves nothing behind.
  """
  use ExUnit.Case, async: false

  import MealPlannerApi.FactoryHelpers

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Auth.SocialVerifierFake
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Persistence.Auth.SocialIdentity
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.SocialLogin

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()
    :ok
  end

  test "a sign-up whose session cannot be opened registers and links nobody" do
    answer("new@example.com")

    assert SocialLogin.sign_in("google", "token", fn _user, _membership ->
             {:error, :session_failed}
           end) == {:error, :session_failed}

    assert Repo.aggregate(User, :count) == 0
    assert Repo.aggregate(Account, :count) == 0
    assert Repo.aggregate(AccountMembership, :count) == 0
    assert Repo.aggregate(SocialIdentity, :count) == 0
  end

  test "a sign-in whose session cannot be opened does not link the provider account" do
    user_with_memberships(%{email: "known@example.com"}, [{%{plan: :individual}, :owner}])
    answer("known@example.com")

    assert {:error, :session_failed} =
             SocialLogin.sign_in("google", "token", fn _user, _membership ->
               {:error, :session_failed}
             end)

    assert Repo.aggregate(SocialIdentity, :count) == 0
  end

  test "the session opener gets the User and the Membership" do
    user = user_with_memberships(%{email: "opener@example.com"}, [{%{plan: :individual}, :owner}])
    [membership] = user.memberships
    answer("opener@example.com")

    assert {:ok, {user_id, membership_id}} =
             SocialLogin.sign_in("google", "token", fn user, membership ->
               {:ok, {user.id, membership.id}}
             end)

    assert user_id == user.id
    assert membership_id == membership.id
  end

  defp answer(email) do
    SocialVerifierFake.answer(
      {:ok, %{provider: "google", subject: "google-sub", email: email, email_verified: true}}
    )
  end
end
