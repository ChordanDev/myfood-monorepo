defmodule MealPlannerApi.Services.EmailCodeLoginTest do
  @moduledoc """
  Branches of `MealPlannerApi.Services.EmailCodeLogin` that the HTTP tests
  in `mobile_auth_controller_test.exs` do not reach: when the mail is sent
  and what a failed delivery leaves behind, a mailer adapter that raises
  instead of answering, and a session that cannot be opened.
  """
  use ExUnit.Case, async: false

  import Ecto.Query
  import MealPlannerApi.FactoryHelpers

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Auth.EmailAuthEvent
  alias MealPlannerApi.Persistence.Auth.EmailVerificationCode
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.EmailCodeAuth
  alias MealPlannerApi.Services.EmailCodeLogin

  defmodule RefusingMailAdapter do
    @moduledoc false
    @behaviour Bamboo.Adapter

    @impl true
    def deliver(_email, _config), do: {:error, :smtp_unavailable}

    @impl true
    def handle_config(config), do: config

    @impl true
    def supports_attachments?, do: true
  end

  defmodule RaisingMailAdapter do
    @moduledoc false
    @behaviour Bamboo.Adapter

    @impl true
    def deliver(_email, _config), do: raise("connection refused")

    @impl true
    def handle_config(config), do: config

    @impl true
    def supports_attachments?, do: true
  end

  defmodule ExitingMailAdapter do
    @moduledoc false
    @behaviour Bamboo.Adapter

    @impl true
    def deliver(_email, _config), do: exit(:timeout)

    @impl true
    def handle_config(config), do: config

    @impl true
    def supports_attachments?, do: true
  end

  # Delivers like the test adapter, and tells the test process whether
  # the delivery ran inside a database transaction and which codes were
  # stored by then.
  defmodule ProbingMailAdapter do
    @moduledoc false
    @behaviour Bamboo.Adapter

    @impl true
    def deliver(email, config) do
      send(self(), {:delivered, Repo.in_transaction?(), Repo.all(EmailVerificationCode)})
      Bamboo.LocalAdapter.deliver(email, config)
    end

    @impl true
    def handle_config(config), do: config

    @impl true
    def supports_attachments?, do: true
  end

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()
    Bamboo.SentEmail.reset()

    user =
      user_with_memberships(%{email: "login-service@example.com"}, [
        {%{plan: :individual, name: "Login service"}, :owner}
      ])

    %{user: user}
  end

  describe "request_code/2 delivery" do
    test "the mail is sent after the code is stored, outside the transaction", %{user: user} do
      insert_code!(user, "123456", seconds_ago(120))

      assert {:ok, _sent} =
               with_mail_adapter(ProbingMailAdapter, fn ->
                 EmailCodeLogin.request_code(user.email, "203.0.113.1")
               end)

      assert_received {:delivered, false, codes_at_delivery}
      assert length(codes_at_delivery) == 2

      # Once the mail is out, the new code is the only pending one.
      assert [%EmailVerificationCode{consumed_at: nil} = pending] =
               Repo.all(from(c in EmailVerificationCode, where: is_nil(c.consumed_at)))

      refute pending.code_hash == EmailCodeAuth.hash_code("123456")
    end
  end

  describe "request_code/2 when delivery fails" do
    @tag :capture_log
    test "a refused delivery drops the new code, spends the request and keeps the previous code usable",
         %{user: user} do
      insert_code!(user, "123456", seconds_ago(120))

      assert {:error, :code_send_failed} =
               with_mail_adapter(RefusingMailAdapter, fn ->
                 EmailCodeLogin.request_code(user.email, "203.0.113.1")
               end)

      assert [%EmailVerificationCode{consumed_at: nil} = previous] =
               Repo.all(EmailVerificationCode)

      assert previous.code_hash == EmailCodeAuth.hash_code("123456")
      assert Repo.aggregate(EmailAuthEvent, :count) == 2

      assert {:ok, %{user: verified}} =
               EmailCodeLogin.verify_code(user.email, "123456", "203.0.113.1", &session/2)

      assert verified.id == user.id
    end

    @tag :capture_log
    test "a refused delivery does not start the cooldown", %{user: user} do
      with_mail_adapter(RefusingMailAdapter, fn ->
        assert {:error, :code_send_failed} = EmailCodeLogin.request_code(user.email, nil)
      end)

      assert {:ok, _sent} = EmailCodeLogin.request_code(user.email, nil)
    end

    @tag :capture_log
    test "an adapter that raises is reported as code_send_failed", %{user: user} do
      assert {:error, :code_send_failed} =
               with_mail_adapter(RaisingMailAdapter, fn ->
                 EmailCodeLogin.request_code(user.email, nil)
               end)

      assert Repo.aggregate(EmailVerificationCode, :count) == 0
    end

    @tag :capture_log
    test "an adapter that exits is reported as code_send_failed", %{user: user} do
      assert {:error, :code_send_failed} =
               with_mail_adapter(ExitingMailAdapter, fn ->
                 EmailCodeLogin.request_code(user.email, "203.0.113.1")
               end)

      assert Repo.aggregate(EmailVerificationCode, :count) == 0
    end
  end

  describe "request_code/2 email lookup" do
    test "finds a User whose stored email has upper-case letters" do
      user =
        user_with_memberships(%{email: "Mixed.Case@Example.com"}, [
          {%{plan: :individual, name: "Mixed case"}, :owner}
        ])

      assert {:ok, _sent} = EmailCodeLogin.request_code("mixed.case@example.com", nil)

      assert [%EmailVerificationCode{user_id: user_id, email: "mixed.case@example.com"}] =
               Repo.all(EmailVerificationCode)

      assert user_id == user.id
    end
  end

  describe "verify_code/4" do
    test "a session that cannot be opened leaves the code pending for a retry", %{user: user} do
      insert_code!(user, "123456", seconds_ago(30))

      assert {:error, :session_issue_failed} =
               EmailCodeLogin.verify_code(user.email, "123456", "203.0.113.1", fn _user,
                                                                                  _membership ->
                 {:error, :session_issue_failed}
               end)

      assert [%EmailVerificationCode{consumed_at: nil, attempts: 0}] =
               Repo.all(EmailVerificationCode)

      assert {:ok, %{user: verified}} =
               EmailCodeLogin.verify_code(user.email, "123456", "203.0.113.1", &session/2)

      assert verified.id == user.id
      assert [%EmailVerificationCode{consumed_at: %DateTime{}}] = Repo.all(EmailVerificationCode)
    end

    test "the session is opened with the User and the Membership the code resolves", %{
      user: user
    } do
      insert_code!(user, "123456", seconds_ago(30))
      [membership] = user.memberships

      assert {:ok, %{user: verified, membership: resolved}} =
               EmailCodeLogin.verify_code(user.email, "123456", nil, &session/2)

      assert verified.id == user.id
      assert resolved.id == membership.id
    end
  end

  # Sign-up codes (`MealPlannerApi.Services.EmailCodeSignup`) share the
  # table and name no User; login must behave as if they were not there.
  describe "sign-up codes" do
    test "verify_code/4 refuses a sign-up code and leaves it pending", %{user: user} do
      insert_code!(nil, "123456", seconds_ago(30))

      assert {:error, :code_invalid} =
               EmailCodeLogin.verify_code(user.email, "123456", nil, &session/2)

      assert {:error, :code_invalid} =
               EmailCodeLogin.verify_code(user.email, "000000", nil, &session/2)

      assert [%EmailVerificationCode{user_id: nil, consumed_at: nil, attempts: 0}] =
               Repo.all(EmailVerificationCode)
    end

    test "verify_code/4 still accepts the login code when a newer sign-up code exists", %{
      user: user
    } do
      insert_code!(user, "123456", seconds_ago(120))
      insert_code!(nil, "654321", seconds_ago(30))

      assert {:ok, %{user: verified}} =
               EmailCodeLogin.verify_code(user.email, "123456", nil, &session/2)

      assert verified.id == user.id
    end

    test "request_code/2 does not consume a pending sign-up code", %{user: user} do
      insert_code!(nil, "123456", seconds_ago(120))

      assert {:ok, _sent} = EmailCodeLogin.request_code(user.email, nil)

      assert [%EmailVerificationCode{consumed_at: nil}] =
               Repo.all(from(c in EmailVerificationCode, where: is_nil(c.user_id)))
    end
  end

  # Stands in for the Device session the controller opens.
  defp session(user, membership), do: {:ok, %{user: user, membership: membership}}

  defp insert_code!(user, code, inserted_at) do
    Repo.insert!(%EmailVerificationCode{
      user_id: user && user.id,
      email: "login-service@example.com",
      code_hash: EmailCodeAuth.hash_code(code),
      expires_at: DateTime.add(DateTime.utc_now(), 600, :second),
      inserted_at: inserted_at
    })
  end

  defp seconds_ago(seconds), do: DateTime.add(DateTime.utc_now(), -seconds, :second)

  defp with_mail_adapter(adapter, fun) do
    original = Application.fetch_env!(:meal_planner_api, MealPlannerApi.Mailer)
    Application.put_env(:meal_planner_api, MealPlannerApi.Mailer, adapter: adapter)

    try do
      fun.()
    after
      Application.put_env(:meal_planner_api, MealPlannerApi.Mailer, original)
    end
  end
end
