defmodule MealPlannerApiWeb.MobileAuthControllerTest do
  @moduledoc """
  HTTP contract of the mobile login routes (issue #7):

    * `POST /api/auth/login/request-code`
    * `POST /api/auth/login/verify-code`

  Bodies and error codes mirror `apps/mobile/src/features/auth/types/auth.ts`
  and `apps/mobile/src/api/errors.ts`. Expiry and cooldown are simulated by
  inserting rows with past timestamps; delivery is read back from
  `Bamboo.SentEmail` (the test mailer adapter is `Bamboo.LocalAdapter`).
  """
  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.FactoryHelpers

  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Auth.EmailAuthEvent
  alias MealPlannerApi.Persistence.Auth.EmailVerificationCode
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.EmailCodeAuth

  @request_path "/api/auth/login/request-code"
  @verify_path "/api/auth/login/verify-code"
  @device_id "3f0c5f4e-6f0e-4a55-9d0b-1c7f1f6f2a10"

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
        |> put_req_header("x-forwarded-for", "203.0.113.20")
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
        conn |> put_req_header("x-forwarded-for", ip) |> post(@request_path, %{"email" => email})
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

    test "an unknown email from an unusable client IP is answered without being counted", %{
      conn: conn
    } do
      conn =
        conn
        |> put_req_header("x-forwarded-for", "not-an-ip")
        |> post(@request_path, %{"email" => "nobody@example.com"})

      assert_error(conn, 404, "email_not_found")
      assert Repo.aggregate(EmailAuthEvent, :count) == 0
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
        |> put_req_header("x-forwarded-for", "203.0.113.9")
        |> post(@request_path, %{"email" => user.email})

      assert_error(conn, 429, "rate_limited")
      assert retry_after(conn) in 2_990..3_000
      assert Bamboo.SentEmail.all() == []
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

  # ---- helpers ---------------------------------------------------------------

  # Verifies a known pending code for `user` and returns the 200 body.
  defp verify!(conn, user) do
    insert_code!(user, "123456")
    conn |> post(@verify_path, verify_body(user.email, "123456")) |> json_response(200)
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

  defp assert_error(conn, status, code) do
    assert %{"error" => %{"code" => ^code, "message" => message}} = json_response(conn, status)
    assert is_binary(message) and message != ""
  end

  defp retry_after(conn) do
    assert [value] = get_resp_header(conn, "retry-after")
    String.to_integer(value)
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

  defp insert_request_event!(email, client_ip, occurred_at) do
    Repo.insert!(%EmailAuthEvent{
      kind: "request",
      email: email,
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
