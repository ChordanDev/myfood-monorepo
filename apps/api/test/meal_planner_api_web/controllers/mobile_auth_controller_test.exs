defmodule MealPlannerApiWeb.MobileAuthControllerTest do
  @moduledoc """
  HTTP contract of the mobile login routes (issue #7) and sign-up routes
  (issue #8):

    * `POST /api/auth/login/request-code`
    * `POST /api/auth/login/verify-code`
    * `POST /api/auth/signup/request-code`
    * `POST /api/auth/signup/verify-code`

  Bodies and error codes mirror `apps/mobile/src/features/auth/types/auth.ts`
  and `apps/mobile/src/api/errors.ts`. Expiry and cooldown are simulated by
  inserting rows with past timestamps; delivery is read back from
  `Bamboo.SentEmail` (the test mailer adapter is `Bamboo.LocalAdapter`).

  The Device session a verified code opens (issue #9) is asserted here;
  what `POST /api/auth/refresh` and `POST /api/auth/logout` then do with
  it is covered in `auth_controller_test.exs`.
  """
  use MealPlannerApiWeb.ConnCase, async: false

  import ExUnit.CaptureLog
  import MealPlannerApi.FactoryHelpers

  alias MealPlannerApi.Auth.Guardian
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Persistence.Auth.DeviceSession
  alias MealPlannerApi.Persistence.Auth.EmailAuthEvent
  alias MealPlannerApi.Persistence.Auth.EmailVerificationCode
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.EmailCodeAuth
  alias MealPlannerApi.Subscriptions.Plan

  @request_path "/api/auth/login/request-code"
  @verify_path "/api/auth/login/verify-code"
  @signup_request_path "/api/auth/signup/request-code"
  @signup_verify_path "/api/auth/signup/verify-code"
  @device_id "3f0c5f4e-6f0e-4a55-9d0b-1c7f1f6f2a10"

  # Two values a count of characters lets through: Postgres text cannot
  # hold a NUL, and 100 four-byte characters take 400 bytes, over the 255
  # a `deviceId` may take.
  @device_id_with_nul "3f0c5f4e" <> <<0>> <> "6f0e"
  @device_id_of_wide_characters String.duplicate("😀", 100)

  defmodule FailingMailAdapter do
    @moduledoc false
    @behaviour Bamboo.Adapter

    @impl true
    def deliver(_email, _config), do: {:error, :smtp_unavailable}

    @impl true
    def handle_config(config), do: config

    @impl true
    def supports_attachments?, do: true
  end

  defmodule ExitingMailAdapter do
    @moduledoc false
    @behaviour Bamboo.Adapter

    # What an HTTP client timeout looks like: an exit, not an exception.
    @impl true
    def deliver(_email, _config), do: exit({:timeout, {:gen_server, :call, [:mail_client]}})

    @impl true
    def handle_config(config), do: config

    @impl true
    def supports_attachments?, do: true
  end

  setup do
    Bamboo.SentEmail.reset()
    :ok
  end

  describe "POST /api/auth/login/request-code" do
    test "sends a code to a known email and answers with the cooldown", %{conn: conn} do
      insert_owner!("login-request@example.com")

      conn = post(conn, @request_path, %{"email" => "login-request@example.com"})

      assert json_response(conn, 200) == %{
               "status" => "code_sent",
               "expiresInSeconds" => 600,
               "resendAvailableInSeconds" => 60
             }

      assert [email] = Bamboo.SentEmail.all()
      assert [{_name, "login-request@example.com"}] = email.to
      assert mailed_code() =~ ~r/^\d{6}$/
    end

    test "matches the email regardless of case and surrounding spaces", %{conn: conn} do
      insert_owner!("login-case@example.com")

      conn = post(conn, @request_path, %{"email" => "  Login-Case@Example.com "})

      assert %{"status" => "code_sent"} = json_response(conn, 200)
      assert [_email] = Bamboo.SentEmail.all()
    end

    test "an email without a User gets email_not_found and no code is stored or sent", %{
      conn: conn
    } do
      conn = post(conn, @request_path, %{"email" => "nobody@example.com"})

      assert_error(conn, 404, "email_not_found")
      assert Repo.aggregate(EmailVerificationCode, :count) == 0
      assert Bamboo.SentEmail.all() == []
    end

    test "an unknown email counts against the caller's IP and not against the email", %{
      conn: conn
    } do
      conn =
        conn
        |> from_client("203.0.113.20")
        |> post(@request_path, %{"email" => "nobody@example.com"})

      assert_error(conn, 404, "email_not_found")

      assert [%EmailAuthEvent{kind: "request", client_ip: "203.0.113.20"} = event] =
               Repo.all(EmailAuthEvent)

      assert event.email != "nobody@example.com"
    end

    test "unknown emails from one IP are rate limited once its hourly limit is spent", %{
      conn: conn
    } do
      user = insert_owner!("login-probed@example.com")

      for n <- 1..19 do
        insert_request_event!("other-#{n}@example.com", "203.0.113.20", seconds_ago(600))
      end

      probe = fn ip, email ->
        conn |> from_client(ip) |> post(@request_path, %{"email" => email})
      end

      # The twentieth request of the hour still gets the plain answer.
      assert_error(probe.("203.0.113.20", "nobody-1@example.com"), 404, "email_not_found")

      limited = probe.("203.0.113.20", "nobody-2@example.com")
      assert_error(limited, 429, "rate_limited")
      assert retry_after(limited) in 2_990..3_000

      # The spent IP no longer tells a known email from an unknown one.
      known = probe.("203.0.113.20", user.email)
      assert_error(known, 429, "rate_limited")
      assert retry_after(known) in 2_990..3_000

      assert_error(probe.("203.0.113.21", "nobody-2@example.com"), 404, "email_not_found")

      assert Repo.aggregate(EmailVerificationCode, :count) == 0
      assert Bamboo.SentEmail.all() == []
    end

    test "rotating x-forwarded-for does not give an unknown email a fresh per-IP bucket", %{
      conn: conn
    } do
      for n <- 1..19 do
        insert_request_event!("other-#{n}@example.com", "127.0.0.1", seconds_ago(600))
      end

      probe = fn forwarded_for, email ->
        conn
        |> put_req_header("x-forwarded-for", forwarded_for)
        |> post(@request_path, %{"email" => email})
      end

      # The twentieth request of the hour from this socket address.
      assert_error(probe.("203.0.113.40", "nobody-1@example.com"), 404, "email_not_found")

      limited = probe.("203.0.113.41", "nobody-2@example.com")
      assert_error(limited, 429, "rate_limited")
      assert retry_after(limited) in 2_990..3_000
    end

    test "a client address header that is not an IP is counted under the socket address", %{
      conn: conn
    } do
      conn =
        conn
        |> from_client("not-an-ip")
        |> post(@request_path, %{"email" => "nobody@example.com"})

      assert_error(conn, 404, "email_not_found")
      assert [%EmailAuthEvent{kind: "request", client_ip: "127.0.0.1"}] = Repo.all(EmailAuthEvent)
    end

    test "without the client address header the socket address is counted, IPv4 or IPv6", %{
      conn: conn
    } do
      for remote_ip <- [{198, 51, 100, 7}, {0x2001, 0xDB8, 0, 0, 0, 0, 0, 0x7}] do
        conn =
          post(%{conn | remote_ip: remote_ip}, @request_path, %{"email" => "nobody@example.com"})

        assert_error(conn, 404, "email_not_found")
      end

      counted = EmailAuthEvent |> Repo.all() |> Enum.map(& &1.client_ip) |> Enum.sort()
      assert counted == ["198.51.100.7", "2001:db8::/64"]
    end

    test "an IPv6 client is rate limited once its /64 has spent its hourly limit", %{conn: conn} do
      for n <- 1..20 do
        insert_request_event!("other-#{n}@example.com", "2001:db8::/64", seconds_ago(600))
      end

      conn = %{conn | remote_ip: {0x2001, 0xDB8, 0, 0, 0, 0, 0, 0x7}}

      limited = post(conn, @request_path, %{"email" => "nobody@example.com"})
      assert_error(limited, 429, "rate_limited")
      assert retry_after(limited) in 2_990..3_000
    end

    test "a malformed or missing email gets invalid_email", %{conn: conn} do
      for body <- [%{"email" => "not-an-email"}, %{"email" => ""}, %{"email" => 42}, %{}] do
        assert_error(post(conn, @request_path, body), 422, "invalid_email")
      end

      assert Bamboo.SentEmail.all() == []
    end

    test "a second request inside the cooldown is rate limited with retry-after", %{conn: conn} do
      insert_owner!("login-cooldown@example.com")
      body = %{"email" => "login-cooldown@example.com"}

      assert %{"status" => "code_sent"} = conn |> post(@request_path, body) |> json_response(200)

      conn = post(conn, @request_path, body)

      assert_error(conn, 429, "rate_limited")
      assert retry_after(conn) in 1..60
      assert [_only_the_first] = Bamboo.SentEmail.all()
    end

    test "retry-after carries the remaining cooldown seconds", %{conn: conn} do
      user = insert_owner!("login-remaining@example.com")
      insert_code!(user, "111111", inserted_at: seconds_ago(20))

      conn = post(conn, @request_path, %{"email" => user.email})

      assert_error(conn, 429, "rate_limited")
      assert retry_after(conn) in 39..40
    end

    test "a request after the cooldown is served again", %{conn: conn} do
      user = insert_owner!("login-after-cooldown@example.com")
      insert_code!(user, "111111", inserted_at: seconds_ago(61))

      conn = post(conn, @request_path, %{"email" => user.email})

      assert %{"status" => "code_sent"} = json_response(conn, 200)
    end

    test "the hourly per-email request limit still applies", %{conn: conn} do
      user = insert_owner!("login-hourly-email@example.com")
      for _ <- 1..5, do: insert_request_event!(user.email, nil, seconds_ago(600))

      conn = post(conn, @request_path, %{"email" => user.email})

      assert_error(conn, 429, "rate_limited")
      assert retry_after(conn) in 2_990..3_000
      assert Bamboo.SentEmail.all() == []
    end

    test "the hourly per-IP request limit still applies", %{conn: conn} do
      user = insert_owner!("login-hourly-ip@example.com")

      for n <- 1..20 do
        insert_request_event!("other-#{n}@example.com", "203.0.113.9", seconds_ago(600))
      end

      conn =
        conn
        |> from_client("203.0.113.9")
        |> post(@request_path, %{"email" => user.email})

      assert_error(conn, 429, "rate_limited")
      assert retry_after(conn) in 2_990..3_000
      assert Bamboo.SentEmail.all() == []
      # The refused request spent none of the email's hourly slots.
      refute Enum.any?(Repo.all(EmailAuthEvent), &(&1.email == user.email))
    end

    test "a User whose stored email has upper-case letters gets a code that opens a session", %{
      conn: conn
    } do
      user = insert_owner!("Login-Mixed-Case@Example.com")

      assert %{"status" => "code_sent"} =
               conn
               |> post(@request_path, %{"email" => "login-mixed-case@example.com"})
               |> json_response(200)

      body =
        conn
        |> post(@verify_path, verify_body("login-mixed-case@example.com", mailed_code()))
        |> json_response(200)

      assert body["me"]["user"]["id"] == user.id
    end

    @tag :capture_log
    test "a delivery failure gets code_send_failed and does not start the cooldown", %{conn: conn} do
      insert_owner!("login-mail-down@example.com")
      body = %{"email" => "login-mail-down@example.com"}

      with_mailer(FailingMailAdapter, fn ->
        assert_error(post(conn, @request_path, body), 502, "code_send_failed")
      end)

      assert %{"status" => "code_sent"} = conn |> post(@request_path, body) |> json_response(200)
    end

    @tag :capture_log
    test "a delivery that exits gets code_send_failed and keeps the previous code valid", %{
      conn: conn
    } do
      user = insert_owner!("login-mail-timeout@example.com")
      insert_code!(user, "123456", inserted_at: seconds_ago(61))

      with_mailer(ExitingMailAdapter, fn ->
        assert_error(
          post(conn, @request_path, %{"email" => user.email}),
          502,
          "code_send_failed"
        )
      end)

      assert [%EmailVerificationCode{consumed_at: nil}] = Repo.all(EmailVerificationCode)

      assert %{"accessToken" => _} =
               conn |> post(@verify_path, verify_body(user.email, "123456")) |> json_response(200)
    end
  end

  describe "POST /api/auth/login/verify-code — code checks" do
    test "the mailed code opens a session", %{conn: conn} do
      user = insert_owner!("login-verify@example.com")
      post(conn, @request_path, %{"email" => user.email})

      conn = post(conn, @verify_path, verify_body(user.email, mailed_code()))

      body = json_response(conn, 200)
      assert Map.keys(body) == ["accessToken", "me", "refreshToken", "tokenType"]
      assert body["tokenType"] == "Bearer"
      assert is_binary(body["accessToken"]) and body["accessToken"] != ""
      assert is_binary(body["refreshToken"]) and body["refreshToken"] != ""
      assert body["me"]["user"]["id"] == user.id
      assert body["me"]["user"]["email"] == "login-verify@example.com"
    end

    test "matches the email regardless of case and surrounding spaces", %{conn: conn} do
      user = insert_owner!("login-verify-case@example.com")
      insert_code!(user, "123456")

      conn = post(conn, @verify_path, verify_body(" Login-Verify-Case@Example.com ", "123456"))

      assert %{"accessToken" => _} = json_response(conn, 200)
    end

    test "a wrong code gets code_invalid and the right one still works", %{conn: conn} do
      user = insert_owner!("login-wrong@example.com")
      insert_code!(user, "123456")

      assert_error(
        post(conn, @verify_path, verify_body(user.email, "654321")),
        422,
        "code_invalid"
      )

      assert %{"accessToken" => _} =
               conn |> post(@verify_path, verify_body(user.email, "123456")) |> json_response(200)
    end

    test "an email with no pending code gets code_invalid", %{conn: conn} do
      user = insert_owner!("login-no-code@example.com")

      assert_error(
        post(conn, @verify_path, verify_body(user.email, "123456")),
        422,
        "code_invalid"
      )

      assert_error(
        post(conn, @verify_path, verify_body("nobody@example.com", "123456")),
        422,
        "code_invalid"
      )
    end

    test "an expired code gets code_expired", %{conn: conn} do
      user = insert_owner!("login-expired@example.com")
      insert_code!(user, "123456", inserted_at: seconds_ago(601), expires_at: seconds_ago(1))

      conn = post(conn, @verify_path, verify_body(user.email, "123456"))

      assert_error(conn, 401, "code_expired")
    end

    test "the fifth wrong attempt locks the code, and the right code is refused afterwards", %{
      conn: conn
    } do
      user = insert_owner!("login-lockout@example.com")
      insert_code!(user, "123456", inserted_at: seconds_ago(61))
      wrong = verify_body(user.email, "000000")

      for _ <- 1..4 do
        assert_error(post(conn, @verify_path, wrong), 422, "code_invalid")
      end

      assert_error(post(conn, @verify_path, wrong), 429, "too_many_attempts")

      assert_error(
        post(conn, @verify_path, verify_body(user.email, "123456")),
        429,
        "too_many_attempts"
      )

      # A new code is the only way out of the lockout.
      post(conn, @request_path, %{"email" => user.email})

      assert %{"accessToken" => _} =
               conn
               |> post(@verify_path, verify_body(user.email, mailed_code()))
               |> json_response(200)
    end

    test "a code cannot be used twice", %{conn: conn} do
      user = insert_owner!("login-reuse@example.com")
      insert_code!(user, "123456")
      body = verify_body(user.email, "123456")

      assert %{"accessToken" => _} = conn |> post(@verify_path, body) |> json_response(200)

      assert_error(post(conn, @verify_path, body), 422, "code_invalid")
    end

    test "a new code invalidates the previous one", %{conn: conn} do
      user = insert_owner!("login-supersede@example.com")
      insert_code!(user, "111111", inserted_at: seconds_ago(61))
      post(conn, @request_path, %{"email" => user.email})
      new_code = mailed_code()

      # Skip the one-in-a-million run where the fresh code repeats the old one.
      if new_code != "111111" do
        assert_error(
          post(conn, @verify_path, verify_body(user.email, "111111")),
          422,
          "code_invalid"
        )
      end

      assert %{"accessToken" => _} =
               conn |> post(@verify_path, verify_body(user.email, new_code)) |> json_response(200)
    end

    test "a missing or blank deviceId is refused without spending the code", %{conn: conn} do
      user = insert_owner!("login-device@example.com")
      insert_code!(user, "123456")
      body = verify_body(user.email, "123456")

      for bad <- [
            Map.delete(body, "deviceId"),
            %{body | "deviceId" => "  "},
            %{body | "deviceId" => 7}
          ] do
        assert_error(post(conn, @verify_path, bad), 422, "code_invalid")
      end

      assert %{"accessToken" => _} = conn |> post(@verify_path, body) |> json_response(200)
    end

    test "a deviceId over 255 bytes is refused without spending the code", %{conn: conn} do
      user = insert_owner!("login-device-long@example.com")
      insert_code!(user, "123456")
      body = verify_body(user.email, "123456")

      too_long = %{body | "deviceId" => String.duplicate("d", 256)}
      assert_error(post(conn, @verify_path, too_long), 422, "code_invalid")
      assert Repo.aggregate(DeviceSession, :count) == 0

      longest = String.duplicate("d", 255)
      conn = post(conn, @verify_path, %{body | "deviceId" => longest})

      assert %{"refreshToken" => refresh_token} = json_response(conn, 200)
      assert device_session(refresh_token).device_id == longest
    end

    test "a deviceId with a NUL character or of 100 four-byte characters is refused without spending the code",
         %{conn: conn} do
      user = insert_owner!("login-device-unstorable@example.com")
      insert_code!(user, "123456")
      body = verify_body(user.email, "123456")

      for refused <- [@device_id_with_nul, @device_id_of_wide_characters] do
        assert_error(
          post(conn, @verify_path, %{body | "deviceId" => refused}),
          422,
          "code_invalid"
        )
      end

      assert Repo.aggregate(DeviceSession, :count) == 0
      assert %{"accessToken" => _} = conn |> post(@verify_path, body) |> json_response(200)
    end

    test "a missing code or email gets code_invalid", %{conn: conn} do
      user = insert_owner!("login-missing@example.com")
      insert_code!(user, "123456")
      body = verify_body(user.email, "123456")

      for bad <- [
            Map.delete(body, "code"),
            %{body | "code" => 123_456},
            Map.delete(body, "email")
          ] do
        assert_error(post(conn, @verify_path, bad), 422, "code_invalid")
      end
    end
  end

  describe "POST /api/auth/login/verify-code — per-IP failure limit" do
    test "a failed verification is counted against the caller's IP", %{conn: conn} do
      user = insert_owner!("login-ip-failure@example.com")
      insert_code!(user, "123456")

      conn
      |> from_client("203.0.113.30")
      |> post(@verify_path, verify_body(user.email, "000000"))
      |> assert_error(422, "code_invalid")

      assert [%EmailAuthEvent{kind: "verification_failure", client_ip: "203.0.113.30"}] =
               Repo.all(EmailAuthEvent)
    end

    test "a successful verification is not counted", %{conn: conn} do
      user = insert_owner!("login-ip-success@example.com")
      insert_code!(user, "123456")

      assert %{"accessToken" => _} =
               conn
               |> from_client("203.0.113.31")
               |> post(@verify_path, verify_body(user.email, "123456"))
               |> json_response(200)

      assert Repo.all(EmailAuthEvent) == []
    end

    test "twenty failures from one IP rate limit its next verification, across emails", %{
      conn: conn
    } do
      user = insert_owner!("login-ip-spray@example.com")
      insert_code!(user, "123456")

      for n <- 1..20 do
        conn
        |> from_client("203.0.113.32")
        |> post(@verify_path, verify_body("login-spray-#{n}@example.com", "123456"))
        |> assert_error(422, "code_invalid")
      end

      limited =
        conn
        |> from_client("203.0.113.32")
        |> post(@verify_path, verify_body(user.email, "123456"))

      assert_error(limited, 429, "rate_limited")
      assert retry_after(limited) in 3_590..3_600
    end

    test "a limited IP is refused even with the right code, which stays usable elsewhere", %{
      conn: conn
    } do
      user = insert_owner!("login-ip-limited@example.com")
      insert_code!(user, "123456")

      for _ <- 1..20 do
        insert_verify_failure_event!("203.0.113.33", seconds_ago(600))
      end

      limited =
        conn
        |> from_client("203.0.113.33")
        |> post(@verify_path, verify_body(user.email, "123456"))

      assert_error(limited, 429, "rate_limited")
      assert retry_after(limited) in 2_990..3_000

      # The refused request neither spent the code nor counted as an attempt.
      assert [%EmailVerificationCode{consumed_at: nil, attempts: 0}] =
               Repo.all(EmailVerificationCode)

      assert %{"accessToken" => _} =
               conn
               |> from_client("203.0.113.34")
               |> post(@verify_path, verify_body(user.email, "123456"))
               |> json_response(200)
    end

    test "failures older than an hour are not counted", %{conn: conn} do
      user = insert_owner!("login-ip-old-failures@example.com")
      insert_code!(user, "123456")

      for _ <- 1..20 do
        insert_verify_failure_event!("203.0.113.35", seconds_ago(3_601))
      end

      assert %{"accessToken" => _} =
               conn
               |> from_client("203.0.113.35")
               |> post(@verify_path, verify_body(user.email, "123456"))
               |> json_response(200)
    end
  end

  describe "POST /api/auth/login/verify-code — session" do
    test "me equals the GET /api/me body obtained with the returned access token", %{conn: conn} do
      user = insert_owner!("login-me@example.com")
      [membership] = user.memberships
      put_trial!(membership.account_id, 7 * 86_400)

      body = verify!(conn, user)

      me =
        conn
        |> put_req_header("authorization", "Bearer " <> body["accessToken"])
        |> get("/api/me")
        |> json_response(200)

      assert body["me"] == me
      assert Map.keys(me) == ["account", "membership", "onboarding", "user"]
      assert me["account"]["id"] == membership.account_id
      assert me["account"]["access"] == %{"canUseApp" => true, "reason" => nil}
      assert me["membership"] == %{"role" => "owner"}
    end

    test "a User with two Accounts gets the one they own", %{conn: conn} do
      user =
        user_with_memberships(%{email: "login-two@example.com"}, [
          {%{plan: :family_4, name: "Someone else's family"}, :member},
          {%{plan: :individual, name: "Own account"}, :owner}
        ])

      member = membership_of(user, "Someone else's family")
      owner = membership_of(user, "Own account")
      # The owned Account is the newer one, so age alone would not pick it.
      set_membership!(member, joined_at: seconds_ago(86_400))
      set_membership!(owner, joined_at: seconds_ago(60))

      body = verify!(conn, user)

      assert Map.keys(body) == ["accessToken", "me", "refreshToken", "tokenType"]
      assert body["me"]["account"]["id"] == owner.account_id
      assert body["me"]["membership"] == %{"role" => "owner"}
    end

    test "without an owned Account the earliest active Membership wins", %{conn: conn} do
      user =
        user_with_memberships(%{email: "login-earliest@example.com"}, [
          {%{plan: :family_4, name: "Joined last"}, :member},
          {%{plan: :family_6, name: "Joined first"}, :member},
          {%{plan: :family_4, name: "Suspended long ago"}, :member}
        ])

      last = membership_of(user, "Joined last")
      first = membership_of(user, "Joined first")
      suspended = membership_of(user, "Suspended long ago")
      set_membership!(last, joined_at: seconds_ago(60))
      set_membership!(first, joined_at: seconds_ago(86_400))
      set_membership!(suspended, joined_at: seconds_ago(30 * 86_400), status: :suspended)

      body = verify!(conn, user)

      assert body["me"]["account"]["id"] == first.account_id
      assert body["me"]["membership"] == %{"role" => "member"}
    end

    test "a Membership without joined_at is ordered by when it was created", %{conn: conn} do
      user =
        user_with_memberships(%{email: "login-no-joined-at@example.com"}, [
          {%{plan: :family_4, name: "Joined an hour ago"}, :member},
          {%{plan: :family_6, name: "Created a day ago"}, :member}
        ])

      joined = membership_of(user, "Joined an hour ago")
      legacy = membership_of(user, "Created a day ago")
      set_membership!(joined, joined_at: seconds_ago(3_600))
      set_membership!(legacy, joined_at: nil, inserted_at: seconds_ago(86_400))

      body = verify!(conn, user)

      assert body["me"]["account"]["id"] == legacy.account_id
    end

    test "a User who was only invited gets account_not_found", %{conn: conn} do
      [host_membership] = insert_owner!("login-host@example.com").memberships
      invited = user_with_memberships(%{email: "login-invited@example.com"}, [])

      %AccountMembership{}
      |> AccountMembership.changeset(%{
        account_id: host_membership.account_id,
        user_id: invited.id,
        role: :member,
        status: :invited
      })
      |> Repo.insert!()

      insert_code!(invited, "123456")

      conn = post(conn, @verify_path, verify_body(invited.email, "123456"))

      assert_error(conn, 401, "account_not_found")
      assert [%EmailVerificationCode{consumed_at: nil}] = Repo.all(EmailVerificationCode)
    end

    test "a User who has not finished onboarding still gets a session", %{conn: conn} do
      user = insert_owner!("login-onboarding@example.com")

      body = verify!(conn, user)

      assert body["me"]["onboarding"] == %{"isComplete" => false}
    end

    test "a User who finished onboarding is reported as complete", %{conn: conn} do
      user = insert_owner!("login-onboarded@example.com")

      user
      |> Ecto.Changeset.change(onboarding_completed_at: DateTime.utc_now())
      |> Repo.update!()

      assert verify!(conn, user)["me"]["onboarding"] == %{"isComplete" => true}
    end

    test "a User whose trial expired still gets a session, locked out of the app", %{conn: conn} do
      user = insert_owner!("login-trial-expired@example.com")
      [membership] = user.memberships
      put_trial!(membership.account_id, -86_400)

      body = verify!(conn, user)

      assert is_binary(body["accessToken"])

      assert body["me"]["account"]["access"] == %{
               "canUseApp" => false,
               "reason" => "trial_expired"
             }
    end
  end

  describe "POST /api/auth/login/verify-code — Device session" do
    test "opening a session stores a Device session for the refresh token", %{conn: conn} do
      user = insert_owner!("login-device-session@example.com")
      [membership] = user.memberships

      body = verify!(conn, user)

      assert [%DeviceSession{} = session] = Repo.all(DeviceSession)
      assert session.token_hash == token_hash(body["refreshToken"])
      assert session.user_id == user.id
      assert session.membership_id == membership.id
      assert session.device_id == @device_id
      assert session.revoked_at == nil
      assert session.replaced_by_id == nil
      assert_in_delta DateTime.diff(session.expires_at, DateTime.utc_now()), 30 * 86_400, 5
    end

    test "the refresh token names its Device session and expires with it", %{conn: conn} do
      user = insert_owner!("login-device-claims@example.com")

      body = verify!(conn, user)

      assert [%DeviceSession{} = session] = Repo.all(DeviceSession)

      assert {:ok, %{"typ" => "refresh", "sid" => sid, "sub" => sub, "exp" => exp}} =
               Guardian.decode_and_verify(body["refreshToken"])

      assert sid == session.id
      assert sub == user.id
      assert DateTime.compare(DateTime.from_unix!(exp), session.expires_at) == :eq
    end

    test "the access token carries the claims of the User and the Membership", %{conn: conn} do
      user = insert_owner!("login-device-access@example.com")
      [membership] = user.memberships

      body = verify!(conn, user)

      assert {:ok, claims} = Guardian.decode_and_verify(body["accessToken"])
      assert claims["typ"] == "access_v2"
      assert claims["sub"] == user.id
      assert claims["membership_id"] == membership.id
      assert claims["account_id"] == membership.account_id
      refute Map.has_key?(claims, "sid")
    end

    test "logging in again on the same device ends the session it had", %{conn: conn} do
      user = insert_owner!("login-device-again@example.com")

      first = verify!(conn, user)
      second = verify!(conn, user)

      assert %DeviceSession{revoked_at: %DateTime{}, replaced_by_id: nil} =
               device_session(first["refreshToken"])

      assert %DeviceSession{revoked_at: nil} = device_session(second["refreshToken"])

      conn = post(conn, "/api/auth/refresh", %{"refreshToken" => first["refreshToken"]})
      assert_error(conn, 401, "refresh_token_revoked")
    end

    test "a login leaves the User's other devices and other Users' sessions alone", %{
      conn: conn
    } do
      user = insert_owner!("login-device-own@example.com")
      other_user = insert_owner!("login-device-other@example.com")

      other_device = verify!(conn, user, "another-phone")
      other_person = verify!(conn, other_user)
      verify!(conn, user)

      assert %DeviceSession{revoked_at: nil, device_id: "another-phone"} =
               device_session(other_device["refreshToken"])

      assert %DeviceSession{revoked_at: nil, device_id: @device_id} =
               device_session(other_person["refreshToken"])

      assert Repo.aggregate(DeviceSession, :count) == 3
    end
  end

  describe "POST /api/auth/signup/request-code" do
    test "sends a code to a new email and stores it without a User", %{conn: conn} do
      conn = post(conn, @signup_request_path, %{"email" => "  New-Person@Example.com "})

      assert json_response(conn, 200) == %{
               "status" => "code_sent",
               "expiresInSeconds" => 600,
               "resendAvailableInSeconds" => 60
             }

      assert [%EmailVerificationCode{user_id: nil, consumed_at: nil} = row] =
               Repo.all(EmailVerificationCode)

      assert row.email == "new-person@example.com"
      assert row.code_hash == EmailCodeAuth.hash_code(mailed_code())
      assert [email] = Bamboo.SentEmail.all()
      assert [{_name, "new-person@example.com"}] = email.to
      assert_nothing_registered()
    end

    test "a registered email gets email_already_exists and no code is stored or sent", %{
      conn: conn
    } do
      insert_owner!("signup-taken@example.com")

      conn = post(conn, @signup_request_path, %{"email" => " Signup-Taken@Example.com"})

      assert_error(conn, 409, "email_already_exists")
      assert Repo.aggregate(EmailVerificationCode, :count) == 0
      assert Bamboo.SentEmail.all() == []
    end

    test "a registered email counts against the caller's IP and not against the email", %{
      conn: conn
    } do
      insert_owner!("signup-taken-ip@example.com")

      conn =
        conn
        |> from_client("203.0.113.30")
        |> post(@signup_request_path, %{"email" => "signup-taken-ip@example.com"})

      assert_error(conn, 409, "email_already_exists")

      assert [%EmailAuthEvent{kind: "request", client_ip: "203.0.113.30"} = event] =
               Repo.all(EmailAuthEvent)

      assert event.email != "signup-taken-ip@example.com"
    end

    test "registered emails from one IP are rate limited once its hourly limit is spent", %{
      conn: conn
    } do
      insert_owner!("signup-probed@example.com")

      for n <- 1..20 do
        insert_request_event!("other-#{n}@example.com", "203.0.113.30", seconds_ago(600))
      end

      conn =
        conn
        |> from_client("203.0.113.30")
        |> post(@signup_request_path, %{"email" => "signup-probed@example.com"})

      assert_error(conn, 429, "rate_limited")
      assert retry_after(conn) in 2_990..3_000
    end

    test "a malformed or missing email gets invalid_email", %{conn: conn} do
      for body <- [%{"email" => "not-an-email"}, %{"email" => ""}, %{"email" => 42}, %{}] do
        assert_error(post(conn, @signup_request_path, body), 422, "invalid_email")
      end

      assert Bamboo.SentEmail.all() == []
    end

    test "a second request inside the cooldown is rate limited with retry-after", %{conn: conn} do
      body = %{"email" => "signup-cooldown@example.com"}

      assert %{"status" => "code_sent"} =
               conn |> post(@signup_request_path, body) |> json_response(200)

      conn = post(conn, @signup_request_path, body)

      assert_error(conn, 429, "rate_limited")
      assert retry_after(conn) in 1..60
      assert [_only_the_first] = Bamboo.SentEmail.all()
    end

    test "the cooldown is shared with login: a sign-up code delays the first login code", %{
      conn: conn
    } do
      insert_signup_code!("signup-then-login@example.com", "111111", inserted_at: seconds_ago(20))
      insert_owner!("signup-then-login@example.com")

      conn = post(conn, @request_path, %{"email" => "signup-then-login@example.com"})

      assert_error(conn, 429, "rate_limited")
      assert retry_after(conn) in 39..40
    end

    test "the hourly per-email request limit applies", %{conn: conn} do
      for _ <- 1..5 do
        insert_request_event!("signup-hourly@example.com", nil, seconds_ago(600))
      end

      conn = post(conn, @signup_request_path, %{"email" => "signup-hourly@example.com"})

      assert_error(conn, 429, "rate_limited")
      assert retry_after(conn) in 2_990..3_000
      assert Bamboo.SentEmail.all() == []
    end

    test "the hourly per-IP request limit applies", %{conn: conn} do
      for n <- 1..20 do
        insert_request_event!("other-#{n}@example.com", "203.0.113.31", seconds_ago(600))
      end

      conn =
        conn
        |> from_client("203.0.113.31")
        |> post(@signup_request_path, %{"email" => "signup-hourly-ip@example.com"})

      assert_error(conn, 429, "rate_limited")
      assert retry_after(conn) in 2_990..3_000
      assert Bamboo.SentEmail.all() == []
    end

    test "rotating x-forwarded-for does not give a new email a fresh per-IP bucket", %{
      conn: conn
    } do
      for n <- 1..19 do
        insert_request_event!("other-#{n}@example.com", "127.0.0.1", seconds_ago(600))
      end

      request = fn forwarded_for, email ->
        conn
        |> put_req_header("x-forwarded-for", forwarded_for)
        |> post(@signup_request_path, %{"email" => email})
      end

      # The twentieth request of the hour from this socket address.
      assert %{"status" => "code_sent"} =
               "203.0.113.40" |> request.("signup-rotate-1@example.com") |> json_response(200)

      limited = request.("203.0.113.41", "signup-rotate-2@example.com")
      assert_error(limited, 429, "rate_limited")
      assert retry_after(limited) in 2_990..3_000
      assert [_only_the_first] = Bamboo.SentEmail.all()
    end

    test "a client whose address cannot be resolved is counted in the shared bucket", %{
      conn: conn
    } do
      for n <- 1..19 do
        insert_request_event!("other-#{n}@example.com", "unresolved", seconds_ago(600))
      end

      # What a listener on a Unix socket reports. (`nil` would not do: the
      # test adapter replaces it with 127.0.0.1.)
      conn = %{conn | remote_ip: {:local, "/tmp/api.sock"}}

      assert %{"status" => "code_sent"} =
               conn
               |> post(@signup_request_path, %{"email" => "signup-unresolved-1@example.com"})
               |> json_response(200)

      limited = post(conn, @signup_request_path, %{"email" => "signup-unresolved-2@example.com"})
      assert_error(limited, 429, "rate_limited")
      assert retry_after(limited) in 2_990..3_000
      assert [_only_the_first] = Bamboo.SentEmail.all()
    end

    @tag :capture_log
    test "a delivery failure gets code_send_failed, stores no code and spends the request", %{
      conn: conn
    } do
      body = %{"email" => "signup-mail-down@example.com"}

      with_mailer(FailingMailAdapter, fn ->
        assert_error(post(conn, @signup_request_path, body), 502, "code_send_failed")
      end)

      assert Repo.aggregate(EmailVerificationCode, :count) == 0
      assert Repo.aggregate(EmailAuthEvent, :count) == 2

      assert %{"status" => "code_sent"} =
               conn |> post(@signup_request_path, body) |> json_response(200)
    end

    @tag :capture_log
    test "a delivery that exits gets code_send_failed and keeps the previous code pending", %{
      conn: conn
    } do
      insert_signup_code!("signup-mail-timeout@example.com", "123456",
        inserted_at: seconds_ago(61)
      )

      with_mailer(ExitingMailAdapter, fn ->
        assert_error(
          post(conn, @signup_request_path, %{"email" => "signup-mail-timeout@example.com"}),
          502,
          "code_send_failed"
        )
      end)

      assert [%EmailVerificationCode{consumed_at: nil}] = Repo.all(EmailVerificationCode)
    end
  end

  describe "POST /api/auth/signup/verify-code" do
    test "the mailed code creates the User and opens a session", %{conn: conn} do
      post(conn, @signup_request_path, %{"email" => "signup-verify@example.com"})

      conn =
        post(conn, @signup_verify_path, verify_body(" Signup-Verify@Example.com", mailed_code()))

      body = json_response(conn, 200)
      assert Map.keys(body) == ["accessToken", "me", "refreshToken", "tokenType"]
      assert body["tokenType"] == "Bearer"
      assert is_binary(body["accessToken"]) and body["accessToken"] != ""
      assert is_binary(body["refreshToken"]) and body["refreshToken"] != ""

      assert [%User{email: "signup-verify@example.com"} = user] = Repo.all(User)
      assert body["me"]["user"]["id"] == user.id
      assert body["me"]["user"]["email"] == "signup-verify@example.com"
    end

    test "the session it opens stores a Device session for the refresh token", %{conn: conn} do
      body = signup!(conn, "signup-device-session@example.com")

      assert [%User{} = user] = Repo.all(User)
      assert [%AccountMembership{} = membership] = Repo.all(AccountMembership)

      assert [%DeviceSession{} = session] = Repo.all(DeviceSession)
      assert session.token_hash == token_hash(body["refreshToken"])
      assert session.user_id == user.id
      assert session.membership_id == membership.id
      assert session.device_id == @device_id
      assert session.revoked_at == nil
    end

    test "a fresh sign-up is on a seven day Trial, can use the app and has not onboarded", %{
      conn: conn
    } do
      body = signup!(conn, "signup-me@example.com")

      me =
        conn
        |> put_req_header("authorization", "Bearer " <> body["accessToken"])
        |> get("/api/me")
        |> json_response(200)

      assert body["me"] == me
      assert me["user"]["displayName"] == "signup-me"
      assert me["account"]["type"] == "individual"
      assert me["account"]["subscriptionStatus"] == "none"
      assert me["account"]["timezone"] == nil
      assert me["account"]["access"] == %{"canUseApp" => true, "reason" => nil}
      assert me["membership"] == %{"role" => "owner"}
      assert me["onboarding"] == %{"isComplete" => false}

      assert {:ok, trial_ends_at, 0} = DateTime.from_iso8601(me["account"]["trialEndsAt"])
      assert_in_delta DateTime.diff(trial_ends_at, DateTime.utc_now(), :second), 7 * 86_400, 5
    end

    test "creates the User, an individual Account, the owner Membership and the Trial", %{
      conn: conn
    } do
      signup!(conn, "signup-records@example.com")

      assert [user] = Repo.all(User)
      assert [account] = Repo.all(Account)
      assert [membership] = Repo.all(AccountMembership)

      assert %User{email: "signup-records@example.com", name: "signup-records", role: :owner} =
               user

      assert user.account_id == account.id
      assert is_nil(user.onboarding_completed_at)

      assert %Account{name: "signup-records", plan: :individual, default_budget_cents: 0} =
               account

      assert is_binary(account.subscription_plan_id)
      assert_in_delta DateTime.diff(DateTime.utc_now(), account.trial_started_at, :second), 0, 5

      assert DateTime.diff(account.trial_ends_at, account.trial_started_at, :second) ==
               7 * 86_400

      assert %AccountMembership{role: :owner, status: :active} = membership
      assert membership.user_id == user.id
      assert membership.account_id == account.id
      assert_in_delta DateTime.diff(DateTime.utc_now(), membership.joined_at, :second), 0, 5
    end

    test "a sign-up that is never verified leaves no User, Account or Membership", %{conn: conn} do
      post(conn, @signup_request_path, %{"email" => "signup-abandoned@example.com"})

      assert_error(
        post(conn, @signup_verify_path, verify_body("signup-abandoned@example.com", "000000")),
        422,
        "code_invalid"
      )

      assert_nothing_registered()
    end

    test "a missing individual Plan row gets unknown_error, is logged and keeps the code pending",
         %{conn: conn} do
      post(conn, @signup_request_path, %{"email" => "signup-no-plan@example.com"})
      code = mailed_code()

      # What a database looks like when the reference Plans were never
      # inserted, or the row was deleted afterwards.
      Plan |> Repo.get_by!(name: "individual") |> Repo.delete!()

      log =
        capture_log(fn ->
          assert_error(
            post(conn, @signup_verify_path, verify_body("signup-no-plan@example.com", code)),
            500,
            "unknown_error"
          )
        end)

      assert log =~ ~s(Plan "individual")
      assert log =~ "subscription_plans"
      refute log =~ "signup-no-plan@example.com"

      assert_nothing_registered()
      assert [%EmailVerificationCode{consumed_at: nil}] = Repo.all(EmailVerificationCode)
    end

    test "a wrong code gets code_invalid and the right one still works", %{conn: conn} do
      insert_signup_code!("signup-wrong@example.com", "123456")

      assert_error(
        post(conn, @signup_verify_path, verify_body("signup-wrong@example.com", "654321")),
        422,
        "code_invalid"
      )

      assert %{"accessToken" => _} =
               conn
               |> post(@signup_verify_path, verify_body("signup-wrong@example.com", "123456"))
               |> json_response(200)
    end

    test "an email with no pending code gets code_invalid", %{conn: conn} do
      conn = post(conn, @signup_verify_path, verify_body("signup-no-code@example.com", "123456"))

      assert_error(conn, 422, "code_invalid")
      assert_nothing_registered()
    end

    test "an expired code gets code_expired and creates nothing", %{conn: conn} do
      insert_signup_code!("signup-expired@example.com", "123456",
        inserted_at: seconds_ago(601),
        expires_at: seconds_ago(1)
      )

      conn = post(conn, @signup_verify_path, verify_body("signup-expired@example.com", "123456"))

      assert_error(conn, 401, "code_expired")
      assert_nothing_registered()
    end

    test "the fifth wrong attempt locks the code, and the right code is refused afterwards", %{
      conn: conn
    } do
      email = "signup-lockout@example.com"
      insert_signup_code!(email, "123456", inserted_at: seconds_ago(61))
      wrong = verify_body(email, "000000")

      for _ <- 1..4 do
        assert_error(post(conn, @signup_verify_path, wrong), 422, "code_invalid")
      end

      assert_error(post(conn, @signup_verify_path, wrong), 429, "too_many_attempts")

      assert_error(
        post(conn, @signup_verify_path, verify_body(email, "123456")),
        429,
        "too_many_attempts"
      )

      assert_nothing_registered()

      # A new code is the only way out of the lockout.
      post(conn, @signup_request_path, %{"email" => email})

      assert %{"accessToken" => _} =
               conn
               |> post(@signup_verify_path, verify_body(email, mailed_code()))
               |> json_response(200)
    end

    test "a code cannot be used twice", %{conn: conn} do
      insert_signup_code!("signup-reuse@example.com", "123456")
      body = verify_body("signup-reuse@example.com", "123456")

      assert %{"accessToken" => _} = conn |> post(@signup_verify_path, body) |> json_response(200)

      assert_error(post(conn, @signup_verify_path, body), 422, "code_invalid")
      assert Repo.aggregate(User, :count) == 1
    end

    test "a new code invalidates the previous one", %{conn: conn} do
      email = "signup-supersede@example.com"
      insert_signup_code!(email, "111111", inserted_at: seconds_ago(61))
      post(conn, @signup_request_path, %{"email" => email})
      new_code = mailed_code()

      # Skip the one-in-a-million run where the fresh code repeats the old one.
      if new_code != "111111" do
        assert_error(
          post(conn, @signup_verify_path, verify_body(email, "111111")),
          422,
          "code_invalid"
        )
      end

      assert %{"accessToken" => _} =
               conn
               |> post(@signup_verify_path, verify_body(email, new_code))
               |> json_response(200)
    end

    test "a missing or blank deviceId is refused without spending the code", %{conn: conn} do
      insert_signup_code!("signup-device@example.com", "123456")
      body = verify_body("signup-device@example.com", "123456")

      for bad <- [
            Map.delete(body, "deviceId"),
            %{body | "deviceId" => "  "},
            %{body | "deviceId" => 7}
          ] do
        assert_error(post(conn, @signup_verify_path, bad), 422, "code_invalid")
      end

      assert_nothing_registered()
      assert %{"accessToken" => _} = conn |> post(@signup_verify_path, body) |> json_response(200)
    end

    test "a deviceId over 255 bytes is refused without spending the code", %{conn: conn} do
      insert_signup_code!("signup-device-long@example.com", "123456")
      body = verify_body("signup-device-long@example.com", "123456")

      too_long = %{body | "deviceId" => String.duplicate("d", 256)}
      assert_error(post(conn, @signup_verify_path, too_long), 422, "code_invalid")
      assert_nothing_registered()

      longest = String.duplicate("d", 255)
      conn = post(conn, @signup_verify_path, %{body | "deviceId" => longest})

      assert %{"refreshToken" => refresh_token} = json_response(conn, 200)
      assert device_session(refresh_token).device_id == longest
    end

    test "a deviceId with a NUL character or of 100 four-byte characters is refused without spending the code",
         %{conn: conn} do
      insert_signup_code!("signup-device-unstorable@example.com", "123456")
      body = verify_body("signup-device-unstorable@example.com", "123456")

      for refused <- [@device_id_with_nul, @device_id_of_wide_characters] do
        assert_error(
          post(conn, @signup_verify_path, %{body | "deviceId" => refused}),
          422,
          "code_invalid"
        )
      end

      assert_nothing_registered()
      assert %{"accessToken" => _} = conn |> post(@signup_verify_path, body) |> json_response(200)
    end

    test "a missing code or email gets code_invalid", %{conn: conn} do
      insert_signup_code!("signup-missing@example.com", "123456")
      body = verify_body("signup-missing@example.com", "123456")

      for bad <- [
            Map.delete(body, "code"),
            %{body | "code" => 123_456},
            Map.delete(body, "email")
          ] do
        assert_error(post(conn, @signup_verify_path, bad), 422, "code_invalid")
      end

      assert_nothing_registered()
    end

    test "an email that got a User after the code was sent gets email_already_exists", %{
      conn: conn
    } do
      insert_signup_code!("signup-raced@example.com", "123456")
      insert_owner!("signup-raced@example.com")

      conn = post(conn, @signup_verify_path, verify_body("signup-raced@example.com", "123456"))

      assert_error(conn, 409, "email_already_exists")
      assert Repo.aggregate(User, :count) == 1
      assert Repo.aggregate(Account, :count) == 1
      assert Repo.aggregate(AccountMembership, :count) == 1
    end
  end

  # ---- helpers ---------------------------------------------------------------

  # No sign-up has created anything yet.
  defp assert_nothing_registered do
    assert Repo.aggregate(User, :count) == 0
    assert Repo.aggregate(Account, :count) == 0
    assert Repo.aggregate(AccountMembership, :count) == 0
  end

  # Verifies a known pending code for `user` on `device_id` and returns
  # the 200 body.
  defp verify!(conn, user, device_id \\ @device_id) do
    insert_code!(user, "123456")
    body = %{verify_body(user.email, "123456") | "deviceId" => device_id}
    conn |> post(@verify_path, body) |> json_response(200)
  end

  # Signs `email` up with a known pending code and returns the 200 body.
  defp signup!(conn, email) do
    insert_signup_code!(email, "123456")
    conn |> post(@signup_verify_path, verify_body(email, "123456")) |> json_response(200)
  end

  # The User's Membership in the Account called `account_name`.
  defp membership_of(user, account_name) do
    Enum.find(user.memberships, &(&1.account.name == account_name))
  end

  defp set_membership!(membership, changes) do
    membership |> Ecto.Changeset.change(changes) |> Repo.update!()
  end

  # Persists a 7-day trial window ending `ends_in_seconds` from now.
  defp put_trial!(account_id, ends_in_seconds) do
    ends_at = DateTime.add(DateTime.utc_now(), ends_in_seconds, :second)

    Account
    |> Repo.get!(account_id)
    |> Account.changeset(%{
      trial_started_at: DateTime.add(ends_at, -7 * 86_400, :second),
      trial_ends_at: ends_at
    })
    |> Repo.update!()
  end

  defp verify_body(email, code) do
    %{"email" => email, "code" => code, "deviceId" => @device_id}
  end

  # Makes the request come from `ip` as the proxy in front of the app
  # would report it: through the header `config/test.exs` names as
  # `:client_ip_header`.
  defp from_client(conn, ip) do
    put_req_header(conn, Application.fetch_env!(:meal_planner_api, :client_ip_header), ip)
  end

  defp assert_error(conn, status, code) do
    assert %{"error" => %{"code" => ^code, "message" => message}} = json_response(conn, status)
    assert is_binary(message) and message != ""
  end

  defp retry_after(conn) do
    assert [value] = get_resp_header(conn, "retry-after")
    String.to_integer(value)
  end

  # The digest a Device session keeps of its refresh token.
  defp token_hash(token), do: :sha256 |> :crypto.hash(token) |> Base.encode16(case: :lower)

  # The Device session row of `refresh_token`.
  defp device_session(refresh_token) do
    Repo.get_by!(DeviceSession, token_hash: token_hash(refresh_token))
  end

  defp seconds_ago(seconds), do: DateTime.add(DateTime.utc_now(), -seconds, :second)

  # The plaintext code of the most recent captured email.
  defp mailed_code do
    email = List.last(Bamboo.SentEmail.all())
    [code] = Regex.run(~r/\b\d{6}\b/, email.text_body)
    code
  end

  defp insert_owner!(email) do
    user_with_memberships(%{email: email, name: "Owner #{email}"}, [
      {%{plan: :individual, name: "Solo #{email}"}, :owner}
    ])
  end

  # Inserts a pending code row; `overrides` replaces any column
  # (`inserted_at`, `expires_at`, `attempts`, `consumed_at`).
  defp insert_code!(user, code, overrides \\ []) do
    attrs =
      Map.merge(
        %{
          user_id: user.id,
          email: user.email,
          code_hash: EmailCodeAuth.hash_code(code),
          expires_at: DateTime.add(DateTime.utc_now(), 600, :second)
        },
        Map.new(overrides)
      )

    %EmailVerificationCode{} |> Ecto.Changeset.change(attrs) |> Repo.insert!()
  end

  # A pending sign-up code: a row that names no User yet.
  defp insert_signup_code!(email, code, overrides \\ []) do
    attrs =
      Map.merge(
        %{
          email: email,
          code_hash: EmailCodeAuth.hash_code(code),
          expires_at: DateTime.add(DateTime.utc_now(), 600, :second)
        },
        Map.new(overrides)
      )

    %EmailVerificationCode{} |> Ecto.Changeset.change(attrs) |> Repo.insert!()
  end

  defp insert_request_event!(email, client_ip, occurred_at) do
    Repo.insert!(%EmailAuthEvent{
      kind: "request",
      email: email,
      client_ip: client_ip,
      occurred_at: occurred_at
    })
  end

  defp insert_verify_failure_event!(client_ip, occurred_at) do
    Repo.insert!(%EmailAuthEvent{
      kind: "verification_failure",
      email: "unknown",
      client_ip: client_ip,
      occurred_at: occurred_at
    })
  end

  defp with_mailer(adapter, fun) do
    original = Application.fetch_env!(:meal_planner_api, MealPlannerApi.Mailer)
    Application.put_env(:meal_planner_api, MealPlannerApi.Mailer, adapter: adapter)

    try do
      fun.()
    after
      Application.put_env(:meal_planner_api, MealPlannerApi.Mailer, original)
    end
  end
end
