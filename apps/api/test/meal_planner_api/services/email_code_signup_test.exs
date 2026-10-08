defmodule MealPlannerApi.Services.EmailCodeSignupTest do
  @moduledoc """
  Branches of `MealPlannerApi.Services.EmailCodeSignup` that the HTTP tests
  in `mobile_auth_controller_test.exs` do not reach: login codes sharing
  the table, and what a failed delivery leaves behind.
  """
  use ExUnit.Case, async: false

  import MealPlannerApi.FactoryHelpers

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Persistence.Auth.EmailAuthEvent
  alias MealPlannerApi.Persistence.Auth.EmailVerificationCode
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.EmailCodeAuth
  alias MealPlannerApi.Services.EmailCodeSignup

  @email "signup-service@example.com"

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

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()
    Bamboo.SentEmail.reset()
    :ok
  end

  # Login codes (`MealPlannerApi.Services.EmailCodeLogin`) share the table
  # and name a User; sign-up must behave as if they were not there.
  describe "login codes" do
    test "verify_code/2 refuses a login code and leaves it pending" do
      user = insert_owner!()
      insert_code!(user.id, "123456")

      assert {:error, :code_invalid} = EmailCodeSignup.verify_code(@email, "123456")
      assert {:error, :code_invalid} = EmailCodeSignup.verify_code(@email, "000000")

      assert [%EmailVerificationCode{consumed_at: nil, attempts: 0}] =
               Repo.all(EmailVerificationCode)

      assert Repo.aggregate(User, :count) == 1
    end
  end

  describe "request_code/2 when delivery fails" do
    @tag :capture_log
    test "an adapter that raises is reported as code_send_failed and stores nothing" do
      assert {:error, :code_send_failed} =
               with_mail_adapter(RaisingMailAdapter, fn ->
                 EmailCodeSignup.request_code(@email, "203.0.113.1")
               end)

      assert Repo.aggregate(EmailVerificationCode, :count) == 0
      assert Repo.aggregate(EmailAuthEvent, :count) == 0
    end
  end

  describe "verify_code/2" do
    test "returns the new User with the Membership the session is scoped to" do
      insert_code!(nil, "123456")

      assert {:ok, %{user: user, membership: membership}} =
               EmailCodeSignup.verify_code(@email, "123456")

      assert user.email == @email
      assert membership.user_id == user.id
      assert membership.account.id == user.account_id
      assert [%EmailVerificationCode{consumed_at: %DateTime{}}] = Repo.all(EmailVerificationCode)
    end

    test "non-string input gets code_invalid" do
      assert {:error, :code_invalid} = EmailCodeSignup.verify_code(nil, "123456")
      assert {:error, :code_invalid} = EmailCodeSignup.verify_code(@email, 123_456)
    end
  end

  defp insert_owner! do
    user_with_memberships(%{email: @email}, [
      {%{plan: :individual, name: "Signup service"}, :owner}
    ])
  end

  defp insert_code!(user_id, code) do
    Repo.insert!(%EmailVerificationCode{
      user_id: user_id,
      email: @email,
      code_hash: EmailCodeAuth.hash_code(code),
      expires_at: DateTime.add(DateTime.utc_now(), 600, :second)
    })
  end

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
