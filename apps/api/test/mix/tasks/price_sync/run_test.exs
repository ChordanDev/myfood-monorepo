defmodule Mix.Tasks.PriceSync.RunTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Catalog.UnitConversion
  alias MealPlannerApi.Repo
  alias Mix.Tasks.PriceSync.Run

  # Answers `fetch/1` from a script kept in the process dictionary: the task
  # runs in the test process, so the calls land there in order. An Ingredient
  # with no script (one already in the test database) gets no products, which
  # the task counts as skipped and leaves out of the exit code.
  defmodule ScriptedClient do
    def script(responses_by_name), do: Process.put(__MODULE__, responses_by_name)

    def calls(name), do: Process.get({__MODULE__, :calls, name}, 0)

    def fetch(name) do
      Process.put({__MODULE__, :calls, name}, calls(name) + 1)

      case Map.get(Process.get(__MODULE__), name, [{:ok, %{products: [], failed_scrapers: []}}]) do
        [response] ->
          response

        [response | rest] ->
          Process.put(__MODULE__, Map.put(Process.get(__MODULE__), name, rest))
          response
      end
    end
  end

  describe "mix price_sync.run" do
    test "task module is defined" do
      assert is_atom(Run)
    end

    test "has run/1 function (Mix.Task callback)" do
      assert is_function(&Run.run/1, 1)
    end

    # The task reads the Repo, so Mix has to start the app before it runs.
    test "starts the app before it runs" do
      assert "app.start" in Mix.Task.requirements(Run)
    end
  end

  describe "run/1 against the scraper client" do
    setup do
      :ok = Sandbox.checkout(Repo)

      previous_client = Application.get_env(:meal_planner_api, :go_scraper_client)
      Application.put_env(:meal_planner_api, :go_scraper_client, ScriptedClient)
      Mix.shell(Mix.Shell.Process)

      on_exit(fn ->
        Mix.shell(Mix.Shell.IO)

        if previous_client,
          do: Application.put_env(:meal_planner_api, :go_scraper_client, previous_client),
          else: Application.delete_env(:meal_planner_api, :go_scraper_client)
      end)

      :ok
    end

    defp priced_ingredient(name) do
      {:ok, ingredient} = Catalog.create_ingredient(%{name: name, category: :otros})
      # Inserted directly: `UnitConversionRepo.upsert_conversion/3` passes an
      # `on_conflict` value Ecto rejects (#417).
      {:ok, _} =
        %UnitConversion{}
        |> UnitConversion.changeset(%{
          ingredient_id: ingredient.id,
          from_unit: "kg",
          factor_to_base: 1.0
        })
        |> Repo.insert()

      ingredient
    end

    defp prices do
      {:ok,
       %{
         products: [
           %{
             source: "jumbo",
             name: "Arroz 1 kg",
             price: 1500.0,
             unit_price: 1500.0,
             unit: "kg",
             unavailable: false
           }
         ],
         failed_scrapers: []
       }}
    end

    test "retries a timed-out ingredient once and stores its price" do
      priced_ingredient("arroz")
      ScriptedClient.script(%{"arroz" => [{:error, :timeout}, prices()]})

      assert Run.run([]) == {:ok, 0}
      assert ScriptedClient.calls("arroz") == 2
      assert_received {:mix_shell, :info, ["  Retry 1 for 'arroz' (timeout)"]}
    end

    test "counts an ingredient that keeps timing out as failed and exits with 1" do
      priced_ingredient("arroz")
      ScriptedClient.script(%{"arroz" => [{:error, :timeout}]})

      assert catch_exit(Run.run([])) == {:shutdown, 1}
      assert ScriptedClient.calls("arroz") == 2
      assert_received {:mix_shell, :error, ["  ✗ Failed to fetch 'arroz': :timeout"]}
    end

    test "exits with 2 when some ingredients fail and others are stored" do
      priced_ingredient("arroz")
      priced_ingredient("fideos")

      ScriptedClient.script(%{
        "arroz" => [prices()],
        "fideos" => [{:error, :unreachable}]
      })

      assert catch_exit(Run.run([])) == {:shutdown, 2}
    end
  end
end
