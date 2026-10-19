import Config

# The `e2e` environment: a local API for the Maestro flows of
# `apps/mobile/e2e/`. It runs like `dev` against its own database, with the
# test doubles `config/runtime.exs` accepts in this environment only:
# `AI_CLIENT=mock` and the fixed login code of `E2E_LOGIN_EMAIL`.
# `priv/repo/e2e_seeds.exs` seeds the data the flows need.
#
# The database has a variable of its own, not the `DB_NAME` of `dev`: the
# seed rewrites data and the documented cleanup drops the database, so a
# `DB_NAME` exported for `dev` must never reach them. The seed also refuses
# a database whose name does not end in `_e2e`.
config :meal_planner_api, MealPlannerApi.Repo,
  username: System.get_env("DB_USER", "postgres"),
  password: System.get_env("DB_PASSWORD", "postgres"),
  hostname: System.get_env("DB_HOST", "localhost"),
  database: System.get_env("MYFOOD_E2E_DATABASE", "meal_planner_api_e2e"),
  stacktrace: true,
  show_sensitive_data_on_connection_error: true,
  pool_size: 10

# Loopback only, as in `dev`: the iOS simulator reaches the host there.
config :meal_planner_api, MealPlannerApiWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}],
  check_origin: false,
  debug_errors: true,
  secret_key_base:
    System.get_env("SECRET_KEY_BASE") ||
      "e2eOnlySecretKeyBaseNeverUsedInProductionE2eOnlySecretKeyBase0001"

config :meal_planner_api, MealPlannerApi.Auth.Guardian,
  secret_key: System.get_env("GUARDIAN_SECRET_KEY") || "change_this_for_e2e_only_guardian_secret"

# Planning proposals come from the OR-Tools optimizer, as in `dev`
# (`pip install -r optimizer/requirements.txt`). `OPTIMIZER_PYTHON` points
# at the interpreter that has it.
config :meal_planner_api,
  optimizer_python: System.get_env("OPTIMIZER_PYTHON", "python3"),
  optimizer_script_path:
    System.get_env(
      "OPTIMIZER_SCRIPT_PATH",
      Path.expand("../optimizer/optimizador.py", __DIR__)
    ),
  optimizer_timeout_ms: String.to_integer(System.get_env("OPTIMIZER_TIMEOUT_MS", "60000")),
  go_scraper_url: System.get_env("GO_SCRAPER_URL", "http://localhost:4001"),
  optimize_timeout_ms: 60_000

config :logger, :default_formatter, format: "[$level] $message\n"

config :phoenix, :plug_init_mode, :runtime

# Email-code auth — Bamboo LocalAdapter (no outbound SMTP), as in `dev`.
config :meal_planner_api, MealPlannerApi.Mailer, adapter: Bamboo.LocalAdapter
