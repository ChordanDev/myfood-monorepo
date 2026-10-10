defmodule MealPlannerApiWeb.PlannerFixtures do
  @moduledoc """
  Frozen payloads of the Planner (issue #25), recorded from real channel runs.

  `check!/3` takes a payload a channel test received and either rewrites the
  JSON fixture the mobile app reads (`UPDATE_FIXTURES=1`) or asserts that the
  committed fixture equals the fresh payload, so a change of the API side that
  is not mirrored in the committed files fails an API test. The app side reads
  the same files in `apps/mobile/src/features/planner/fixtures/__tests__`.

  Regenerate with `UPDATE_FIXTURES=1 mix test test/meal_planner_api_web/channels/planner_fixtures_test.exs`.

  ## Normalization

  The files must not change between runs, so volatile values are replaced
  before comparing or writing:

    * every UUID becomes `00000000-0000-4000-8000-00000000000N`, `N` being the
      order of first appearance (keys are visited in sorted order). A UUID that
      already has the stable form is kept, so a test can pin ids shared by
      several fixtures;
    * every value in `substitutions` (`%{real => stable}`) is replaced, for
      the ids and dates a test knows it generated.

  Keys are written sorted, and the comparison is on the decoded JSON, so the
  formatting of the file (prettier runs on the mobile side) never matters.
  """

  import ExUnit.Assertions

  @fixtures_dir Path.expand("../../../mobile/src/features/planner/fixtures", __DIR__)
  @stable_prefix "00000000-0000-4000-8000-"
  @uuid ~r/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/i

  @doc "Directory where the fixtures live (mobile app side)."
  def fixtures_dir, do: @fixtures_dir

  @doc """
  Records or checks the fixture `name` (without extension) for `payload`.
  Returns the normalized payload.
  """
  @spec check!(String.t(), term(), %{optional(String.t()) => String.t()}) :: term()
  def check!(name, payload, substitutions \\ %{}) do
    normalized = normalize(payload, substitutions)
    path = Path.join(@fixtures_dir, name <> ".json")

    if System.get_env("UPDATE_FIXTURES") == "1" do
      File.mkdir_p!(@fixtures_dir)
      File.write!(path, encode(normalized))
    else
      assert File.exists?(path),
             "missing fixture #{path}; run with UPDATE_FIXTURES=1 to create it"

      committed = path |> File.read!() |> Jason.decode!()

      assert committed == Jason.decode!(Jason.encode!(normalized)),
             "fixture #{name}.json drifted from the channel payload; " <>
               "run with UPDATE_FIXTURES=1 and commit the result"
    end

    normalized
  end

  defp encode(normalized) do
    normalized |> to_ordered() |> Jason.encode!(pretty: true) |> Kernel.<>("\n")
  end

  # Replaces the volatile values. Structs and atoms are reduced to JSON first,
  # so the walk only meets maps, lists and scalars.
  defp normalize(payload, substitutions) do
    json = payload |> Jason.encode!() |> Jason.decode!()
    substituted = walk(json, fn value -> Map.get(substitutions, value, value) end)

    {normalized, _seen} = number_uuids(substituted, %{})
    normalized
  end

  defp walk(map, fun) when is_map(map), do: Map.new(map, fn {k, v} -> {k, walk(v, fun)} end)
  defp walk(list, fun) when is_list(list), do: Enum.map(list, &walk(&1, fun))
  defp walk(value, fun) when is_binary(value), do: fun.(value)
  defp walk(value, _fun), do: value

  defp number_uuids(map, seen) when is_map(map) do
    map
    |> Enum.sort_by(&elem(&1, 0))
    |> Enum.map_reduce(seen, fn {key, value}, acc ->
      {value, acc} = number_uuids(value, acc)
      {{key, value}, acc}
    end)
    |> then(fn {pairs, acc} -> {Map.new(pairs), acc} end)
  end

  defp number_uuids(list, seen) when is_list(list) do
    Enum.map_reduce(list, seen, &number_uuids/2)
  end

  defp number_uuids(value, seen) when is_binary(value) do
    if Regex.match?(@uuid, value) and not String.starts_with?(value, @stable_prefix) do
      seen = Map.put_new_lazy(seen, value, fn -> map_size(seen) + 1 end)
      {stable_uuid(Map.fetch!(seen, value)), seen}
    else
      {value, seen}
    end
  end

  defp number_uuids(value, seen), do: {value, seen}

  defp stable_uuid(n) do
    @stable_prefix <> String.pad_leading(Integer.to_string(n), 12, "0")
  end

  defp to_ordered(map) when is_map(map) do
    map
    |> Enum.sort_by(&elem(&1, 0))
    |> Enum.map(fn {k, v} -> {k, to_ordered(v)} end)
    |> Jason.OrderedObject.new()
  end

  defp to_ordered(list) when is_list(list), do: Enum.map(list, &to_ordered/1)
  defp to_ordered(value), do: value
end
