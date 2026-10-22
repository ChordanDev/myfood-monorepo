defmodule Mix.Tasks.AiPopulateTest do
  use ExUnit.Case, async: false

  import Ecto.Query, warn: false
  import ExUnit.CaptureLog

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Catalog.Ingredient
  alias MealPlannerApi.Repo
  alias Mix.Tasks.AiPopulate

  defmodule StubClient do
    @moduledoc false
    def generate_text(prompt, _opts) do
      send(Application.fetch_env!(:meal_planner_api, :ai_populate_test_owner), {:prompt, prompt})
      {:ok, Application.fetch_env!(:meal_planner_api, :ai_populate_test_answer)}
    end
  end

  @args ~w(--only-category otros --max-topics 1 --per-topic 5 --sleep-ms 0)

  setup do
    :ok = Sandbox.checkout(Repo)

    previous_client = Application.get_env(:meal_planner_api, :ai_client)
    Application.put_env(:meal_planner_api, :ai_client, StubClient)
    Application.put_env(:meal_planner_api, :ai_populate_test_owner, self())
    previous_level = Logger.level()
    Logger.configure(level: :info)

    on_exit(fn ->
      Logger.configure(level: previous_level)
      Application.put_env(:meal_planner_api, :ai_client, previous_client)
      Application.delete_env(:meal_planner_api, :ai_populate_test_owner)
      Application.delete_env(:meal_planner_api, :ai_populate_test_answer)
    end)
  end

  test "asks the AI for the allergens of each item, drawn from the Ingredient codes" do
    answer([item("Huevos de campo", ["egg"])])

    capture_log(fn -> AiPopulate.run(@args) end)

    assert_received {:prompt, prompt}
    assert prompt =~ "allergens"

    assert prompt =~
             "peanut, tree_nut, shellfish, gluten, dairy, egg, soy, meat, fish, animal_product"
  end

  test "saves the union of the AI codes and the name-rule codes as the proposal, leaving allergens NULL" do
    answer([
      item("Pan rallado", ["egg"]),
      item("Rogel", ["gluten", "dairy", "egg"])
    ])

    capture_log(fn -> AiPopulate.run(@args) end)

    assert ingredient!("Pan rallado") |> Map.take([:allergens, :allergens_proposed]) ==
             %{allergens: nil, allergens_proposed: ["gluten", "egg"]}

    assert ingredient!("Rogel") |> Map.take([:allergens, :allergens_proposed]) ==
             %{allergens: nil, allergens_proposed: ["gluten", "dairy", "egg"]}
  end

  test "proposes the Diet marks the AI names, leaving allergens NULL" do
    answer([
      item("Bife de chorizo", ["meat"]),
      item("Merluza rebozada", ["fish"]),
      item("Miel", ["animal_product"])
    ])

    capture_log(fn -> AiPopulate.run(@args) end)

    assert ingredient!("Bife de chorizo") |> Map.take([:allergens, :allergens_proposed]) ==
             %{allergens: nil, allergens_proposed: ["meat"]}

    assert ingredient!("Merluza rebozada").allergens_proposed == ["gluten", "egg", "fish"]
    assert ingredient!("Miel").allergens_proposed == ["animal_product"]
  end

  test "drops an unknown AI code with a warning and still saves the item" do
    answer([item("Merluza congelada", ["sesame", "gluten"])])

    log = capture_log(fn -> AiPopulate.run(@args) end)

    assert ingredient!("Merluza congelada").allergens_proposed == ["gluten"]
    assert log =~ ~s("sesame")
  end

  test "saves an item without the allergens key, or with an invalid one, with the name-rule proposal only" do
    answer([
      Map.delete(item("Ravioles de verdura", []), "allergens"),
      item("Tomate perita", "dairy")
    ])

    capture_log(fn -> AiPopulate.run(@args) end)

    assert ingredient!("Ravioles de verdura").allergens_proposed == ["gluten", "egg"]
    assert ingredient!("Tomate perita").allergens_proposed == []
  end

  test "re-running leaves the allergens and the proposal of a reviewed Ingredient unchanged" do
    {:ok, _} =
      Catalog.create_ingredient(%{
        name: "Queso cremoso",
        category: :lacteos,
        allergens: ["dairy"],
        allergens_proposed: ["dairy"]
      })

    answer([item("Queso cremoso", ["soy"])])

    capture_log(fn -> AiPopulate.run(@args) end)

    assert ingredient!("Queso cremoso") |> Map.take([:allergens, :allergens_proposed]) ==
             %{allergens: ["dairy"], allergens_proposed: ["dairy"]}
  end

  test "re-running adds to the proposal of an Ingredient nobody reviewed, dropping no code" do
    {:ok, _} =
      Catalog.create_ingredient(%{
        name: "Tofu firme",
        category: :otros,
        allergens_proposed: ["dairy"]
      })

    answer([item("Tofu firme", ["gluten"])])

    capture_log(fn -> AiPopulate.run(@args) end)

    assert ingredient!("Tofu firme") |> Map.take([:allergens, :allergens_proposed]) ==
             %{allergens: nil, allergens_proposed: ["gluten", "dairy", "soy"]}
  end

  test "logs how many Ingredients are still unreviewed at the end of the run" do
    {:ok, _} = Catalog.create_ingredient(%{name: "Reviewed", category: :otros, allergens: []})
    answer([item("Lentejas", []), item("Garbanzos", [])])

    log = capture_log(fn -> AiPopulate.run(@args) end)

    assert log =~ "Ingredientes sin revisar: 2"
  end

  defp answer(items),
    do: Application.put_env(:meal_planner_api, :ai_populate_test_answer, Jason.encode!(items))

  defp item(name, allergens) do
    %{
      "name" => name,
      "calories_per_100" => 100,
      "protein_g_per_100" => 1,
      "carbs_g_per_100" => 1,
      "fat_g_per_100" => 1,
      "allergens" => allergens
    }
  end

  defp ingredient!(name), do: Repo.one!(from(i in Ingredient, where: i.name == ^name))
end
