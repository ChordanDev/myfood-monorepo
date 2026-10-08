defmodule MealPlannerApiWeb.AuthControllerTest do
  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.FactoryHelpers

  alias Guardian.Token.Jwt, as: GuardianJwt
  alias MealPlannerApi.Auth.Guardian
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Persistence.Auth.DeviceSession
  alias MealPlannerApi.Persistence.Auth.EmailVerificationCode
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.EmailCodeAuth

  @refresh_path "/api/auth/refresh"
  @logout_path "/api/auth/logout"
  @device_id "3f0c5f4e-6f0e-4a55-9d0b-1c7f1f6f2a10"

  setup do
    previous_verifier = Application.get_env(:meal_planner_api, :social_verifier)

    Application.put_env(
      :meal_planner_api,
      :social_verifier,
      MealPlannerApi.Auth.SocialVerifierFake
    )

    on_exit(fn ->
      Application.put_env(:meal_planner_api, :social_verifier, previous_verifier)
    end)

    :ok
  end

  test "password register issues token with account and subscription claims", %{conn: conn} do
    conn =
      post(conn, "/api/auth/password", %{
        "mode" => "register",
        "email" => "u_auth@myfood.local",
        "password" => "supersecret123",
        "name" => "U Auth",
        "account_type" => "group",
        "subscription_tier" => "premium"
      })

    body = json_response(conn, 200)

    assert is_binary(body["access_token"])
    assert body["subscription"]["tier"] == "premium"
    assert body["subscription"]["max_planning_days"] == 7

    {:ok, claims} = Guardian.decode_and_verify(body["access_token"])
    assert claims["account_id"] == body["account"]["id"]
    assert claims["account_type"] == "group"
    assert claims["subscription_tier"] == "premium"
  end

  test "authenticated me endpoint returns the mobile CurrentMe body", %{conn: conn} do
    token =
      issue_password_token(conn, %{
        "email" => "u_me@myfood.local",
        "password" => "supersecret123",
        "name" => "U Me",
        "subscription_tier" => "free"
      })

    conn =
      conn
      |> put_req_header("authorization", "Bearer " <> token)
      |> get("/api/me")

    body = json_response(conn, 200)

    {:ok, claims} = Guardian.decode_and_verify(token)

    assert body["user"] == %{
             "id" => claims["sub"],
             "email" => "u_me@myfood.local",
             "displayName" => "U Me",
             "householdSize" => nil,
             "cookingSkill" => nil
           }

    assert body["account"]["id"] == claims["account_id"]
    assert body["account"]["type"] == "individual"
    assert body["membership"] == %{"role" => "owner"}
    assert body["onboarding"] == %{"isComplete" => false}
    refute Map.has_key?(body, "claims")
  end

  test "authenticated me endpoint rejects token when user no longer exists", %{conn: conn} do
    token =
      issue_password_token(conn, %{
        "email" => "u_me_deleted@myfood.local",
        "password" => "supersecret123",
        "name" => "U Me Deleted",
        "subscription_tier" => "free"
      })

    {:ok, claims} = Guardian.decode_and_verify(token)

    persisted_user_id = claims["sub"]
    persisted_user = Repo.get!(User, persisted_user_id)
    Repo.delete!(persisted_user)

    conn =
      conn
      |> put_req_header("authorization", "Bearer " <> token)
      |> get("/api/me")

    body = json_response(conn, 401)
    assert body["error"]["code"] == "unauthenticated"
  end

  test "password endpoint fails when required fields are missing", %{conn: conn} do
    conn =
      post(conn, "/api/auth/password", %{
        "mode" => "register",
        "email" => "u_missing_password@myfood.local",
        "subscription_tier" => "free"
      })

    body = json_response(conn, 400)
    assert body["error"] == "invalid_password"
  end

  test "social auth issues token for a verified provider identity", %{conn: conn} do
    Process.put(
      {MealPlannerApi.Auth.SocialVerifierFake, :response},
      {:ok,
       %{
         provider: "google",
         provider_user_id: "g_123",
         email: "g_123@myfood.local",
         name: "G User"
       }}
    )

    conn =
      post(conn, "/api/auth/social", %{
        "provider" => "google",
        "id_token" => "google-id-token",
        "subscription_tier" => "free"
      })

    body = json_response(conn, 200)

    assert is_binary(body["access_token"])
    assert body["user"]["email"] == "g_123@myfood.local"
    assert body["websocket"]["params"]["token"] == body["access_token"]
  end

  test "social auth supports facebook provider identity", %{conn: conn} do
    Process.put(
      {MealPlannerApi.Auth.SocialVerifierFake, :response},
      {:ok,
       %{
         provider: "facebook",
         provider_user_id: "fb_123",
         email: "fb_123@myfood.local",
         name: "FB User"
       }}
    )

    conn =
      post(conn, "/api/auth/social", %{
        "provider" => "facebook",
        "id_token" => "facebook-user-token",
        "subscription_tier" => "free"
      })

    body = json_response(conn, 200)

    assert is_binary(body["access_token"])
    assert body["user"]["email"] == "fb_123@myfood.local"
  end

  test "social auth rejects unsupported provider", %{conn: conn} do
    Process.put(
      {MealPlannerApi.Auth.SocialVerifierFake, :response},
      {:error, :unsupported_provider}
    )

    conn =
      post(conn, "/api/auth/social", %{
        "provider" => "twitter",
        "id_token" => "tw-token"
      })

    body = json_response(conn, 401)
    assert body["error"] == "unsupported_provider"
  end

  test "social auth validates required payload", %{conn: conn} do
    conn =
      post(conn, "/api/auth/social", %{
        "provider" => "google"
      })

    body = json_response(conn, 400)
    assert body["error"] == "invalid_social_payload"
  end

  test "password auth register creates user and returns token", %{conn: conn} do
    conn =
      post(conn, "/api/auth/password", %{
        "mode" => "register",
        "email" => "password_user@myfood.local",
        "password" => "supersecret123",
        "name" => "Password User",
        "account_type" => "individual"
      })

    body = json_response(conn, 200)

    assert is_binary(body["access_token"])
    assert body["user"]["email"] == "password_user@myfood.local"
  end

  test "password auth login returns token for existing credentials", %{conn: conn} do
    _register_response =
      conn
      |> post("/api/auth/password", %{
        "mode" => "register",
        "email" => "password_login@myfood.local",
        "password" => "supersecret123",
        "name" => "Password Login User"
      })
      |> json_response(200)

    conn =
      post(conn, "/api/auth/password", %{
        "mode" => "login",
        "email" => "password_login@myfood.local",
        "password" => "supersecret123"
      })

    body = json_response(conn, 200)
    assert is_binary(body["access_token"])
    assert body["user"]["email"] == "password_login@myfood.local"
  end

  test "password auth rejects wrong credentials", %{conn: conn} do
    _register_response =
      conn
      |> post("/api/auth/password", %{
        "mode" => "register",
        "email" => "password_wrong@myfood.local",
        "password" => "supersecret123",
        "name" => "Password Wrong User"
      })
      |> json_response(200)

    conn =
      post(conn, "/api/auth/password", %{
        "mode" => "login",
        "email" => "password_wrong@myfood.local",
        "password" => "wrong-password"
      })

    body = json_response(conn, 401)
    assert body["error"] == "invalid_credentials"
  end

  test "password auth validates minimum password length", %{conn: conn} do
    conn =
      post(conn, "/api/auth/password", %{
        "mode" => "register",
        "email" => "short_pass@myfood.local",
        "password" => "short"
      })

    body = json_response(conn, 400)
    assert body["error"] == "password_too_short"
  end

  defp issue_password_token(conn, params) do
    register_payload =
      Map.merge(
        %{
          "mode" => "register",
          "account_type" => "individual"
        },
        params
      )

    response = conn |> post("/api/auth/password", register_payload) |> json_response(200)
    response["access_token"]
  end

  # ----------------------------------------------------------------------
  # Phase A — Tenancy Refactor (PR 3a task 3.8)
  # ----------------------------------------------------------------------
  #
  # `auth_controller.ex` consults `:meal_planner_api, :tenancy_v2_only` to
  # decide whether `password/2` (register + login modes) mints `access_v2`
  # (via `AccountsMembership.claims_for/2`) or the legacy `access_v1`
  # (via `Accounts.claims_for/2`).
  describe "tenancy_v2_only flag (task 3.8)" do
    setup do
      previous = Application.get_env(:meal_planner_api, :tenancy_v2_only)

      on_exit(fn ->
        Application.put_env(:meal_planner_api, :tenancy_v2_only, previous)
      end)

      :ok
    end

    test "password register mints access_v2 with membership claims when the flag is on", %{
      conn: conn
    } do
      Application.put_env(:meal_planner_api, :tenancy_v2_only, true)

      conn =
        post(conn, "/api/auth/password", %{
          "mode" => "register",
          "email" => "v2_register@myfood.local",
          "password" => "supersecret123",
          "name" => "V2 Register"
        })

      body = json_response(conn, 200)
      {:ok, claims} = Guardian.decode_and_verify(body["access_token"])

      assert claims["typ"] == "access_v2"
      assert is_binary(claims["membership_id"])
      assert claims["account_id"] == body["account"]["id"]
      assert claims["role"] == "owner"
    end

    test "password login mints access_v2 with membership claims when the flag is on", %{
      conn: conn
    } do
      _ =
        post(conn, "/api/auth/password", %{
          "mode" => "register",
          "email" => "v2_login@myfood.local",
          "password" => "supersecret123",
          "name" => "V2 Login"
        })

      Application.put_env(:meal_planner_api, :tenancy_v2_only, true)

      conn =
        post(conn, "/api/auth/password", %{
          "mode" => "login",
          "email" => "v2_login@myfood.local",
          "password" => "supersecret123"
        })

      body = json_response(conn, 200)
      {:ok, claims} = Guardian.decode_and_verify(body["access_token"])

      assert claims["typ"] == "access_v2"
      assert is_binary(claims["membership_id"])
    end

    test "password register mints access_v1 when the flag is off (regression)", %{conn: conn} do
      Application.put_env(:meal_planner_api, :tenancy_v2_only, false)

      conn =
        post(conn, "/api/auth/password", %{
          "mode" => "register",
          "email" => "v1_register_flagoff@myfood.local",
          "password" => "supersecret123",
          "name" => "V1 Register"
        })

      body = json_response(conn, 200)
      {:ok, claims} = Guardian.decode_and_verify(body["access_token"])

      assert claims["typ"] == "access"
      refute Map.has_key?(claims, "membership_id")
    end
  end

  # ----------------------------------------------------------------------
  # Device sessions (issue #9)
  # ----------------------------------------------------------------------
  #
  # `POST /api/auth/refresh` and `POST /api/auth/logout` act on the Device
  # session a mobile verify route opened. Every session below is opened
  # through `POST /api/auth/login/verify-code`, so rotation, replay
  # detection and revocation are observed end to end over HTTP.
  describe "POST /api/auth/refresh" do
    test "rotates the pair and answers the new tokens without me", %{conn: conn} do
      user = insert_owner!("refresh-rotate@example.com")
      [membership] = user.memberships
      session = login!(conn, user)

      conn = post(conn, @refresh_path, %{"refreshToken" => session["refreshToken"]})

      body = json_response(conn, 200)
      assert Map.keys(body) == ["accessToken", "refreshToken", "tokenType"]
      assert body["tokenType"] == "Bearer"
      assert body["refreshToken"] != session["refreshToken"]

      assert {:ok, claims} = Guardian.decode_and_verify(body["accessToken"])
      assert claims["typ"] == "access_v2"
      assert claims["sub"] == user.id
      assert claims["membership_id"] == membership.id
    end

    test "the new refresh token rotates again and the old Device session is replaced", %{
      conn: conn
    } do
      user = insert_owner!("refresh-chain@example.com")
      first = login!(conn, user)

      second = refresh!(conn, first["refreshToken"])
      third = refresh!(conn, second["refreshToken"])

      assert %DeviceSession{revoked_at: %DateTime{}, replaced_by_id: second_id} =
               device_session(first["refreshToken"])

      assert %DeviceSession{id: ^second_id, revoked_at: %DateTime{}, replaced_by_id: third_id} =
               device_session(second["refreshToken"])

      assert %DeviceSession{id: ^third_id, revoked_at: nil, replaced_by_id: nil} =
               latest = device_session(third["refreshToken"])

      original = device_session(first["refreshToken"])
      assert latest.device_id == original.device_id
      assert latest.membership_id == original.membership_id
      assert latest.user_id == user.id
      assert_in_delta DateTime.diff(latest.expires_at, DateTime.utc_now()), 30 * 86_400, 5
    end

    test "a token that never had a Device session gets refresh_token_invalid", %{conn: conn} do
      {:ok, typeless_token} =
        GuardianJwt.create_token(Guardian, %{"sub" => Ecto.UUID.generate()}, [])

      for bad <- ["not-a-jwt", "", "   ", 42, nil, %{"nested" => "value"}, typeless_token] do
        conn = post(conn, @refresh_path, %{"refreshToken" => bad})
        assert_error(conn, 401, "refresh_token_invalid")
      end

      assert_error(post(conn, @refresh_path, %{}), 401, "refresh_token_invalid")
    end

    test "tokens the legacy routes minted have no Device session and are refused", %{conn: conn} do
      register_body =
        conn
        |> post("/api/auth/password", %{
          "mode" => "register",
          "email" => "legacy_refresh@myfood.local",
          "password" => "supersecret123",
          "name" => "Legacy Refresh"
        })
        |> json_response(200)

      assert {:ok, %{"typ" => "refresh"}} =
               Guardian.decode_and_verify(register_body["refresh_token"])

      for body <- [
            %{"refreshToken" => register_body["refresh_token"]},
            %{"refresh_token" => register_body["refresh_token"]}
          ] do
        assert_error(post(conn, @refresh_path, body), 401, "refresh_token_invalid")
      end
    end

    test "an access token posted as the refresh token is refused", %{conn: conn} do
      session = login!(conn, insert_owner!("refresh-access@example.com"))

      conn = post(conn, @refresh_path, %{"refreshToken" => session["accessToken"]})

      assert_error(conn, 401, "refresh_token_invalid")
      assert %DeviceSession{revoked_at: nil} = device_session(session["refreshToken"])
    end

    @tag :capture_log
    test "a rotated token presented again is a replay and ends the session on that device", %{
      conn: conn
    } do
      user = insert_owner!("refresh-replay@example.com")
      first = login!(conn, user)
      second = refresh!(conn, first["refreshToken"])

      conn_replay = post(conn, @refresh_path, %{"refreshToken" => first["refreshToken"]})
      assert_error(conn_replay, 401, "refresh_token_replayed")

      # The token that replaced it is revoked with the rest of the chain.
      conn_latest = post(conn, @refresh_path, %{"refreshToken" => second["refreshToken"]})
      assert_error(conn_latest, 401, "refresh_token_revoked")

      assert Repo.aggregate(DeviceSession, :count) == 2
      assert Enum.all?(Repo.all(DeviceSession), &match?(%DateTime{}, &1.revoked_at))
    end

    test "a Membership that is no longer active gets account_not_found", %{conn: conn} do
      user = insert_owner!("refresh-suspended@example.com")
      [membership] = user.memberships
      session = login!(conn, user)

      membership |> Ecto.Changeset.change(status: :suspended) |> Repo.update!()

      conn = post(conn, @refresh_path, %{"refreshToken" => session["refreshToken"]})

      assert_error(conn, 401, "account_not_found")
      assert %DeviceSession{revoked_at: nil} = device_session(session["refreshToken"])
    end

    test "a Device session past its expiry gets refresh_token_expired", %{conn: conn} do
      session = login!(conn, insert_owner!("refresh-expired@example.com"))

      session["refreshToken"]
      |> device_session()
      |> Ecto.Changeset.change(expires_at: DateTime.add(DateTime.utc_now(), -1, :second))
      |> Repo.update!()

      conn = post(conn, @refresh_path, %{"refreshToken" => session["refreshToken"]})

      assert_error(conn, 401, "refresh_token_expired")
      assert Repo.aggregate(DeviceSession, :count) == 1
    end
  end

  describe "POST /api/auth/logout" do
    test "revokes the Device session and answers 204 with no body", %{conn: conn} do
      session = login!(conn, insert_owner!("logout@example.com"))

      conn_logout = post(conn, @logout_path, %{"refreshToken" => session["refreshToken"]})

      assert response(conn_logout, 204) == ""

      assert %DeviceSession{revoked_at: %DateTime{}, replaced_by_id: nil} =
               device_session(session["refreshToken"])

      conn_refresh = post(conn, @refresh_path, %{"refreshToken" => session["refreshToken"]})
      assert_error(conn_refresh, 401, "refresh_token_revoked")
    end

    test "works when the access token in the header has expired or is garbage", %{conn: conn} do
      user = insert_owner!("logout-expired-access@example.com")

      {:ok, expired_access_token, _claims} =
        Guardian.encode_and_sign(user, %{"typ" => "access_v2"},
          token_type: "access",
          ttl: {-1, :minute}
        )

      assert {:error, :token_expired} = Guardian.decode_and_verify(expired_access_token)

      for authorization <- ["Bearer " <> expired_access_token, "Bearer not-a-jwt"] do
        session = login!(conn, user, Ecto.UUID.generate())

        conn =
          conn
          |> put_req_header("authorization", authorization)
          |> post(@logout_path, %{"refreshToken" => session["refreshToken"]})

        assert response(conn, 204) == ""
        assert %DeviceSession{revoked_at: %DateTime{}} = device_session(session["refreshToken"])
      end
    end

    test "answers 204 for an unknown, malformed or missing token and revokes nothing", %{
      conn: conn
    } do
      session = login!(conn, insert_owner!("logout-unknown@example.com"))

      {:ok, unknown_token, _claims} =
        Guardian.encode_and_sign(%{id: Ecto.UUID.generate()}, %{"sid" => Ecto.UUID.generate()},
          token_type: "refresh"
        )

      for body <- [
            %{"refreshToken" => unknown_token},
            %{"refreshToken" => "not-a-jwt"},
            %{"refreshToken" => ""},
            %{"refreshToken" => 42},
            %{"refreshToken" => nil},
            %{"refresh_token" => session["refreshToken"]},
            %{}
          ] do
        assert conn |> post(@logout_path, body) |> response(204) == ""
      end

      assert conn |> post(@logout_path) |> response(204) == ""
      assert %DeviceSession{revoked_at: nil} = device_session(session["refreshToken"])
    end

    test "logging out twice answers 204 both times and keeps the first revocation", %{conn: conn} do
      session = login!(conn, insert_owner!("logout-twice@example.com"))
      body = %{"refreshToken" => session["refreshToken"]}

      assert conn |> post(@logout_path, body) |> response(204) == ""
      %DeviceSession{revoked_at: revoked_at} = device_session(session["refreshToken"])

      assert conn |> post(@logout_path, body) |> response(204) == ""
      assert device_session(session["refreshToken"]).revoked_at == revoked_at
    end

    test "logging out a rotated token does not end the session that replaced it", %{conn: conn} do
      first = login!(conn, insert_owner!("logout-rotated@example.com"))
      second = refresh!(conn, first["refreshToken"])

      assert conn
             |> post(@logout_path, %{"refreshToken" => first["refreshToken"]})
             |> response(204) == ""

      assert %{"accessToken" => _} = refresh!(conn, second["refreshToken"])
    end
  end

  describe "Device sessions of one User" do
    test "logging out of one device leaves the other refreshable", %{conn: conn} do
      user = insert_owner!("two-devices-logout@example.com")
      phone = login!(conn, user, "phone")
      tablet = login!(conn, user, "tablet")

      assert conn
             |> post(@logout_path, %{"refreshToken" => phone["refreshToken"]})
             |> response(204) == ""

      conn_phone = post(conn, @refresh_path, %{"refreshToken" => phone["refreshToken"]})
      assert_error(conn_phone, 401, "refresh_token_revoked")

      assert %{"refreshToken" => rotated} = refresh!(conn, tablet["refreshToken"])
      assert %DeviceSession{device_id: "tablet", revoked_at: nil} = device_session(rotated)
    end

    @tag :capture_log
    test "a replay on one device leaves the other refreshable", %{conn: conn} do
      user = insert_owner!("two-devices-replay@example.com")
      phone = login!(conn, user, "phone")
      tablet = login!(conn, user, "tablet")

      rotated_phone = refresh!(conn, phone["refreshToken"])

      conn_replay = post(conn, @refresh_path, %{"refreshToken" => phone["refreshToken"]})
      assert_error(conn_replay, 401, "refresh_token_replayed")

      conn_phone = post(conn, @refresh_path, %{"refreshToken" => rotated_phone["refreshToken"]})
      assert_error(conn_phone, 401, "refresh_token_revoked")

      assert %{"accessToken" => _} = refresh!(conn, tablet["refreshToken"])
    end

    @tag :capture_log
    test "a replay does not touch another User's session on the same device", %{conn: conn} do
      user = insert_owner!("shared-device-replay@example.com")
      other_user = insert_owner!("shared-device-other@example.com")
      mine = login!(conn, user)
      theirs = login!(conn, other_user)

      refresh!(conn, mine["refreshToken"])
      conn_replay = post(conn, @refresh_path, %{"refreshToken" => mine["refreshToken"]})
      assert_error(conn_replay, 401, "refresh_token_replayed")

      assert %{"accessToken" => _} = refresh!(conn, theirs["refreshToken"])
    end
  end

  # ---- helpers ---------------------------------------------------------------

  defp insert_owner!(email) do
    user_with_memberships(%{email: email, name: "Owner #{email}"}, [
      {%{plan: :individual, name: "Solo #{email}"}, :owner}
    ])
  end

  # Logs `user` in on `device_id` through the mobile verify route and
  # returns the 200 body.
  defp login!(conn, user, device_id \\ @device_id) do
    Repo.insert!(%EmailVerificationCode{
      user_id: user.id,
      email: user.email,
      code_hash: EmailCodeAuth.hash_code("123456"),
      expires_at: DateTime.add(DateTime.utc_now(), 600, :second)
    })

    conn
    |> post("/api/auth/login/verify-code", %{
      "email" => user.email,
      "code" => "123456",
      "deviceId" => device_id
    })
    |> json_response(200)
  end

  # Rotates `refresh_token` and returns the 200 body.
  defp refresh!(conn, refresh_token) do
    conn |> post(@refresh_path, %{"refreshToken" => refresh_token}) |> json_response(200)
  end

  # The Device session row of `refresh_token`, or nil.
  defp device_session(refresh_token) do
    hash = :sha256 |> :crypto.hash(refresh_token) |> Base.encode16(case: :lower)
    Repo.get_by(DeviceSession, token_hash: hash)
  end

  defp assert_error(conn, status, code) do
    assert %{"error" => %{"code" => ^code, "message" => message}} = json_response(conn, status)
    assert is_binary(message) and message != ""
  end
end
