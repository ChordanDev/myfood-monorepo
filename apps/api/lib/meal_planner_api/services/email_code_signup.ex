defmodule MealPlannerApi.Services.EmailCodeSignup do
  @moduledoc """
  Email-code sign-up for the mobile app (issue #8), served by
  `POST /api/auth/signup/request-code` and `POST /api/auth/signup/verify-code`.

  The mirror image of `MealPlannerApi.Services.EmailCodeLogin`: login only
  serves emails that have a User, sign-up only serves emails that do not.
  Codes are issued and redeemed through the same helpers, so the resend
  cooldown, the hourly request limits, the attempt limit and the per-email
  lock are the ones login uses.

  A sign-up code is an `email_verification_codes` row with no `user_id`.
  Nothing else is written until the code is verified, so a sign-up that is
  never finished leaves no User, Account or Membership behind.
  """

  alias MealPlannerApi.Accounts
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Persistence.Accounts.UserEmail
  alias MealPlannerApi.Persistence.Auth.EmailVerificationCode
  alias MealPlannerApi.Services.EmailCodeAuth
  alias MealPlannerApi.Services.EmailCodeLogin

  @doc """
  Issues a sign-up code for `email` and mails it.

  Errors:

    * `{:error, :invalid_email}` — not a string, or not shaped like an email.
    * `{:error, :email_already_exists}` — a User already has this email,
      in any case. No code is stored and nothing is sent, but the request
      still spends one of the caller's hourly per-IP slots.
    * `{:error, :rate_limited, retry_after}` — the resend cooldown or an
      hourly request limit applies, exactly as in
      `MealPlannerApi.Services.EmailCodeLogin.request_code/2`. An exhausted
      IP gets this answer for registered emails too.
    * `{:error, :code_send_failed}` — the mailer refused the message or
      never answered, as in
      `MealPlannerApi.Services.EmailCodeLogin.request_code/2`: the caller
      may retry at once.
  """
  @spec request_code(term(), String.t() | nil) ::
          {:ok, EmailCodeLogin.code_sent()}
          | {:error, :invalid_email | :email_already_exists | :code_send_failed}
          | {:error, :rate_limited, pos_integer()}
  def request_code(email, client_ip) do
    with {:ok, normalized_email} <- EmailCodeLogin.cast_email(email) do
      EmailCodeLogin.issue_code(normalized_email, client_ip, :signup, &admit_new_email/2)
    end
  end

  @doc """
  Verifies `code` against the latest pending sign-up code for `email` and,
  on a match, registers the person and opens their session with
  `open_session`: the User, their individual Account, the owner
  Membership, the Trial and whatever `open_session` writes are created
  together with the consumption of the code, or not at all.
  `open_session` receives the new User and Membership and answers
  `{:ok, session}` or `{:error, reason}`.

  Errors:

    * `{:error, :code_invalid}`, `{:error, :code_expired}` and
      `{:error, :too_many_attempts}` — as in
      `MealPlannerApi.Services.EmailCodeLogin.verify_code/2`.
    * `{:error, :email_already_exists}` — the code was right, but a User
      took the email after the code was issued. Nothing is created.
    * `{:error, :registration_failed}` — the registration could not be
      written. Nothing is created and the code stays pending.
    * any error `open_session` answers. Nothing is created and the code
      stays pending.
  """
  @spec verify_code(
          term(),
          term(),
          (User.t(), AccountMembership.t() -> {:ok, session} | {:error, atom()})
        ) ::
          {:ok, session}
          | {:error, atom()}
        when session: term()
  def verify_code(email, code, open_session) do
    EmailCodeLogin.redeem_code(email, code, :signup, fn row, now ->
      with {:ok, %{user: user, membership: membership}} <- register(row, now) do
        open_session.(user, membership)
      end
    end)
  end

  # Runs in the transaction that checked the code; any error it answers
  # rolls that transaction back, which a failed registration needs (a
  # unique violation aborts it).
  defp register(%EmailVerificationCode{email: email}, now) do
    case Accounts.register_with_verified_email(email, now) do
      {:ok, %{user: user, membership: membership}} ->
        {:ok, %{user: user, membership: membership}}

      {:error, :email_already_registered} ->
        {:error, :email_already_exists}

      {:error, :unable_to_issue_identity} ->
        {:error, :registration_failed}
    end
  end

  # A request for a registered email is still counted against the caller's
  # IP, in the bucket new emails draw from, so the answer cannot be used to
  # probe emails without limit. The event is kept because the transaction
  # commits on this error.
  defp admit_new_email(email, client_ip) do
    if UserEmail.registered?(email) do
      with :ok <- EmailCodeAuth.reserve_ip_request_slot(client_ip) do
        {:error, :email_already_exists}
      end
    else
      {:ok, nil}
    end
  end
end
