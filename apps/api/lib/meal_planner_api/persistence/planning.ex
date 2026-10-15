defmodule MealPlannerApi.Persistence.Planning do
  @moduledoc "Persistence helpers for planning runs, proposals and cooking state."

  import Ecto.Query, warn: false

  alias MealPlannerApi.Persistence.Catalog.{FavoriteRecipe, Recipe}
  alias MealPlannerApi.Repo

  alias MealPlannerApi.Persistence.Planning.{
    ContextSnapshot,
    CookingSession,
    CookingStepEvent,
    PlanningGenerationRun,
    PlanningMessage,
    PlanningProposal,
    PlanningSession,
    ScheduledMeal
  }

  def create_generation_run(attrs),
    do: %PlanningGenerationRun{} |> PlanningGenerationRun.changeset(attrs) |> Repo.insert()

  def update_generation_run(run, attrs),
    do: run |> PlanningGenerationRun.changeset(attrs) |> Repo.update()

  def create_proposal(attrs),
    do: %PlanningProposal{} |> PlanningProposal.changeset(attrs) |> Repo.insert()

  def update_proposal(proposal, attrs),
    do: proposal |> PlanningProposal.changeset(attrs) |> Repo.update()

  @doc """
  The `:active` planning session of the account, or `nil`. Read-only.
  """
  @spec get_active_planning_session(Ecto.UUID.t()) :: PlanningSession.t() | nil
  def get_active_planning_session(account_id) do
    from(s in PlanningSession,
      where: s.account_id == ^account_id and s.status == :active,
      order_by: [desc: s.started_at],
      limit: 1
    )
    |> Repo.one()
  end

  @doc """
  The most recent `:pending` proposal generated for the account since the
  given session started, or `nil`. Proposals older than the session belong to
  an earlier flow and are ignored, and so is the empty placeholder of a
  generation that has not completed (issue #146). Read-only.
  """
  @spec latest_pending_proposal(Ecto.UUID.t(), PlanningSession.t()) ::
          PlanningProposal.t() | nil
  def latest_pending_proposal(account_id, %PlanningSession{started_at: started_at}) do
    from(p in PlanningProposal,
      join: r in PlanningGenerationRun,
      on: r.id == p.generation_run_id,
      where:
        r.account_id == ^account_id and r.status == :completed and
          p.status == :pending and p.inserted_at >= ^started_at,
      order_by: [desc: p.inserted_at],
      limit: 1
    )
    |> Repo.one()
  end

  @doc """
  The last `limit` messages of a planning session of the account, oldest
  first. Read-only.
  """
  @spec recent_planning_messages(Ecto.UUID.t(), Ecto.UUID.t(), pos_integer()) :: [
          PlanningMessage.t()
        ]
  def recent_planning_messages(account_id, session_id, limit \\ 20) do
    from(m in PlanningMessage,
      where: m.account_id == ^account_id and m.session_id == ^session_id,
      order_by: [desc: m.inserted_at],
      limit: ^limit
    )
    |> Repo.all()
    |> Enum.reverse()
  end

  def schedule_meal(attrs),
    do: %ScheduledMeal{} |> ScheduledMeal.changeset(attrs) |> Repo.insert()

  def update_scheduled_meal(meal, attrs),
    do: meal |> ScheduledMeal.changeset(attrs) |> Repo.update()

  def list_scheduled_meals(account_id, from_date, to_date) do
    from(m in ScheduledMeal,
      where: m.account_id == ^account_id and m.date >= ^from_date and m.date <= ^to_date,
      order_by: [asc: m.date, asc: m.slot]
    )
    |> Repo.all()
  end

  def list_uncooked_scheduled_meals(account_id, from_date, to_date) do
    from(m in ScheduledMeal,
      where:
        m.account_id == ^account_id and m.is_cooked == false and m.date >= ^from_date and
          m.date <= ^to_date
    )
    |> Repo.all()
  end

  def list_uncooked_scheduled_meals_with_recipe_ingredients(account_id, from_date, to_date) do
    from(m in ScheduledMeal,
      where:
        m.account_id == ^account_id and m.is_cooked == false and m.date >= ^from_date and
          m.date <= ^to_date,
      preload: [
        recipe: [
          recipe_ingredients: [:ingredient]
        ]
      ]
    )
    |> Repo.all()
  end

  def create_cooking_session(attrs),
    do: %CookingSession{} |> CookingSession.changeset(attrs) |> Repo.insert()

  def update_cooking_session(session, attrs),
    do: session |> CookingSession.changeset(attrs) |> Repo.update()

  def add_step_event(attrs),
    do: %CookingStepEvent{} |> CookingStepEvent.changeset(attrs) |> Repo.insert()

  def add_context_snapshot(attrs),
    do: %ContextSnapshot{} |> ContextSnapshot.changeset(attrs) |> Repo.insert()

  def get_scheduled_meal_for_account(account_id, meal_id) do
    from(m in ScheduledMeal,
      where: m.id == ^meal_id and m.account_id == ^account_id,
      preload: [
        recipe: [
          :recipe_steps,
          recipe_ingredients: [:ingredient]
        ]
      ]
    )
    |> Repo.one()
  end

  def get_cooking_session_for_account(account_id, session_id) do
    from(s in CookingSession,
      where: s.id == ^session_id and s.account_id == ^account_id,
      preload: [
        :context_snapshots,
        scheduled_meal: [
          recipe: [
            :recipe_steps,
            recipe_ingredients: [:ingredient]
          ]
        ]
      ]
    )
    |> Repo.one()
  end

  def latest_context_snapshot(session_id) do
    from(cs in ContextSnapshot,
      where: cs.cooking_session_id == ^session_id,
      order_by: [desc: cs.captured_at],
      limit: 1
    )
    |> Repo.one()
  end

  def list_favorite_recipes_for_user(account_id, user_id, limit \\ 10) do
    from(f in FavoriteRecipe,
      where: f.account_id == ^account_id and f.user_id == ^user_id,
      join: r in assoc(f, :recipe),
      order_by: [desc: f.inserted_at],
      limit: ^limit,
      select: %{
        recipe_id: f.recipe_id,
        recipe_name: r.name,
        suitable_for_slots: r.suitable_for_slots,
        prep_time_minutes: r.prep_time_minutes,
        calories_per_serving: r.calories_per_serving
      }
    )
    |> Repo.all()
  end

  def recipes_for_ids(recipe_ids, account_id) when is_list(recipe_ids) do
    from(r in Recipe,
      where: r.id in ^recipe_ids,
      where: is_nil(r.account_id) or r.account_id == ^account_id,
      select: %{id: r.id, name: r.name, suitable_for_slots: r.suitable_for_slots}
    )
    |> Repo.all()
    |> Enum.flat_map(fn recipe ->
      Enum.map(recipe.suitable_for_slots, fn slot ->
        %{id: recipe.id, name: recipe.name, slot: slot, source: "favorite"}
      end)
    end)
  end

  def fetch_owned_proposal(proposal_id, account_id, user_id) do
    query =
      from(p in PlanningProposal,
        join: r in assoc(p, :generation_run),
        where: p.id == ^proposal_id and r.account_id == ^account_id and r.user_id == ^user_id,
        select: {p, r}
      )

    case Repo.one(query) do
      {proposal, run} -> {:ok, proposal, run}
      nil -> {:error, :proposal_not_found}
    end
  end
end
