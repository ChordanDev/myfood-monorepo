defmodule MealPlannerApiWeb.MobileFixtures do
  @moduledoc """
  Reads the frozen response bodies the mobile app is tested with and reduces
  a body to its key sets, so a controller test can pin a route to the fixture
  the app reads:

      fixture = MobileFixtures.read!("preferences/fixtures/preferences.json")
      assert MobileFixtures.key_shape(body) == MobileFixtures.key_shape(fixture)

  The fixtures live on the mobile side, under
  `apps/mobile/src/features/<feature>/fixtures`.
  """

  @features_dir Path.expand("../../../mobile/src/features", __DIR__)

  @doc "Decodes the fixture at `relative_path`, a path below the mobile `features` directory."
  @spec read!(String.t()) :: term()
  def read!(relative_path) do
    @features_dir |> Path.join(relative_path) |> File.read!() |> Jason.decode!()
  end

  @doc """
  The keys of `term` at every depth, with the values dropped.

  A map becomes a map of the shapes of its values. A list of maps becomes the
  distinct shapes of its entries. Anything else, a list of scalars or an
  empty list included, is `:value`: a null and a string have the same shape,
  and so do an empty list and a list of codes.
  """
  @spec key_shape(term()) :: term()
  def key_shape(map) when is_map(map) do
    Map.new(map, fn {key, value} -> {key, key_shape(value)} end)
  end

  def key_shape([entry | _] = list) when is_map(entry) or is_list(entry) do
    list |> Enum.map(&key_shape/1) |> Enum.uniq()
  end

  def key_shape(_value), do: :value
end
