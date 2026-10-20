defmodule MealPlannerApi.Auth.SocialVerifier do
  @moduledoc """
  Verifies the ID token a provider SDK handed the mobile app (issue #106)
  and returns who the provider says signed in.

    * `"google"` — the token goes to Google's `tokeninfo` endpoint, which
      checks its signature and expiry; this module then checks the issuer,
      the audience and the expiry again.
    * `"apple"` — the token is an RS256 JWT verified against Apple's
      published keys, then its issuer, audience and expiry are checked.
      The key set is cached for an hour per URL. A token naming a key the
      cache lacks fetches it again at most once a minute, so forged tokens
      cannot make every request call Apple.

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
    * `:provider_unavailable` — the provider endpoint failed or did not
      answer.
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

  @google_issuers ["accounts.google.com", "https://accounts.google.com"]
  @apple_issuer "https://appleid.apple.com"

  @default_google_tokeninfo_url "https://oauth2.googleapis.com/tokeninfo"
  @default_apple_jwks_url "https://appleid.apple.com/auth/keys"
  @default_apple_jwks_ttl_seconds 3_600
  @default_apple_jwks_min_refresh_seconds 60

  @doc """
  Verifies `id_token` for `provider`.

  Options (each defaults to the application config of the same name):

    * `:google_oauth_client_ids`, `:apple_oauth_client_ids` — the accepted
      audiences.
    * `:google_tokeninfo_url`, `:apple_jwks_url` — the provider endpoints.
    * `:apple_jwks_ttl_seconds` (default #{@default_apple_jwks_ttl_seconds}),
      `:apple_jwks_min_refresh_seconds` (default
      #{@default_apple_jwks_min_refresh_seconds}) — how long a fetched key
      set is used, and how soon a token naming an unknown key may fetch it
      again.
    * `:req_options` — extra options for `Req`, such as a `:plug` in tests.
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
    url = option(opts, :google_tokeninfo_url, @default_google_tokeninfo_url)
    request = [params: [id_token: id_token]]

    with {:ok, claims} <- url |> get_json(request, opts) |> google_answer(),
         :ok <- validate_issuer(claims, @google_issuers),
         :ok <- validate_audience(claims, client_ids),
         :ok <- validate_expiry(claims) do
      identity("google", claims)
    end
  end

  defp verify_token("apple", id_token, client_ids, opts) do
    url = option(opts, :apple_jwks_url, @default_apple_jwks_url)

    with {:ok, kid} <- header_kid(id_token),
         {:ok, jwk} <- fetch_apple_key(url, kid, opts),
         {:ok, claims} <- verify_signature(jwk, id_token),
         :ok <- validate_issuer(claims, [@apple_issuer]),
         :ok <- validate_audience(claims, client_ids),
         :ok <- validate_expiry(claims) do
      identity("apple", claims)
    end
  end

  # Google answers 4xx for a token it rejects: that is the token's fault.
  defp google_answer({:error, :rejected}), do: {:error, :invalid_token}
  defp google_answer(answer), do: answer

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

  # Google's `tokeninfo` sends `exp` as a string, Apple's JWT as a number.
  defp validate_expiry(%{"exp" => exp}) when is_binary(exp) do
    case Integer.parse(exp) do
      {exp, ""} -> validate_expiry(%{"exp" => exp})
      _ -> {:error, :invalid_token}
    end
  end

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

  defp fetch_apple_key(url, kid, opts) do
    with {:ok, keys} <- apple_keys(url, kid, opts) do
      case Enum.find(keys, &match?(%{"kid" => ^kid, "kty" => "RSA"}, &1)) do
        nil -> {:error, :invalid_token}
        key -> {:ok, JOSE.JWK.from_map(key)}
      end
    end
  end

  # The cached key set while it is younger than the TTL, unless the token
  # names a key it lacks and the last fetch is older than the refresh
  # interval: Apple may have rotated a key in.
  defp apple_keys(url, kid, opts) do
    now = System.monotonic_time(:second)

    case :persistent_term.get({__MODULE__, :apple_jwks, url}, nil) do
      %{keys: keys, fetched_at: fetched_at} ->
        age = now - fetched_at
        fresh? = age < option(opts, :apple_jwks_ttl_seconds, @default_apple_jwks_ttl_seconds)

        known? =
          Enum.any?(keys, &match?(%{"kid" => ^kid}, &1)) or
            age <
              option(
                opts,
                :apple_jwks_min_refresh_seconds,
                @default_apple_jwks_min_refresh_seconds
              )

        if fresh? and known?, do: {:ok, keys}, else: fetch_apple_keys(url, now, opts)

      nil ->
        fetch_apple_keys(url, now, opts)
    end
  end

  # Apple's key set never depends on the token, so any failure to read it
  # is Apple's.
  defp fetch_apple_keys(url, now, opts) do
    case get_json(url, [], opts) do
      {:ok, %{"keys" => keys}} when is_list(keys) ->
        :persistent_term.put({__MODULE__, :apple_jwks, url}, %{keys: keys, fetched_at: now})
        {:ok, keys}

      _failed ->
        {:error, :provider_unavailable}
    end
  end

  # The algorithm is fixed to the one Apple signs with; the token's header
  # never chooses it.
  defp verify_signature(jwk, id_token) do
    case JOSE.JWT.verify_strict(jwk, ["RS256"], id_token) do
      {true, %JOSE.JWT{fields: claims}, _jws} -> {:ok, claims}
      _ -> {:error, :invalid_token}
    end
  rescue
    _malformed -> {:error, :invalid_token}
  end

  # A 4xx is `:rejected`, except a 429: the provider throttling this
  # server says nothing about the token. Any other failure, a body that is
  # not a JSON object included, is the provider's.
  defp get_json(url, request_options, opts) do
    options =
      [
        receive_timeout: 10_000,
        pool_timeout: 5_000,
        connect_options: [timeout: 5_000],
        retry: false
      ]
      |> Keyword.merge(request_options)
      |> Keyword.merge(Keyword.get(opts, :req_options, []))

    case request(url, options) do
      {:ok, %Req.Response{status: status, body: body}} when status in 200..299 and is_map(body) ->
        {:ok, body}

      {:ok, %Req.Response{status: status}} when status in 400..499 and status != 429 ->
        {:error, :rejected}

      _failed ->
        {:error, :provider_unavailable}
    end
  end

  # Finch raises when its connection pool is exhausted; that is the
  # provider being unreachable too, not a crash of the request.
  defp request(url, options) do
    Req.get(url, options)
  rescue
    exception -> {:error, exception}
  end

  defp option(opts, key, default) do
    Keyword.get_lazy(opts, key, fn -> Application.get_env(:meal_planner_api, key, default) end)
  end

  defp optional_string(value) when is_binary(value) and value != "", do: value
  defp optional_string(_value), do: nil
end
