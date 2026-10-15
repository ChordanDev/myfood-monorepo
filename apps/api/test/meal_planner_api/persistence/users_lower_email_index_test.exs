defmodule MealPlannerApi.Persistence.UsersLowerEmailIndexTest do
  @moduledoc """
  Email lookups match `lower(users.email)` (login and sign-up), so `users`
  carries an index on that expression. It is not unique: rows that differ
  only in case may already exist, and the plain unique index on `email`
  still guards exact duplicates.
  """
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
  end

  test "users has a non-unique index on lower(email)" do
    assert [[indexdef]] =
             Repo.query!(
               "SELECT indexdef FROM pg_indexes WHERE tablename = 'users' AND indexname = 'users_lower_email_index'"
             ).rows

    assert indexdef =~ "lower((email)::text)"
    refute indexdef =~ "UNIQUE"
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
end
