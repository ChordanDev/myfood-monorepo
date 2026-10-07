defmodule MealPlannerApiWeb.AuthErrorHandler do
  @moduledoc """
  `Guardian.Plug.ErrorHandler` for the `:auth` pipeline. Every rejection is
  rendered through `MealPlannerApiWeb.ApiError` so the body is the mobile
  envelope `{"error": {"code": ..., "message": ...}}` (issue #1, "Token
  lifetimes").

  Mapping of Guardian's `{type, reason}`:

    * `{:invalid_token, :token_expired}` (a well-formed token whose `exp`
      is in the past) → `401 access_token_expired`. The mobile client
      treats this code as "refresh, then retry".
    * everything else (`:invalid_token` with any other reason,
      `:unauthenticated`, `:no_resource_found`, ...) → `401 unauthenticated`.
  """

  @behaviour Guardian.Plug.ErrorHandler

  alias MealPlannerApiWeb.ApiError

  @impl true
  def auth_error(conn, {:invalid_token, :token_expired}, _opts) do
    conn |> ApiError.error(:access_token_expired)
  end

  def auth_error(conn, {_type, _reason}, _opts) do
    conn |> ApiError.error(:unauthenticated)
  end
end
