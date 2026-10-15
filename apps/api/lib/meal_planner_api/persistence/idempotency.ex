defmodule MealPlannerApi.Persistence.Idempotency do
  @moduledoc """
  Makes a mutation safe to retry under a client-generated key (issue #140).

  `run/4` runs a mutation once per Account, endpoint and key. The first
  request claims the key, runs the mutation and stores its response in the
  same transaction, so a key is never stored for a mutation that did not
  commit, nor a mutation committed without its key. A repeat with the same key
  within 24 hours returns the stored response and runs nothing.

  Two requests racing on one key serialize on its unique index: the second
  waits for the first to commit, then replays its response; if the first
  rolled back, the second claims the key and runs the mutation itself.

  Only a mutation that succeeded is stored. One that failed rolls back its
  claim with it, so a retry with the same key runs it again.
  """

  import Ecto.Query, warn: false

  alias MealPlannerApi.Persistence.Idempotency.Key
  alias MealPlannerApi.Repo

  @lifetime_seconds 24 * 60 * 60

  @type mutation :: (-> {:ok, map()} | {:error, term()})

  @doc """
  Runs `mutation` under `key`, or replays the response stored for it.

  Without a key the mutation runs as it would without this module. The
  mutation runs inside a transaction and may open its own, which joins it.
  """
  @spec run(Ecto.UUID.t(), String.t(), String.t() | nil, mutation()) ::
          {:ok, map()} | {:error, term()}
  def run(_account_id, _endpoint, nil, mutation), do: mutation.()

  def run(account_id, endpoint, key, mutation) when is_binary(key) do
    Repo.transaction(fn ->
      case claim(account_id, endpoint, key, DateTime.utc_now()) do
        {:replay, response} -> response
        :claimed -> run_and_store(account_id, endpoint, key, mutation)
      end
    end)
  end

  @doc "Deletes the keys that expired at `now`. Returns how many it deleted."
  @spec prune_expired(DateTime.t()) :: non_neg_integer()
  def prune_expired(now \\ DateTime.utc_now()) do
    {count, _} = Repo.delete_all(from(k in Key, where: k.expires_at <= ^now))
    count
  end

  defp run_and_store(account_id, endpoint, key, mutation) do
    case mutation.() do
      {:ok, response} ->
        {1, _} =
          account_id
          |> key_query(endpoint, key)
          |> Repo.update_all(set: [response: response, updated_at: DateTime.utc_now()])

        response

      {:error, reason} ->
        Repo.rollback(reason)
    end
  end

  # `ON CONFLICT DO NOTHING` waits for a transaction that holds the same key
  # uncommitted, so a key that is already taken is read once it is final.
  defp claim(account_id, endpoint, key, now) do
    row = %{
      id: Ecto.UUID.generate(),
      account_id: account_id,
      endpoint: endpoint,
      key: key,
      expires_at: expires_at(now),
      inserted_at: now,
      updated_at: now
    }

    case Repo.insert_all(Key, [row],
           on_conflict: :nothing,
           conflict_target: [:account_id, :endpoint, :key]
         ) do
      {1, _} -> :claimed
      {0, _} -> taken(account_id, endpoint, key, now)
    end
  end

  # A key that expired but was not pruned yet is claimed again, as if it were
  # new. One pruned between the insert and this read is claimed afresh.
  defp taken(account_id, endpoint, key, now) do
    case account_id |> key_query(endpoint, key) |> lock("FOR UPDATE") |> Repo.one() do
      nil ->
        claim(account_id, endpoint, key, now)

      %Key{expires_at: expires_at, response: response} ->
        if DateTime.compare(expires_at, now) == :gt do
          {:replay, response}
        else
          reclaim(account_id, endpoint, key, now)
        end
    end
  end

  defp reclaim(account_id, endpoint, key, now) do
    {1, _} =
      account_id
      |> key_query(endpoint, key)
      |> Repo.update_all(
        set: [response: nil, expires_at: expires_at(now), inserted_at: now, updated_at: now]
      )

    :claimed
  end

  defp key_query(account_id, endpoint, key) do
    from(k in Key,
      where: k.account_id == ^account_id and k.endpoint == ^endpoint and k.key == ^key
    )
  end

  defp expires_at(now), do: DateTime.add(now, @lifetime_seconds, :second)
end
