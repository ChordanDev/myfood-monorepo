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

# Least weekly Budget per person, in cents (issue #271): the owner cannot set
# an Account's weekly Budget below this times the owner's Household size.
# `0` means no floor until the real amount is known from supermarket prices.
config :meal_planner_api,
  min_weekly_budget_per_person_cents: 0

config :meal_planner_api,
  ai_client: MealPlannerApi.AI.GeminiClient

config :meal_planner_api,
  planning_optimizer_client: MealPlannerApi.Optimization.OptimizerServer,
  start_optimizer_server: true,
  optimizer_python: "python3",
  optimizer_timeout_ms: 15_000,
  optimizer_inventory_weight: 100

# Planning agent (issue #423). `model` is the model adapter every Planning
# session uses; `max_range_days` the longest Planning Range.
config :meal_planner_api, :planning_agent,
  model: {MealPlannerApi.PlanningAgent.Model.ClaudeMessages, []},
  max_range_days: 31

# The Claude adapter of the planning agent. The model is Claude Haiku 5.5;
# another model is a configuration change (`PLANNING_AGENT_CLAUDE_MODEL`
# with its prices), made only after the quality battery (#435) is re-run on
# it. Prices are micro-USD per million tokens: Claude Haiku 5.5 list prices
# for prompts up to 100K tokens, 5x above. The spend caps are the same for
# every Account and are PLACEHOLDERS until the quality battery measures the
# real cost per session. `api_key` comes from `ANTHROPIC_API_KEY`
# (`config/runtime.exs`); without it no Planning session starts.
config :meal_planner_api, MealPlannerApi.PlanningAgent.Model.ClaudeMessages,
  model: "claude-haiku-5-5",
  effort: "medium",
  input_price_micros_per_mtok: 100_000,
  output_price_micros_per_mtok: 500_000,
  cache_write_price_micros_per_mtok: 125_000,
  cache_read_price_micros_per_mtok: 10_000,
  long_context_threshold_tokens: 100_000,
  long_context_price_multiplier: 5,
  # US$0.50 and 5M tokens per Planning session (placeholders).
  spend_cap_micros: 500_000,
  token_cap: 5_000_000,
  # Provider calls in flight across every Planning session.
  max_concurrent_calls: 20

# Social sign-in (issue #106). A provider with no client ID is refused,
# so both lists stay empty until `config/runtime.exs` reads them.
config :meal_planner_api,
  social_verifier: MealPlannerApi.Auth.SocialVerifier,
  google_oauth_client_ids: [],
  apple_oauth_client_ids: [],
  google_jwks_url: "https://www.googleapis.com/oauth2/v3/certs",
  apple_jwks_url: "https://appleid.apple.com/auth/keys"

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

# Cooking conversations and spoken inventory transcripts must not be retained
# in request parameter logs. Phoenix matches case-sensitively, so `"Token"`
# covers the mobile contract's `idToken`, `accessToken` and `refreshToken`.
config :phoenix, :filter_parameters, [
  "password",
  "token",
  "Token",
  "secret",
  "code",
  "message",
  "content",
  "prompt",
  "transcript"
]

# IANA time zone database, compiled into the `tz` package: no runtime
# download and no writable data directory. `MealPlannerApi.AccountClock`
# needs it to resolve an Account's stored timezone.
config :elixir, :time_zone_database, Tz.TimeZoneDatabase

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
