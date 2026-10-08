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

  ## Field validation

  A message in `@codes` is static, and a request that fails validation has
  to say which field failed. `validation_error/2` renders the
  `validation_error` code with a message naming that field, in its wire
  spelling:

      conn |> ApiError.validation_error("householdSize")

  The contract scan does not see this call either. It sees the code through
  the one rejection that has no field to name, which goes through `error/2`
  and keeps the static message:

      conn |> ApiError.error(:validation_error)

  ## Outside a conn

  `envelope/1` and `unknown_error_envelope/0` return the envelope as a plain
  map, for a transport that has no `Plug.Conn`: the planning channel replies
  them to a failed join or command (issue #11). `error/2`,
  `validation_error/2` and `server_fault/1` send the same shape, so the
  envelope is shaped in one place.

  The planning channel codes share `@codes` with the HTTP codes. Their status
  is the one an HTTP route replying the same code would use; a channel reply
  carries no status. The channel picks the code at runtime, from the reason a
  service returned, so the contract scan above does not see these codes: the
  mobile allowlist lists them by hand, in step with the table.
  """

  import Plug.Conn

  @type code ::
          :unauthenticated
          | :access_token_expired
          | :account_not_found
          | :trial_expired
          | :invalid_email
          | :email_not_found
          | :rate_limited
          | :code_invalid
          | :code_expired
          | :too_many_attempts
          | :code_send_failed
          | :email_already_exists
          | :refresh_token_invalid
          | :refresh_token_revoked
          | :refresh_token_replayed
          | :refresh_token_expired
          | :refresh_token_session_mismatch
          | :validation_error
          | :invalid_cooking_skill
          | :generation_in_progress
          | :no_active_generation
          | :missing_session_id
          | :account_expired
          | :invalid_proposal_id
          | :not_found
          | :subscription_required
          | :invalid_range
          | :overlapping_range
          | :forbidden_intent
          | :unknown_intent
          | :invalid_payload
          | :session_mismatch
          | :no_active_session
          | :forbidden
          | :already_confirmed
          | :foreign_lock
          | :not_a_member
          | :missing_lock
          | :lost_lock
          | :terminal_lock
          | :transaction_failed
          | :already_active
          | :invalid_identity
          | :invalid_date
          | :invalid_date_range
          | :optimization_failed
          | :optimizer_unavailable
          | :optimizer_timeout

  @type envelope :: %{error: %{code: code() | :unknown_error, message: String.t()}}

  @codes %{
    unauthenticated: {401, "Authentication is required for this request."},
    access_token_expired: {401, "The access token has expired."},
    account_not_found: {401, "No active account is associated with this session."},
    trial_expired: {403, "The trial period for this account has ended."},
    invalid_email: {422, "The email address is not valid."},
    email_not_found: {404, "No account exists for this email address."},
    rate_limited: {429, "Too many requests. Try again later."},
    code_invalid: {422, "The verification code is not valid."},
    code_expired: {401, "The verification code has expired."},
    too_many_attempts: {429, "Too many failed attempts for this code. Request a new one."},
    code_send_failed: {502, "The verification code could not be sent."},
    email_already_exists: {409, "An account already exists for this email address."},
    refresh_token_invalid: {401, "The refresh token is not valid."},
    refresh_token_revoked: {401, "The refresh token has been revoked."},
    refresh_token_replayed: {401, "The refresh token has already been used."},
    refresh_token_expired: {401, "The refresh token has expired."},
    refresh_token_session_mismatch: {401, "The refresh token does not match its session."},
    # Onboarding profile (issue #17). `validation_error/2` replaces the
    # message of `validation_error` with one naming the field.
    validation_error: {422, "The request is not valid."},
    invalid_cooking_skill: {422, "The cooking skill is not valid."},
    # Planning channel (issue #11): every deliberate reason a join or a
    # command of `PlanningChannel` replies, named as the reason was.
    generation_in_progress: {409, "A menu generation is already in progress for this account."},
    no_active_generation: {409, "There is no active menu generation for this account."},
    missing_session_id: {422, "A valid planning session id is required."},
    account_expired: {403, "Access for this account has expired."},
    invalid_proposal_id: {422, "The proposal id is not valid."},
    not_found: {404, "The requested resource was not found."},
    subscription_required: {403, "An active subscription is required for this action."},
    invalid_range: {422, "The date range is not valid."},
    overlapping_range: {409, "The date range overlaps an active planning session."},
    forbidden_intent: {422, "The intent contains a field that is not allowed."},
    unknown_intent: {422, "The intent kind is not recognized."},
    invalid_payload: {422, "The request payload is not valid."},
    session_mismatch:
      {409, "The session id does not match the planning session of this connection."},
    no_active_session: {409, "There is no active planning session on this connection."},
    forbidden: {403, "You are not allowed to perform this action."},
    already_confirmed: {409, "The proposal has already been confirmed."},
    foreign_lock: {403, "The planning session belongs to another account."},
    not_a_member: {403, "You are not an active member of this account."},
    missing_lock: {409, "No planning session holds the lock for this confirmation."},
    lost_lock: {409, "The planning session lost its lock."},
    terminal_lock: {409, "The planning session has already ended."},
    transaction_failed: {409, "The confirmation could not be completed. Nothing was saved."},
    already_active: {409, "The planning session is already active."},
    invalid_identity: {401, "The identity of this session could not be resolved."},
    invalid_date: {422, "The date is not valid."},
    invalid_date_range: {422, "The start date must not be after the end date."},
    optimization_failed: {422, "A menu could not be generated for this request."},
    optimizer_unavailable: {503, "The menu optimizer is not available. Try again later."},
    optimizer_timeout: {504, "The menu optimizer took too long. Try again later."}
  }

  @unknown_error_message "An unexpected error occurred."

  @doc """
  Sends the envelope for `code` with its mapped status and halts the conn.

  Halting is deliberate: the renderer is used from plugs, where the request
  must stop here, and halting a conn that a controller action returns is a
  no-op.

  Response headers already on the conn are kept, so a rate-limited answer
  sets `retry-after` before the call:

      conn |> put_resp_header("retry-after", "42") |> ApiError.error(:rate_limited)
  """
  @spec error(Plug.Conn.t(), code()) :: Plug.Conn.t()
  def error(%Plug.Conn{} = conn, code) when is_map_key(@codes, code) do
    {status, _message} = Map.fetch!(@codes, code)
    send_envelope(conn, status, envelope(code))
  end

  @doc """
  Sends `unknown_error` with 500 and halts. Use for unexpected server-side
  failures so the response still carries the envelope.
  """
  @spec server_fault(Plug.Conn.t()) :: Plug.Conn.t()
  def server_fault(%Plug.Conn{} = conn) do
    send_envelope(conn, 500, unknown_error_envelope())
  end

  @doc """
  Sends `validation_error` with its mapped status and a message naming
  `field`, and halts. `field` is the wire spelling of the first field that
  failed validation, such as `"householdSize"`.
  """
  @spec validation_error(Plug.Conn.t(), String.t()) :: Plug.Conn.t()
  def validation_error(%Plug.Conn{} = conn, field) when is_binary(field) do
    {status, _message} = Map.fetch!(@codes, :validation_error)

    send_envelope(
      conn,
      status,
      build_envelope(:validation_error, "The field #{field} is not valid.")
    )
  end

  @doc """
  Returns the envelope for `code` as a map, without a conn:

      %{error: %{code: :not_found, message: "The requested resource was not found."}}

  Like `error/2`, it raises `FunctionClauseError` for a code outside
  `@codes`, `unknown_error` included.
  """
  @spec envelope(code()) :: envelope()
  def envelope(code) when is_map_key(@codes, code) do
    {_status, message} = Map.fetch!(@codes, code)
    build_envelope(code, message)
  end

  @doc """
  Returns the `unknown_error` envelope as a map. Use it for an unexpected
  failure, or for a reason outside the allowlist, so nothing internal reaches
  the client.
  """
  @spec unknown_error_envelope() :: envelope()
  def unknown_error_envelope, do: build_envelope(:unknown_error, @unknown_error_message)

  @doc "The codes this renderer can emit, for tests and documentation."
  @spec codes() :: [code()]
  def codes, do: Map.keys(@codes)

  # The one place that shapes the envelope.
  defp build_envelope(code, message), do: %{error: %{code: code, message: message}}

  defp send_envelope(conn, status, envelope) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(status, Jason.encode!(envelope))
    |> halt()
  end
end
