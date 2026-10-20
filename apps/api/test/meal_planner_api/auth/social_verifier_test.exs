defmodule MealPlannerApi.Auth.SocialVerifierTest do
  @moduledoc """
  `MealPlannerApi.Auth.SocialVerifier` against stand-ins for Google's
  `tokeninfo` endpoint and Apple's key set, served through Req's `:plug`
  option. Apple tokens are signed here with a generated RSA key.
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
    test "a token Google accepts for this app returns its subject and verified email" do
      plug = fn conn ->
        assert conn.query_string == "id_token=google-token"
        Req.Test.json(conn, google_claims())
      end

      assert SocialVerifier.verify("google", "google-token", opts(plug)) ==
               {:ok,
                %{
                  provider: "google",
                  subject: "google-sub",
                  email: "person@example.com",
                  email_verified: true
                }}
    end

    test "an email Google does not mark verified is returned as unverified" do
      for verified <- ["false", false, nil] do
        plug = fn conn -> Req.Test.json(conn, google_claims(%{"email_verified" => verified})) end

        assert {:ok, %{email_verified: false}} =
                 SocialVerifier.verify("google", "google-token", opts(plug))
      end
    end

    test "a token issued for another client is invalid" do
      for audience <- ["someone-else", [@google_client], nil] do
        plug = fn conn -> Req.Test.json(conn, google_claims(%{"aud" => audience})) end
        assert SocialVerifier.verify("google", "t", opts(plug)) == {:error, :invalid_token}
      end
    end

    test "a token from another issuer, expired, or without a subject is invalid" do
      for claims <- [
            %{"iss" => "https://evil.example.com"},
            %{"exp" => Integer.to_string(System.os_time(:second) - 1)},
            %{"exp" => "soon"},
            %{"sub" => ""}
          ] do
        plug = fn conn -> Req.Test.json(conn, google_claims(claims)) end
        assert SocialVerifier.verify("google", "t", opts(plug)) == {:error, :invalid_token}
      end
    end

    test "a token Google rejects is invalid, and a Google failure or throttle is the provider's" do
      rejected = fn conn -> conn |> Plug.Conn.put_status(400) |> Req.Test.json(%{}) end
      failing = fn conn -> Plug.Conn.send_resp(conn, 503, "unavailable") end
      not_json = fn conn -> Plug.Conn.send_resp(conn, 200, "not json") end
      throttled = fn conn -> Plug.Conn.send_resp(conn, 429, "slow down") end

      assert SocialVerifier.verify("google", "t", opts(rejected)) == {:error, :invalid_token}

      assert SocialVerifier.verify("google", "t", opts(failing)) ==
               {:error, :provider_unavailable}

      assert SocialVerifier.verify("google", "t", opts(not_json)) ==
               {:error, :provider_unavailable}

      # Google throttling this server says nothing about the token.
      assert SocialVerifier.verify("google", "t", opts(throttled)) ==
               {:error, :provider_unavailable}
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

  # ---- helpers ---------------------------------------------------------------

  defp opts(plug \\ fn conn -> Req.Test.json(conn, %{}) end, overrides \\ []) do
    Keyword.merge(
      [
        google_oauth_client_ids: [@google_client],
        apple_oauth_client_ids: [@apple_client],
        google_tokeninfo_url: "http://google.test/tokeninfo",
        apple_jwks_url: "http://apple.test/auth/keys",
        req_options: [plug: plug]
      ],
      overrides
    )
  end

  defp google_claims(overrides \\ %{}) do
    Map.merge(
      %{
        "iss" => "https://accounts.google.com",
        "aud" => @google_client,
        "sub" => "google-sub",
        "email" => "person@example.com",
        "email_verified" => "true",
        "exp" => Integer.to_string(System.os_time(:second) + 3_600)
      },
      overrides
    )
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
    {_jws, token} =
      key
      |> JOSE.JWT.sign(%{"alg" => "RS256", "kid" => kid}, apple_claims(overrides))
      |> JOSE.JWS.compact()

    token
  end

  defp apple_keys_plug(key) do
    {_fields, public} = key |> JOSE.JWK.to_public() |> JOSE.JWK.to_map()
    keys = %{"keys" => [Map.merge(public, %{"kid" => "apple-key", "alg" => "RS256"})]}

    fn conn -> Req.Test.json(conn, keys) end
  end
end
