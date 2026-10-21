defmodule MealPlannerApi.Auth.SocialVerifierTest do
  @moduledoc """
  `MealPlannerApi.Auth.SocialVerifier` against stand-ins for Google's and
  Apple's key sets, served through Req's `:plug` option. Tokens are signed
  here with generated RSA keys.
  """
  use ExUnit.Case, async: true

  alias MealPlannerApi.Auth.SocialVerifier

  @google_client "google-web-client"
  @apple_client "com.myfood.app"

  describe "providers" do
    test "a provider other than google or apple is unsupported" do
      assert SocialVerifier.verify("facebook", "token", opts()) == {:error, :unsupported_provider}
      assert SocialVerifier.verify(nil, "token", opts()) == {:error, :unsupported_provider}
    end

    test "a provider without a configured client ID is unsupported, whatever the token" do
      plug = fn _conn -> flunk("the provider must not be asked") end

      for provider <- ["google", "apple"],
          client_ids <- [[], nil] do
        opts = opts(plug, google_oauth_client_ids: client_ids, apple_oauth_client_ids: client_ids)
        assert SocialVerifier.verify(provider, "token", opts) == {:error, :unsupported_provider}
      end
    end

    test "a missing or blank token is invalid and never sent" do
      plug = fn _conn -> flunk("the provider must not be asked") end

      for provider <- ["google", "apple"], token <- [nil, "", 42] do
        assert SocialVerifier.verify(provider, token, opts(plug)) == {:error, :invalid_token}
      end
    end
  end

  describe "google" do
    setup do
      key = JOSE.JWK.generate_key({:rsa, 2048})
      %{key: key, plug: keys_plug(key, "google-key")}
    end

    test "a token signed by Google for this app signs in without asking tokeninfo", %{key: key} do
      test = self()
      keys = jwks(key, "google-key")

      plug = fn conn ->
        send(test, {:requested, conn.host, conn.request_path})

        if conn.host == "oauth2.googleapis.com" or conn.request_path =~ "tokeninfo",
          do: raise("tokeninfo must not be called"),
          else: Req.Test.json(conn, keys)
      end

      assert SocialVerifier.verify("google", google_token(key, %{}), opts(plug)) ==
               {:ok,
                %{
                  provider: "google",
                  subject: "google-sub",
                  email: "person@example.com",
                  email_verified: true
                }}

      assert_received {:requested, "google.test", path}
      assert path =~ "/oauth2/v3/certs"
      refute_received {:requested, _host, _path}
    end

    test "either issuer Google uses is accepted", %{key: key, plug: plug} do
      for issuer <- ["accounts.google.com", "https://accounts.google.com"] do
        token = google_token(key, %{"iss" => issuer})

        assert {:ok, %{subject: "google-sub"}} =
                 SocialVerifier.verify("google", token, opts(plug))
      end
    end

    test "an email Google does not mark verified is returned as unverified", %{
      key: key,
      plug: plug
    } do
      for verified <- ["false", false, nil] do
        token = google_token(key, %{"email_verified" => verified})

        assert {:ok, %{email_verified: false}} =
                 SocialVerifier.verify("google", token, opts(plug))
      end
    end

    test "a token signed by another key is invalid", %{plug: plug} do
      token = google_token(JOSE.JWK.generate_key({:rsa, 2048}), %{})
      assert SocialVerifier.verify("google", token, opts(plug)) == {:error, :invalid_token}
    end

    test "a token issued for another client is invalid", %{key: key, plug: plug} do
      for audience <- ["someone-else", [@google_client], nil] do
        token = google_token(key, %{"aud" => audience})
        assert SocialVerifier.verify("google", token, opts(plug)) == {:error, :invalid_token}
      end
    end

    test "a token from another issuer is invalid", %{key: key, plug: plug} do
      for issuer <- ["https://evil.example.com", "https://appleid.apple.com", nil] do
        token = google_token(key, %{"iss" => issuer})
        assert SocialVerifier.verify("google", token, opts(plug)) == {:error, :invalid_token}
      end
    end

    test "an expired token is invalid", %{key: key, plug: plug} do
      for exp <- [System.os_time(:second) - 1, nil] do
        token = google_token(key, %{"exp" => exp})
        assert SocialVerifier.verify("google", token, opts(plug)) == {:error, :invalid_token}
      end
    end

    test "a token without a subject is invalid", %{key: key, plug: plug} do
      token = google_token(key, %{"sub" => ""})
      assert SocialVerifier.verify("google", token, opts(plug)) == {:error, :invalid_token}
    end

    test "Google's key set failing or throttled is the provider's", %{key: key} do
      token = google_token(key, %{})

      for plug <- [
            fn conn -> Plug.Conn.send_resp(conn, 503, "unavailable") end,
            fn conn -> Plug.Conn.send_resp(conn, 429, "slow down") end,
            fn conn -> Plug.Conn.send_resp(conn, 200, "not json") end
          ] do
        assert SocialVerifier.verify("google", token, opts(plug)) ==
                 {:error, :provider_unavailable}
      end
    end
  end

  describe "apple" do
    setup do
      key = JOSE.JWK.generate_key({:rsa, 2048})
      %{key: key, plug: apple_keys_plug(key)}
    end

    test "a token signed by Apple for this app returns its subject and email", %{
      key: key,
      plug: plug
    } do
      token = apple_token(key, %{"email_verified" => "true", "is_private_email" => "true"})

      assert SocialVerifier.verify("apple", token, opts(plug)) ==
               {:ok,
                %{
                  provider: "apple",
                  subject: "apple-sub",
                  email: "relay@privaterelay.appleid.com",
                  email_verified: true
                }}
    end

    test "a token without an email returns the subject only", %{key: key, plug: plug} do
      token = apple_token(key, %{"email" => nil, "email_verified" => nil})

      assert {:ok, %{subject: "apple-sub", email: nil, email_verified: false}} =
               SocialVerifier.verify("apple", token, opts(plug))
    end

    test "a token for another app, from another issuer or expired is invalid", %{
      key: key,
      plug: plug
    } do
      for claims <- [
            %{"aud" => "com.other.app"},
            %{"aud" => [@apple_client]},
            %{"iss" => "https://accounts.google.com"},
            %{"exp" => System.os_time(:second) - 1}
          ] do
        token = apple_token(key, claims)
        assert SocialVerifier.verify("apple", token, opts(plug)) == {:error, :invalid_token}
      end
    end

    test "a token signed by another key is invalid", %{plug: plug} do
      token = apple_token(JOSE.JWK.generate_key({:rsa, 2048}), %{})

      assert SocialVerifier.verify("apple", token, opts(plug)) == {:error, :invalid_token}
    end

    test "a token whose header picks another algorithm is invalid", %{plug: plug} do
      hmac = JOSE.JWK.from_oct("shared secret")

      {_jws, token} =
        hmac
        |> JOSE.JWT.sign(%{"alg" => "HS256", "kid" => "apple-key"}, apple_claims(%{}))
        |> JOSE.JWS.compact()

      assert SocialVerifier.verify("apple", token, opts(plug)) == {:error, :invalid_token}
    end

    test "a token naming an unknown key or not shaped like a JWT is invalid", %{
      key: key,
      plug: plug
    } do
      unknown_kid = apple_token(key, %{}, "another-key")

      assert SocialVerifier.verify("apple", unknown_kid, opts(plug)) == {:error, :invalid_token}
      assert SocialVerifier.verify("apple", "not-a-jwt", opts(plug)) == {:error, :invalid_token}
    end

    test "Apple's key set failing is the provider's", %{key: key} do
      token = apple_token(key, %{})
      failing = fn conn -> Plug.Conn.send_resp(conn, 500, "") end
      not_found = fn conn -> Plug.Conn.send_resp(conn, 404, "") end

      assert SocialVerifier.verify("apple", token, opts(failing)) ==
               {:error, :provider_unavailable}

      assert SocialVerifier.verify("apple", token, opts(not_found)) ==
               {:error, :provider_unavailable}
    end
  end

  describe "key set cache" do
    setup do
      key = JOSE.JWK.generate_key({:rsa, 2048})
      url = "http://apple.test/#{System.unique_integer([:positive])}/auth/keys"
      %{key: key, url: url}
    end

    test "Apple's key set is fetched once for many tokens, forged ones included", %{
      key: key,
      url: url
    } do
      plug = counting_keys_plug(key)
      opts = opts(plug, apple_jwks_url: url)

      for _ <- 1..50 do
        forged = apple_token(JOSE.JWK.generate_key({:rsa, 2048}), %{}, "forged-key")
        assert SocialVerifier.verify("apple", forged, opts) == {:error, :invalid_token}
      end

      assert {:ok, %{subject: "apple-sub"}} =
               SocialVerifier.verify("apple", apple_token(key, %{}), opts)

      assert fetches() == 1
    end

    test "a cached key set keeps verifying while Apple's endpoint is down", %{key: key, url: url} do
      assert {:ok, _} =
               SocialVerifier.verify(
                 "apple",
                 apple_token(key, %{}),
                 opts(apple_keys_plug(key), apple_jwks_url: url)
               )

      down = fn conn -> Plug.Conn.send_resp(conn, 500, "") end

      assert {:ok, %{subject: "apple-sub"}} =
               SocialVerifier.verify(
                 "apple",
                 apple_token(key, %{}),
                 opts(down, apple_jwks_url: url)
               )
    end

    test "a key Apple rotated in is fetched once the refresh interval allows it", %{
      key: key,
      url: url
    } do
      rotated = JOSE.JWK.generate_key({:rsa, 2048})
      plug = counting_keys_plug(key)
      rotated_plug = counting_keys_plug(rotated, "rotated-key")

      assert {:ok, _} =
               SocialVerifier.verify(
                 "apple",
                 apple_token(key, %{}),
                 opts(plug, apple_jwks_url: url)
               )

      token = apple_token(rotated, %{}, "rotated-key")

      # Inside the interval an unknown key is refused without asking Apple.
      assert SocialVerifier.verify("apple", token, opts(rotated_plug, apple_jwks_url: url)) ==
               {:error, :invalid_token}

      assert {:ok, _} =
               SocialVerifier.verify(
                 "apple",
                 token,
                 opts(rotated_plug, apple_jwks_url: url, jwks_min_refresh_seconds: 0)
               )

      assert fetches() == 2
    end

    test "an expired key set is fetched again", %{key: key, url: url} do
      plug = counting_keys_plug(key)

      for _ <- 1..2 do
        assert {:ok, _} =
                 SocialVerifier.verify(
                   "apple",
                   apple_token(key, %{}),
                   opts(plug, apple_jwks_url: url, jwks_ttl_seconds: 0)
                 )
      end

      assert fetches() == 2
    end

    test "concurrent sign-ins against an empty cache fetch the key set once", %{
      key: key,
      url: url
    } do
      test = self()
      keys = jwks(key, "google-key")

      # Slow enough that every sign-in finds the cache empty while the
      # first fetch is still running.
      plug = fn conn ->
        send(test, :jwks_fetched)
        Process.sleep(100)
        Req.Test.json(conn, keys)
      end

      opts = opts(plug, google_jwks_url: url)

      results =
        1..20
        |> Task.async_stream(
          fn _ -> SocialVerifier.verify("google", google_token(key, %{}), opts) end,
          max_concurrency: 20
        )
        |> Enum.map(fn {:ok, result} -> result end)

      assert Enum.all?(results, &match?({:ok, %{subject: "google-sub"}}, &1))
      assert fetches() == 1
    end
  end

  describe "provider requests" do
    test "a request that raises, such as a full connection pool, is the provider's" do
      key = JOSE.JWK.generate_key({:rsa, 2048})
      raising = fn _conn -> raise RuntimeError, "Finch was unable to provide a connection" end

      assert SocialVerifier.verify("google", google_token(key, %{}), opts(raising)) ==
               {:error, :provider_unavailable}
    end
  end

  # ---- helpers ---------------------------------------------------------------

  # Every call names its own key set URLs unless `overrides` names one, so
  # the key set cache never carries over between calls or tests.
  defp opts(plug \\ fn conn -> Req.Test.json(conn, %{}) end, overrides \\ []) do
    Keyword.merge(
      [
        google_oauth_client_ids: [@google_client],
        apple_oauth_client_ids: [@apple_client],
        google_jwks_url:
          "http://google.test/#{System.unique_integer([:positive])}/oauth2/v3/certs",
        apple_jwks_url: "http://apple.test/#{System.unique_integer([:positive])}/auth/keys",
        req_options: [plug: plug]
      ],
      overrides
    )
  end

  defp google_claims(overrides) do
    Map.merge(
      %{
        "iss" => "https://accounts.google.com",
        "aud" => @google_client,
        "sub" => "google-sub",
        "email" => "person@example.com",
        "email_verified" => true,
        "exp" => System.os_time(:second) + 3_600
      },
      overrides
    )
  end

  defp google_token(key, overrides, kid \\ "google-key") do
    sign(key, kid, google_claims(overrides))
  end

  defp apple_claims(overrides) do
    Map.merge(
      %{
        "iss" => "https://appleid.apple.com",
        "aud" => @apple_client,
        "sub" => "apple-sub",
        "email" => "relay@privaterelay.appleid.com",
        "email_verified" => true,
        "exp" => System.os_time(:second) + 3_600
      },
      overrides
    )
  end

  defp apple_token(key, overrides, kid \\ "apple-key") do
    sign(key, kid, apple_claims(overrides))
  end

  defp sign(key, kid, claims) do
    {_jws, token} =
      key
      |> JOSE.JWT.sign(%{"alg" => "RS256", "kid" => kid}, claims)
      |> JOSE.JWS.compact()

    token
  end

  # Serves `key` and tells the test process each time it is asked.
  defp counting_keys_plug(key, kid \\ "apple-key") do
    test = self()
    keys = jwks(key, kid)

    fn conn ->
      send(test, :jwks_fetched)
      Req.Test.json(conn, keys)
    end
  end

  defp fetches(count \\ 0) do
    receive do
      :jwks_fetched -> fetches(count + 1)
    after
      0 -> count
    end
  end

  defp jwks(key, kid) do
    {_fields, public} = key |> JOSE.JWK.to_public() |> JOSE.JWK.to_map()
    %{"keys" => [Map.merge(public, %{"kid" => kid, "alg" => "RS256"})]}
  end

  defp keys_plug(key, kid) do
    keys = jwks(key, kid)
    fn conn -> Req.Test.json(conn, keys) end
  end

  defp apple_keys_plug(key), do: keys_plug(key, "apple-key")
end
