defmodule MealPlannerApi.Services.SocialLogin do
  @moduledoc """
  Sign-in with a Google or Apple ID token for the mobile app (issue #106),
  served by `POST /api/auth/social`.

  The provider's proof replaces the email code; everything else follows
  the code contract:

    * a provider account already linked to a User signs that User in;
    * otherwise the provider must mark the email verified. An email whose
      User has an active Membership signs in, and an email with no User
      signs up with an Account, the owner Membership and the Trial, as
      `MealPlannerApi.Services.EmailCodeSignup` does. Either way the
      provider account is linked to the User, so a later sign-in without
      an email (Apple sends it only the first time) finds the same User;
    * a User without an active Membership gets `:account_not_found`, as an
      email-code login does.

  The Membership the session is scoped to is chosen by
  `MealPlannerApi.Services.EmailCodeLogin.resolve_session/1`, the rule a
  code login uses.

  The token is verified before any database work, so no connection is held
  while the provider answers. The rest runs in one transaction, under a
  lock on the provider account, so two first sign-ins of the same person
  link and register once.
  """

  alias MealPlannerApi.Accounts
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Persistence.Accounts.UserEmail
  alias MealPlannerApi.Persistence.Auth.SocialIdentity
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.EmailCodeLogin

  # First key of the two-key advisory lock form, apart from the ones
  # `EmailCodeLogin`, `DeviceSessions` and `CookingService` use.
  @lock_namespace 0x534F_4349

  @doc """
  Verifies `id_token` with `provider`'s verifier, finds or registers the
  User and opens their session with `open_session`, which receives the
  User and the Membership and answers `{:ok, session}` or
  `{:error, reason}`. On any error nothing is written: no User, no link,
  no session.

  Errors:

    * `{:error, :unsupported_provider}`, `{:error, :invalid_token}`,
      `{:error, :provider_unavailable}` — from
      `MealPlannerApi.Auth.SocialVerifier.verify/3`.
    * `{:error, :email_unverified}` — the provider account is not linked
      yet and the token carries no email the provider marks verified.
    * `{:error, :account_not_found}` — the User has no active Membership.
    * `{:error, :email_already_exists}` — the email got a User while this
      sign-up was being written.
    * `{:error, :registration_failed}` — the sign-up could not be written.
    * any error `open_session` answers.
  """
  @spec sign_in(
          term(),
          term(),
          (User.t(), AccountMembership.t() -> {:ok, session} | {:error, reason})
        ) ::
          {:ok, session}
          | {:error,
             MealPlannerApi.Auth.SocialVerifier.reason()
             | :email_unverified
             | :account_not_found
             | :email_already_exists
             | :registration_failed}
          | {:error, reason}
        when session: term(), reason: atom()
  def sign_in(provider, id_token, open_session) do
    with {:ok, identity} <- verifier().verify(provider, id_token, []) do
      Repo.transaction(fn -> sign_in_identity(identity, open_session) end)
    end
  end

  # Runs in the transaction; any error rolls back what it wrote.
  defp sign_in_identity(identity, open_session) do
    lock_identity(identity)

    with {:ok, %{user: user, membership: membership}} <- find_or_register(identity),
         {:ok, session} <- open_session.(user, membership) do
      session
    else
      {:error, reason} -> Repo.rollback(reason)
    end
  end

  defp find_or_register(identity) do
    case Repo.get_by(SocialIdentity, provider: identity.provider, subject: identity.subject) do
      %SocialIdentity{user_id: user_id} -> EmailCodeLogin.resolve_session(user_id)
      nil -> link_by_email(identity)
    end
  end

  defp link_by_email(identity) do
    with {:ok, email} <- verified_email(identity),
         {:ok, %{user: user} = session} <- sign_in_or_register(email),
         :ok <- link(user, identity) do
      {:ok, session}
    end
  end

  defp verified_email(%{email: email, email_verified: true}) when is_binary(email) do
    case EmailCodeLogin.cast_email(email) do
      {:ok, email} -> {:ok, email}
      {:error, :invalid_email} -> {:error, :email_unverified}
    end
  end

  defp verified_email(_identity), do: {:error, :email_unverified}

  defp sign_in_or_register(email) do
    case UserEmail.get_user(email) do
      %User{id: user_id} -> EmailCodeLogin.resolve_session(user_id)
      nil -> register(email)
    end
  end

  defp register(email) do
    case Accounts.register_with_verified_email(email) do
      {:ok, %{user: user, membership: membership}} -> {:ok, %{user: user, membership: membership}}
      {:error, :email_already_registered} -> {:error, :email_already_exists}
      {:error, :unable_to_issue_identity} -> {:error, :registration_failed}
    end
  end

  defp link(%User{id: user_id}, identity) do
    %SocialIdentity{}
    |> SocialIdentity.changeset(%{
      user_id: user_id,
      provider: identity.provider,
      subject: identity.subject
    })
    |> Repo.insert()
    |> case do
      {:ok, _identity} -> :ok
      {:error, _changeset} -> {:error, :registration_failed}
    end
  end

  # Serializes sign-ins of one provider account for the rest of the
  # transaction, so the second of two first sign-ins finds the link the
  # first one wrote.
  defp lock_identity(%{provider: provider, subject: subject}) do
    Repo.query!("SELECT pg_advisory_xact_lock($1, $2)", [
      @lock_namespace,
      :erlang.phash2({provider, subject})
    ])
  end

  defp verifier do
    Application.get_env(:meal_planner_api, :social_verifier, MealPlannerApi.Auth.SocialVerifier)
  end
end
