defmodule MealPlannerApi.Repo.Migrations.TagIngredientAllergens do
  @moduledoc """
  Tags the current Ingredient catalog with Hard restriction codes (issue #114).

  The catalog lives in the database (`mix ai_populate` fills it), so the tags
  come from the Ingredient name: one regular expression per code, matched on
  the lowercased name without accents. A name that matches no rule gets `[]`.
  Only untagged rows (`allergens IS NULL`) are written.

  The rules lean towards tagging: a recipe dropped by a wrong tag is a worse
  plan, a recipe kept by a missing tag is a safety defect. Phrases that name
  something else (`harina de maiz`, `leche de almendras`, `pasta de mani`,
  anything `sin TACC`) are removed from the name before a rule matches, and
  only for that rule.

  A human reviews every tag before this ships: `preview_sql/0` lists the tags
  this migration would write, without writing them.

  Rolling back sets every `allergens` back to NULL (not reviewed).
  """
  use Ecto.Migration

  # Accented capitals are folded by `translate` too: `lower` leaves them as
  # they are under the C collation.
  @normalized_name "translate(lower(name), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun')"

  # Catalog order of `UserHardRestriction.codes/0`. `strip` is removed from
  # the name before `match` runs.
  @rules [
    %{
      code: "peanut",
      match:
        ~S"\m(mani|manies|cacahuates?|cacahuetes?|garrapinadas?|mantecol|granolas?)\M|frutos secos|frutas secas|barras? de cereal",
      strip: nil
    },
    %{
      code: "tree_nut",
      match:
        ~S"\m(nuez|nueces|almendras?|almendrad[oa]s?|avellanas?|castanas?|pistachos?|caju|cajus|anacardos?|pecan|pecanas?|macadamias?|pinones?|praline|mazapan|marzipan|amaretto|turron|turrones|nutella|pesto|granolas?)\M|frutos secos|frutas secas|barras? de cereal",
      strip: ~S"nuez moscada"
    },
    %{
      code: "shellfish",
      match:
        ~S"\m(camaron|camarones|langostinos?|langostas?|cangrejos?|centollas?|centollon|mejillon|mejillones|almejas?|ostras?|ostion|ostiones|oyster|vieiras?|calamar|calamares|calamaretis?|pulpos?|pulpitos?|sepias?|berberechos?|cholgas?|gambas?|percebes?|cigalas?|bogavantes?|jaibas?|krill|abulon|mariscos?|mariscadas?|kani|kanikama|surimi|rabas)\M|frutos de?l? mar",
      strip: nil
    },
    %{
      code: "gluten",
      match:
        ~S"\m(trigo|harinas?|pan|panes|pancitos?|panificados?|fideos?|pastas?|spaghettis?|spaguettis?|espaguetis?|tallarin|tallarines|penne|rigatonis?|mostachol|mostacholes|tirabuzon|tirabuzones|coditos?|fusillis?|farfalles?|fettuccines?|ravioles|raviolis?|noquis?|gnocchis?|lasagnas?|lasanas?|canelones|sorrentinos|capelettis?|capeletis?|cappellettis?|tortelinis?|tortellinis?|agnolottis?|ramen|masas?|prepizzas?|pizzas?|pizzetas?|pascualinas?|hojaldres?|bagels?|baguettes?|brioches?|focaccias?|sandwich|sandwiches|miga|wraps?|tacos?|nachos?|galletitas?|galletas?|cookies?|oreo|cremonas?|criollitos?|pepitos?|rellenitas?|bizcochuelos?|bizcochos?|budin|budines|magdalenas?|piononos?|brownies?|cupcakes?|muffins?|donas?|churros?|tortas?|tostadas?|grisines|rebozador|semolas?|avenas?|cebadas?|centeno|malta|cervezas?|seitan|cuscus|couscous|bulgur|espelta|kamut|triticale|alfajor|alfajores|obleas?|vainillas?|facturas?|medialunas?|croissants?|milanesas?|empanad[oa]s?|rebozad[oa]s?|apanad[oa]s?|nuggets?|patitas|paty|medallon|medallones|premezclas?|tortillas?|tartas?|tartaletas?|wafles?|waffles?|crackers?|salvado|cereal|cereales|copos|granolas?|teriyaki|shoyu|hoisin|worcestershire)\M|tapas? (de|para) (empanadas?|tartas?|pascualinas?)|salsa de soja|salsa de soya|salsa inglesa",
      strip:
        ~S"^.*\m(sin tacc|sin gluten)\M.*$|harinas? de (maiz|arroz|mandioca|garbanzos?|almendras?|coco|papa|soja|lentejas?)|(galle(titas?|tas?)|fideos?|tostadas?) de arroz|pastas? de (mani|avellanas?|almendras?|aceitunas?|sesamo|tomate|dientes|ajo|curry|anchoas?|miso|camarones|garbanzos?)|(esencia|extracto|aroma) de vainilla"
    },
    %{
      code: "dairy",
      match:
        ~S"\m(leches?|lacteos?|lacteas?|lacteados?|quesos?|ricotas?|ricottas?|moz+arel+as?|muz+arel+as?|parmesano|reggianito|sardo|provolone|provoleta|roquefort|mascarpone|cheddar|fontina|gruyere|brie|camembert|gouda|edam|fynbo|pategras|cuartirolo|danbo|emmental|feta|gorgonzola|grana padano|halloumi|manchego|burrata|pecorino|stracchino|casancrem|mantecas?|mantequillas?|cremas?|yogur|yogures|yogurt|yogurts|nata|suero|whey|caseinas?|caseinatos?|lactosa|kefir|helados?|flan|flanes|postrecitos?|chocolates?|bombon|bombones|chantilly|bechamel|carbonara|capuchinos?|chipa|nutella|pesto|ghee)\M|dulce de leche|salsa blanca|formulas? infantil(es)?",
      strip:
        ~S"leches? de (coco|almendras?|soja|soya|avena|arroz|castanas?|mani|caju)|(manteca|mantequilla) de (mani|cacao|cerdo)|crema de (mani|coco)"
    },
    %{
      code: "egg",
      match:
        ~S"\m(huevos?|claras?|yemas?|mayonesas?|mayo|alioli|aioli|caesar|cesar|ovoalbuminas?|albuminas?|merengues?|flan|flanes|vainillas?|bizcochuelos?|budin|budines|magdalenas?|piononos?|brownies?|cupcakes?|tortas?|tortillas?|ravioles|raviolis?|sorrentinos|canelones|capelettis?|capeletis?|cappellettis?|tortelinis?|tortellinis?|agnolottis?|lasagnas?|lasanas?|noquis?|panqueques?|crepes?|omelette|alfajor|alfajores|chipa|milanesas?|rebozad[oa]s?|apanad[oa]s?|nuggets?)\M|salsa golf",
      strip: ~S"(esencia|extracto|aroma) de vainilla"
    },
    %{
      code: "soy",
      match:
        ~S"\m(soja|soya|tofu|tempeh|edamame|miso|natto|okara|shoyu|tamari|teriyaki|lecitinas?|texturizad[oa]s?)\M|formulas? infantil(es)?",
      strip: nil
    }
  ]

  def up do
    execute(tag_sql())
  end

  def down do
    execute("UPDATE ingredients SET allergens = NULL")
  end

  @doc "Tags every Ingredient whose `allergens` is NULL."
  def tag_sql do
    "UPDATE ingredients SET allergens = #{allergens_expression()} WHERE allergens IS NULL"
  end

  @doc "The tags `tag_sql/0` would write, one row per untagged Ingredient."
  def preview_sql do
    "SELECT name, #{allergens_expression()} AS allergens FROM ingredients " <>
      "WHERE allergens IS NULL ORDER BY name"
  end

  defp allergens_expression do
    cases =
      Enum.map_join(@rules, ",\n  ", fn rule ->
        "CASE WHEN #{condition(rule)} THEN '#{rule.code}' END"
      end)

    "array_remove(ARRAY[\n  #{cases}\n]::varchar[], NULL)"
  end

  defp condition(%{match: match, strip: nil}), do: "#{@normalized_name} ~ '#{match}'"

  defp condition(%{match: match, strip: strip}),
    do: "regexp_replace(#{@normalized_name}, '#{strip}', ' ', 'g') ~ '#{match}'"
end
