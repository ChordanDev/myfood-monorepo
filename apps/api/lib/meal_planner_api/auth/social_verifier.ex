defmodule MealPlannerApi.Auth.SocialVerifier do
  @moduledoc """
  Verifies the ID token a provider SDK handed the mobile app (issue #106)
  and returns who the provider says signed in.

  Both providers' tokens are RS256 JWTs, verified here against the
  provider's published keys (issue #404); no token is sent anywhere.

    * `"google"` — keys from Google's JWKS, issuer `accounts.google.com`
      or `https://accounts.google.com`.
    * `"apple"` — keys from Apple's JWKS, issuer
      `https://appleid.apple.com`.

  Then the audience and the expiry are checked. The key sets come from
  `MealPlannerApi.Auth.JwksCache`, which fetches each one once however many
  sign-ins need it at the same time.

  The audience must be one of the client IDs configured for the provider
  (`:google_oauth_client_ids`, `:apple_oauth_client_ids`). A provider with
  no client ID configured is unsupported: an empty list never means "any
  audience".

  The answer carries the provider's stable `subject`, the `email` and
  whether the provider marks it verified. Deciding what an unverified or
  missing email means is `MealPlannerApi.Services.SocialLogin`'s job.

  Errors:

    * `:unsupported_provider` — not `"google"` or `"apple"`, or no client
      ID is configured for it.
    * `:invalid_token` — blank, malformed, badly signed, expired, or issued
      by or for someone else.
    * `:provider_unavailable` — the provider's key set could not be read.
  """

  @type provider :: String.t()

  @type identity :: %{
          provider: provider(),
          subject: String.t(),
          email: String.t() | nil,
          email_verified: boolean()
        }

  @type reason :: :unsupported_provider | :invalid_token | :provider_unavailable

  @callback verify(provider(), term(), keyword()) :: {:ok, identity()} | {:error, reason()}

  @behaviour __MODULE__

  alias MealPlannerApi.Auth.JwksCache

  @google_issuers ["accounts.google.com", "https://accounts.google.com"]
  @apple_issuer "https://appleid.apple.com"

  @default_google_jwks_url "https://www.googleapis.com/oauth2/v3/certs"
  @default_apple_jwks_url "https://appleid.apple.com/auth/keys"

  @doc """
  Verifies `id_token` for `provider`.

  Options (each defaults to the application config of the same name):

    * `:google_oauth_client_ids`, `:apple_oauth_client_ids` — the accepted
      audiences.
    * `:google_jwks_url`, `:apple_jwks_url` — the providers' key sets.
    * `:jwks_ttl_seconds`, `:jwks_min_refresh_seconds`, `:req_options` —
      passed to `MealPlannerApi.Auth.JwksCache.keys/3`.
  """
  @impl true
  def verify(provider, id_token, opts \\ [])

  def verify(provider, id_token, opts) when provider in ["google", "apple"] do
    with {:ok, client_ids} <- client_ids(provider, opts),
         {:ok, id_token} <- cast_token(id_token) do
      verify_token(provider, id_token, client_ids, opts)
    end
  end

  def verify(_provider, _id_token, _opts), do: {:error, :unsupported_provider}

  defp verify_token("google", id_token, client_ids, opts) do
    url = option(opts, :google_jwks_url, @default_google_jwks_url)
    verify_jwt("google", id_token, url, @google_issuers, client_ids, opts)
  end

  defp verify_token("apple", id_token, client_ids, opts) do
    url = option(opts, :apple_jwks_url, @default_apple_jwks_url)
    verify_jwt("apple", id_token, url, [@apple_issuer], client_ids, opts)
  end

  defp verify_jwt(provider, id_token, url, issuers, client_ids, opts) do
    with {:ok, kid} <- header_kid(id_token),
         {:ok, jwk} <- fetch_key(url, kid, opts),
         {:ok, claims} <- verify_signature(jwk, id_token),
         :ok <- validate_issuer(claims, issuers),
         :ok <- validate_audience(claims, client_ids),
         :ok <- validate_expiry(claims) do
      identity(provider, claims)
    end
  end

  defp identity(provider, claims) do
    case claims do
      %{"sub" => subject} when is_binary(subject) and subject != "" ->
        {:ok,
         %{
           provider: provider,
           subject: subject,
           email: optional_string(claims["email"]),
           email_verified: claims["email_verified"] in [true, "true"]
         }}

      _ ->
        {:error, :invalid_token}
    end
  end

  defp client_ids(provider, opts) do
    key = %{"google" => :google_oauth_client_ids, "apple" => :apple_oauth_client_ids}[provider]

    case option(opts, key, []) do
      [_ | _] = client_ids -> {:ok, client_ids}
      _none -> {:error, :unsupported_provider}
    end
  end

  defp cast_token(id_token) when is_binary(id_token) and id_token != "", do: {:ok, id_token}
  defp cast_token(_id_token), do: {:error, :invalid_token}

  defp validate_issuer(%{"iss" => issuer}, issuers) do
    if issuer in issuers, do: :ok, else: {:error, :invalid_token}
  end

  defp validate_issuer(_claims, _issuers), do: {:error, :invalid_token}

  # `aud` is a string in both providers' ID tokens; anything else, a list
  # included, is refused rather than matched loosely.
  defp validate_audience(%{"aud" => audience}, client_ids) when is_binary(audience) do
    if audience in client_ids, do: :ok, else: {:error, :invalid_token}
  end

  defp validate_audience(_claims, _client_ids), do: {:error, :invalid_token}

  defp validate_expiry(%{"exp" => exp}) when is_integer(exp) do
    if exp > System.os_time(:second), do: :ok, else: {:error, :invalid_token}
  end

  defp validate_expiry(_claims), do: {:error, :invalid_token}

  defp header_kid(id_token) do
    with [header | _] <- String.split(id_token, "."),
         {:ok, json} <- Base.url_decode64(header, padding: false),
         {:ok, %{"kid" => kid}} when is_binary(kid) <- Jason.decode(json) do
      {:ok, kid}
    else
      _ -> {:error, :invalid_token}
    end
  end

  defp fetch_key(url, kid, opts) do
    with {:ok, keys} <- JwksCache.keys(url, kid, opts) do
      case Enum.find(keys, &match?(%{"kid" => ^kid, "kty" => "RSA"}, &1)) do
        nil -> {:error, :invalid_token}
        key -> {:ok, JOSE.JWK.from_map(key)}
      end
    end
  end

  # The algorithm is fixed to the one both providers sign with; the
  # token's header never chooses it.
  defp verify_signature(jwk, id_token) do
    case JOSE.JWT.verify_strict(jwk, ["RS256"], id_token) do
      {true, %JOSE.JWT{fields: claims}, _jws} -> {:ok, claims}
      _ -> {:error, :invalid_token}
    end
  rescue
    _malformed -> {:error, :invalid_token}
  end

  defp option(opts, key, default) do
    Keyword.get_lazy(opts, key, fn -> Application.get_env(:meal_planner_api, key, default) end)
  end

  defp optional_string(value) when is_binary(value) and value != "", do: value
  defp optional_string(_value), do: nil
end
