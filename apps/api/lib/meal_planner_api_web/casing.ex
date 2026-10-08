defmodule MealPlannerApiWeb.Casing do
  @moduledoc """
  Key transform between the snake_case the API uses internally and the
  camelCase of the mobile contract (issue #11):

      camelize_keys(%{recipe_id: 1, steps: [%{step_number: 1}]})
      #=> %{"recipeId" => 1, "steps" => [%{"stepNumber" => 1}]}

      snake_keys(%{"recipeId" => 1, "steps" => [%{"stepNumber" => 1}]})
      #=> %{"recipe_id" => 1, "steps" => [%{"step_number" => 1}]}

  Both functions are pure and only ever touch keys:

    * They recurse through plain maps and lists. A struct (`DateTime`,
      `Date`, `Decimal`, `Plug.Upload`, any other) is a value and is returned
      untouched, as is every other term.
    * Values are never changed, atoms and strings included.
    * Atom and string keys are both accepted and every one of them comes out
      as a string, rewritten or not. Keys of any other type are left as they
      are.

  ## Which keys are rewritten

  A key is rewritten only when it is an identifier in the source casing:

    * `camelize_keys/1`: lowercase words joined by single underscores, each
      word starting with a letter (`prep_time_minutes`, `sha256_hash`).
    * `snake_keys/1`: a lowercase letter followed by letters and digits
      (`prepTimeMinutes`, `sha256Hash`).

  Everything else is data and stays as it is: dates, UUIDs, numeric strings,
  keys with dashes or spaces, keys starting with an uppercase letter or an
  underscore. This already protects most maps keyed by data.

  The two rewrites are exact inverses, which makes both functions idempotent
  and lets `snake_keys/1` restore every key `camelize_keys/1` rewrote (and
  the other way round). Two edge cases follow from that:

    * Digits belong to the word they follow: `address_line1` and
      `addressLine1` map to each other. A word that starts with a digit has
      no camelCase spelling that could be undone, so `item_2_id` and
      `calories_per_100` are not identifiers and are left as they are.
    * Every uppercase letter starts a word, so acronyms are not recognised:
      `protein_g_per_meal` and `proteinGPerMeal` map to each other, and
      `deviceID` becomes `device_i_d`. Clients send `deviceId`.

  When two keys of one map end up with the same name, one of them is kept and
  the choice does not depend on the order of the map: the key already spelled
  in the target casing wins over a rewritten one (`snake_keys/1` keeps
  `recipe_id` over `recipeId`, `camelize_keys/1` the other way round), and
  between an atom and a string with the same name the string wins.

  ## Opaque keys

  Some maps are keyed by data that does look like an identifier. The keys in
  `@opaque_keys` mark them, in either casing (`by_category` and
  `byCategory`). The opaque key itself is rewritten like any other; the
  direct keys of the map stored under it are data and are kept as they are;
  below those keys the rewrite goes on as usual (a string data key wins over
  an atom with the same name):

      camelize_keys(%{by_category: %{"no_perecederos" => [%{ingredient_id: 7}]}})
      #=> %{"byCategory" => %{"no_perecederos" => [%{"ingredientId" => 7}]}}

  The rule stops after one level because the values of such a map are
  ordinary payloads again. A value that is not a plain map is traversed as
  usual.

    * `by_category` — inventory grouped by ingredient category: the keys are
      enum values such as `no_perecederos`, the values are lists of item
      maps with field keys.
    * `timers` — cooking timers the client stores in the session snapshot and
      reads back: the keys are timer ids chosen by the client.
  """

  @opaque_keys ~w(by_category timers)

  @doc """
  Rewrites every snake_case key of `term` to camelCase, recursively.

  Used on what the API sends: response bodies and channel payloads.
  """
  @spec camelize_keys(term()) :: term()
  def camelize_keys(term), do: rewrite_keys(term, &camelize/1)

  @doc """
  Rewrites every camelCase key of `term` to snake_case, recursively.

  Used on what the API receives: request params and channel payloads.
  """
  @spec snake_keys(term()) :: term()
  def snake_keys(term), do: rewrite_keys(term, &underscore/1)

  defp rewrite_keys(%_{} = struct, _rewrite), do: struct

  defp rewrite_keys(map, rewrite) when is_map(map) do
    rewrite_entries(map, rewrite, &rewrite_value(&1, &2, rewrite))
  end

  defp rewrite_keys(list, rewrite) when is_list(list),
    do: Enum.map(list, &rewrite_keys(&1, rewrite))

  defp rewrite_keys(other, _rewrite), do: other

  # The direct keys of a map stored under an opaque key are data: they are
  # kept, and the rewrite resumes in the values.
  defp rewrite_value(key, value, rewrite) when is_map(value) and not is_struct(value) do
    if opaque?(key) do
      rewrite_entries(value, & &1, fn _data_key, child -> rewrite_keys(child, rewrite) end)
    else
      rewrite_keys(value, rewrite)
    end
  end

  defp rewrite_value(_key, value, rewrite), do: rewrite_keys(value, rewrite)

  # Builds the map entry by entry. Two keys can end up with the same name;
  # the entry with the lowest rank is kept, so the result does not depend on
  # the order in which the map is traversed.
  defp rewrite_entries(map, rewrite, rewrite_child) do
    map
    |> Enum.reduce(%{}, fn {key, value}, ranked ->
      {name, rank} = rewrite_key(key, rewrite)

      case ranked do
        %{^name => {kept_rank, _kept}} when kept_rank <= rank -> ranked
        _ -> Map.put(ranked, name, {rank, rewrite_child.(key, value)})
      end
    end)
    |> Map.new(fn {name, {_rank, value}} -> {name, value} end)
  end

  # Returns the new key and its rank among the keys that share that name: a
  # key already in the target casing (0 for a string, 1 for an atom) comes
  # before a rewritten one (2 for a string, 3 for an atom). Two keys that
  # collide never share a rank, because two distinct keys of the same kind
  # cannot be given the same name: left as they are they stay distinct, and
  # each rewrite is injective, so two rewritten keys stay distinct too.
  defp rewrite_key(key, rewrite) when is_binary(key) do
    name = rewrite.(key)
    {name, if(name == key, do: 0, else: 2)}
  end

  defp rewrite_key(key, rewrite) when is_atom(key) do
    {name, rank} = key |> Atom.to_string() |> rewrite_key(rewrite)
    {name, rank + 1}
  end

  # Any other key is kept as it is and cannot collide with another one.
  defp rewrite_key(key, _rewrite), do: {key, 0}

  # The snake_case form is the same whichever casing the key arrives in.
  defp opaque?(key) when is_binary(key), do: underscore(key) in @opaque_keys
  defp opaque?(key) when is_atom(key), do: opaque?(Atom.to_string(key))
  defp opaque?(_key), do: false

  defp camelize(key) do
    if key =~ ~r/\A[a-z][a-z0-9]*(_[a-z][a-z0-9]*)*\z/ do
      Regex.replace(~r/_([a-z])/, key, fn _match, letter -> String.upcase(letter) end)
    else
      key
    end
  end

  defp underscore(key) do
    if key =~ ~r/\A[a-z][a-zA-Z0-9]*\z/ do
      Regex.replace(~r/[A-Z]/, key, fn letter -> "_" <> String.downcase(letter) end)
    else
      key
    end
  end
end
