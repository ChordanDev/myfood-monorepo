defmodule MealPlannerApi.Services.IngredientService do
  @moduledoc """
  The Ingredient catalogue as the mobile app reads it: a bounded name search
  the inventory add sheet picks an Ingredient from (issue #116).
  """

  alias MealPlannerApi.Persistence.Catalog

  # The most Ingredients one search answers.
  @max_results 20
  # The longest query a search takes, counted once trimmed.
  @max_query_length 100

  @doc """
  Searches the catalogue by name, ignoring case. The query is trimmed; a blank
  one, or one longer than #{@max_query_length} characters, is `:invalid_query`.
  """
  @spec search(term()) ::
          {:ok, [%{id: Ecto.UUID.t(), name: String.t()}]} | {:error, :invalid_query}
  def search(query) when is_binary(query) do
    trimmed = String.trim(query)

    if trimmed == "" or String.length(trimmed) > @max_query_length do
      {:error, :invalid_query}
    else
      {:ok,
       trimmed
       |> Catalog.search_ingredients(@max_results)
       |> Enum.map(&%{id: &1.id, name: &1.name})}
    end
  end

  def search(_query), do: {:error, :invalid_query}
end
