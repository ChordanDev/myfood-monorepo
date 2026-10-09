defmodule MealPlannerApi.Voice.InventoryIntentParser do
  @moduledoc """
  Reads one spoken Inventory adjustment ("me comí la mitad del queso crema")
  into a single subtract intent, with a confidence from 0.0 to 1.0.

  Pure: it takes the transcript and the stock the Account holds, and returns
  the intent or `{:error, :voice_parse_failed}`.

  Confidence is the sum of independent evidence:

  - the transcript names an ingredient in stock: 0.3 (without it nothing is
    parsed);
  - it carries a consume verb ("me comí", "usé", "terminé", "ate"): 0.2;
  - it states an amount, as a fraction of the stock or as a quantity in the
    stock's unit: 0.4. A transcript with no amount subtracts all the stock.

  A stated amount larger than the stock is capped at the stock and does not
  count as evidence of an amount.
  """

  @confirmation_threshold 0.8

  @name_evidence 30
  @verb_evidence 20
  @amount_evidence 40

  # Stems matched at the start of a word, so "comí", "comiendo" and "comimos"
  # share "comi" while "comida" does not.
  @consume_stems ~w(
    comi comiendo comimos termin acab consum use usa uso usando usamos gast
    ate eat eaten finish used consume
  )

  @fractions [
    {["tres cuartos", "three quarters"], {3, 4}},
    {["medio", "media", "mitad", "half"], {1, 2}},
    {["tercio", "third"], {1, 3}},
    {["cuarto", "quarter"], {1, 4}}
  ]

  # "medio kilo" is 500 g and "un cuarto de kilo" 250 g whatever the stock
  # holds. Kept ahead of the fractions of the stock.
  @bulk_phrases [
    {["medio kilo", "mitad del kilo", "half a kilo", "half kilo"], :g, 500_000},
    {["medio litro", "mitad del litro", "half a liter", "half a litre"], :ml, 500_000},
    {[
       "cuarto de kilo",
       "cuarto kilo",
       "quarter of a kilo",
       "quarter of kilo",
       "a quarter kilo",
       "quarter kilo"
     ], :g, 250_000},
    {[
       "cuarto de litro",
       "cuarto litro",
       "quarter of a liter",
       "quarter of a litre",
       "quarter liter",
       "quarter litre"
     ], :ml, 250_000}
  ]

  @unit_labels "kilogramos?|kilos?|kgs?|gramos?|grs?|g|mililitros?|ml|litros?|lts?|l|unidades|unidad|u"

  # A number not glued to another digit, a dot, a comma or a slash, so the
  # denominator of "1/2" is never read as an amount of its own.
  @quantity_regex Regex.compile!("(?<![\\d.,/])(\\d+(?:[.,]\\d+)?)\\s*(#{@unit_labels})\\b")
  @fraction_regex Regex.compile!("(?<![\\d.,/])(\\d+)/(\\d+)\\s*(#{@unit_labels})\\b")

  # Spoken words that start with a consume stem but are not the verb.
  @not_verbs ~w(comida comidas)

  @type stock :: %{
          ingredient_id: String.t(),
          name: String.t(),
          unit: :g | :ml | :unit,
          total_milli: non_neg_integer()
        }

  @type intent :: %{
          operation: :subtract,
          ingredient_id: String.t(),
          name: String.t(),
          unit: :g | :ml | :unit,
          quantity_milli: pos_integer()
        }

  @doc "Confidence below which the User must confirm the intent before it is applied."
  @spec confirmation_threshold() :: float()
  def confirmation_threshold, do: @confirmation_threshold

  @spec confirmation_required?(number()) :: boolean()
  def confirmation_required?(confidence), do: confidence < @confirmation_threshold

  @spec parse(String.t(), [stock()]) ::
          {:ok, %{intent: intent(), confidence: float()}} | {:error, :voice_parse_failed}
  def parse(transcript, stock) when is_binary(transcript) and is_list(stock) do
    words = words(transcript)
    text = decimal_text(transcript)

    with %{total_milli: total} = matched when total > 0 <- match_stock(words, stock),
         {quantity, amount_evidence} <- amount(words, text, matched),
         true <- quantity > 0 do
      verb_evidence = if consume_verb?(words), do: @verb_evidence, else: 0

      {:ok,
       %{
         intent: %{
           operation: :subtract,
           ingredient_id: matched.ingredient_id,
           name: matched.name,
           unit: matched.unit,
           quantity_milli: quantity
         },
         confidence: (@name_evidence + verb_evidence + amount_evidence) / 100
       }}
    else
      _ -> {:error, :voice_parse_failed}
    end
  end

  def parse(_transcript, _stock), do: {:error, :voice_parse_failed}

  # The longest name wins, so "queso crema" beats "queso"; the larger stock
  # breaks a tie.
  defp match_stock(words, stock) do
    stock
    |> Enum.filter(&mentioned?(words, &1.name))
    |> Enum.max_by(&{String.length(&1.name), &1.total_milli}, fn -> nil end)
  end

  defp mentioned?(words, name) do
    name_words = words(name)

    name_words != [] and
      Enum.any?(
        [name_words, plural(name_words)],
        &contains_phrase?(words, &1)
      )
  end

  defp plural(name_words) do
    {init, [last]} = Enum.split(name_words, -1)
    init ++ [last <> "s"]
  end

  defp contains_phrase?(words, phrase) do
    haystack = " " <> Enum.join(words, " ") <> " "
    String.contains?(haystack, " " <> Enum.join(phrase, " ") <> " ")
  end

  defp consume_verb?(words) do
    Enum.any?(words, fn word ->
      word not in @not_verbs and Enum.any?(@consume_stems, &String.starts_with?(word, &1))
    end)
  end

  # {quantity_milli, amount_evidence}. No stated amount takes all the stock.
  defp amount(words, text, stock) do
    case stated_amount(words, text, stock) do
      nil -> {stock.total_milli, 0}
      quantity when quantity > stock.total_milli -> {stock.total_milli, 0}
      quantity -> {quantity, @amount_evidence}
    end
  end

  defp stated_amount(words, text, stock) do
    quantity_amount(text, stock) || count_amount(text, stock) || half_bulk_amount(words, stock) ||
      fraction_amount(words, stock)
  end

  defp quantity_amount(text, stock) do
    @quantity_regex
    |> Regex.scan(text)
    |> Enum.find_value(fn [_whole, number, label] ->
      {unit, factor} = unit_of(label)
      if unit == stock.unit, do: round(parse_number(number) * factor)
    end)
  end

  # "me comí 2 huevos": a bare number before the name counts units.
  defp count_amount(_text, %{unit: unit}) when unit != :unit, do: nil

  defp count_amount(text, stock) do
    name = stock.name |> words() |> Enum.join(" ") |> Regex.escape()

    case Regex.run(~r/(?<![\d.,\/])(\d+(?:[.,]\d+)?)\s+#{name}/, text) do
      [_whole, number] -> round(parse_number(number) * 1_000)
      nil -> nil
    end
  end

  defp half_bulk_amount(words, stock) do
    Enum.find_value(@bulk_phrases, fn {phrases, unit, quantity} ->
      if unit == stock.unit and Enum.any?(phrases, &contains_phrase?(words, words(&1))),
        do: quantity
    end)
  end

  defp fraction_amount(words, stock) do
    Enum.find_value(@fractions, fn {phrases, {numerator, denominator}} ->
      if Enum.any?(phrases, &contains_phrase?(words, words(&1))),
        do: div(stock.total_milli * numerator, denominator)
    end)
  end

  defp unit_of(label) when label in ~w(g gr grs gramo gramos), do: {:g, 1_000}

  defp unit_of(label) when label in ~w(kg kgs kilo kilos kilogramo kilogramos),
    do: {:g, 1_000_000}

  defp unit_of(label) when label in ~w(ml mililitro mililitros), do: {:ml, 1_000}
  defp unit_of(label) when label in ~w(l lt lts litro litros), do: {:ml, 1_000_000}
  defp unit_of(_label), do: {:unit, 1_000}

  defp parse_number(number) do
    {value, _rest} = number |> String.replace(",", ".") |> Float.parse()
    value
  end

  # Lowercase, no accents, only letters and digits: the form names and
  # phrases are compared in.
  defp words(text) do
    text
    |> fold()
    |> String.replace(~r/[^\p{L}\p{N}]+/u, " ")
    |> String.split(" ", trim: true)
  end

  # The same fold, keeping the decimal separators of a quantity and the slash
  # of a fraction. "1/2 kg" becomes "0.500000 kg"; a slash fraction with no
  # unit stays "1/2", which no amount pattern reads.
  defp decimal_text(text) do
    text
    |> fold()
    |> String.replace(~r/[^\p{L}\p{N}.,\/]+/u, " ")
    |> then(
      &Regex.replace(@fraction_regex, &1, fn whole, n, d, label ->
        fraction_text(whole, n, d, label)
      end)
    )
  end

  defp fraction_text(whole, numerator, denominator, label) do
    case String.to_integer(denominator) do
      0 ->
        whole

      divisor ->
        value = String.to_integer(numerator) / divisor
        :erlang.float_to_binary(value, decimals: 6) <> " " <> label
    end
  end

  defp fold(text) do
    text
    |> String.downcase()
    |> :unicode.characters_to_nfd_binary()
    |> String.replace(~r/\p{Mn}/u, "")
  end
end
