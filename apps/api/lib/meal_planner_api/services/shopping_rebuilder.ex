defmodule MealPlannerApi.Services.ShoppingRebuilder do
  @moduledoc """
  Pure stateless functions for computing net shopping shortages
  from confirmed scheduled meals and available inventory.

  No side effects. All DB writes are done by the caller
  (Generation.Server). This separation makes the math testable
  without database fixtures.

  ## Usage

      meals = [%{id: "m1", recipe_id: "r1", date: ~D[2026-09-25],
                 recipe: %{recipe_ingredients: [%{ingredient_id: "flour", unit: :g, quantity_milli: 200_000}]}}]
      pool = %{{"flour", :g} => 100_000}
      ShoppingRebuilder.compute_net_shortages(meals, pool)
      # => [%{scheduled_meal_id: "m1", planned_date: ~D[2026-09-25],
      #       ingredient_id: "flour", unit: :g, quantity_milli: 100_000}]

  ## Reading the list

  `limit_to_date/2` and `group_lines/2` shape the list for a read
  (issue #39): the first keeps the meals up to a chosen day, the second
  turns persisted Shopping items into the lines of the list, one per
  ingredient or one per meal. Both are pure as well.
  """

  alias MealPlannerApi.Persistence.Planning.ScheduledMeal

  # Slots in the order of the day, as the Scheduled meal schema declares
  # them. A slot outside this list sorts after the known ones. Read through
  # `slot_rank/1`.
  @slot_rank ScheduledMeal |> Ecto.Enum.values(:slot) |> Enum.with_index() |> Map.new()
  @unknown_slot_rank map_size(@slot_rank)

  @doc """
  Computes net shopping shortages for a list of confirmed meals.

  For each meal's recipe ingredients, subtracts greedily from the
  available inventory pool. Returns per-meal rows only where
  shortage > 0. The pool is mutable across meals (greedy depletion):
  once an ingredient is consumed by an earlier meal, later meals
  see the reduced pool.

  ## Parameters

    * `meals` — list of scheduled meals with preloaded recipe and
      recipe_ingredients. Each meal has `%{id, recipe_id, date, recipe}`.
      Meals with `recipe_id == nil` are skipped.
    * `pool` — `%{{ingredient_id, unit} => available_quantity_milli}`,
      typically built from `Inventory.available_for/2`.

  ## Returns

  A flat list of `%{scheduled_meal_id, planned_date, ingredient_id,
  unit, quantity_milli}` maps, one per ingredient-unit with a positive
  shortage. No rounding, no Float, no package math.
  """
  @spec compute_net_shortages([map()], %{{term(), atom()} => non_neg_integer()}) :: [map()]
  def compute_net_shortages(meals, pool) when is_list(meals) and is_map(pool) do
    {rows, _remaining_pool} =
      Enum.reduce(meals, {[], pool}, fn meal, {acc, current_pool} ->
        case meal.recipe_id do
          nil ->
            {acc, current_pool}

          _recipe_id ->
            ingredients = get_recipe_ingredients(meal)
            process_meal_ingredients(meal, ingredients, acc, current_pool)
        end
      end)

    Enum.reverse(rows)
  end

  @doc """
  Keeps the meals scheduled on or before `until_date`.

  The boundary day is included and the order of the meals is preserved.
  `nil` means no limit and returns the meals unchanged.

  ## Parameters

    * `meals` — the same meals `compute_net_shortages/2` accepts; only
      `date` is read.
    * `until_date` — the last day to keep, or `nil`.
  """
  @spec limit_to_date([map()], Date.t() | nil) :: [map()]
  def limit_to_date(meals, nil) when is_list(meals), do: meals

  def limit_to_date(meals, %Date{} = until_date) when is_list(meals) do
    Enum.filter(meals, &(Date.compare(&1.date, until_date) != :gt))
  end

  @doc """
  Groups persisted Shopping items into the lines of the Shopping list.

  ## Parameters

    * `rows` — one map per Shopping item of one Scheduled meal:
      `%{item_id, ingredient_id, name, category, unit, quantity_milli,
      status, source, supermarket_id, scheduled_meal_id, date, slot}`.
      `status` is `:needed | :in_cart | :removed` and `source` is
      `:planned_meal | :manual`.
    * `group_by` — `:ingredient` or `:meal`.

  Every row is expected to have an Ingredient and a Scheduled meal. Rows
  without an Ingredient (manual items, a later slice) are not a supported
  input yet: with `:ingredient` they would all share the `nil` key and
  collapse into one line.

  ## Returns

  A list of `%{id, ingredient_id, name, category, quantity_milli, unit,
  status, source, supermarket_id, allocations}` maps. Each allocation is
  `%{item_id, scheduled_meal_id, date, slot, quantity_milli}`: the
  Shopping item behind the line and the Scheduled meal it is for.

  With `:meal` every row is its own line, in input order. `id` is the
  row's `item_id` as a string and the line has exactly one allocation.

  With `:ingredient` the rows sharing `{ingredient_id, unit}` become one
  line, and lines follow the first appearance of each pair in the input:

    * `id` is `"<ingredient_id>:<unit>"`.
    * `quantity_milli` is the sum of the rows that are not `:removed`. No
      rounding, no unit conversion: the same ingredient in two units stays
      on two lines.
    * `allocations` list every row, removed ones included, sorted by date,
      then by slot in the order of the day (see `slot_rank/1`).
    * `status` is the status the rows that are not `:removed` share,
      otherwise `:needed`, so a line never reads as in the Cart while part
      of it is not.
    * A line whose rows are all `:removed` is the exception: it reads
      `:removed` and its `quantity_milli` is the sum of every row.
    * `supermarket_id` is the value every row shares, otherwise `nil`.
    * `name`, `category` and `source` come from the first row.
  """
  @spec group_lines([map()], :ingredient | :meal) :: [map()]
  def group_lines(rows, :meal) when is_list(rows) do
    Enum.map(rows, fn row ->
      row
      |> Map.take([
        :ingredient_id,
        :name,
        :category,
        :quantity_milli,
        :unit,
        :status,
        :source,
        :supermarket_id
      ])
      |> Map.merge(%{id: to_string(row.item_id), allocations: [allocation(row)]})
    end)
  end

  def group_lines(rows, :ingredient) when is_list(rows) do
    groups = Enum.group_by(rows, &ingredient_key/1)

    rows
    |> Enum.map(&ingredient_key/1)
    |> Enum.uniq()
    |> Enum.map(&ingredient_line(Map.fetch!(groups, &1)))
  end

  @doc """
  Position of a Scheduled meal slot in the order of the day: breakfast,
  lunch, snack, dinner, as the Scheduled meal schema declares them.

  A slot outside the schema enum, `nil` included, ranks after every known
  slot. Sort rows by `{date, slot_rank(slot)}` to list them the way the
  allocations of a line are listed.
  """
  @spec slot_rank(atom()) :: non_neg_integer()
  def slot_rank(slot), do: Map.get(@slot_rank, slot, @unknown_slot_rank)

  defp ingredient_key(row), do: {row.ingredient_id, row.unit}

  defp ingredient_line([first | _] = rows) do
    # The rows that decide the quantity and the status: the ones still on
    # the list, or all of them when every row was removed.
    counted =
      case Enum.reject(rows, &(&1.status == :removed)) do
        [] -> rows
        live -> live
      end

    %{
      id: "#{first.ingredient_id}:#{first.unit}",
      ingredient_id: first.ingredient_id,
      name: first.name,
      category: first.category,
      quantity_milli: counted |> Enum.map(& &1.quantity_milli) |> Enum.sum(),
      unit: first.unit,
      status: shared_value(counted, :status, :needed),
      source: first.source,
      supermarket_id: shared_value(rows, :supermarket_id, nil),
      allocations:
        rows
        |> Enum.sort_by(&{Date.to_erl(&1.date), slot_rank(&1.slot)})
        |> Enum.map(&allocation/1)
    }
  end

  defp allocation(row) do
    Map.take(row, [:item_id, :scheduled_meal_id, :date, :slot, :quantity_milli])
  end

  # The value every row has for `field`, or `fallback` when they differ.
  defp shared_value(rows, field, fallback) do
    case rows |> Enum.map(&Map.fetch!(&1, field)) |> Enum.uniq() do
      [value] -> value
      _ -> fallback
    end
  end

  defp get_recipe_ingredients(meal) do
    case MealPlannerApi.Services.RecipeVersions.recipe_for_meal(meal) do
      %{recipe_ingredients: ingredients} when is_list(ingredients) -> ingredients
      _ -> []
    end
  end

  defp process_meal_ingredients(meal, ingredients, acc, pool) do
    Enum.reduce(ingredients, {acc, pool}, fn ri, {rows, current_pool} ->
      key = {ri.ingredient_id, ri.unit}
      available = Map.get(current_pool, key, 0)
      needed = ri.quantity_milli

      cond do
        available >= needed ->
          # Fully covered — deduct from pool, no shortage row
          {rows, Map.put(current_pool, key, available - needed)}

        available > 0 ->
          # Partially covered — deduct what's available, emit shortage
          shortage = needed - available

          row = %{
            scheduled_meal_id: meal.id,
            planned_date: meal.date,
            ingredient_id: ri.ingredient_id,
            unit: ri.unit,
            quantity_milli: shortage
          }

          {[row | rows], Map.put(current_pool, key, 0)}

        true ->
          # Nothing available — full shortage
          row = %{
            scheduled_meal_id: meal.id,
            planned_date: meal.date,
            ingredient_id: ri.ingredient_id,
            unit: ri.unit,
            quantity_milli: needed
          }

          {[row | rows], current_pool}
      end
    end)
  end
end
