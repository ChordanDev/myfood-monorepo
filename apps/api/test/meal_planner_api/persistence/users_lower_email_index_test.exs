defmodule MealPlannerApi.Persistence.UsersLowerEmailIndexTest do
  @moduledoc """
  Email lookups match `lower(users.email)` (login, sign-up, invites), so
  `users` carries a unique index on that expression: two users can no
  longer hold emails that differ only in case.
  """
  use ExUnit.Case, async: false

  import MealPlannerApi.FactoryHelpers

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
  end

  test "users has a unique index on lower(email)" do
    assert [[indexdef]] =
             Repo.query!(
               "SELECT indexdef FROM pg_indexes WHERE tablename = 'users' AND indexname = 'users_lower_email_index'"
             ).rows

    assert indexdef =~ "lower((email)::text)"
    assert indexdef =~ "UNIQUE"
  end

  test "the lower(email) lookup can be served by the index" do
    Repo.transaction(fn ->
      Repo.query!("SET LOCAL enable_seqscan = off")

      plan =
        Repo.query!("EXPLAIN SELECT id FROM users WHERE lower(email) = $1", ["a@example.com"]).rows
        |> List.flatten()
        |> Enum.join("\n")

      assert plan =~ "users_lower_email_index"
    end)
  end

  test "a user whose email differs only in case is an :email changeset error, not a crash" do
    user_with_memberships(%{email: "index-dup@example.com"}, [])

    assert {:error, %Ecto.Changeset{errors: errors}} =
             %User{}
             |> User.changeset(%{email: "Index-Dup@Example.com", name: "Dup", role: :member})
             |> Repo.insert()

    assert {:email,
            {_message, [{:constraint, :unique}, {:constraint_name, "users_lower_email_index"}]}} =
             List.keyfind(errors, :email, 0)
  end
end
