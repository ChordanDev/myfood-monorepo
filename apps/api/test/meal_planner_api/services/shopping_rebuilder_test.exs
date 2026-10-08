defmodule MealPlannerApi.Services.ShoppingRebuilderTest do
  use ExUnit.Case, async: true

  alias MealPlannerApi.Services.ShoppingRebuilder

  # Helpers ----------------------------------------------------------------

  defp meal(id, date, recipe_ingredients) do
    %{
      id: id,
      recipe_id: "recipe-#{id}",
      date: date,
      recipe: %{recipe_ingredients: recipe_ingredients}
    }
  end

  defp ri(ingredient_id, unit, quantity_milli) do
    %{ingredient_id: ingredient_id, unit: unit, quantity_milli: quantity_milli}
  end

  # -------------------------------------------------------------------------
  # Scenario: Partial inventory yields the exact shortage
  # Spec: AC #3 / story 16 — 200_000 needed, 100_000 available → 100_000
  # -------------------------------------------------------------------------

  describe "compute_net_shortages/2 — partial inventory" do
    test "returns exact shortage when inventory covers part of the need" do
      meals = [meal("m1", ~D[2026-09-25], [ri("flour", :g, 200_000)])]
      pool = %{{"flour", :g} => 100_000}

      result = ShoppingRebuilder.compute_net_shortages(meals, pool)

      assert [%{quantity_milli: 100_000, ingredient_id: "flour", unit: :g}] = result
    end
  end

  # -------------------------------------------------------------------------
  # Scenario: Surplus inventory floors shortage at zero
  # Spec: AC #3 / story 16 — 200_000 needed, 300_000 available → no row
  # -------------------------------------------------------------------------

  describe "compute_net_shortages/2 — surplus inventory" do
    test "returns no row when inventory fully covers the need" do
      meals = [meal("m1", ~D[2026-09-25], [ri("flour", :g, 200_000)])]
      pool = %{{"flour", :g} => 300_000}

      result = ShoppingRebuilder.compute_net_shortages(meals, pool)

      assert result == []
    end
  end

  # -------------------------------------------------------------------------
  # Scenario: Mixed recipe units remain separate
  # Spec: AC #3 / story 16 — milk as :ml and milk as :g → two rows
  # -------------------------------------------------------------------------

  describe "compute_net_shortages/2 — mixed units" do
    test "same ingredient with different units produces separate rows" do
      meals = [
        meal("m1", ~D[2026-09-25], [
          ri("milk", :ml, 500_000),
          ri("milk", :g, 100_000)
        ])
      ]

      pool = %{}

      result = ShoppingRebuilder.compute_net_shortages(meals, pool)

      assert length(result) == 2
      assert Enum.any?(result, &(&1.unit == :ml and &1.quantity_milli == 500_000))
      assert Enum.any?(result, &(&1.unit == :g and &1.quantity_milli == 100_000))
    end
  end

  # -------------------------------------------------------------------------
  # Scenario: Exact differences are not rounded
  # Spec: AC #3 / story 16 — flour 33_000 needed, 10_000 available → 23_000
  # -------------------------------------------------------------------------

  describe "compute_net_shortages/2 — no rounding" do
    test "returns exact integer difference without any rounding" do
      meals = [meal("m1", ~D[2026-09-25], [ri("flour", :g, 33_000)])]
      pool = %{{"flour", :g} => 10_000}

      result = ShoppingRebuilder.compute_net_shortages(meals, pool)

      assert [%{quantity_milli: 23_000}] = result
    end
  end

  # -------------------------------------------------------------------------
  # Scenario: Multi-meal greedy pool depletion
  # Pool 150_000 flour; meal1 needs 100_000, meal2 needs 100_000
  # → meal1 gets 0 shortage (fully covered), meal2 gets 50_000 shortage
  # -------------------------------------------------------------------------

  describe "compute_net_shortages/2 — greedy pool across meals" do
    test "depletes pool greedily across multiple meals" do
      meals = [
        meal("m1", ~D[2026-09-25], [ri("flour", :g, 100_000)]),
        meal("m2", ~D[2026-09-26], [ri("flour", :g, 100_000)])
      ]

      pool = %{{"flour", :g} => 150_000}

      result = ShoppingRebuilder.compute_net_shortages(meals, pool)

      # meal1 is fully covered (0 shortage → no row), meal2 has 50_000 shortage
      assert [%{scheduled_meal_id: "m2", quantity_milli: 50_000}] = result
    end
  end

  # -------------------------------------------------------------------------
  # Scenario: Empty meals returns empty list
  # -------------------------------------------------------------------------

  describe "compute_net_shortages/2 — empty meals" do
    test "returns empty list when no meals provided" do
      assert ShoppingRebuilder.compute_net_shortages([], %{}) == []
    end
  end

  # -------------------------------------------------------------------------
  # Scenario: Nil recipe_id meals are skipped
  # -------------------------------------------------------------------------

  describe "compute_net_shortages/2 — nil recipe" do
    test "skips meals with nil recipe_id" do
      meals = [%{id: "m1", recipe_id: nil, date: ~D[2026-09-25], recipe: nil}]

      result = ShoppingRebuilder.compute_net_shortages(meals, %{})

      assert result == []
    end
  end

  # -------------------------------------------------------------------------
  # Scenario: Per-meal grain preserves scheduled_meal_id and planned_date
  # -------------------------------------------------------------------------

  describe "compute_net_shortages/2 — output shape" do
    test "each row carries scheduled_meal_id and planned_date" do
      meals = [meal("m1", ~D[2026-09-25], [ri("salt", :g, 5_000)])]
      pool = %{}

      [row] = ShoppingRebuilder.compute_net_shortages(meals, pool)

      assert row.scheduled_meal_id == "m1"
      assert row.planned_date == ~D[2026-09-25]
      assert row.ingredient_id == "salt"
      assert row.unit == :g
      assert row.quantity_milli == 5_000
    end
  end

  # -------------------------------------------------------------------------
  # Scenario: The date limit keeps meals on or before the chosen day
  # Spec: issue #39 — `untilDate` limits planned lines, boundary inclusive
  # -------------------------------------------------------------------------

  describe "limit_to_date/2" do
    test "keeps meals on or before the date, boundary day included" do
      meals = [
        meal("m1", ~D[2026-09-30], [ri("flour", :g, 100_000)]),
        meal("m2", ~D[2026-10-02], [ri("flour", :g, 100_000)]),
        meal("m3", ~D[2026-10-03], [ri("flour", :g, 100_000)])
      ]

      result = ShoppingRebuilder.limit_to_date(meals, ~D[2026-10-02])

      assert Enum.map(result, & &1.id) == ["m1", "m2"]
    end

    test "preserves the input order of the meals it keeps" do
      meals = [
        meal("m3", ~D[2026-10-02], []),
        meal("m1", ~D[2026-09-30], []),
        meal("m4", ~D[2026-11-01], []),
        meal("m2", ~D[2026-10-01], [])
      ]

      result = ShoppingRebuilder.limit_to_date(meals, ~D[2026-10-02])

      assert Enum.map(result, & &1.id) == ["m3", "m1", "m2"]
    end

    test "returns the meals unchanged when the date is nil" do
      meals = [
        meal("m1", ~D[2026-09-30], [ri("flour", :g, 100_000)]),
        meal("m2", ~D[2027-01-15], [ri("flour", :g, 100_000)])
      ]

      assert ShoppingRebuilder.limit_to_date(meals, nil) == meals
    end

    test "returns an empty list when every meal is after the date" do
      meals = [meal("m1", ~D[2026-10-03], [])]

      assert ShoppingRebuilder.limit_to_date(meals, ~D[2026-10-02]) == []
    end

    test "limited meals feed compute_net_shortages/2" do
      meals = [
        meal("m1", ~D[2026-10-01], [ri("flour", :g, 100_000)]),
        meal("m2", ~D[2026-10-05], [ri("flour", :g, 100_000)])
      ]

      result =
        meals
        |> ShoppingRebuilder.limit_to_date(~D[2026-10-01])
        |> ShoppingRebuilder.compute_net_shortages(%{})

      assert [%{scheduled_meal_id: "m1", quantity_milli: 100_000}] = result
    end
  end

  # Helper: one persisted Shopping item for one Scheduled meal -------------

  defp row(item_id, ingredient_id, overrides \\ %{}) do
    Map.merge(
      %{
        item_id: item_id,
        ingredient_id: ingredient_id,
        name: String.capitalize(ingredient_id),
        category: "pantry",
        unit: :g,
        quantity_milli: 100_000,
        status: :needed,
        source: :planned_meal,
        supermarket_id: nil,
        scheduled_meal_id: "meal-#{item_id}",
        date: ~D[2026-10-01],
        slot: :lunch
      },
      overrides
    )
  end

  # -------------------------------------------------------------------------
  # Scenario: Grouping by ingredient aggregates the meals that need it
  # Spec: issue #39 — `groupBy=ingredient`, decisions D4 and D5
  # -------------------------------------------------------------------------

  describe "group_lines/2 — :ingredient" do
    test "three meals of the same ingredient become one line with three allocations" do
      rows = [
        row("i1", "flour", %{date: ~D[2026-10-01], quantity_milli: 100_000}),
        row("i2", "flour", %{date: ~D[2026-10-02], quantity_milli: 250_000}),
        row("i3", "flour", %{date: ~D[2026-10-03], quantity_milli: 50_000})
      ]

      assert [line] = ShoppingRebuilder.group_lines(rows, :ingredient)

      assert line == %{
               id: "flour:g",
               ingredient_id: "flour",
               name: "Flour",
               category: "pantry",
               quantity_milli: 400_000,
               unit: :g,
               status: :needed,
               source: :planned_meal,
               supermarket_id: nil,
               allocations: [
                 %{
                   item_id: "i1",
                   scheduled_meal_id: "meal-i1",
                   date: ~D[2026-10-01],
                   slot: :lunch,
                   quantity_milli: 100_000
                 },
                 %{
                   item_id: "i2",
                   scheduled_meal_id: "meal-i2",
                   date: ~D[2026-10-02],
                   slot: :lunch,
                   quantity_milli: 250_000
                 },
                 %{
                   item_id: "i3",
                   scheduled_meal_id: "meal-i3",
                   date: ~D[2026-10-03],
                   slot: :lunch,
                   quantity_milli: 50_000
                 }
               ]
             }
    end

    test "the same ingredient with different units stays on separate lines" do
      rows = [
        row("i1", "milk", %{unit: :ml, quantity_milli: 500_000}),
        row("i2", "milk", %{unit: :g, quantity_milli: 100_000}),
        row("i3", "milk", %{unit: :ml, quantity_milli: 250_000})
      ]

      assert [ml, g] = ShoppingRebuilder.group_lines(rows, :ingredient)

      assert %{id: "milk:ml", unit: :ml, quantity_milli: 750_000} = ml
      assert %{id: "milk:g", unit: :g, quantity_milli: 100_000} = g
      assert Enum.map(ml.allocations, & &1.item_id) == ["i1", "i3"]
      assert Enum.map(g.allocations, & &1.item_id) == ["i2"]
    end

    test "lines follow the first appearance of each ingredient in the input" do
      rows = [
        row("i1", "salt"),
        row("i2", "flour"),
        row("i3", "salt"),
        row("i4", "butter")
      ]

      lines = ShoppingRebuilder.group_lines(rows, :ingredient)

      assert Enum.map(lines, & &1.id) == ["salt:g", "flour:g", "butter:g"]
    end

    test "allocations are sorted by date, across a month boundary" do
      rows = [
        row("i1", "flour", %{date: ~D[2026-10-02]}),
        row("i2", "flour", %{date: ~D[2026-09-30]}),
        row("i3", "flour", %{date: ~D[2026-10-01]})
      ]

      assert [line] = ShoppingRebuilder.group_lines(rows, :ingredient)

      assert Enum.map(line.allocations, & &1.date) ==
               [~D[2026-09-30], ~D[2026-10-01], ~D[2026-10-02]]
    end

    test "allocations on the same date follow the order of the day's slots" do
      rows = [
        row("i1", "flour", %{slot: :dinner}),
        row("i2", "flour", %{slot: :snack}),
        row("i3", "flour", %{slot: :breakfast}),
        row("i4", "flour", %{slot: :lunch})
      ]

      assert [line] = ShoppingRebuilder.group_lines(rows, :ingredient)

      assert Enum.map(line.allocations, & &1.slot) == [:breakfast, :lunch, :snack, :dinner]
    end

    test "mixed statuses read as needed" do
      rows = [
        row("i1", "flour", %{status: :in_cart}),
        row("i2", "flour", %{status: :needed}),
        row("i3", "flour", %{status: :in_cart})
      ]

      assert [%{status: :needed}] = ShoppingRebuilder.group_lines(rows, :ingredient)
    end

    test "a removed row does not add to the quantity of a line that is still needed" do
      rows = [
        row("i1", "flour", %{status: :needed, quantity_milli: 100_000}),
        row("i2", "flour", %{status: :removed, quantity_milli: 250_000})
      ]

      assert [line] = ShoppingRebuilder.group_lines(rows, :ingredient)

      assert %{status: :needed, quantity_milli: 100_000} = line
      assert Enum.map(line.allocations, & &1.item_id) == ["i1", "i2"]
      assert Enum.map(line.allocations, & &1.quantity_milli) == [100_000, 250_000]
    end

    test "a removed row is left out of the status the other rows share" do
      rows = [
        row("i1", "flour", %{status: :in_cart, quantity_milli: 100_000}),
        row("i2", "flour", %{status: :removed, quantity_milli: 250_000}),
        row("i3", "flour", %{status: :in_cart, quantity_milli: 50_000})
      ]

      assert [%{status: :in_cart, quantity_milli: 150_000}] =
               ShoppingRebuilder.group_lines(rows, :ingredient)
    end

    test "needed and in cart next to a removed row still read as needed" do
      rows = [
        row("i1", "flour", %{status: :in_cart, quantity_milli: 100_000}),
        row("i2", "flour", %{status: :removed, quantity_milli: 250_000}),
        row("i3", "flour", %{status: :needed, quantity_milli: 50_000})
      ]

      assert [%{status: :needed, quantity_milli: 150_000}] =
               ShoppingRebuilder.group_lines(rows, :ingredient)
    end

    test "every row in the cart reads as in cart" do
      rows = [
        row("i1", "flour", %{status: :in_cart}),
        row("i2", "flour", %{status: :in_cart})
      ]

      assert [%{status: :in_cart}] = ShoppingRebuilder.group_lines(rows, :ingredient)
    end

    test "every row removed reads as removed, with the summed quantity" do
      rows = [
        row("i1", "flour", %{status: :removed, quantity_milli: 100_000}),
        row("i2", "flour", %{status: :removed, quantity_milli: 250_000})
      ]

      assert [%{status: :removed, quantity_milli: 350_000}] =
               ShoppingRebuilder.group_lines(rows, :ingredient)
    end

    test "a slot outside the schema enum sorts last within its date" do
      rows = [
        row("i1", "flour", %{date: ~D[2026-10-01], slot: :brunch}),
        row("i2", "flour", %{date: ~D[2026-10-01], slot: :dinner}),
        row("i3", "flour", %{date: ~D[2026-10-02], slot: :breakfast}),
        row("i4", "flour", %{date: ~D[2026-10-01], slot: :breakfast})
      ]

      assert [line] = ShoppingRebuilder.group_lines(rows, :ingredient)

      assert Enum.map(line.allocations, &{&1.date, &1.slot}) == [
               {~D[2026-10-01], :breakfast},
               {~D[2026-10-01], :dinner},
               {~D[2026-10-01], :brunch},
               {~D[2026-10-02], :breakfast}
             ]
    end

    test "a shared supermarket is kept" do
      rows = [
        row("i1", "flour", %{supermarket_id: "s1"}),
        row("i2", "flour", %{supermarket_id: "s1"})
      ]

      assert [%{supermarket_id: "s1"}] = ShoppingRebuilder.group_lines(rows, :ingredient)
    end

    test "differing supermarkets read as nil" do
      rows = [
        row("i1", "flour", %{supermarket_id: "s1"}),
        row("i2", "flour", %{supermarket_id: "s2"})
      ]

      assert [%{supermarket_id: nil}] = ShoppingRebuilder.group_lines(rows, :ingredient)
    end

    test "a supermarket set on only some rows reads as nil" do
      rows = [
        row("i1", "flour", %{supermarket_id: "s1"}),
        row("i2", "flour", %{supermarket_id: nil})
      ]

      assert [%{supermarket_id: nil}] = ShoppingRebuilder.group_lines(rows, :ingredient)
    end

    test "name, category and source come from the first row" do
      rows = [
        row("i1", "flour", %{name: "Flour 000", category: "bakery", source: :planned_meal}),
        row("i2", "flour", %{name: "Plain flour", category: "pantry", source: :manual})
      ]

      assert [%{name: "Flour 000", category: "bakery", source: :planned_meal}] =
               ShoppingRebuilder.group_lines(rows, :ingredient)
    end

    test "returns an empty list for no rows" do
      assert ShoppingRebuilder.group_lines([], :ingredient) == []
    end
  end

  # -------------------------------------------------------------------------
  # Scenario: Grouping by meal keeps one line per Shopping item
  # Spec: issue #39 — `groupBy=meal`, decision D4
  # -------------------------------------------------------------------------

  describe "group_lines/2 — :meal" do
    test "produces one line per row, in input order, with a single allocation" do
      rows = [
        row("i2", "flour", %{date: ~D[2026-10-02], quantity_milli: 250_000, status: :in_cart}),
        row("i1", "flour", %{date: ~D[2026-10-01], quantity_milli: 100_000}),
        row("i3", "salt", %{date: ~D[2026-10-01], quantity_milli: 5_000, supermarket_id: "s1"})
      ]

      lines = ShoppingRebuilder.group_lines(rows, :meal)

      assert Enum.map(lines, & &1.id) == ["i2", "i1", "i3"]
      assert Enum.map(lines, & &1.quantity_milli) == [250_000, 100_000, 5_000]
      assert Enum.map(lines, & &1.status) == [:in_cart, :needed, :needed]
      assert Enum.map(lines, & &1.supermarket_id) == [nil, nil, "s1"]

      assert Enum.map(lines, & &1.allocations) == [
               [
                 %{
                   item_id: "i2",
                   scheduled_meal_id: "meal-i2",
                   date: ~D[2026-10-02],
                   slot: :lunch,
                   quantity_milli: 250_000
                 }
               ],
               [
                 %{
                   item_id: "i1",
                   scheduled_meal_id: "meal-i1",
                   date: ~D[2026-10-01],
                   slot: :lunch,
                   quantity_milli: 100_000
                 }
               ],
               [
                 %{
                   item_id: "i3",
                   scheduled_meal_id: "meal-i3",
                   date: ~D[2026-10-01],
                   slot: :lunch,
                   quantity_milli: 5_000
                 }
               ]
             ]
    end

    test "a line carries the same keys as an ingredient line" do
      [meal_line] = ShoppingRebuilder.group_lines([row("i1", "flour")], :meal)
      [ingredient_line] = ShoppingRebuilder.group_lines([row("i1", "flour")], :ingredient)

      assert Map.keys(meal_line) == Map.keys(ingredient_line)
      assert %{ingredient_id: "flour", name: "Flour", category: "pantry", unit: :g} = meal_line
      assert meal_line.source == :planned_meal
    end

    test "the line id is the item id as a string" do
      item_id = Ecto.UUID.generate()

      assert [%{id: ^item_id}] = ShoppingRebuilder.group_lines([row(item_id, "flour")], :meal)
      assert [%{id: "42"}] = ShoppingRebuilder.group_lines([row(42, "flour")], :meal)
    end

    test "returns an empty list for no rows" do
      assert ShoppingRebuilder.group_lines([], :meal) == []
    end
  end

  # -------------------------------------------------------------------------
  # Scenario: Slots are ranked in the order of the day
  # Spec: issue #39 — the read orders its rows with the same rank the
  # allocations of a line use
  # -------------------------------------------------------------------------

  describe "slot_rank/1" do
    test "ranks the slots of the schema in the order of the day" do
      slots = [:dinner, :snack, :breakfast, :lunch]

      assert Enum.sort_by(slots, &ShoppingRebuilder.slot_rank/1) ==
               [:breakfast, :lunch, :snack, :dinner]
    end

    test "ranks a slot outside the schema enum, nil included, after the known ones" do
      dinner = ShoppingRebuilder.slot_rank(:dinner)

      assert ShoppingRebuilder.slot_rank(:brunch) > dinner
      assert ShoppingRebuilder.slot_rank(nil) > dinner
    end
  end
end
