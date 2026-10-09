defmodule MealPlannerApi.Persistence.Auth.EmailAuthEvent do
  @moduledoc """
  Phase 1 — Persistence and Code Request (issue #31).

  Append-only rate-limit event log. One row per counted `request`; the
  `Retry-After` policy reads the earliest counted event from this table.
  The `kind` check of the table also admits `verification_failure`,
  which nothing writes.

  See `design.md` §"Persistence Shapes".
  """
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @type t :: %__MODULE__{}

  schema "email_auth_events" do
    field(:kind, :string)
    field(:email, :string)
    # The migration declares `client_ip` as a Postgres `:inet`, but Ecto
    # has no built-in :inet type. We cast to/from a string in the service
    # layer (`MealPlannerApi.Services.EmailCodeAuth.normalize_client_ip/1`)
    # and store it via raw SQL there. For Ecto queries the column is
    # treated as opaque.
    field(:client_ip, :string)
    field(:occurred_at, :utc_datetime_usec)

    timestamps(type: :utc_datetime_usec)
  end
end
