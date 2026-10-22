defmodule MealPlannerApi.PlanningAgent.ProposalValidator do
  @moduledoc """
  Deterministic validation run by `present_proposal` before any Proposal is
  shown, and again at confirmation (issue #423, ported from
  myfood@d9b965a). Validity is owned by code, never by the model.

  Checks, for the session's Account and Planning Range:

    * coverage — exactly one meal per day and slot of the range (breakfast,
      lunch and dinner only)
    * availability — every recipe exists, is visible to the Account (the
      catalog or its own), is not superseded and suits its slot
    * restrictions — no recipe the Participants' restrictions forbid
      (`MealPlannerApi.PlanningAgent.Restrictions`)

  The budget is not a violation: `MealPlannerApi.PlanningAgent.Proposal`
  compares the estimated cost with the session budget and reports overspend
  as a budget Deviation. Violations are generic and never name a
  Participant.
  """

  import Ecto.Query

  alias MealPlannerApi.Persistence.Catalog.Recipe
  alias MealPlannerApi.PlanningAgent.{RecipeCosts, Restrictions}
  alias MealPlannerApi.Repo

  @type meal :: %{date: Date.t(), slot: String.t(), recipe_id: String.t()}

  @doc """
  Validates `meals`. Returns `{:valid, meals}` with each recipe's `:name` and
  `:estimated_cost_cents` (nil when unknown) attached, or
  `{:invalid, violations}`.
  """
  @spec validate([meal()], map()) :: {:valid, [map()]} | {:invalid, [map()]}
  def validate(meals, ctx) do
    {from_date, to_date} = ctx.range
    expected = for date <- Date.range(from_date, to_date), slot <- ctx.slots, do: {date, slot}

    recipes = load_recipes(meals, ctx.account_id)

    violations =
      coverage_violations(meals, expected) ++
        availability_violations(meals, recipes) ++
        restriction_violations(meals, recipes, ctx.household)

    case violations do
      [] ->
        costs = recipes |> Map.keys() |> RecipeCosts.load()

        {:valid,
         Enum.map(meals, fn meal ->
           Map.merge(meal, %{
             name: Map.fetch!(recipes, meal.recipe_id).name,
             estimated_cost_cents: Map.get(costs, meal.recipe_id)
           })
         end)}

      _ ->
        {:invalid, violations}
    end
  end

  defp coverage_violations(meals, expected) do
    counts = Enum.frequencies_by(meals, &{&1.date, &1.slot})

    missing =
      for {date, slot} <- expected,
          not Map.has_key?(counts, {date, slot}),
          do: violation("missing_meal", date, slot, "No meal is planned for this day and slot.")

    expected_set = MapSet.new(expected)

    unexpected =
      for {{date, slot}, count} <- counts,
          not MapSet.member?(expected_set, {date, slot}) or count > 1,
          do:
            violation(
              "unexpected_meal",
              date,
              slot,
              "This day and slot is outside the Planning Range or planned more than once."
            )

    missing ++ Enum.sort_by(unexpected, &{&1["date"], &1["slot"]})
  end

  defp availability_violations(meals, recipes),
    do: Enum.flat_map(meals, &availability_violation(&1, Map.get(recipes, &1.recipe_id)))

  defp availability_violation(meal, nil),
    do: [violation("recipe_not_available", meal.date, meal.slot, "This recipe is not available.")]

  defp availability_violation(meal, recipe) do
    if meal.slot in recipe.suitable_for_slots,
      do: [],
      else: [
        violation("slot_mismatch", meal.date, meal.slot, "This recipe does not suit the slot.")
      ]
  end

  defp restriction_violations(meals, recipes, household) do
    forbidden = Restrictions.forbidden_ids(household, Map.keys(recipes))

    meals
    |> Enum.filter(&MapSet.member?(forbidden, &1.recipe_id))
    |> Enum.uniq_by(&{&1.date, &1.slot})
    |> Enum.map(fn meal ->
      violation(
        "restriction_conflict",
        meal.date,
        meal.slot,
        "This meal includes an ingredient that conflicts with a household member's restriction."
      )
    end)
  end

  defp load_recipes(meals, account_id) do
    ids = meals |> Enum.map(& &1.recipe_id) |> Enum.flat_map(&cast_uuid/1) |> Enum.uniq()

    from(r in Recipe,
      where: r.id in ^ids,
      where: is_nil(r.superseded_by_id),
      where: is_nil(r.account_id) or r.account_id == ^account_id,
      select: %{id: r.id, name: r.name, suitable_for_slots: r.suitable_for_slots}
    )
    |> Repo.all()
    |> Map.new(&{&1.id, &1})
  end

  defp cast_uuid(value) do
    case Ecto.UUID.cast(value) do
      {:ok, uuid} -> [uuid]
      :error -> []
    end
  end

  defp violation(type, date, slot, message) do
    %{"type" => type, "date" => Date.to_iso8601(date), "slot" => slot, "message" => message}
  end
end
