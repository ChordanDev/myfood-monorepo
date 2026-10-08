defmodule MealPlannerApiWeb.CasingAssertions do
  @moduledoc """
  Assertions for the camelCase mobile contract (issue #11).

  Imported by `MealPlannerApiWeb.ConnCase`, so every controller test can
  check a decoded response body with `assert_camel_case_keys/1`.
  """

  import ExUnit.Assertions

  # Maps keyed by data instead of field names, in the casing a response uses.
  # Mirrors the opaque keys of `MealPlannerApiWeb.Casing`: the direct keys of
  # the map stored under one of them are not checked, the levels below are.
  @opaque_keys ~w(byCategory timers)

  @doc """
  Fails when a key of `term` is spelled in snake_case, at any depth, nested
  lists included. The failure lists the path of every offending key.

  A key is snake_case when it is made of lowercase words joined by
  underscores (`recipe_id`, `calories_per_100`). The direct keys of a map
  stored under an opaque key (`byCategory`, `timers`) are data and are
  exempt; the payloads below them are checked.

  Returns `term`, so the assertion can sit in a pipeline:

      body = conn |> json_response(200) |> assert_camel_case_keys()
  """
  @spec assert_camel_case_keys(term()) :: term()
  def assert_camel_case_keys(term) do
    case snake_case_paths(term, []) do
      [] ->
        term

      paths ->
        flunk(
          "expected camelCase keys only, found snake_case keys:\n" <>
            Enum.map_join(paths, "\n", &("  " <> &1))
        )
    end
  end

  defp snake_case_paths(map, path) when is_map(map) and not is_struct(map) do
    Enum.flat_map(map, fn {key, value} ->
      here = [to_string(key) | path]
      own = if snake_case?(key), do: [format(here)], else: []

      own ++ value_paths(key, value, here)
    end)
  end

  defp snake_case_paths(list, path) when is_list(list) do
    list
    |> Enum.with_index()
    |> Enum.flat_map(fn {item, index} -> snake_case_paths(item, ["[#{index}]" | path]) end)
  end

  defp snake_case_paths(_other, _path), do: []

  defp value_paths(key, value, path) when is_map(value) and not is_struct(value) do
    if to_string(key) in @opaque_keys do
      Enum.flat_map(value, fn {data_key, child} ->
        snake_case_paths(child, [to_string(data_key) | path])
      end)
    else
      snake_case_paths(value, path)
    end
  end

  defp value_paths(_key, value, path), do: snake_case_paths(value, path)

  defp snake_case?(key) when is_binary(key), do: key =~ ~r/\A[a-z][a-z0-9]*(_[a-z0-9]+)+\z/
  defp snake_case?(key) when is_atom(key), do: snake_case?(Atom.to_string(key))
  defp snake_case?(_key), do: false

  defp format(path), do: path |> Enum.reverse() |> Enum.join(".")
end
