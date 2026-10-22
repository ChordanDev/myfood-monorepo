defmodule MealPlannerApi.PlanningAgent.Confirmation do
  @moduledoc """
  Saves a confirmed Proposal (issue #423, ported from myfood@d9b965a): one
  transaction commits the Planning session, stores the confirmation and
  replaces the range's Scheduled meals with the Proposal's.

  The confirmation identity is the Proposal's id, the primary key of
  `planning_confirmations`: a replayed confirmation finds its row
  (`status/2`) instead of saving twice, and a concurrent replay that loses
  the race is refused by the key. The row outlives the session, so a client
  that lost the acknowledgement asks `status/2` later.

  The meals replace the range through
  `MealPlannerApi.Persistence.Calendar.replace_scheduled_meals_multi/4`, so a
  final meal (cooked, or confirmed not cooked) keeps its answer: a Proposal
  meal on its date and slot refuses the whole confirmation. The Shopping
  list is derived from the Scheduled meals by the existing rebuild on its
  next read; the confirmation writes no Shopping items.
  """

  import Ecto.Query

  alias MealPlannerApi.Data.PlanningRepo
  alias MealPlannerApi.Persistence.Calendar
  alias MealPlannerApi.Persistence.Planning.PlanningConfirmation
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

  @doc """
  Commits the confirmation in one transaction. Refuses with:

    * `:already_confirmed` — a concurrent replay stored it first
    * `:session_not_active` — the Planning session is no longer active
    * `:scheduled_meal_cooked`, `:meal_already_confirmed` — a Proposal meal
      falls on a final meal
    * `:rejected` — the database refused it; nothing was saved
    * `:unresolved` — the connection failed, so the outcome is unknown;
      `status/2` tells once it can be read
  """
  @spec commit(attrs()) :: {:ok, summary()} | {:error, atom()}
  def commit(attrs) do
    {from_date, to_date} = attrs.range

    meals =
      Enum.map(attrs.meals, fn meal ->
        %{date: meal.date, slot: Map.fetch!(@slots, meal.slot), recipe_id: meal.recipe_id}
      end)

    multi =
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

    with {:ok, multi} <-
           Calendar.replace_scheduled_meals_multi(multi, attrs.account_id, attrs.range, meals) do
      multi
      |> Repo.transaction()
      |> case do
        {:ok, %{confirmation: confirmation}} -> {:ok, summary(confirmation)}
        {:error, :mark_committed, :session_lock_lost, _} -> {:error, :session_not_active}
        {:error, :answered_meals_kept, reason, _} -> {:error, reason}
        {:error, :confirmation, reason, _} -> {:error, reason}
        {:error, _step, _reason, _} -> {:error, :rejected}
      end
    end
  rescue
    # The database answered with an error: the transaction was rolled back.
    _error in [Postgrex.Error, Ecto.ConstraintError] -> {:error, :rejected}
    # The connection failed: the outcome is unknown.
    _error in DBConnection.ConnectionError -> {:error, :unresolved}
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
