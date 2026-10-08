defmodule MealPlannerApiWeb.CasingTest do
  @moduledoc """
  Unit coverage for `MealPlannerApiWeb.Casing`, the key transform between the
  snake_case the API uses internally and the camelCase of the mobile contract
  (issue #11).
  """
  use ExUnit.Case, async: true

  alias MealPlannerApiWeb.Casing

  # Keys that are not identifiers in either casing: no rewrite applies to them
  # in any direction.
  @non_identifier_keys [
    "2026-10-08",
    "2026-10-08T12:30:00Z",
    "7c874975-2ebe-4362-ae6d-5bd0f51519c2",
    "42",
    "no-perecederos",
    "shopping list",
    "",
    "_private",
    "trailing_",
    "double__underscore",
    "PascalCase",
    "Mixed_Case",
    "SCREAMING_SNAKE",
    "item_2_id",
    "calories_per_100",
    "user_id\n"
  ]

  describe "camelize_keys/1" do
    test "rewrites snake_case keys and returns string keys" do
      assert Casing.camelize_keys(%{"recipe_id" => 1, "prep_time_minutes" => 20}) ==
               %{"recipeId" => 1, "prepTimeMinutes" => 20}
    end

    test "accepts atom and string keys in the same map" do
      assert Casing.camelize_keys(%{:recipe_id => 1, "is_cooked" => false, :slot => "lunch"}) ==
               %{"recipeId" => 1, "isCooked" => false, "slot" => "lunch"}
    end

    test "recurses through nested maps and nested lists" do
      input = %{
        date_from: "2026-10-05",
        days: [
          %{day_state: "planned", meals: [%{meal_id: 1, macros: %{calories_per_serving: 450}}]},
          %{day_state: "empty", meals: []}
        ],
        matrix: [[%{row_count: 1}], [%{row_count: 2}]]
      }

      assert Casing.camelize_keys(input) == %{
               "dateFrom" => "2026-10-05",
               "days" => [
                 %{
                   "dayState" => "planned",
                   "meals" => [%{"mealId" => 1, "macros" => %{"caloriesPerServing" => 450}}]
                 },
                 %{"dayState" => "empty", "meals" => []}
               ],
               "matrix" => [[%{"rowCount" => 1}], [%{"rowCount" => 2}]]
             }
    end

    test "rewrites a top-level list" do
      assert Casing.camelize_keys([%{recipe_id: 1}, %{recipe_id: 2}]) ==
               [%{"recipeId" => 1}, %{"recipeId" => 2}]
    end

    test "returns structs untouched" do
      datetime = ~U[2026-10-08 12:30:00Z]
      date = ~D[2026-10-08]
      decimal = Decimal.new("12.50")
      uri = %URI{scheme: "https", host: "example.com"}

      assert Casing.camelize_keys(%{
               acquired_at: datetime,
               planned_date: date,
               unit_price: decimal,
               source_uri: uri
             }) == %{
               "acquiredAt" => datetime,
               "plannedDate" => date,
               "unitPrice" => decimal,
               "sourceUri" => uri
             }

      assert Casing.camelize_keys(datetime) == datetime
    end

    test "never changes values" do
      input = %{
        step_status: :not_started,
        source_kind: "user_created",
        change_type: nil,
        is_favorite: true,
        retry_count: 3,
        unit_ratio: 1.5,
        slot_names: [:breakfast, "late_snack"],
        date_range: {:from_date, :to_date}
      }

      assert Casing.camelize_keys(input) == %{
               "stepStatus" => :not_started,
               "sourceKind" => "user_created",
               "changeType" => nil,
               "isFavorite" => true,
               "retryCount" => 3,
               "unitRatio" => 1.5,
               "slotNames" => [:breakfast, "late_snack"],
               "dateRange" => {:from_date, :to_date}
             }
    end

    test "returns non-container terms as they are" do
      assert Casing.camelize_keys("recipe_id") == "recipe_id"
      assert Casing.camelize_keys(:recipe_id) == :recipe_id
      assert Casing.camelize_keys(nil) == nil
      assert Casing.camelize_keys(42) == 42
    end

    test "leaves keys that are not snake_case identifiers as they are" do
      input = Map.new(@non_identifier_keys, &{&1, %{recipe_id: 1}})

      assert Casing.camelize_keys(input) ==
               Map.new(@non_identifier_keys, &{&1, %{"recipeId" => 1}})
    end

    test "leaves keys that are neither binaries nor atoms as they are" do
      assert Casing.camelize_keys(%{1 => %{recipe_id: 1}, {:a, :b} => "tuple", 2.5 => "float"}) ==
               %{1 => %{"recipeId" => 1}, {:a, :b} => "tuple", 2.5 => "float"}
    end

    test "turns an atom key into its string form even when it is not rewritten" do
      assert Casing.camelize_keys(%{:"2026-10-08" => 1, :"no-perecederos" => 2, :slot => 3}) ==
               %{"2026-10-08" => 1, "no-perecederos" => 2, "slot" => 3}
    end

    test "treats digits inside a word as part of that word" do
      assert Casing.camelize_keys(%{sha256_hash: 1, address_line1: 2, oauth2_token: 3}) ==
               %{"sha256Hash" => 1, "addressLine1" => 2, "oauth2Token" => 3}
    end

    test "starts a new word at every single-letter segment" do
      assert Casing.camelize_keys(%{protein_g_per_meal: 30, x_y_z: 1}) ==
               %{"proteinGPerMeal" => 30, "xYZ" => 1}
    end

    test "is idempotent" do
      once =
        Casing.camelize_keys(%{
          recipe_id: 1,
          protein_g_per_meal: 30,
          by_category: %{"no_perecederos" => []},
          items: [%{"ingredient_name" => "Rice", "2026-10-08" => 1}]
        })

      assert Casing.camelize_keys(once) == once
    end
  end

  describe "snake_keys/1" do
    test "rewrites camelCase keys and returns string keys" do
      assert Casing.snake_keys(%{"recipeId" => 1, "prepTimeMinutes" => 20}) ==
               %{"recipe_id" => 1, "prep_time_minutes" => 20}
    end

    test "accepts atom and string keys in the same map" do
      assert Casing.snake_keys(%{:recipeId => 1, "isCooked" => false, :slot => "lunch"}) ==
               %{"recipe_id" => 1, "is_cooked" => false, "slot" => "lunch"}
    end

    test "recurses through nested maps and nested lists" do
      input = %{
        "sessionId" => "abc",
        "constraints" => %{
          "budgetCents" => 45_000,
          "excludedIngredients" => [%{"ingredientId" => 7}]
        },
        "lineGroups" => [[%{"quantityMilli" => 500}], [%{"quantityMilli" => 250}]]
      }

      assert Casing.snake_keys(input) == %{
               "session_id" => "abc",
               "constraints" => %{
                 "budget_cents" => 45_000,
                 "excluded_ingredients" => [%{"ingredient_id" => 7}]
               },
               "line_groups" => [[%{"quantity_milli" => 500}], [%{"quantity_milli" => 250}]]
             }
    end

    test "returns structs untouched" do
      datetime = ~U[2026-10-08 12:30:00Z]
      decimal = Decimal.new("12.50")
      upload = %Plug.Upload{path: "/tmp/voice.m4a", filename: "voice.m4a"}

      assert Casing.snake_keys(%{
               "acquiredAt" => datetime,
               "unitPrice" => decimal,
               "voiceNote" => upload
             }) ==
               %{"acquired_at" => datetime, "unit_price" => decimal, "voice_note" => upload}
    end

    test "never changes values" do
      assert Casing.snake_keys(%{
               "stepStatus" => :notStarted,
               "contentType" => "speechTranscript"
             }) ==
               %{"step_status" => :notStarted, "content_type" => "speechTranscript"}
    end

    test "leaves keys that are not camelCase identifiers as they are" do
      input = Map.new(@non_identifier_keys, &{&1, %{"recipeId" => 1}})

      assert Casing.snake_keys(input) ==
               Map.new(@non_identifier_keys, &{&1, %{"recipe_id" => 1}})
    end

    test "leaves keys that are neither binaries nor atoms as they are" do
      assert Casing.snake_keys(%{1 => %{"recipeId" => 1}, {:a, :b} => "tuple"}) ==
               %{1 => %{"recipe_id" => 1}, {:a, :b} => "tuple"}
    end

    test "turns an atom key into its string form even when it is not rewritten" do
      assert Casing.snake_keys(%{:recipe_id => 1, :"2026-10-08" => 2}) ==
               %{"recipe_id" => 1, "2026-10-08" => 2}
    end

    test "starts a new word at every uppercase letter, so acronyms are spelled out" do
      assert Casing.snake_keys(%{"deviceID" => 1, "htmlURL" => 2, "proteinGPerMeal" => 3}) ==
               %{"device_i_d" => 1, "html_u_r_l" => 2, "protein_g_per_meal" => 3}
    end

    test "treats digits as part of the word they follow" do
      assert Casing.snake_keys(%{"sha256Hash" => 1, "addressLine1" => 2, "item2Id" => 3}) ==
               %{"sha256_hash" => 1, "address_line1" => 2, "item2_id" => 3}
    end

    test "is idempotent" do
      once =
        Casing.snake_keys(%{
          "recipeId" => 1,
          "proteinGPerMeal" => 30,
          "timers" => %{"eggTimer" => %{"remainingSeconds" => 90}},
          "items" => [%{"ingredientName" => "Rice", "2026-10-08" => 1}]
        })

      assert Casing.snake_keys(once) == once
    end
  end

  describe "opaque keys" do
    test "camelize_keys/1 keeps the direct keys of the opaque map and rewrites below them" do
      input = %{
        by_category: %{
          "no_perecederos" => [
            %{ingredient_id: 7, ingredient_name: "Rice", freshness_status: "ok"}
          ],
          "lacteos" => []
        }
      }

      assert Casing.camelize_keys(input) == %{
               "byCategory" => %{
                 "no_perecederos" => [
                   %{"ingredientId" => 7, "ingredientName" => "Rice", "freshnessStatus" => "ok"}
                 ],
                 "lacteos" => []
               }
             }
    end

    test "snake_keys/1 keeps the direct keys of the opaque map and rewrites below them" do
      input = %{
        "byCategory" => %{
          "no_perecederos" => [%{"ingredientId" => 7, "ingredientName" => "Rice"}],
          "sinGluten" => []
        }
      }

      assert Casing.snake_keys(input) == %{
               "by_category" => %{
                 "no_perecederos" => [%{"ingredient_id" => 7, "ingredient_name" => "Rice"}],
                 "sinGluten" => []
               }
             }
    end

    test "keeps timer ids and rewrites the fields of each timer, losslessly" do
      camel = %{
        "timers" => %{
          "eggTimer" => %{"remainingSeconds" => 90, "startedAt" => "2026-10-08T12:30:00Z"},
          "pasta_timer" => %{"remainingSeconds" => 480, "stepIds" => [%{"recipeStepId" => 3}]},
          "7c874975-2ebe-4362-ae6d-5bd0f51519c2" => %{"remainingSeconds" => 0}
        }
      }

      snake = %{
        "timers" => %{
          "eggTimer" => %{"remaining_seconds" => 90, "started_at" => "2026-10-08T12:30:00Z"},
          "pasta_timer" => %{"remaining_seconds" => 480, "step_ids" => [%{"recipe_step_id" => 3}]},
          "7c874975-2ebe-4362-ae6d-5bd0f51519c2" => %{"remaining_seconds" => 0}
        }
      }

      assert Casing.snake_keys(camel) == snake
      assert Casing.camelize_keys(snake) == camel
    end

    test "applies to an opaque key nested inside a value of another opaque map" do
      input = %{
        by_category: %{
          "no_perecederos" => [
            %{ingredient_id: 7, timers: %{"egg_timer" => %{remaining_seconds: 90}}}
          ]
        }
      }

      assert Casing.camelize_keys(input) == %{
               "byCategory" => %{
                 "no_perecederos" => [
                   %{
                     "ingredientId" => 7,
                     "timers" => %{"egg_timer" => %{"remainingSeconds" => 90}}
                   }
                 ]
               }
             }
    end

    test "turns the atom keys of the opaque map into their string form" do
      assert Casing.camelize_keys(%{by_category: %{no_perecederos: [%{ingredient_id: 7}]}}) ==
               %{"byCategory" => %{"no_perecederos" => [%{"ingredientId" => 7}]}}
    end

    test "traverses a value that is not a plain map as usual" do
      datetime = ~U[2026-10-08 12:30:00Z]

      assert Casing.camelize_keys(%{timers: [%{remaining_seconds: 90}]}) ==
               %{"timers" => [%{"remainingSeconds" => 90}]}

      assert Casing.camelize_keys(%{timers: datetime}) == %{"timers" => datetime}
      assert Casing.camelize_keys(%{timers: nil}) == %{"timers" => nil}
    end

    test "matches an opaque key in either casing, as an atom or as a string" do
      value = %{"no_perecederos" => [], "sinGluten" => []}

      assert Casing.camelize_keys(%{"byCategory" => value}) == %{"byCategory" => value}
      assert Casing.camelize_keys(%{byCategory: value}) == %{"byCategory" => value}
      assert Casing.snake_keys(%{"by_category" => value}) == %{"by_category" => value}
      assert Casing.snake_keys(%{by_category: value}) == %{"by_category" => value}
    end

    test "keeps rewriting the siblings of an opaque key" do
      assert Casing.camelize_keys(%{
               by_category: %{"no_perecederos" => []},
               totals: %{items_count: 0}
             }) == %{
               "byCategory" => %{"no_perecederos" => []},
               "totals" => %{"itemsCount" => 0}
             }
    end

    test "applies to an opaque key found inside a list" do
      assert Casing.camelize_keys(%{sessions: [%{timers: %{"egg_timer" => %{step_id: 3}}}]}) ==
               %{"sessions" => [%{"timers" => %{"egg_timer" => %{"stepId" => 3}}}]}
    end
  end

  describe "round trip" do
    test "snake_keys/1 restores what camelize_keys/1 rewrote" do
      original = %{
        "session_id" => "abc",
        "recipe_step_id" => "7c874975-2ebe-4362-ae6d-5bd0f51519c2",
        "protein_g_per_meal" => 30,
        "sha256_hash" => "ff",
        "address_line1" => "Main St",
        "item_2_id" => 2,
        "calories_per_100" => 130,
        "2026-10-08" => [%{"is_cooked" => false, "meal_ids" => [1, 2]}],
        "by_category" => %{"no_perecederos" => [%{"ingredient_name" => "Rice"}]},
        "snapshot" => %{
          "current_step_id" => 3,
          "timers" => %{"egg_timer" => %{"remaining_seconds" => 90}}
        }
      }

      assert original |> Casing.camelize_keys() |> Casing.snake_keys() == original
    end

    test "camelize_keys/1 restores what snake_keys/1 rewrote" do
      original = %{
        "sessionId" => "abc",
        "deviceID" => "phone",
        "proteinGPerMeal" => 30,
        "item2Id" => 2,
        "byCategory" => %{"noPerecederos" => [%{"ingredientId" => 7}]},
        "timers" => %{"egg_timer" => %{"remainingSeconds" => 90}},
        "items" => [%{"quantityMilli" => 500}]
      }

      assert original |> Casing.snake_keys() |> Casing.camelize_keys() == original
    end
  end
end
