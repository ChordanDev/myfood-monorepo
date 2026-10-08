import Config

# Force using SSL in production. This also sets the "strict-security-transport" header,
# known as HSTS. If you have a health check endpoint, you may want to exclude it below.
# Note `:force_ssl` is required to be set at compile-time.
config :meal_planner_api, MealPlannerApiWeb.Endpoint,
  force_ssl: [
    rewrite_on: [:x_forwarded_proto],
    exclude: [
      # paths: ["/health"],
      hosts: ["localhost", "127.0.0.1"]
    ]
  ]

# Client address for rate limiting (`MealPlannerApiWeb.ClientIp`). The app
# is deployed on Fly, whose proxy always sets `Fly-Client-IP` to the client
# address as it sees it (https://docs.fly.io/networking/request-headers).
# The header is only trustworthy while traffic reaches the app through Fly
# Proxy alone: a request arriving any other way could write it itself.
config :meal_planner_api, client_ip_header: "fly-client-ip"

# Do not print debug messages in production
config :logger, level: :info

# Runtime production configuration, including reading
# of environment variables, is done on config/runtime.exs.
