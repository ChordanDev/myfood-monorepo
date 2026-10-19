defmodule Mix.Tasks.Catalog.ReviewAllergens do
  @moduledoc """
  The human review of Ingredient `allergens` (issue #302). Only this review
  moves `allergens` away from NULL (not reviewed); `mix ai_populate` only
  proposes codes in `allergens_proposed`.

      mix catalog.review_allergens --export review.csv
      mix catalog.review_allergens --apply review.csv

  `--export` writes every Ingredient whose `allergens` is NULL, by name, with
  the columns `id,name,category,allergens_proposed,allergens,reviewed`. The
  `allergens` column is pre-filled from the proposal and `reviewed` is empty.
  Codes inside a cell are separated by spaces. It prints how many Ingredients
  are unreviewed.

  The reviewer corrects `allergens` and writes `yes` in `reviewed` on every
  row they checked. `--apply` then writes `allergens` on those rows only:

    * a row without `reviewed = yes` is skipped, so an untouched row never
      becomes "no allergens";
    * on a reviewed row an empty `allergens` cell means `[]`, reviewed with no
      allergens;
    * an Ingredient whose `allergens` is no longer NULL is left as it is;
    * a file with any code outside `peanut, tree_nut, shellfish, gluten,
      dairy, egg, soy`, a malformed id or a different header writes nothing
      and exits non-zero.
  """

  use Mix.Task

  alias MealPlannerApi.Persistence.Accounts.UserHardRestriction
  alias MealPlannerApi.Persistence.Catalog

  @shortdoc "Exports unreviewed Ingredient allergens to a CSV, or applies a reviewed one"

  @header ~w(id name category allergens_proposed allergens reviewed)
  @usage "Usage: mix catalog.review_allergens --export PATH | --apply PATH"

  @impl Mix.Task
  def run(args) do
    Mix.Task.run("app.start")

    case OptionParser.parse(args, strict: [export: :string, apply: :string]) do
      {[export: path], [], []} -> export(path)
      {[apply: path], [], []} -> apply_file(path)
      _ -> Mix.raise(@usage)
    end
  end

  defp export(path) do
    ingredients = Catalog.list_unreviewed_ingredients()

    rows =
      Enum.map(ingredients, fn ingredient ->
        proposed = join_codes(ingredient.allergens_proposed)
        [ingredient.id, ingredient.name, to_string(ingredient.category), proposed, proposed, ""]
      end)

    File.write!(path, Enum.map_join([@header | rows], &(encode_row(&1) <> "\n")))

    Mix.shell().info("Exported #{length(ingredients)} unreviewed Ingredients to #{path}")
  end

  defp apply_file(path) do
    text = File.read!(path)
    unless String.valid?(text), do: Mix.raise("#{path} is not valid UTF-8")
    # A spreadsheet saving "CSV UTF-8" starts the file with a byte order mark.
    rows = text |> String.trim_leading("\uFEFF") |> parse_csv()

    case rows do
      [header | data] ->
        if Enum.map(header, &String.trim/1) != @header do
          Mix.raise("#{path}: the header must be #{Enum.join(@header, ",")}")
        end

        data
        |> Enum.with_index(2)
        |> Enum.reject(fn {row, _number} -> row == [""] end)
        |> Enum.map(&parse_row/1)
        |> apply_rows(path)

      [] ->
        Mix.raise("#{path} is empty")
    end
  end

  defp apply_rows(parsed, path) do
    case for({:error, message} <- parsed, do: message) do
      [] ->
        rows = for {:ok, row} <- parsed, do: row
        reviews = for %{reviewed?: true, id: id, codes: codes} <- rows, do: {id, codes}
        {:ok, %{written: written, skipped: skipped}} = Catalog.apply_allergen_reviews(reviews)

        Mix.shell().info(
          "Wrote #{written} reviewed Ingredients; skipped #{skipped} already reviewed and " <>
            "#{length(rows) - length(reviews)} without reviewed = yes. " <>
            "#{Catalog.count_unreviewed_ingredients()} Ingredients are still unreviewed."
        )

      errors ->
        Mix.raise("#{path} was not applied, nothing was written:\n" <> Enum.join(errors, "\n"))
    end
  end

  defp parse_row({[id, _name, _category, _proposed, allergens, reviewed], number}) do
    codes = split_codes(allergens)

    unknown = codes |> Enum.reject(&(&1 in UserHardRestriction.codes())) |> Enum.uniq()

    case {cast_id(String.trim(id)), unknown} do
      {{:ok, uuid}, []} ->
        {:ok,
         %{
           id: uuid,
           codes: Enum.filter(UserHardRestriction.codes(), &(&1 in codes)),
           reviewed?: String.downcase(String.trim(reviewed)) == "yes"
         }}

      {:error, _unknown} ->
        {:error, "row #{number}: #{inspect(id)} is not an Ingredient id"}

      {_id, unknown} ->
        {:error, "row #{number}: unknown allergen codes #{inspect(unknown)}"}
    end
  end

  defp parse_row({row, number}),
    do: {:error, "row #{number}: expected #{length(@header)} columns, got #{length(row)}"}

  # `Ecto.UUID.cast/1` also accepts any 16-byte string as a raw UUID; an id
  # in the file must be the 36-character text form the export writes.
  defp cast_id(id) when byte_size(id) == 36, do: Ecto.UUID.cast(id)
  defp cast_id(_id), do: :error

  defp join_codes(nil), do: ""
  defp join_codes(codes), do: Enum.join(codes, " ")

  defp split_codes(cell), do: cell |> String.downcase() |> String.split(~r/[\s,;]+/, trim: true)

  defp encode_row(fields), do: Enum.map_join(fields, ",", &encode_field/1)

  defp encode_field(field) do
    if String.contains?(field, [",", "\"", "\n", "\r"]),
      do: "\"" <> String.replace(field, "\"", "\"\"") <> "\"",
      else: field
  end

  # RFC 4180: fields separated by commas, rows by LF or CRLF; a quoted field
  # may hold commas, line breaks and `""` for a quote.
  defp parse_csv(text) do
    text
    |> String.trim_trailing()
    |> case do
      "" -> []
      content -> parse_fields(content, [], [], "")
    end
  end

  defp parse_fields(<<>>, row, rows, field),
    do: Enum.reverse([Enum.reverse([field | row]) | rows])

  defp parse_fields(<<"\"", rest::binary>>, row, rows, "") do
    {quoted, rest} = parse_quoted(rest, "")
    parse_fields(rest, row, rows, quoted)
  end

  defp parse_fields(<<",", rest::binary>>, row, rows, field),
    do: parse_fields(rest, [field | row], rows, "")

  defp parse_fields(<<"\r\n", rest::binary>>, row, rows, field),
    do: parse_fields(rest, [], [Enum.reverse([field | row]) | rows], "")

  defp parse_fields(<<"\n", rest::binary>>, row, rows, field),
    do: parse_fields(rest, [], [Enum.reverse([field | row]) | rows], "")

  defp parse_fields(<<char::utf8, rest::binary>>, row, rows, field),
    do: parse_fields(rest, row, rows, field <> <<char::utf8>>)

  defp parse_quoted(<<"\"\"", rest::binary>>, acc), do: parse_quoted(rest, acc <> "\"")
  defp parse_quoted(<<"\"", rest::binary>>, acc), do: {acc, rest}

  defp parse_quoted(<<char::utf8, rest::binary>>, acc),
    do: parse_quoted(rest, acc <> <<char::utf8>>)

  defp parse_quoted(<<>>, _acc), do: Mix.raise("the CSV has a quoted field that never closes")
end
