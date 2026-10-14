defmodule MealPlannerApi.Persistence.Accounts.UserEmailTest do
  @moduledoc """
  The one rule every email lookup follows (login, sign-up, invites,
  identities): an email is compared trimmed and lower-cased, and it
  matches at most one User.
  """
  use ExUnit.Case, async: false

  import MealPlannerApi.FactoryHelpers

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Persistence.Accounts.UserEmail
  alias MealPlannerApi.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()
  end

  defp insert_user!(email) do
    user_with_memberships(%{email: email, name: "User", role: :owner}, [
      {%{plan: :individual, name: "Account"}, :owner}
    ])
  end

  describe "normalize/1" do
    test "trims and lower-cases" do
      assert UserEmail.normalize("  Ana.Perez@Example.COM \n") == "ana.perez@example.com"
    end
  end

  describe "get_user/1" do
    test "finds the user whose stored email differs in case and whitespace" do
      %User{id: id} = insert_user!("Ana.Perez@Example.com")

      assert %User{id: ^id} = UserEmail.get_user("  ana.perez@EXAMPLE.com ")
    end

    test "returns nil for an unknown email" do
      insert_user!("known@example.com")

      assert UserEmail.get_user("unknown@example.com") == nil
    end

    # The copies this module replaced broke ties differently (login took
    # the exact-case row, the others the oldest). The unique
    # lower(email) index makes the tie impossible, so there is no
    # tie-break to choose.
    test "never has to choose between users: a case variant cannot be stored" do
      %User{id: id} = insert_user!("tie@example.com")

      assert {:error, changeset} =
               %User{}
               |> User.changeset(%{email: "Tie@Example.com", name: "Other", role: :member})
               |> Repo.insert()

      assert {"has already been taken", _} = changeset.errors[:email]
      assert %User{id: ^id} = UserEmail.get_user("TIE@example.com")
    end
  end

  describe "registered?/1" do
    test "is true for an email stored with another case and false otherwise" do
      insert_user!("Registered@Example.com")

      assert UserEmail.registered?(" registered@example.com")
      refute UserEmail.registered?("someone-else@example.com")
    end
  end
end
