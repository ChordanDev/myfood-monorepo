defmodule MealPlannerApi.Voice.InventoryIntentParserTest do
  use ExUnit.Case, async: true

  alias MealPlannerApi.Voice.InventoryIntentParser

  @cheese %{ingredient_id: "cheese", name: "Queso crema", unit: :g, total_milli: 400_000}
  @plain_cheese %{ingredient_id: "plain", name: "Queso", unit: :g, total_milli: 900_000}
  @eggs %{ingredient_id: "eggs", name: "Huevo", unit: :unit, total_milli: 6_000}
  @milk %{ingredient_id: "milk", name: "Leche", unit: :ml, total_milli: 2_000_000}
  @stock [@cheese, @plain_cheese, @eggs, @milk]

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

  test "the threshold is 0.8" do
    assert InventoryIntentParser.confirmation_threshold() == 0.8
    assert InventoryIntentParser.confirmation_required?(0.79)
    refute InventoryIntentParser.confirmation_required?(0.8)
  end
end
