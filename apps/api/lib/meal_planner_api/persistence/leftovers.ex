defmodule MealPlannerApi.Persistence.Leftovers do
  @moduledoc """
  Persistence boundary for Prepared leftovers (issue #45).

  Every function takes the Account id, so a leftover of another Account is
  indistinguishable from a missing one. A leftover is open until it is
  consumed down to zero portions or discarded; closed ones are not listed and
  cannot be changed. Prepared leftovers never touch Inventory.

  `now` is an option (default `DateTime.utc_now/0`) so tests pass the
  instant they need. The default consume-by date is three days after the
  Account's today (`MealPlannerApi.AccountClock`).
  """

  import Ecto.Query, warn: false

  alias MealPlannerApi.AccountClock
  alias MealPlannerApi.Persistence.Leftovers.PreparedLeftover
  alias MealPlannerApi.Persistence.Planning.ScheduledMeal
  alias MealPlannerApi.Repo

  @default_days_to_consume 3

  @doc "Open leftovers of the Account, soonest consume-by date first."
  def list_open(account_id) do
    from(l in PreparedLeftover,
      where: l.account_id == ^account_id and is_nil(l.consumed_at) and is_nil(l.discarded_at),
      order_by: [asc: l.consume_by_date, asc: l.stored_at, asc: l.id]
    )
    |> Repo.all()
  end

  @doc """
  Stores a leftover. `attrs` uses atom keys: `:title`, `:portions`, and
  optionally `:consume_by_date`, `:notes`, `:scheduled_meal_id`.

  `:scheduled_meal_id` is the source of the leftover and has to be a Scheduled
  meal of the Account: a malformed id, an unknown one and another Account's
  all answer `:scheduled_meal_not_found`, and nothing is stored. An invalid
  field is reported first, before the meal is looked up.
  """
  @spec create(Ecto.UUID.t(), map(), map()) ::
          {:ok, Ecto.Schema.t()}
          | {:error, Ecto.Changeset.t()}
          | {:error, :scheduled_meal_not_found}
  def create(account_id, attrs, opts \\ %{}) when is_map(attrs) do
    now = Map.get(opts, :now, DateTime.utc_now())
    {source_meal_id, attrs} = Map.pop(attrs, :scheduled_meal_id)

    attrs =
      attrs
      |> Map.put(:account_id, account_id)
      |> Map.put(:stored_at, now)
      |> Map.put_new_lazy(:consume_by_date, fn ->
        account_id |> AccountClock.today(now) |> Date.add(@default_days_to_consume)
      end)

    changeset = PreparedLeftover.create_changeset(%PreparedLeftover{}, attrs)

    with {:ok, _valid} <- Ecto.Changeset.apply_action(changeset, :insert),
         {:ok, meal_id} <- own_scheduled_meal_id(account_id, source_meal_id) do
      changeset |> Ecto.Changeset.put_change(:scheduled_meal_id, meal_id) |> insert_with_source()
    end
  end

  defp own_scheduled_meal_id(_account_id, nil), do: {:ok, nil}

  defp own_scheduled_meal_id(account_id, meal_id) do
    with {:ok, uuid} <- Ecto.UUID.cast(meal_id),
         true <-
           Repo.exists?(
             from(m in ScheduledMeal, where: m.id == ^uuid and m.account_id == ^account_id)
           ) do
      {:ok, uuid}
    else
      _ -> {:error, :scheduled_meal_not_found}
    end
  end

  # The meal can be deleted between the lookup and the insert: the foreign key
  # then answers what the lookup would have.
  defp insert_with_source(changeset) do
    case Repo.insert(changeset) do
      {:error, %Ecto.Changeset{errors: errors}} = error ->
        if Keyword.has_key?(errors, :scheduled_meal_id),
          do: {:error, :scheduled_meal_not_found},
          else: error

      {:ok, leftover} ->
        {:ok, leftover}
    end
  end

  @doc "Eats one portion; closes the leftover when none remain."
  def consume(account_id, id, opts \\ %{}) do
    now = Map.get(opts, :now, DateTime.utc_now())

    mutate_open(account_id, id, fn leftover ->
      remaining = leftover.portions - 1
      closed_at = if remaining == 0, do: now

      PreparedLeftover.state_changeset(leftover, %{portions: remaining, consumed_at: closed_at})
    end)
  end

  @doc "Discards the whole leftover."
  def discard(account_id, id, opts \\ %{}) do
    now = Map.get(opts, :now, DateTime.utc_now())

    mutate_open(account_id, id, fn leftover ->
      PreparedLeftover.state_changeset(leftover, %{discarded_at: now})
    end)
  end

  defp mutate_open(account_id, id, changeset_fun) do
    case Ecto.UUID.cast(id) do
      {:ok, uuid} ->
        Repo.transaction(fn -> update_open_leftover!(account_id, uuid, changeset_fun) end)

      :error ->
        {:error, :not_found}
    end
  end

  # Runs inside the caller's transaction: it locks the row and rolls back.
  defp update_open_leftover!(account_id, uuid, changeset_fun) do
    query =
      from(l in PreparedLeftover,
        where:
          l.id == ^uuid and l.account_id == ^account_id and is_nil(l.consumed_at) and
            is_nil(l.discarded_at),
        lock: "FOR UPDATE"
      )

    case Repo.one(query) do
      nil ->
        Repo.rollback(:not_found)

      leftover ->
        case leftover |> changeset_fun.() |> Repo.update() do
          {:ok, updated} -> updated
          {:error, changeset} -> Repo.rollback(changeset)
        end
    end
  end
end
