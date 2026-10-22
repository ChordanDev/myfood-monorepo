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
          | :social_token_invalid
          | :social_email_unverified
          | :social_provider_unsupported
          | :refresh_token_invalid
          | :refresh_token_revoked
          | :refresh_token_replayed
          | :refresh_token_expired
          | :refresh_token_session_mismatch
          | :recipe_not_found
          | :validation_error
          | :invalid_cooking_skill
          | :slot_cooking_times_not_found
          | :invalid_hunger_level
          | :invalid_diet
          | :invalid_hard_restriction
          | :inventory_item_not_found
          | :shopping_item_not_manual
          | :shopping_item_not_found
          | :shopping_item_not_planned
          | :shopping_item_in_cart
          | :generation_in_progress
          | :no_active_generation
          | :missing_session_id
          | :account_expired
          | :invalid_proposal_id
          | :not_found
          | :subscription_required
          | :invalid_range
          | :overlapping_range
          | :planning_invalid_range
          | :planning_date_range_too_long
          | :planning_range_locked
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
          | :date_range_too_long
          | :optimization_failed
          | :optimizer_unavailable
          | :optimizer_timeout
          | :scheduled_meal_not_found
          | :cooking_session_not_active
          | :cooking_already_finished
          | :cooking_chat_unavailable
          | :cooking_chat_limit_reached
          | :cooking_message_id_conflict
          | :inventory_mutation_failed
          | :cart_locked
          | :stale_cart
          | :cart_not_found
          | :checkout_invalid_type
          | :cart_expired
          | :checkout_session_not_found
          | :voice_parse_failed
          | :voice_confirmation_required
          | :prepared_leftover_not_found
          | :scheduled_meal_cooked
          | :calendar_conflict
          | :calendar_move_not_possible
          | :calendar_meal_cooking_in_progress
          | :meal_already_confirmed
          | :confirmation_window_closed
          | :not_owner
          | :planning_proposal_not_pending
          | :planning_slot_occupied
          | :planning_session_invalid_range
          | :consent_required
          | :agent_busy
          | :agent_unavailable
          | :stale_proposal
          | :approval_required
          | :proposal_invalid
          | :confirmation_unresolved

  @type envelope :: %{
          error:
            %{code: code() | :unknown_error, message: String.t()}
            | %{code: code(), message: String.t(), details: map()}
        }

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
    # Social sign-in (issue #106).
    social_token_invalid: {401, "The sign-in provider token is not valid."},
    social_email_unverified: {422, "The sign-in provider did not confirm an email address."},
    social_provider_unsupported: {422, "This sign-in provider is not supported."},
    refresh_token_invalid: {401, "The refresh token is not valid."},
    refresh_token_revoked: {401, "The refresh token has been revoked."},
    refresh_token_replayed: {401, "The refresh token has already been used."},
    refresh_token_expired: {401, "The refresh token has expired."},
    refresh_token_session_mismatch: {401, "The refresh token does not match its session."},
    # Recipe detail (issue #32): a missing recipe, a malformed id and a recipe
    # of another Account share the code, so existence is not revealed.
    recipe_not_found: {404, "The recipe was not found."},
    # Onboarding profile (issue #17). `validation_error/2` replaces the
    # message of `validation_error` with one naming the field. The shopping
    # list read (issue #39) replies the same code, with this static message,
    # for a request param that is malformed or out of range.
    validation_error: {422, "The request is not valid."},
    invalid_cooking_skill: {422, "The cooking skill is not valid."},
    # Slot cooking times (issue #19). They share `validation_error` with the
    # Onboarding profile.
    slot_cooking_times_not_found: {404, "No slot cooking times are saved for this user."},
    invalid_hunger_level: {422, "The hunger level must be one of light, normal or strong."},
    # User preferences (issue #18). A field that is missing or malformed
    # goes through `validation_error/2` instead.
    invalid_diet: {422, "The diet is not valid."},
    invalid_hard_restriction: {422, "A hard restriction is not valid."},
    # Inventory (issue #42). An item id that is unknown, of another Account or
    # not a UUID shares the code, so existence is not revealed. Invalid input
    # replies `validation_error` with its static message.
    inventory_item_not_found: {404, "The inventory item was not found."},
    # Cooking sessions (issue #35). An unknown session or recipe step shares
    # `not_found`.
    scheduled_meal_not_found: {404, "The scheduled meal was not found."},
    cooking_session_not_active: {409, "The cooking session is not active."},
    cooking_already_finished: {409, "This meal has already been cooked."},
    cooking_chat_unavailable: {409, "Cooking is only available for a meal scheduled for today."},
    # Cooking chat (issue #185): the Account's questions per day are capped, and
    # a client message id names one question only.
    cooking_chat_limit_reached:
      {429, "The daily limit of Cooking chat questions was reached. Try again tomorrow."},
    cooking_message_id_conflict:
      {409, "This message id was already used for a different question."},
    inventory_mutation_failed: {422, "The inventory could not be updated. Nothing was saved."},
    # Manual Shopping items (issue #40). An id that is unknown, of another
    # Account, not a UUID or of an item no longer on the list shares
    # `shopping_item_not_found`, so existence is not revealed.
    shopping_item_not_manual: {422, "Only a Shopping item added by hand can be deleted."},
    shopping_item_not_found: {404, "The Shopping item was not found."},
    # Removing or restoring planned Shopping items (issue #40).
    shopping_item_not_planned: {422, "Only a planned Shopping item can be removed or restored."},
    shopping_item_in_cart: {409, "A Shopping item in a Cart cannot be removed."},
    # Voice adjustment of Inventory (issue #44).
    voice_parse_failed: {422, "The spoken adjustment could not be understood."},
    voice_confirmation_required: {422, "This adjustment needs the User's confirmation first."},
    # Cart lease (issue #41). `cart_locked`: the items are held in another
    # Membership's live Cart. `stale_cart`: the lease ran out. A Cart of
    # another Membership or an unknown one share `cart_not_found`.
    cart_locked: {409, "These items are held in another member's cart."},
    stale_cart: {409, "This cart has expired."},
    cart_not_found: {404, "The cart was not found."},
    # Checkout confirm (issue #43). `cart_expired`: the Cart being confirmed
    # is no longer live. A session of another Account, an unknown one and a
    # malformed id share `checkout_session_not_found`.
    checkout_invalid_type: {422, "The checkout type must be physical or online."},
    cart_expired: {409, "This cart has expired and can no longer be confirmed."},
    checkout_session_not_found: {404, "The checkout session was not found."},
    # Prepared leftovers (issue #45). A missing, closed, malformed-id and
    # other-Account leftover share the code, so existence is not revealed.
    # Keep it above the planning channel rows: the mobile allowlist test reads
    # every row after that header as a channel code.
    prepared_leftover_not_found: {404, "The prepared leftover was not found."},
    # Moving a Scheduled meal (issue #144). A missing, malformed-id and
    # other-Account meal reply `scheduled_meal_not_found`. Keep these above
    # the planning channel rows too.
    scheduled_meal_cooked: {409, "A cooked meal cannot be moved or replaced."},
    calendar_conflict: {409, "The calendar changed while the meal was moved. Nothing was saved."},
    # Stored rows that cannot follow the meal: a retry fails the same way.
    calendar_move_not_possible: {409, "This meal cannot be moved there. Nothing was saved."},
    # A meal with an active Cooking session, on either side (issue #207).
    calendar_meal_cooking_in_progress:
      {409, "A meal being cooked cannot be moved. Finish cooking it first."},
    # Confirming a past Scheduled meal as cooked or not cooked (issue #145).
    # Keep these above the planning channel rows too.
    meal_already_confirmed: {409, "This meal was already confirmed. Nothing was changed."},
    confirmation_window_closed:
      {422, "Only a meal from the last 7 days can be confirmed as cooked or not cooked."},
    # The Account's weekly Budget (issue #271): any member reads it, only the
    # owner changes it. Keep it above the planning channel rows too.
    not_owner: {403, "Only the owner of the account can change this."},
    # Confirm and reject of a Planner proposal over HTTP (issue #28): only a
    # pending proposal is confirmed or rejected. Keep it above the planning
    # channel rows too.
    planning_proposal_not_pending: {409, "The proposal is no longer pending."},
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
    # `start_planning` (issue #25). The Planner screen reads these two instead
    # of `invalid_range` / `overlapping_range`. The locked range may carry the
    # display name of the member who holds it, see `envelope/2`.
    planning_invalid_range:
      {422, "The planning range must be 1 to 7 days and start today or later."},
    # Issue #213: a range longer than `PlanningService.max_planning_days/0`.
    # Its details carry that maximum as `max_days`.
    planning_date_range_too_long: {422, "The date range must not be longer than 7 days."},
    planning_range_locked: {409, "Another planning session holds part of this date range."},
    # `start_planning` (issue #28): the Planner never plans over a Scheduled
    # meal. The details name the date and slot pairs that already hold one.
    planning_slot_occupied:
      {409, "A meal is already scheduled for one of the requested days and slots."},
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
    # `POST /api/planning/chat` (issue #213): the counterpart of
    # `planning_date_range_too_long`, with the same `max_days` details.
    date_range_too_long: {422, "The date range must not be longer than 7 days."},
    optimization_failed: {422, "A menu could not be generated for this request."},
    optimizer_unavailable: {503, "The menu optimizer is not available. Try again later."},
    optimizer_timeout: {504, "The menu optimizer took too long. Try again later."},
    # The planning agent's commands on the channel (issue #423, ADR 0007).
    planning_session_invalid_range:
      {422, "The planning range must be 1 to 31 days and start today or later."},
    consent_required: {403, "AI-processing consent is required before the agent can plan."},
    agent_busy: {409, "The planning agent is still answering the previous message."},
    agent_unavailable: {503, "The planning agent is not available. Try again later."},
    stale_proposal: {409, "This proposal is no longer the one on display."},
    approval_required: {409, "This proposal is over the budget and needs approval first."},
    proposal_invalid: {409, "This proposal is no longer valid. Nothing was saved."},
    confirmation_unresolved: {503, "The confirmation outcome is not known yet. Check its status."}
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
  Returns the envelope for `code` with a `details` map next to the message:

      %{error: %{code: :planning_range_locked, message: "...", details: %{owner_name: "Ana"}}}

  An empty `details` renders the envelope of `envelope/1`, so a client never
  reads an empty `details`. The keys of `details` are spelled in snake_case
  here, like the rest of a channel payload, and the channel camelizes them.
  """
  @spec envelope(code(), map()) :: envelope()
  def envelope(code, details) when is_map(details) and map_size(details) == 0,
    do: envelope(code)

  def envelope(code, details) when is_map(details) do
    %{error: error} = envelope(code)
    %{error: Map.put(error, :details, details)}
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
