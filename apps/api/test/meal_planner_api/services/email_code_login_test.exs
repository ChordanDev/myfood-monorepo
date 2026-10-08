defmodule MealPlannerApi.Services.EmailCodeLoginTest do
  @moduledoc """
  Branches of `MealPlannerApi.Services.EmailCodeLogin` that the HTTP tests
  in `mobile_auth_controller_test.exs` do not reach: what a failed delivery
  leaves behind, and a mailer adapter that raises instead of answering.
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

  describe "request_code/2 when delivery fails" do
    @tag :capture_log
    test "a refused delivery leaves no code, no counted request, and the previous code usable",
         %{user: user} do
      insert_code!(user, "123456", DateTime.add(DateTime.utc_now(), -120, :second))

      assert {:error, :code_send_failed} =
               with_mail_adapter(RefusingMailAdapter, fn ->
                 EmailCodeLogin.request_code(user.email, "203.0.113.1")
               end)

      assert Repo.aggregate(EmailVerificationCode, :count) == 1
      assert Repo.aggregate(EmailAuthEvent, :count) == 0
      assert {:ok, %{user: verified}} = EmailCodeLogin.verify_code(user.email, "123456")
      assert verified.id == user.id
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
      assert Repo.aggregate(EmailAuthEvent, :count) == 0
    end
  end

  # Sign-up codes (`MealPlannerApi.Services.EmailCodeSignup`) share the
  # table and name no User; login must behave as if they were not there.
  describe "sign-up codes" do
    test "verify_code/2 refuses a sign-up code and leaves it pending", %{user: user} do
      insert_code!(nil, "123456", seconds_ago(30))

      assert {:error, :code_invalid} = EmailCodeLogin.verify_code(user.email, "123456")
      assert {:error, :code_invalid} = EmailCodeLogin.verify_code(user.email, "000000")

      assert [%EmailVerificationCode{user_id: nil, consumed_at: nil, attempts: 0}] =
               Repo.all(EmailVerificationCode)
    end

    test "verify_code/2 still accepts the login code when a newer sign-up code exists", %{
      user: user
    } do
      insert_code!(user, "123456", seconds_ago(120))
      insert_code!(nil, "654321", seconds_ago(30))

      assert {:ok, %{user: verified}} = EmailCodeLogin.verify_code(user.email, "123456")
      assert verified.id == user.id
    end

    test "request_code/2 does not consume a pending sign-up code", %{user: user} do
      insert_code!(nil, "123456", seconds_ago(120))

      assert {:ok, _sent} = EmailCodeLogin.request_code(user.email, nil)

      assert [%EmailVerificationCode{consumed_at: nil}] =
               Repo.all(from(c in EmailVerificationCode, where: is_nil(c.user_id)))
    end
  end

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
