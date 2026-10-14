defmodule MealPlannerApi.Persistence.Accounts.UserEmail do
  @moduledoc """
  Single source of truth for how a User is found by email.

  An email is compared in its canonical form, trimmed and lower-cased,
  against `lower(users.email)`. The unique `users_lower_email_index`
  guarantees that at most one User matches, so no lookup has to break a
  tie. Login, sign-up, invites and identities all go through here.
  """

  import Ecto.Query, warn: false

  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Repo

  @doc """
  Canonical form of an email address, as stored on users, verification
  codes and rate-limit events: trimmed and lower-cased.
  """
  @spec normalize(String.t()) :: String.t()
  def normalize(email) when is_binary(email) do
    email |> String.trim() |> String.downcase()
  end

  @doc "The User whose email matches `email` regardless of case and surrounding whitespace, or `nil`."
  @spec get_user(String.t()) :: User.t() | nil
  def get_user(email) when is_binary(email), do: email |> matching() |> Repo.one()

  @doc "Whether a User's email matches `email` regardless of case and surrounding whitespace."
  @spec registered?(String.t()) :: boolean()
  def registered?(email) when is_binary(email), do: email |> matching() |> Repo.exists?()

  defp matching(email) do
    email = normalize(email)
    from(u in User, where: fragment("lower(?)", u.email) == ^email)
  end
end
