defmodule MealPlannerApi.Persistence.IdempotencyTest do
  use ExUnit.Case, async: false

  import Ecto.Query, only: [from: 2]
  import MealPlannerApi.IdentityFixtures

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Idempotency
  alias MealPlannerApi.Persistence.Idempotency.Key
  alias MealPlannerApi.Repo

  @endpoint "test.mutation"

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()
    %{account: account} = insert_identity!(plan: :family_4)
    counter = :counters.new(1, [])

    # Counts its runs and answers with that count.
    mutation = fn ->
      :counters.add(counter, 1, 1)
      {:ok, %{runs: :counters.get(counter, 1)}}
    end

    {:ok, account_id: account.id, mutation: mutation, runs: fn -> :counters.get(counter, 1) end}
  end

  test "a repeat with the same key replays the stored response and runs nothing", ctx do
    assert {:ok, %{runs: 1}} = Idempotency.run(ctx.account_id, @endpoint, "k", ctx.mutation)
    assert {:ok, %{"runs" => 1}} = Idempotency.run(ctx.account_id, @endpoint, "k", ctx.mutation)
    assert ctx.runs.() == 1

    assert %Key{response: %{"runs" => 1}, expires_at: expires_at} = key!(ctx.account_id, "k")
    assert DateTime.diff(expires_at, DateTime.utc_now()) in (24 * 3600 - 5)..(24 * 3600)
  end

  test "a key is scoped to its endpoint", ctx do
    assert {:ok, %{runs: 1}} = Idempotency.run(ctx.account_id, @endpoint, "k", ctx.mutation)
    assert {:ok, %{runs: 2}} = Idempotency.run(ctx.account_id, "other", "k", ctx.mutation)
  end

  test "without a key the mutation runs every time and nothing is stored", ctx do
    assert {:ok, %{runs: 1}} = Idempotency.run(ctx.account_id, @endpoint, nil, ctx.mutation)
    assert {:ok, %{runs: 2}} = Idempotency.run(ctx.account_id, @endpoint, nil, ctx.mutation)
    assert Repo.aggregate(Key, :count) == 0
  end

  test "a failed mutation rolls back its writes and its key", ctx do
    failing = fn ->
      ctx.mutation.()
      Repo.insert_all(Key, [stray_key(ctx.account_id)])
      {:error, :boom}
    end

    assert {:error, :boom} = Idempotency.run(ctx.account_id, @endpoint, "k", failing)
    assert Repo.aggregate(Key, :count) == 0
    assert {:ok, %{runs: 2}} = Idempotency.run(ctx.account_id, @endpoint, "k", ctx.mutation)
  end

  test "an expired key that was not pruned yet runs the mutation again", ctx do
    assert {:ok, %{runs: 1}} = Idempotency.run(ctx.account_id, @endpoint, "k", ctx.mutation)
    expire!(ctx.account_id, "k")

    assert {:ok, %{runs: 2}} = Idempotency.run(ctx.account_id, @endpoint, "k", ctx.mutation)
    assert %Key{response: %{"runs" => 2}} = key = key!(ctx.account_id, "k")
    assert DateTime.compare(key.expires_at, DateTime.utc_now()) == :gt
  end

  test "prune_expired deletes only the expired keys", ctx do
    {:ok, _} = Idempotency.run(ctx.account_id, @endpoint, "old", ctx.mutation)
    {:ok, _} = Idempotency.run(ctx.account_id, @endpoint, "new", ctx.mutation)
    expire!(ctx.account_id, "old")

    assert Idempotency.prune_expired() == 1
    assert Repo.all(from(k in Key, select: k.key)) == ["new"]
  end

  defp key!(account_id, key),
    do: Repo.one!(from(k in Key, where: k.account_id == ^account_id and k.key == ^key))

  defp expire!(account_id, key) do
    past = DateTime.add(DateTime.utc_now(), -1, :second)

    {1, _} =
      Repo.update_all(
        from(k in Key, where: k.account_id == ^account_id and k.key == ^key),
        set: [expires_at: past]
      )
  end

  defp stray_key(account_id) do
    now = DateTime.utc_now()

    %{
      id: Ecto.UUID.generate(),
      account_id: account_id,
      endpoint: "stray",
      key: "stray",
      expires_at: now,
      inserted_at: now,
      updated_at: now
    }
  end
end
