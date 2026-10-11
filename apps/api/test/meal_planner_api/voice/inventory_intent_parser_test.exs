defmodule MealPlannerApi.Voice.InventoryIntentParserTest do
  use ExUnit.Case, async: true

  alias MealPlannerApi.Voice.InventoryIntentParser

  @cheese %{ingredient_id: "cheese", name: "Queso crema", unit: :g, total_milli: 400_000}
  @plain_cheese %{ingredient_id: "plain", name: "Queso", unit: :g, total_milli: 900_000}
  @eggs %{ingredient_id: "eggs", name: "Huevo", unit: :unit, total_milli: 6_000}
  @milk %{ingredient_id: "milk", name: "Leche", unit: :ml, total_milli: 2_000_000}
  @stock [@cheese, @plain_cheese, @eggs, @milk]

  @field_eggs %{
    ingredient_id: "field_eggs",
    name: "Huevo de campo",
    unit: :unit,
    total_milli: 12_000
  }
  @lemons %{ingredient_id: "lemons", name: "Limón", unit: :unit, total_milli: 5_000}
  @walnuts %{ingredient_id: "walnuts", name: "Nuez", unit: :unit, total_milli: 8_000}

  # Enough of everything for a kilo and a half or a litre and a half to fit.
  @pantry [
    %{@plain_cheese | total_milli: 4_000_000},
    %{@milk | total_milli: 3_000_000},
    %{@eggs | total_milli: 12_000},
    %{ingredient_id: "apples", name: "Manzana", unit: :unit, total_milli: 4_000}
  ]

  defp parse(transcript), do: InventoryIntentParser.parse(transcript, @stock)

  test "a consume verb, a name and a fraction is a confident subtract of that share" do
    assert {:ok, %{intent: intent, confidence: confidence}} =
             parse("Me comí la mitad del queso crema")

    assert intent == %{
             operation: :subtract,
             ingredient_id: "cheese",
             name: "Queso crema",
             unit: :g,
             quantity_milli: 200_000
           }

    assert confidence >= 0.8
    refute InventoryIntentParser.confirmation_required?(confidence)
  end

  test "an explicit quantity in the unit of the stock is confident" do
    assert {:ok, %{intent: %{ingredient_id: "cheese", quantity_milli: 150_000}, confidence: c}} =
             parse("usé 150 gramos de queso crema")

    assert c >= 0.8
  end

  test "kilos and litres scale to thousandths of the unit" do
    assert {:ok, %{intent: %{ingredient_id: "plain", quantity_milli: 500_000}}} =
             parse("gasté 0,5 kg de queso")

    assert {:ok, %{intent: %{ingredient_id: "milk", quantity_milli: 1_500_000}}} =
             parse("usé 1.5 litros de leche")
  end

  test "a quantity and a half adds half of the stated unit" do
    stock = [@cheese, %{@plain_cheese | total_milli: 2_000_000}, @eggs, @milk]

    assert {:ok, %{intent: %{ingredient_id: "plain", quantity_milli: 1_500_000}, confidence: 0.9}} =
             InventoryIntentParser.parse("me comí 1 kilo y medio de queso", stock)

    assert {:ok, %{intent: %{ingredient_id: "milk", quantity_milli: 1_500_000}, confidence: 0.9}} =
             InventoryIntentParser.parse("usé 1 litro y medio de leche", stock)

    assert {:ok, %{intent: %{ingredient_id: "eggs", quantity_milli: 1_500}, confidence: 0.9}} =
             InventoryIntentParser.parse("usé 1 unidad y media de huevo", stock)
  end

  test "the decimal form of a quantity and a half still reads the same amount" do
    stock = [%{@plain_cheese | total_milli: 2_000_000}]

    assert {:ok, %{intent: %{quantity_milli: 1_500_000}, confidence: 0.9}} =
             InventoryIntentParser.parse("me comí 1,5 kilos de queso", stock)
  end

  test "a quantity and a half larger than the stock is capped and not confident" do
    assert {:ok, %{intent: %{ingredient_id: "plain", quantity_milli: 900_000}, confidence: c}} =
             parse("me comí 1 kilo y medio de queso")

    assert c < 0.8
  end

  test "un or una reads exactly as the digit 1 does" do
    for {spoken, digit} <- [
          {"me comí un kilo de queso", "me comí 1 kilo de queso"},
          {"usé un gramo de queso", "usé 1 gramo de queso"},
          {"tomé un litro de leche", "tomé 1 litro de leche"},
          {"usé una unidad de huevo", "usé 1 unidad de huevo"},
          {"me comí un kilo y medio de queso", "me comí 1 kilo y medio de queso"},
          {"me comí un huevo", "me comí 1 huevo"},
          {"me comí un huevos", "me comí 1 huevos"},
          {"usé una manzana", "usé 1 manzana"},
          {"Usé UNA manzana.", "Usé 1 manzana."},
          {"me comí un queso", "me comí 1 queso"}
        ] do
      assert {:ok, _parsed} = with_digit = InventoryIntentParser.parse(digit, @pantry)
      assert InventoryIntentParser.parse(spoken, @pantry) == with_digit, spoken
    end
  end

  test "un before a unit label is one of that unit" do
    assert {:ok, %{intent: %{ingredient_id: "plain", quantity_milli: 1_000_000}, confidence: 0.9}} =
             InventoryIntentParser.parse("me comí un kilo de queso", @pantry)

    assert {:ok, %{intent: %{ingredient_id: "milk", quantity_milli: 1_000_000}, confidence: 0.7}} =
             InventoryIntentParser.parse("tomé un litro de leche", @pantry)

    assert {:ok, %{intent: %{ingredient_id: "eggs", quantity_milli: 1_000}, confidence: 0.9}} =
             InventoryIntentParser.parse("usé una unidad de huevo", @pantry)
  end

  test "un kilo y medio is a kilo and a half and needs no confirmation" do
    assert {:ok, %{intent: %{ingredient_id: "plain", quantity_milli: 1_500_000}, confidence: c}} =
             InventoryIntentParser.parse("me comí un kilo y medio de queso", @pantry)

    refute InventoryIntentParser.confirmation_required?(c)
  end

  test "un or una before the name of a stock counted in units is one unit" do
    assert {:ok, %{intent: %{ingredient_id: "eggs", quantity_milli: 1_000}, confidence: 0.9}} =
             InventoryIntentParser.parse("me comí un huevo", @pantry)

    assert {:ok, %{intent: %{ingredient_id: "apples", quantity_milli: 1_000}, confidence: 0.9}} =
             InventoryIntentParser.parse("usé una manzana", @pantry)

    assert {:ok, %{intent: %{ingredient_id: "field_eggs", quantity_milli: 1_000}}} =
             InventoryIntentParser.parse("me comí un huevo de campo", [@eggs, @field_eggs])
  end

  test "un before the name of a stock in grams is not an amount" do
    assert {:ok, %{intent: %{ingredient_id: "plain", quantity_milli: 4_000_000}, confidence: 0.5}} =
             InventoryIntentParser.parse("me comí un queso", @pantry)
  end

  test "a longer word that ends in un is not the number 1" do
    assert {:ok, %{intent: %{ingredient_id: "plain", quantity_milli: 4_000_000}, confidence: 0.5}} =
             InventoryIntentParser.parse("me comí algún kilo de queso", @pantry)

    assert {:ok, %{intent: %{ingredient_id: "eggs", quantity_milli: 12_000}, confidence: 0.5}} =
             InventoryIntentParser.parse("me comí algún huevo", @pantry)

    assert {:ok, %{intent: %{ingredient_id: "apples", quantity_milli: 4_000}, confidence: 0.5}} =
             InventoryIntentParser.parse("usé alguna manzana", @pantry)
  end

  test "a half after a unit that is not the unit of the stock needs confirmation" do
    for transcript <- [
          "usé 1 litro y medio de queso",
          "usé un litro y medio de queso",
          "usé litro y medio de queso",
          "usé 1 unidad y media de queso"
        ] do
      assert {:ok, %{intent: intent, confidence: c}} =
               InventoryIntentParser.parse(transcript, @pantry)

      assert %{ingredient_id: "plain", quantity_milli: 4_000_000} = intent
      assert InventoryIntentParser.confirmation_required?(c), transcript
    end
  end

  test "a half that does not follow a unit label is still half of the stock" do
    assert {:ok, %{intent: %{ingredient_id: "plain", quantity_milli: 2_000_000}, confidence: 0.9}} =
             InventoryIntentParser.parse("me comí medio queso", @pantry)

    assert {:ok, %{intent: %{ingredient_id: "plain", quantity_milli: 2_000_000}, confidence: 0.9}} =
             InventoryIntentParser.parse("me comí la mitad del queso", @pantry)

    assert {:ok, %{intent: %{ingredient_id: "milk", quantity_milli: 1_500_000}, confidence: 0.9}} =
             InventoryIntentParser.parse("usé queso y media leche", [
               %{@plain_cheese | total_milli: 1_000_000},
               %{@milk | total_milli: 3_000_000}
             ])
  end

  test "medio kilo is 500 g whatever the stock holds" do
    assert {:ok, %{intent: %{ingredient_id: "plain", quantity_milli: 500_000}}} =
             parse("me comí medio kilo de queso")
  end

  test "a slash fraction before a unit is that share of the unit, never the denominator" do
    stock = [%{@plain_cheese | total_milli: 2_000_000}]

    assert {:ok, %{intent: %{quantity_milli: 500_000}, confidence: c}} =
             InventoryIntentParser.parse("me comí 1/2 kg de queso", stock)

    assert c >= 0.8

    stock = [%{@plain_cheese | total_milli: 5_000_000}]

    assert {:ok, %{intent: %{quantity_milli: 250_000}}} =
             InventoryIntentParser.parse("me comí 1/4 kg de queso", stock)
  end

  test "a slash fraction without a unit never yields a confident wrong amount" do
    stock = [%{@eggs | total_milli: 6_000}]

    assert {:ok, %{intent: %{quantity_milli: quantity}, confidence: c}} =
             InventoryIntentParser.parse("me comí 1/2 huevos", stock)

    assert c < 0.8 or quantity != 2_000
  end

  test "un cuarto de kilo is 250 g whatever the stock holds" do
    stock = [%{@plain_cheese | total_milli: 2_000_000}]

    assert {:ok, %{intent: %{quantity_milli: 250_000}, confidence: c}} =
             InventoryIntentParser.parse("usé un cuarto de kilo de queso", stock)

    assert c == 0.9

    assert {:ok, %{intent: %{quantity_milli: 250_000}}} =
             InventoryIntentParser.parse("usé un cuarto de litro de leche", [@milk])
  end

  test "the noun comida is not a consume verb" do
    assert {:ok, %{confidence: 0.7}} = parse("queso de la comida 200 g")
    assert {:ok, %{confidence: 0.9}} = parse("me comí 200 g de queso")
  end

  test "a bare count before a unit ingredient subtracts those units" do
    assert {:ok, %{intent: %{ingredient_id: "eggs", quantity_milli: 2_000}, confidence: c}} =
             parse("me comí 2 huevos")

    assert c >= 0.8
  end

  test "the longest matching name wins" do
    assert {:ok, %{intent: %{ingredient_id: "cheese"}}} = parse("terminé el queso crema")
    assert {:ok, %{intent: %{ingredient_id: "plain"}}} = parse("terminé el queso")
  end

  test "a name with a vague amount takes all the stock with low confidence" do
    assert {:ok, %{intent: %{ingredient_id: "milk", quantity_milli: 2_000_000}, confidence: c}} =
             parse("me tomé la leche")

    assert c < 0.8
    assert InventoryIntentParser.confirmation_required?(c)
  end

  test "an amount without a consume verb needs confirmation" do
    assert {:ok, %{confidence: c}} = parse("la mitad del queso crema")
    assert c < 0.8
  end

  test "an amount larger than the stock is capped and not confident" do
    assert {:ok, %{intent: %{quantity_milli: 400_000}, confidence: c}} =
             parse("usé 900 gramos de queso crema")

    assert c < 0.8
  end

  test "a quantity in another unit than the stock is not an amount" do
    assert {:ok, %{intent: %{ingredient_id: "milk", quantity_milli: 2_000_000}, confidence: c}} =
             parse("usé 200 gramos de leche")

    assert c < 0.8
  end

  test "accents and case do not matter" do
    assert {:ok, %{intent: %{ingredient_id: "milk"}}} = parse("ME COMÍ MEDIA LECHE")
  end

  test "nothing parseable fails" do
    assert {:error, :voice_parse_failed} = parse("no sé qué hice")
    assert {:error, :voice_parse_failed} = parse("me comí la mitad del jamón")
    assert {:error, :voice_parse_failed} = parse("")
    assert {:error, :voice_parse_failed} = InventoryIntentParser.parse("me comí el queso", [])
  end

  test "a name inside another word is not a mention" do
    assert {:error, :voice_parse_failed} =
             InventoryIntentParser.parse("usé quesos", [%{@cheese | name: "queso crema"}])
  end

  test "a plural inside a longer name matches the singular stock name" do
    assert {:ok, %{intent: intent, confidence: c}} =
             InventoryIntentParser.parse("me comí 2 huevos de campo", [@eggs, @field_eggs])

    assert %{ingredient_id: "field_eggs", name: "Huevo de campo", quantity_milli: 2_000} = intent
    assert c >= 0.8

    assert {:ok, %{intent: %{ingredient_id: "eggs", quantity_milli: 2_000}}} =
             InventoryIntentParser.parse("me comí 2 huevos", [@eggs, @field_eggs])
  end

  test "a plural that adds es or turns z into ces matches the singular stock name" do
    assert {:ok, %{intent: %{ingredient_id: "lemons", quantity_milli: 2_000}, confidence: c}} =
             InventoryIntentParser.parse("usé 2 limones", [@lemons, @walnuts])

    assert c >= 0.8

    assert {:ok, %{intent: %{ingredient_id: "walnuts", quantity_milli: 3_000}}} =
             InventoryIntentParser.parse("me comí 3 nueces", [@lemons, @walnuts])

    assert {:ok, %{intent: %{ingredient_id: "lemons", quantity_milli: 5_000}, confidence: 0.5}} =
             InventoryIntentParser.parse("terminé los limones", [@lemons, @walnuts])
  end

  test "a bare s still matches a name that ends in a consonant" do
    egg = %{@eggs | name: "Egg"}

    assert {:ok, %{intent: %{ingredient_id: "eggs", quantity_milli: 2_000}}} =
             InventoryIntentParser.parse("ate 2 eggs", [egg])
  end

  test "a longer word that only contains a stock name is not a mention" do
    assert {:error, :voice_parse_failed} =
             InventoryIntentParser.parse("me tomé una limonada", [@lemons])

    assert {:error, :voice_parse_failed} =
             InventoryIntentParser.parse("usé 2 limonadas", [@lemons])
  end

  test "a count before a longer word is not the count of the stock name" do
    assert {:ok, %{intent: %{ingredient_id: "lemons", quantity_milli: 1_000}}} =
             InventoryIntentParser.parse("usé 2 limonadas y 1 limón", [@lemons])
  end

  test "a plural of a name that is not in stock still fails" do
    assert {:error, :voice_parse_failed} =
             InventoryIntentParser.parse("me comí 2 huevos de codorniz", [@field_eggs, @lemons])

    assert {:error, :voice_parse_failed} =
             InventoryIntentParser.parse("usé 2 pomelos", [@field_eggs, @lemons])
  end

  test "the threshold is 0.8" do
    assert InventoryIntentParser.confirmation_threshold() == 0.8
    assert InventoryIntentParser.confirmation_required?(0.79)
    refute InventoryIntentParser.confirmation_required?(0.8)
  end
end
