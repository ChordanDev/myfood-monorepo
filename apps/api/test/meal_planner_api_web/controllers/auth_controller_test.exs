defmodule MealPlannerApiWeb.AuthControllerTest do
  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.FactoryHelpers

  alias Guardian.Token.Jwt, as: GuardianJwt
  alias MealPlannerApi.AccountsMembership
  alias MealPlannerApi.Auth.Guardian
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Persistence.Auth.DeviceSession
  alias MealPlannerApi.Persistence.Auth.EmailVerificationCode
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.EmailCodeAuth
  alias MealPlannerApiWeb.Controllers.AccountScopeHelpers

  @refresh_path "/api/auth/refresh"
  @logout_path "/api/auth/logout"
  @device_id "3f0c5f4e-6f0e-4a55-9d0b-1c7f1f6f2a10"

  test "authenticated me endpoint returns the mobile CurrentMe body", %{conn: conn} do
    user =
      user_with_memberships(%{email: "u_me@myfood.local", name: "U Me"}, [
        {%{plan: :individual, name: "U Me"}, :owner}
      ])

    token = login!(conn, user)["accessToken"]

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
    token = login!(conn, insert_owner!("u_me_deleted@myfood.local"))["accessToken"]

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

    test "a signed refresh token minted without a Device session is refused", %{conn: conn} do
      user = insert_owner!("sessionless_refresh@myfood.local")
      [membership] = user.memberships

      {:ok, _access_token, refresh_token} =
        AccountScopeHelpers.mint_token_pair(user, AccountsMembership.claims_for(user, membership))

      assert {:ok, %{"typ" => "refresh"}} = Guardian.decode_and_verify(refresh_token)

      for body <- [%{"refreshToken" => refresh_token}, %{"refresh_token" => refresh_token}] do
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
