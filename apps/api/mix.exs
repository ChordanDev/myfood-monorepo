defmodule MealPlannerApi.MixProject do
  use Mix.Project

  def project do
    [
      app: :meal_planner_api,
      version: "0.1.0",
      elixir: "~> 1.15",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      aliases: aliases(),
      deps: deps(),
      docs: docs(),
      dialyzer: [
        plt_core_path: "priv/plts",
        plt_file: {:no_warn, "priv/plts/dialyzer.plt"},
        plt_add_apps: [:mix, :ex_unit],
        flags: [:error_handling, :extra_return]
      ],
      listeners: [Phoenix.CodeReloader]
    ]
  end

  defp docs do
    [
      extras: ["docs/CHANNELS.md"],
      main: "overview",
      api_reference: true,
      source_ref: "main",
      source_url: "https://github.com/your-org/meal_planner_api"
    ]
  end

  # Configuration for the OTP application.
  #
  # Type `mix help compile.app` for more information.
  def application do
    [
      mod: {MealPlannerApi.Application, []},
      extra_applications: [:logger, :runtime_tools, :inets, :ssl, :bamboo]
    ]
  end

  def cli do
    [
      preferred_envs: [precommit: :test]
    ]
  end

  # Specifies which paths to compile per environment.
  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  # Specifies your project dependencies.
  #
  # Type `mix help deps` for examples and options.
  defp deps do
    [
      {:phoenix, "~> 1.8.5"},
      {:telemetry_metrics, "~> 1.0"},
      {:telemetry_poller, "~> 1.0"},
      {:req, "~> 0.5"},
      {:jason, "~> 1.2"},
      {:guardian, "~> 2.4"},
      {:ecto_sql, "~> 3.12"},
      {:postgrex, ">= 0.0.0"},
      {:cors_plug, "~> 3.0"},
      {:dns_cluster, "~> 0.2.0"},
      {:bandit, "~> 1.5"},
      {:bamboo, "~> 2.3"},
      {:uuid, "~> 1.1"},
      {:tz, "~> 0.28"},
      {:mox, "~> 1.1", only: :test},
      {:ex_doc, "~> 0.36", only: :dev, runtime: false},
      {:tidewave, "~> 0.6", only: :dev},
      {:credo, "~> 1.7", only: [:dev, :test], runtime: false},
      {:sobelow, "~> 0.13", only: [:dev, :test], runtime: false},
      {:dialyxir, "~> 1.4", only: [:dev, :test], runtime: false}
    ]
  end

  # Aliases are shortcuts or tasks specific to the current project.
  # For example, to install project dependencies and perform other setup tasks, run:
  #
  #     $ mix setup
  #
  # See the documentation for `Mix` for more info on aliases.
  defp aliases do
    [
      setup: ["deps.get"],
      lint: ["credo --strict", "sobelow --config"],
      typecheck: ["dialyzer --format short"],
      precommit: ["compile --warnings-as-errors", "deps.unlock --unused", "format", "test"]
    ]
  end
end
