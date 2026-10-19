defmodule MealPlannerApiWeb.MealSummary do
  @moduledoc """
  The shared meal summary of the mobile contract (issue #27): the one shape
  in which `GET /api/calendar` and `GET /api/planning/weekly` describe a meal.

      %{
        recipe_id: id,
        recipe_name: "Name",
        is_favorite: false,
        slot: "lunch",
        macros: %{calories: 450},
        prep_time_minutes: 20
      }

  Keys are snake_case atoms: the `:mobile_casing` pipeline renders them as
  camelCase (`recipeId`, `recipeName`, `isFavorite`, `prepTimeMinutes`). The
  slot is always one of the English `breakfast | lunch | dinner`.

  Callers map their own source (a calendar row, an optimizer meal) to the
  attributes below; the shape lives only here. A caller that needs more keys
  (the calendar adds `meal_id`, `date`, ...) merges them on top.
  """

  @type attrs :: %{
          required(:recipe_id) => term(),
          required(:slot) => atom() | String.t(),
          optional(:recipe_name) => String.t() | nil,
          optional(:is_favorite) => boolean() | nil,
          optional(:calories) => number() | nil,
          optional(:prep_time_minutes) => integer() | nil
        }

  @spec serialize(attrs()) :: map()
  def serialize(attrs) do
    %{
      recipe_id: attrs.recipe_id,
      recipe_name: Map.get(attrs, :recipe_name),
      is_favorite: Map.get(attrs, :is_favorite) == true,
      slot: to_string(attrs.slot),
      macros: %{calories: Map.get(attrs, :calories)},
      prep_time_minutes: Map.get(attrs, :prep_time_minutes)
    }
  end
end
