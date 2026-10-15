defmodule MealPlannerApi.Persistence.Auth.EmailAuthEvent do
  @moduledoc """
  Phase 1 — Persistence and Code Request (issue #31).

  Append-only rate-limit event log. One row per counted `request`, and
  one `verification_failure` row per failed login verification, counted
  per client IP bucket; the `Retry-After` policy reads the earliest counted
  event of the kind from this table.

  See `design.md` §"Persistence Shapes".
  """
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @type t :: %__MODULE__{}

  schema "email_auth_events" do
    field(:kind, :string)
    field(:email, :string)
    # Not a raw address: the rate-limit bucket key built by
    # `MealPlannerApi.Services.EmailCodeAuth` — an IPv4 address, an IPv6
    # /64 prefix such as "2001:db8::/64", the /56 prefix such as
    # "2001:db8::/56" an IPv6 code request also counts against, or
    # "unresolved" — so the column is a plain string.
    field(:client_ip, :string)
    field(:occurred_at, :utc_datetime_usec)

    timestamps(type: :utc_datetime_usec)
  end
end
