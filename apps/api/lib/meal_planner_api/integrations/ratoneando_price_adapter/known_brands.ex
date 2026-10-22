defmodule MealPlannerApi.Integrations.RatoneandoPriceAdapter.KnownBrands do
  @moduledoc """
  The brands `RatoneandoPriceAdapter` recognizes in a product name.

  Ratoneando returns no brand, so the adapter reads it from the name with this
  list. A name that contains none of these brands gets an empty brand: the
  adapter never guesses one.

  The list is documented in `docs/PRICE_ADAPTER_CONTRACT.md`; a test fails when
  a brand here is missing from that document. Leave out brands that are also
  common words or phrases in product names (such as "Disco", "Dia", "Vea",
  "Ser", or "Noel", found in "Papá Noel"), since they would match names that do
  not carry the brand.
  """

  @brands [
    "Amanda",
    "Arcor",
    "Baggio",
    "Bagley",
    "Blancaflor",
    "Cabrales",
    "Cada Día",
    "Cagnoli",
    "Calchaquí",
    "Cañuelas",
    "Carrefour",
    "Casancrem",
    "Cepita",
    "Chango",
    "Cica",
    "Coca-Cola",
    "Cocinero",
    "Cuisine & Co",
    "Danone",
    "Dánica",
    "Dolca",
    "Don Vicente",
    "Dos Hermanos",
    "Eco de los Andes",
    "Fanacoa",
    "Favorita",
    "Finlandia",
    "Gallo",
    "Granja del Sol",
    "Hellmann's",
    "Ilolay",
    "Inca",
    "Knorr",
    "La Campagnola",
    "La Paulina",
    "La Serenísima",
    "La Virginia",
    "Ledesma",
    "Levité",
    "Lira",
    "Lucchetti",
    "Maggi",
    "Marolio",
    "Matarazzo",
    "McCain",
    "Milkaut",
    "Molto",
    "Morixe",
    "Natura",
    "Nescafé",
    "Paladini",
    "Paty",
    "Pepsi",
    "Playadito",
    "Pureza",
    "Quilmes",
    "Rosamonte",
    "Sancor",
    "Savora",
    "Swift",
    "Taragüí",
    "Terrabusi",
    "Tonadita",
    "Tregar",
    "Verónica",
    "Villa del Sur",
    "Villavicencio",
    "Yogurísimo"
  ]

  defmodule Text do
    @moduledoc false

    # Lowercase words without accents, joined by single spaces. Apostrophes are
    # dropped so "Hellmann's" and "Hellmanns" read the same.
    def normalize(text) do
      text
      |> String.normalize(:nfd)
      |> String.replace(~r/\p{Mn}/u, "")
      |> String.downcase()
      |> String.replace(~r/['’]/u, "")
      |> String.replace(~r/[^a-z0-9]+/, " ")
      |> String.trim()
    end
  end

  # Each brand is normalized once, at compile time, so matching a product
  # normalizes only its name.
  @patterns Enum.map(@brands, &{" #{Text.normalize(&1)} ", &1})

  @doc "Every known brand, as it is displayed."
  @spec all() :: [String.t()]
  def all, do: @brands

  @doc """
  The known brand in a product name, or `""` when there is none.

  Case, accents and punctuation are ignored, and a brand matches only as whole
  words, so "Inca" is not found in "Incaicas". When the name holds several
  brands, the one that appears first wins; at the same position, the longest.

      iex> KnownBrands.match("LECHE ENTERA LA SERENISIMA 1 L")
      "La Serenísima"

      iex> KnownBrands.match("Arroz largo fino 1 kg")
      ""
  """
  @spec match(String.t()) :: String.t()
  def match(name) when is_binary(name) do
    padded_name = " #{Text.normalize(name)} "

    @patterns
    |> Enum.flat_map(fn {pattern, brand} ->
      case :binary.match(padded_name, pattern) do
        {position, length} -> [{position, -length, brand}]
        :nomatch -> []
      end
    end)
    |> Enum.min(fn -> {nil, nil, ""} end)
    |> elem(2)
  end

  def match(_name), do: ""
end
