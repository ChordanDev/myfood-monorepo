# This file is responsible for configuring your application
# and its dependencies with the aid of the Config module.
#
# This configuration file is loaded before any dependency and
# is restricted to this project.

# General application configuration
import Config

config :meal_planner_api,
  generators: [timestamp_type: :utc_datetime]

config :meal_planner_api,
  ecto_repos: [MealPlannerApi.Repo]

# Token lifetimes per `typ` claim (issue #1, "Token lifetimes"): access
# tokens (legacy `access` and `access_v2`) live 1 hour, refresh tokens 30
# days. Guardian resolves the TTL from the minted `typ`, so the three
# entries must stay aligned with the typ values minted in
# `MealPlannerApiWeb.Controllers.AccountScopeHelpers.mint_token_pair/2`.
config :meal_planner_api, MealPlannerApi.Auth.Guardian,
  issuer: "meal_planner_api",
  token_ttl: %{
    "access" => {1, :hour},
    "access_v2" => {1, :hour},
    "refresh" => {30, :days}
  }

# How long after a refresh token was rotated the same token is still
# accepted, for a phone that never received the answer (issue #57). `0`
# turns the tolerance off: a rotated token is then always a replay.
config :meal_planner_api,
  refresh_retry_window_seconds: 10

config :meal_planner_api,
  ai_client: MealPlannerApi.AI.GeminiClient

config :meal_planner_api,
  planning_optimizer_client: MealPlannerApi.Optimization.OptimizerServer,
  start_optimizer_server: true,
  optimizer_python: "python3",
  optimizer_timeout_ms: 15_000,
  optimizer_inventory_weight: 100

# Configure the endpoint
config :meal_planner_api, MealPlannerApiWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  render_errors: [
    formats: [json: MealPlannerApiWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: MealPlannerApi.PubSub,
  live_view: [signing_salt: "xAXCFxOO"]

# Configure Elixir's Logger
config :logger, :default_formatter,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

# Use Jason for JSON parsing in Phoenix
config :phoenix, :json_library, Jason

# Cooking conversations must not be retained in request parameter logs.
config :phoenix, :filter_parameters, [
  "password",
  "token",
  "secret",
  "code",
  "message",
  "content",
  "prompt"
]

# IANA time zone database, compiled into the `tz` package: no runtime
# download and no writable data directory. `MealPlannerApi.AccountClock`
# needs it to resolve an Account's stored timezone.
config :elixir, :time_zone_database, Tz.TimeZoneDatabase

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
