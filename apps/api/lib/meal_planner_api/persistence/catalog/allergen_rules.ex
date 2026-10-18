defmodule MealPlannerApi.Persistence.Catalog.AllergenRules do
  @moduledoc """
  The Hard restriction codes an Ingredient name names (issue #302).

  The rules are a copy of the `@rules` of the tag migration
  (`20261015130010_tag_ingredient_allergens.exs`), which keeps its own frozen
  copy: a migration must not change behaviour when application code changes.
  They are written in PostgreSQL regular expression syntax so the two copies
  stay easy to compare; `\\m` and `\\M` (start and end of a word) become `\\b`
  here, which is the same thing next to a word character.

  The codes are a proposal, never a review. A name no rule recognises (a brand
  or a dish such as "Rogel") gives `[]`, which says nothing about what it
  contains, so `codes_for_name/1` must never be written into `allergens`.
  """

  @accented "áéíóúüñàèìòùâêîôûäëïöç"
  @plain "aeiouunaeiouaeiouaeioc"
  @folding Enum.zip(String.graphemes(@accented), String.graphemes(@plain)) |> Map.new()

  # Catalog order of `UserHardRestriction.codes/0`. In `match`, a root in the
  # first group matches any word that starts with it; a word in the second
  # group matches only as a whole word. `strip` is removed from the name
  # before `match` runs.
  @rules [
    %{
      code: "peanut",
      match:
        ~S"\m(cacahuat|cacahuet|garrapin|mantecol|granola)\w*|\m(mani|manies)\M|frutos secos|frutas secas|barras? de cereal",
      strip: nil
    },
    %{
      code: "tree_nut",
      match:
        ~S"\m(nuez|nuec|almendr|avellan|castan|pistach|caju|anacard|pecan|macadami|pinon|pralin|mazapan|marzipan|amaretto|turron|nutella|pesto|granola)\w*|frutos secos|frutas secas|barras? de cereal",
      strip: ~S"nuez moscada"
    },
    %{
      code: "shellfish",
      match:
        ~S"\m(camaron|langost|cangrej|centoll|mejillon|almej|ostra|ostion|oyster|vieir|calamar|sepia|berberech|cholg|gamba|percebe|cigala|bogavant|jaiba|krill|abulon|marisc|kani|surimi|rabas)\w*|\m(pulpos?|pulpitos?)\M|frutos de?l? mar",
      strip: nil
    },
    %{
      code: "gluten",
      match:
        ~S"\m(trigo|harin|fide|pasta|spag|espag|tallar|penne|rigaton|mostachol|tirabuzon|codit|fusill|farfall|fettucc|raviol|noqui|gnocch|lasagn|lasan|canelon|sorrentin|capel|cappel|tortelin|tortellin|agnolot|ramen|masa|masit|prepizz|pizz|pascualin|hojaldr|bagel|baguet|brioch|focacc|sandwich|wrap|nacho|galle|cookie|cremon|criollit|pepit|rellenit|bizcoch|budin|magdalen|pionon|browni|cupcake|muffin|churro|tort|tostadit|grisin|rebozad|semol|avena|cebad|centeno|cervez|seitan|cuscus|couscous|bulgur|burgol|espelta|kamut|triticale|alfajor|oblea|vainill|factura|medialun|croissant|milanes|empanad|apanad|nugget|medallon|premezcl|tartalet|wafle|waffle|cracker|salvado|cereal|copos|granola|teriyaki|shoyu|hoisin|worcestershire|scon|palmerit|rosquit|rosquill|rosca|chocolin|sacrament|panqueq|crepe)\w*|\m(pan|panes|pancit[oa]s?|panecillos?|panificad[oa]s?|panko|tacos?|donas?|pepas?|malta|migas?|paty|patitas|oreos?|tostadas?|tartas?)\M|tapas? (de|para) (empanadas?|tartas?|pascualinas?)|salsa de so[jy]a|salsa inglesa",
      strip:
        ~S"^.*\m(sin tacc|sin gluten)\M.*$|harinas? de (maiz|arroz|mandioca|garbanzos?|almendras?|coco|papa|soja|lentejas?)|(galle(titas?|tas?)|fideos?|tostadas?) de arroz|pastas? de (mani|avellanas?|almendras?|aceitunas?|sesamo|tomate|dientes|ajo|curry|anchoas?|miso|camarones|garbanzos?)|(esencia|extracto|aroma) de vainilla"
    },
    %{
      code: "dairy",
      match:
        ~S"\m(lechit|lacte|ques|requeson|ricot|moz+arel|muz+arel|parmesan|reggianit|provol|roquefort|mascarpon|cheddar|fontina|gruyer|camembert|gouda|fynbo|pategras|cuartirol|danbo|emmental|gorgonzol|halloumi|manchego|burrat|pecorin|stracchin|casancrem|mantec|mantequill|crem|yogur|suero|whey|casein|lactosa|kefir|helad|postrecit|chocolat|bombon|chantilly|bechamel|carbonara|capuchin|chipa|nutella|pesto|ghee|fraiche|alfajor|panqueq|crepe|scon|masit|palmerit|rosquit|chocolin|sacrament)\w*|\m(leches?|natas?|brie|edam|feta|sardo|flan|flanes|pepas?)\M|grana padano|port salut|dulce de leche|salsa blanca|formulas? infantil(es)?",
      strip:
        ~S"leches? de (coco|almendras?|soja|soya|avena|arroz|castanas?|mani|caju)|(manteca|mantequilla) de (mani|cacao|cerdo)|crema de (mani|coco)|cremor tartaro"
    },
    %{
      code: "egg",
      match:
        ~S"\m(huevo|yema|mayones|alioli|aioli|ovoalbum|albumin|merengu|vainill|bizcochuel|budin|magdalen|pionon|browni|cupcake|tort|raviol|sorrentin|canelon|capel|cappel|tortelin|tortellin|agnolot|lasagn|lasan|noqui|panqueq|crepe|omelet|alfajor|chipa|milanes|rebozad|apanad|nugget|scon|masit|palmerit|rosquit|chocolin|sacrament)\w*|\m(huevos?|claras?|mayo|caesar|cesar|flan|flanes|pepas?)\M|salsa golf",
      strip: ~S"(esencia|extracto|aroma) de vainilla"
    },
    %{
      code: "soy",
      match:
        ~S"\m(soja|soya|tofu|tempeh|edamame|miso|natto|okara|shoyu|tamari|teriyaki|lecitin|texturizad)\w*|formulas? infantil(es)?",
      strip: nil
    }
  ]

  @doc """
  The codes whose rule matches `name`, in catalog order. The name is matched
  lowercased and without accents, as the tag migration matches it.
  """
  @spec codes_for_name(String.t()) :: [String.t()]
  def codes_for_name(name) when is_binary(name) do
    normalized = normalize(name)

    for rule <- @rules, matches?(rule, normalized), do: rule.code
  end

  defp matches?(%{match: match, strip: nil}, name), do: Regex.match?(compile(match), name)

  defp matches?(%{match: match, strip: strip}, name),
    do: Regex.match?(compile(match), Regex.replace(compile(strip), name, " "))

  # `u` makes `\w` and `\b` Unicode-aware; `s` lets `.` match a newline, as
  # it does in PostgreSQL.
  defp compile(source),
    do: source |> String.replace([~S"\m", ~S"\M"], ~S"\b") |> Regex.compile!("us")

  defp normalize(name) do
    name
    |> :unicode.characters_to_nfc_binary()
    |> String.downcase()
    |> String.graphemes()
    |> Enum.map_join(&Map.get(@folding, &1, &1))
  end
end
