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

  @normalized_name "translate(lower(name), 'áéíóúüñ', 'aeiouun')"

  # Catalog order of `UserHardRestriction.codes/0`. `strip` is removed from
  # the name before `match` runs.
  @rules [
    %{
      code: "peanut",
      match: ~S"\m(mani|manies|cacahuates?|cacahuetes?)\M|frutos secos|frutas secas",
      strip: nil
    },
    %{
      code: "tree_nut",
      match:
        ~S"\m(nuez|nueces|almendras?|avellanas?|castanas?|pistachos?|caju|cajus|anacardos?|pecan|pecanas?|macadamias?|pinones?|praline|mazapan|turron|turrones)\M|frutos secos|frutas secas",
      strip: nil
    },
    %{
      code: "shellfish",
      match:
        ~S"\m(camaron|camarones|langostinos?|langostas?|cangrejos?|centollas?|centollon|mejillon|mejillones|almejas?|ostras?|ostion|ostiones|vieiras?|calamar|calamares|calamaretis?|pulpos?|sepias?|berberechos?|cholgas?|mariscos?|kani|kanikama|surimi|rabas)\M|frutos de mar",
      strip: nil
    },
    %{
      code: "gluten",
      match:
        ~S"\m(trigo|harinas?|pan|panes|pancitos?|panificados?|fideos?|pastas?|spaghettis?|espaguetis?|tallarin|tallarines|ravioles|raviolis?|noquis|gnocchis?|lasagnas?|lasanas?|canelones|sorrentinos|capelettis?|masas?|prepizzas?|pizzas?|galletitas?|galletas?|bizcochuelos?|bizcochos?|budin|budines|magdalenas?|piononos?|tostadas?|grisines|rebozador|semolas?|avenas?|cebadas?|centeno|malta|cervezas?|seitan|cuscus|couscous|bulgur|espelta|alfajor|alfajores|obleas?|vainillas?|facturas?|medialunas?|croissants?|milanesas?|empanadas?|empanados?|rebozados?|premezclas?|tortillas?|tartas?|tartaletas?|wafles?|waffles?|crackers?|salvado|cereales?)\M|tapas? (de|para) (empanadas?|tartas?|pascualinas?)|salsa de soja|salsa de soya",
      strip:
        ~S"^.*\m(sin tacc|sin gluten)\M.*$|harinas? de (maiz|arroz|mandioca|garbanzos?|almendras?|coco|papa|soja|lentejas?)|galle(titas?|tas?) de arroz|pastas? de (mani|avellanas?|almendras?|aceitunas?|sesamo|tomate|dientes)"
    },
    %{
      code: "dairy",
      match:
        ~S"\m(leches?|lacteos?|lacteados?|quesos?|ricotas?|ricottas?|mozzarellas?|muzzarellas?|muzarellas?|parmesano|reggianito|sardo|provolone|provoleta|roquefort|mascarpone|cheddar|fontina|gruyere|brie|camembert|gouda|edam|fynbo|pategras|casancrem|mantecas?|mantequillas?|cremas?|yogur|yogures|yogurt|yogurts|nata|suero|caseinas?|caseinatos?|lactosa|kefir|helados?|flan|flanes|chocolates?|bombon|bombones|chantilly|bechamel|ghee)\M|dulce de leche",
      strip:
        ~S"leches? de (coco|almendras?|soja|soya|avena|arroz|castanas?|mani|caju)|manteca de (mani|cacao|cerdo)|crema de (mani|coco)"
    },
    %{
      code: "egg",
      match:
        ~S"\m(huevos?|claras?|yemas?|mayonesas?|merengues?|flan|flanes|vainillas?|bizcochuelos?|budin|budines|magdalenas?|piononos?|tortillas?|ravioles|raviolis?|sorrentinos|canelones|capelettis?|lasagnas?|lasanas?|noquis|panqueques?|crepes?|omelette|alfajor|alfajores)\M|salsa golf",
      strip: nil
    },
    %{
      code: "soy",
      match: ~S"\m(soja|soya|tofu|tempeh|edamame|miso|texturizad[oa]s?)\M",
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
