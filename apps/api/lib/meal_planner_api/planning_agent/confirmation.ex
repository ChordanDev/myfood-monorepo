defmodule MealPlannerApi.PlanningAgent.Confirmation do
  @moduledoc """
  Saves a confirmed Proposal (issue #423, ported from myfood@d9b965a): one
  transaction commits the Planning session, stores the confirmation and
  inserts the Proposal's meals as Scheduled meals.

  The confirmation identity is the Proposal's id, the primary key of
  `planning_confirmations`: a replayed confirmation finds its row
  (`status/2`) instead of saving twice, and a concurrent replay that loses
  the race is refused by the key. The row outlives the session, so a client
  that lost the acknowledgement asks `status/2` later.

  The agent never plans over a Scheduled meal: a session starts on a range
  with none, and the confirmation saves only into a range that still has
  none. A meal another Member added during the session (final or not) is
  never deleted or replaced: the range's meals are locked and any of them
  refuses the whole confirmation with the occupied days and slots, and a
  meal inserted concurrently fails the insert on the one-meal-per-slot
  index. The Shopping list is derived from the Scheduled meals by the
  existing rebuild on its next read; the confirmation writes no Shopping
  items.
  """

  import Ecto.Query

  alias MealPlannerApi.Data.PlanningRepo
  alias MealPlannerApi.Persistence.Planning.{PlanningConfirmation, ScheduledMeal}
  alias MealPlannerApi.Repo

  @type attrs :: %{
          confirmation_id: Ecto.UUID.t(),
          account_id: Ecto.UUID.t(),
          session_id: Ecto.UUID.t(),
          membership_id: Ecto.UUID.t(),
          range: {Date.t(), Date.t()},
          meals: [%{date: Date.t(), slot: String.t(), recipe_id: Ecto.UUID.t()}]
        }

  @type summary :: %{
          confirmation_id: Ecto.UUID.t(),
          range_from: Date.t(),
          range_to: Date.t(),
          meals_count: non_neg_integer()
        }

  @slots %{"breakfast" => :breakfast, "lunch" => :lunch, "dinner" => :dinner}
  @slot_order [:breakfast, :lunch, :dinner]

  @doc """
  Commits the confirmation in one transaction. Refuses with:

    * `:already_confirmed` — a concurrent replay stored it first
    * `:session_not_active` — the Planning session is no longer active
    * `{:slot_occupied, [{date, slot}]}` — the range holds Scheduled meals
      added since the session started
    * `:rejected` — the database refused it; nothing was saved
    * `:unresolved` — the connection failed, so the outcome is unknown;
      `status/2` tells once it can be read
  """
  @spec commit(attrs()) ::
          {:ok, summary()} | {:error, atom() | {:slot_occupied, [{Date.t(), atom()}]}}
  def commit(attrs) do
    {from_date, to_date} = attrs.range

    meals =
      Enum.map(attrs.meals, fn meal ->
        %{date: meal.date, slot: Map.fetch!(@slots, meal.slot), recipe_id: meal.recipe_id}
      end)

    Ecto.Multi.new()
    |> PlanningRepo.mark_committed(attrs.account_id, attrs.session_id)
    |> Ecto.Multi.run(:confirmation, fn repo, _changes ->
      %PlanningConfirmation{}
      |> PlanningConfirmation.changeset(%{
        id: attrs.confirmation_id,
        account_id: attrs.account_id,
        planning_session_id: attrs.session_id,
        confirmed_by_membership_id: attrs.membership_id,
        range_from: from_date,
        range_to: to_date,
        meals_count: length(meals)
      })
      |> repo.insert()
      |> case do
        {:ok, confirmation} -> {:ok, confirmation}
        {:error, _changeset} -> {:error, :already_confirmed}
      end
    end)
    |> Ecto.Multi.run(:range_free, fn repo, _changes -> range_free(repo, attrs) end)
    |> PlanningRepo.insert_scheduled_meals(attrs.account_id, meals)
    |> Repo.transaction()
    |> case do
      {:ok, %{confirmation: confirmation}} -> {:ok, summary(confirmation)}
      {:error, :mark_committed, :session_lock_lost, _} -> {:error, :session_not_active}
      {:error, :range_free, occupied, _} -> {:error, {:slot_occupied, occupied}}
      {:error, :confirmation, reason, _} -> {:error, reason}
      {:error, _step, _reason, _} -> {:error, :rejected}
    end
  rescue
    # The database answered with an error: the transaction was rolled back.
    _error in [Postgrex.Error, Ecto.ConstraintError] -> {:error, :rejected}
    # The connection failed: the outcome is unknown.
    _error in DBConnection.ConnectionError -> {:error, :unresolved}
  end

  # The range's meals, locked in id order as every range write locks them.
  defp range_free(repo, %{account_id: account_id, range: {from_date, to_date}}) do
    occupied =
      from(m in ScheduledMeal,
        where: m.account_id == ^account_id and m.date >= ^from_date and m.date <= ^to_date,
        order_by: m.id,
        lock: "FOR UPDATE",
        select: {m.date, m.slot}
      )
      |> repo.all()
      # Listed by date and slot, as a start refusal lists them; the lock
      # keeps the id order.
      |> Enum.sort_by(fn {date, slot} ->
        {Date.to_gregorian_days(date), Enum.find_index(@slot_order, &(&1 == slot))}
      end)

    if occupied == [], do: {:ok, :free}, else: {:error, occupied}
  end

  @doc "The confirmation `confirmation_id` of the Account, or `:not_found`."
  @spec status(Ecto.UUID.t(), String.t()) :: {:confirmed, summary()} | :not_found
  def status(account_id, confirmation_id) do
    with {:ok, id} <- Ecto.UUID.cast(confirmation_id),
         %PlanningConfirmation{} = row <-
           Repo.one(
             from(c in PlanningConfirmation, where: c.id == ^id and c.account_id == ^account_id)
           ) do
      {:confirmed, summary(row)}
    else
      _ -> :not_found
    end
  end

  defp summary(confirmation) do
    %{
      confirmation_id: confirmation.id,
      range_from: confirmation.range_from,
      range_to: confirmation.range_to,
      meals_count: confirmation.meals_count
    }
  end
end
