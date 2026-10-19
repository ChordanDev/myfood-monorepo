defmodule MealPlannerApi.E2eConfigTest do
  @moduledoc """
  `config/config.exs` read for the `e2e` environment (issue #376). Its
  database has a variable of its own, so the `DB_NAME` a developer exports
  for `dev` never points the `e2e` seed and cleanup at the dev database.
  """
  use ExUnit.Case, async: false

  @config Path.expand("../../config/config.exs", __DIR__)
  @variables ~w(DB_NAME MYFOOD_E2E_DATABASE)

  setup do
    saved = Map.new(@variables, &{&1, System.get_env(&1)})

    on_exit(fn ->
      Enum.each(saved, fn
        {name, nil} -> System.delete_env(name)
        {name, value} -> System.put_env(name, value)
      end)
    end)

    Enum.each(@variables, &System.delete_env/1)
    :ok
  end

  test "the e2e database ignores the DB_NAME of dev" do
    System.put_env("DB_NAME", "meal_planner_api_dev")

    assert repo_database(:e2e) == "meal_planner_api_e2e"
  end

  test "MYFOOD_E2E_DATABASE names the e2e database" do
    System.put_env("MYFOOD_E2E_DATABASE", "myfood_local_e2e")

    assert repo_database(:e2e) == "myfood_local_e2e"
  end

  test "dev still reads DB_NAME" do
    System.put_env("DB_NAME", "meal_planner_api_dev_other")

    assert repo_database(:dev) == "meal_planner_api_dev_other"
  end

  defp repo_database(env) do
    @config
    |> Config.Reader.read!(env: env, target: :host)
    |> get_in([:meal_planner_api, MealPlannerApi.Repo, :database])
  end
end
