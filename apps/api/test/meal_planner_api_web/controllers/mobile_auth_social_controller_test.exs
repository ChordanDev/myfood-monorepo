defmodule MealPlannerApiWeb.MobileAuthSocialControllerTest do
  @moduledoc """
  HTTP contract of `POST /api/auth/social` (issue #106): sign-in with a
  Google or Apple ID token.

  The provider is `MealPlannerApi.Auth.SocialVerifierFake` (see
  `config/test.exs`): each test says what the provider answers. The real
  verification is covered in `social_verifier_test.exs`.
  """
  use MealPlannerApiWeb.ConnCase, async: false

  import Ecto.Query
  import ExUnit.CaptureLog
  import MealPlannerApi.FactoryHelpers

  alias MealPlannerApi.Auth.SocialVerifierFake
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Persistence.Auth.DeviceSession
  alias MealPlannerApi.Persistence.Auth.SocialIdentity
  alias MealPlannerApi.Repo

  @path "/api/auth/social"
  @device_id "3f0c5f4e-6f0e-4a55-9d0b-1c7f1f6f2a10"

  describe "POST /api/auth/social — sign-up" do
    test "a verified email with no User signs up and opens a session", %{conn: conn} do
      provider_answers("google", "google-sub-1", " New.Person@Example.com ")

      body = conn |> post(@path, body("google")) |> json_response(200)

      assert Map.keys(body) == ["accessToken", "me", "refreshToken", "tokenType"]
      assert body["tokenType"] == "Bearer"

      assert [%User{email: "new.person@example.com", role: :owner} = user] = Repo.all(User)
      assert [%Account{plan: :individual} = account] = Repo.all(Account)
      assert account.trial_started_at && account.trial_ends_at

      assert [%AccountMembership{role: :owner, status: :active} = membership] =
               Repo.all(AccountMembership)

      assert membership.user_id == user.id and membership.account_id == account.id

      assert [%SocialIdentity{user_id: user_id, provider: "google", subject: "google-sub-1"}] =
               Repo.all(SocialIdentity)

      assert user_id == user.id
      assert body["me"]["user"]["id"] == user.id
      assert body["me"]["membership"] == %{"role" => "owner"}
      assert body["me"]["account"]["access"] == %{"canUseApp" => true, "reason" => nil}
    end

    test "me equals the GET /api/me body obtained with the returned access token", %{conn: conn} do
      provider_answers("apple", "apple-sub-me", "me@privaterelay.appleid.com")

      body = conn |> post(@path, body("apple")) |> json_response(200)

      me =
        conn
        |> put_req_header("authorization", "Bearer " <> body["accessToken"])
        |> get("/api/me")
        |> json_response(200)

      assert body["me"] == me
    end

    test "Apple's private relay address is a real email", %{conn: conn} do
      provider_answers("apple", "apple-sub-relay", "abc123@privaterelay.appleid.com")

      conn |> post(@path, body("apple")) |> json_response(200)

      assert [%User{email: "abc123@privaterelay.appleid.com"}] = Repo.all(User)
    end
  end

  describe "POST /api/auth/social — existing User" do
    test "a verified email whose User has an active Membership signs in and links", %{
      conn: conn
    } do
      user = insert_owner!("Known@Example.com")
      provider_answers("google", "google-sub-known", "known@example.com")

      body = conn |> post(@path, body("google")) |> json_response(200)

      assert body["me"]["user"]["id"] == user.id
      assert Repo.aggregate(User, :count) == 1
      assert Repo.aggregate(Account, :count) == 1

      assert [%SocialIdentity{user_id: user_id, subject: "google-sub-known"}] =
               Repo.all(SocialIdentity)

      assert user_id == user.id
    end

    test "a User with two Accounts lands on the one they own, as a code login does", %{
      conn: conn
    } do
      user =
        user_with_memberships(%{email: "two@example.com"}, [
          {%{plan: :family_4, name: "Someone else's family"}, :member},
          {%{plan: :individual, name: "Own account"}, :owner}
        ])

      owner = Enum.find(user.memberships, &(&1.account.name == "Own account"))
      provider_answers("google", "google-sub-two", "two@example.com")

      body = conn |> post(@path, body("google")) |> json_response(200)

      assert body["me"]["account"]["id"] == owner.account_id
      assert body["me"]["membership"] == %{"role" => "owner"}
    end

    test "a User who was only invited gets account_not_found and nothing is linked", %{
      conn: conn
    } do
      [host_membership] = insert_owner!("host@example.com").memberships
      invited = user_with_memberships(%{email: "invited@example.com"}, [])

      %AccountMembership{}
      |> AccountMembership.changeset(%{
        account_id: host_membership.account_id,
        user_id: invited.id,
        role: :member,
        status: :invited
      })
      |> Repo.insert!()

      provider_answers("google", "google-sub-invited", "invited@example.com")

      conn = post(conn, @path, body("google"))

      assert_error(conn, 401, "account_not_found")
      assert Repo.all(SocialIdentity) == []
      assert Repo.all(DeviceSession) == []
    end

    test "a linked provider account signs its User in without an email", %{conn: conn} do
      user = insert_owner!("apple-first@example.com")
      provider_answers("apple", "apple-sub-linked", "apple-first@example.com")
      conn |> post(@path, body("apple")) |> json_response(200)

      # Apple sends the email on the first sign-in only.
      SocialVerifierFake.answer(
        {:ok,
         %{provider: "apple", subject: "apple-sub-linked", email: nil, email_verified: false}}
      )

      body = conn |> post(@path, body("apple", device_id: "second-phone")) |> json_response(200)

      assert body["me"]["user"]["id"] == user.id
      assert Repo.aggregate(SocialIdentity, :count) == 1
    end

    test "a linked provider account signs in its User, not the User of the token's email", %{
      conn: conn
    } do
      linked = insert_owner!("linked@example.com")
      _other = insert_owner!("other@example.com")
      link!(linked, "google", "google-sub-moved")
      provider_answers("google", "google-sub-moved", "other@example.com")

      body = conn |> post(@path, body("google")) |> json_response(200)

      assert body["me"]["user"]["id"] == linked.id
    end

    test "the same email signs in through both providers as one User", %{conn: conn} do
      user = insert_owner!("both@example.com")

      provider_answers("google", "google-sub-both", "both@example.com")
      google = conn |> post(@path, body("google")) |> json_response(200)
      provider_answers("apple", "apple-sub-both", "both@example.com")
      apple = conn |> post(@path, body("apple")) |> json_response(200)

      assert google["me"]["user"]["id"] == user.id
      assert apple["me"]["user"]["id"] == user.id
      assert Repo.aggregate(SocialIdentity, :count) == 2
    end
  end

  describe "POST /api/auth/social — email" do
    test "an email the provider does not mark verified gets social_email_unverified", %{
      conn: conn
    } do
      insert_owner!("unverified@example.com")

      SocialVerifierFake.answer(
        {:ok,
         %{
           provider: "google",
           subject: "google-sub-unverified",
           email: "unverified@example.com",
           email_verified: false
         }}
      )

      conn = post(conn, @path, body("google"))

      assert_error(conn, 422, "social_email_unverified")
      assert Repo.all(SocialIdentity) == []
      assert Repo.all(DeviceSession) == []
    end

    test "a token without an email gets social_email_unverified and registers nobody", %{
      conn: conn
    } do
      SocialVerifierFake.answer(
        {:ok, %{provider: "apple", subject: "apple-sub-none", email: nil, email_verified: true}}
      )

      conn = post(conn, @path, body("apple"))

      assert_error(conn, 422, "social_email_unverified")
      assert Repo.all(User) == []
      assert Repo.all(SocialIdentity) == []
    end

    test "an email that is not shaped like one gets social_email_unverified", %{conn: conn} do
      provider_answers("google", "google-sub-bad", "not-an-email")

      assert_error(post(conn, @path, body("google")), 422, "social_email_unverified")
      assert Repo.all(User) == []
    end
  end

  describe "POST /api/auth/social — token and provider" do
    test "a token the provider rejects gets social_token_invalid", %{conn: conn} do
      SocialVerifierFake.answer({:error, :invalid_token})

      assert_error(post(conn, @path, body("google")), 401, "social_token_invalid")
      assert Repo.all(User) == []
    end

    test "an unsupported provider gets social_provider_unsupported", %{conn: conn} do
      SocialVerifierFake.answer({:error, :unsupported_provider})

      assert_error(post(conn, @path, body("facebook")), 422, "social_provider_unsupported")
      assert SocialVerifierFake.calls() == [{"facebook", "id-token"}]
    end

    test "a provider that cannot be reached gets unknown_error", %{conn: conn} do
      SocialVerifierFake.answer({:error, :provider_unavailable})

      log =
        capture_log(fn ->
          assert %{"error" => %{"code" => "unknown_error"}} =
                   conn |> post(@path, body("google")) |> json_response(500)
        end)

      assert log =~ "social sign-in failed with an unexpected error: :provider_unavailable"
      refute log =~ "id-token"
    end

    test "a missing or blank deviceId is refused before the token is verified", %{conn: conn} do
      provider_answers("google", "google-sub-device", "device@example.com")

      for device_id <- [nil, "", "   "] do
        conn = post(conn, @path, %{body("google") | "deviceId" => device_id})
        assert_error(conn, 401, "social_token_invalid")
      end

      assert SocialVerifierFake.calls() == []
      assert Repo.all(User) == []
    end

    test "the old snake_case body is not read", %{conn: conn} do
      provider_answers("google", "google-sub-snake", "snake@example.com")

      conn =
        post(conn, @path, %{"provider" => "google", "id_token" => "x", "device_id" => @device_id})

      assert_error(conn, 401, "social_token_invalid")
      assert Repo.all(User) == []
    end
  end

  describe "POST /api/auth/social — Device session" do
    test "the refresh token it returns is renewed by POST /api/auth/refresh", %{conn: conn} do
      provider_answers("google", "google-sub-refresh", "refresh@example.com")
      body = conn |> post(@path, body("google")) |> json_response(200)

      [%DeviceSession{} = session] = Repo.all(DeviceSession)
      assert session.device_id == @device_id
      assert session.token_hash == token_hash(body["refreshToken"])

      refreshed =
        conn
        |> post("/api/auth/refresh", %{"refreshToken" => body["refreshToken"]})
        |> json_response(200)

      assert is_binary(refreshed["refreshToken"])
      assert refreshed["refreshToken"] != body["refreshToken"]
    end

    test "signing in again on the same device ends the session it had", %{conn: conn} do
      provider_answers("apple", "apple-sub-again", "again@example.com")
      first = conn |> post(@path, body("apple")) |> json_response(200)
      second = conn |> post(@path, body("apple")) |> json_response(200)

      assert [old, current] = Repo.all(from(s in DeviceSession, order_by: s.inserted_at))
      assert old.token_hash == token_hash(first["refreshToken"]) and old.revoked_at

      assert current.token_hash == token_hash(second["refreshToken"]) and
               is_nil(current.revoked_at)
    end
  end

  # ---- helpers ---------------------------------------------------------------

  defp provider_answers(provider, subject, email) do
    SocialVerifierFake.answer(
      {:ok, %{provider: provider, subject: subject, email: email, email_verified: true}}
    )
  end

  defp body(provider, opts \\ []) do
    %{
      "provider" => provider,
      "idToken" => "id-token",
      "deviceId" => Keyword.get(opts, :device_id, @device_id)
    }
  end

  defp insert_owner!(email) do
    user_with_memberships(%{email: email, name: "Owner #{email}"}, [
      {%{plan: :individual, name: "Solo #{email}"}, :owner}
    ])
  end

  defp link!(user, provider, subject) do
    %SocialIdentity{}
    |> SocialIdentity.changeset(%{user_id: user.id, provider: provider, subject: subject})
    |> Repo.insert!()
  end

  defp assert_error(conn, status, code) do
    assert %{"error" => %{"code" => ^code, "message" => message}} = json_response(conn, status)
    assert is_binary(message) and message != ""
  end

  defp token_hash(token), do: :sha256 |> :crypto.hash(token) |> Base.encode16(case: :lower)
end
