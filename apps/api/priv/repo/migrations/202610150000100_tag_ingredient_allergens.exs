defmodule MealPlannerApi.Repo.Migrations.TagIngredientAllergens do
  @moduledoc """
  Tags the current Ingredient catalog with Hard restriction codes (issue #114).

  The catalog lives in the database (`mix ai_populate` fills it), so the tags
  come from the Ingredient name: one regular expression per code, matched on
  the lowercased name without accents. Only untagged rows
  (`allergens IS NULL`) are written, and a name that matches no rule stays
  NULL: nobody has reviewed it, so the planner keeps treating it as carrying
  every code. `[]` is only ever written by a human.

  Most rules match a root and whatever follows it (`bizcoch` matches
  `bizcochitos`), so diminutives and plurals are caught. The rules lean
  towards tagging: a recipe dropped by a wrong tag is a worse plan, a recipe
  kept by a missing tag is a safety defect. Phrases that name something else
  (`harina de maiz`, `leche de almendras`, `pasta de mani`, anything
  `sin TACC`) are removed from the name before a rule matches, and only for
  that rule.

  A human reviews every tag before this ships: `preview_sql/0` lists the tags
  this migration would write, without writing them.

  Rolling back sets every `allergens` back to NULL (not reviewed).
  """
  use Ecto.Migration

  # Accented capitals are folded by `translate` too: `lower` leaves them as
  # they are under the C collation.
  @normalized_name "translate(lower(name), 'áéíóúüñàèìòùâêîôûäëïöçÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÄËÏÖÇ', 'aeiouunaeiouaeiouaeiocaeiouunaeiouaeiouaeioc')"

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
        ~S"\m(lechit|lacte|ques|requeson|ricot|moz+arel|muz+arel|parmesan|reggianit|provol|roquefort|mascarpon|cheddar|fontina|gruyer|camembert|gouda|fynbo|pategras|cuartirol|danbo|emmental|gorgonzol|halloumi|manchego|burrat|pecorin|stracchin|casancrem|mantec|mantequill|crem|yogur|suero|whey|casein|lactosa|kefir|helad|postrecit|chocolat|bombon|chantilly|bechamel|carbonara|capuchin|chipa|nutella|pesto|ghee|fraiche|alfajor|panqueq|crepe|scon)\w*|\m(leches?|natas?|brie|edam|feta|sardo|flan|flanes)\M|grana padano|port salut|dulce de leche|salsa blanca|formulas? infantil(es)?",
      strip:
        ~S"leches? de (coco|almendras?|soja|soya|avena|arroz|castanas?|mani|caju)|(manteca|mantequilla) de (mani|cacao|cerdo)|crema de (mani|coco)|cremor tartaro"
    },
    %{
      code: "egg",
      match:
        ~S"\m(huevo|yema|mayones|alioli|aioli|ovoalbum|albumin|merengu|vainill|bizcochuel|budin|magdalen|pionon|browni|cupcake|tort|raviol|sorrentin|canelon|capel|cappel|tortelin|tortellin|agnolot|lasagn|lasan|noqui|panqueq|crepe|omelet|alfajor|chipa|milanes|rebozad|apanad|nugget|scon)\w*|\m(huevos?|claras?|mayo|caesar|cesar|flan|flanes)\M|salsa golf",
      strip: ~S"(esencia|extracto|aroma) de vainilla"
    },
    %{
      code: "soy",
      match:
        ~S"\m(soja|soya|tofu|tempeh|edamame|miso|natto|okara|shoyu|tamari|teriyaki|lecitin|texturizad)\w*|formulas? infantil(es)?",
      strip: nil
    }
  ]

  def up do
    execute(tag_sql())
  end

  def down do
    execute("UPDATE ingredients SET allergens = NULL")
  end

  @doc "Tags every Ingredient whose `allergens` is NULL and whose name matches a rule."
  def tag_sql do
    "UPDATE ingredients SET allergens = #{allergens_expression()} WHERE allergens IS NULL"
  end

  @doc """
  The tags `tag_sql/0` would write, one row per untagged Ingredient. NULL
  means no rule matched and the row stays untagged.
  """
  def preview_sql do
    "SELECT name, #{allergens_expression()} AS allergens FROM ingredients " <>
      "WHERE allergens IS NULL ORDER BY name"
  end

  defp allergens_expression do
    cases =
      Enum.map_join(@rules, ",\n  ", fn rule ->
        "CASE WHEN #{condition(rule)} THEN '#{rule.code}' END"
      end)

    # NULLIF keeps a name no rule matched at NULL: only a human writes `[]`.
    "NULLIF(array_remove(ARRAY[\n  #{cases}\n]::varchar[], NULL), '{}')"
  end

  defp condition(%{match: match, strip: nil}), do: "#{@normalized_name} ~ '#{match}'"

  defp condition(%{match: match, strip: strip}),
    do: "regexp_replace(#{@normalized_name}, '#{strip}', ' ', 'g') ~ '#{match}'"
end
