defmodule MealPlannerApiWeb.ApiError do
  @moduledoc """
  Single renderer for the mobile error envelope (issue #1, "Error envelope
  helper"):

      {"error": {"code": "<code>", "message": "<human text>"}}

  The HTTP status is derived from the code, so a call site only names the
  domain code and never picks a status by hand.

  ## Call-site shape (contract scan)

  `apps/mobile` runs a contract test that scans every `.ex` file under
  `apps/api/lib` for the literal `error(:<code>)` and requires each captured
  code to be in its `KNOWN_AUTH_ERROR_CODES` allowlist. For that scan to see
  a call, the conn MUST be piped in:

      conn |> ApiError.error(:unauthenticated)

  `ApiError.error(conn, :unauthenticated)` renders the same response but is
  invisible to the scan, so it is not an accepted call shape in this
  codebase.

  Codes outside `@codes` raise `FunctionClauseError` at the call site; the
  table below is the subset of the mobile allowlist the API currently
  emits. Add a row when a new code is introduced — the mobile allowlist is
  the upper bound.

  Server faults never go through `error/2`: use `server_fault/1`, which
  renders `unknown_error` with 500 without a literal the scan would pick
  up, so an internal failure can never leak a non-allowlisted code.
  """

  import Plug.Conn

  @type code ::
          :unauthenticated
          | :access_token_expired
          | :account_not_found
          | :trial_expired

  @codes %{
    unauthenticated: {401, "Authentication is required for this request."},
    access_token_expired: {401, "The access token has expired."},
    account_not_found: {401, "No active account is associated with this session."},
    trial_expired: {403, "The trial period for this account has ended."}
  }

  @doc """
  Sends the envelope for `code` with its mapped status and halts the conn.

  Halting is deliberate: the renderer is used from plugs, where the request
  must stop here, and halting a conn that a controller action returns is a
  no-op.
  """
  @spec error(Plug.Conn.t(), code()) :: Plug.Conn.t()
  def error(%Plug.Conn{} = conn, code) when is_map_key(@codes, code) do
    {status, message} = Map.fetch!(@codes, code)
    send_envelope(conn, status, code, message)
  end

  @doc """
  Sends `unknown_error` with 500 and halts. Use for unexpected server-side
  failures so the response still carries the envelope.
  """
  @spec server_fault(Plug.Conn.t()) :: Plug.Conn.t()
  def server_fault(%Plug.Conn{} = conn) do
    send_envelope(conn, 500, :unknown_error, "An unexpected error occurred.")
  end

  @doc "The codes this renderer can emit, for tests and documentation."
  @spec codes() :: [code()]
  def codes, do: Map.keys(@codes)

  defp send_envelope(conn, status, code, message) do
    body = Jason.encode!(%{error: %{code: code, message: message}})

    conn
    |> put_resp_content_type("application/json")
    |> send_resp(status, body)
    |> halt()
  end
end
