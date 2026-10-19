defmodule MealPlannerApi.Services.EmailCodeLoginE2eTest do
  @moduledoc """
  The fixed login code of the `e2e` environment. `config/runtime.exs`
  sets `:e2e_login` there only (`MealPlannerApi.RuntimeConfigTest`);
  these tests set it themselves to check what the login service does with
  it, and that without it nothing changes.
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

  @e2e_email "e2e-user@example.test"
  @other_email "someone-else@example.test"
  @fixed_code "123456"
  @ip "203.0.113.7"

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()
    Bamboo.SentEmail.reset()

    e2e_user = user_with_account(@e2e_email)
    other_user = user_with_account(@other_email)

    %{e2e_user: e2e_user, other_user: other_user}
  end

  describe "with the e2e login configured" do
    setup do
      put_e2e_login(email: @e2e_email, code: @fixed_code)
    end

    test "a code requested for E2E_LOGIN_EMAIL is E2E_LOGIN_CODE and verifies", %{
      e2e_user: e2e_user
    } do
      assert {:ok, _sent} = EmailCodeLogin.request_code(@e2e_email, @ip)

      assert [%EmailVerificationCode{} = row] = Repo.all(EmailVerificationCode)
      assert row.code_hash == EmailCodeAuth.hash_code(@fixed_code)

      assert {:ok, %{user: verified}} =
               EmailCodeLogin.verify_code(@e2e_email, @fixed_code, @ip, &session/2)

      assert verified.id == e2e_user.id
    end

    test "the email is matched in its canonical form" do
      put_e2e_login(email: "  E2E-User@Example.TEST ", code: @fixed_code)

      assert {:ok, _sent} = EmailCodeLogin.request_code("E2E-USER@example.test", @ip)

      assert {:ok, _session} =
               EmailCodeLogin.verify_code(@e2e_email, @fixed_code, @ip, &session/2)
    end

    test "the code is mailed like any other" do
      assert {:ok, _sent} = EmailCodeLogin.request_code(@e2e_email, @ip)

      assert [mail] = Bamboo.SentEmail.all()
      assert mail.text_body =~ @fixed_code
    end

    test "E2E_LOGIN_EMAIL signs in again and again without the request limits" do
      for _sign_in <- 1..8 do
        assert {:ok, _sent} = EmailCodeLogin.request_code(@e2e_email, @ip)

        assert {:ok, _session} =
                 EmailCodeLogin.verify_code(@e2e_email, @fixed_code, @ip, &session/2)
      end

      assert Repo.aggregate(EmailAuthEvent, :count) == 0
    end

    test "a wrong code for E2E_LOGIN_EMAIL is still refused" do
      assert {:ok, _sent} = EmailCodeLogin.request_code(@e2e_email, @ip)

      assert {:error, :code_invalid} =
               EmailCodeLogin.verify_code(@e2e_email, "654321", @ip, &session/2)
    end

    test "another email gets a random code under the usual limits" do
      assert {:ok, _sent} = EmailCodeLogin.request_code(@other_email, @ip)

      assert [%EmailVerificationCode{} = row] =
               Repo.all(from(c in EmailVerificationCode, where: c.email == ^@other_email))

      refute row.code_hash == EmailCodeAuth.hash_code(@fixed_code)

      assert {:error, :code_invalid} =
               EmailCodeLogin.verify_code(@other_email, @fixed_code, @ip, &session/2)

      # The resend cooldown and the hourly counters still apply to it.
      assert {:error, :rate_limited, _retry_after} =
               EmailCodeLogin.request_code(@other_email, @ip)

      assert request_events() == 2
    end

    test "E2E_LOGIN_EMAIL without a User is still not found" do
      put_e2e_login(email: "nobody@example.test", code: @fixed_code)

      assert {:error, :email_not_found} = EmailCodeLogin.request_code("nobody@example.test", @ip)
      assert Repo.aggregate(EmailVerificationCode, :count) == 0
    end
  end

  describe "without the e2e login configured" do
    test "E2E_LOGIN_EMAIL gets a random code under the usual limits" do
      assert {:ok, _sent} = EmailCodeLogin.request_code(@e2e_email, @ip)

      assert [%EmailVerificationCode{} = row] = Repo.all(EmailVerificationCode)
      refute row.code_hash == EmailCodeAuth.hash_code(@fixed_code)

      assert {:error, :rate_limited, _retry_after} =
               EmailCodeLogin.request_code(@e2e_email, @ip)

      assert request_events() == 2
    end
  end

  defp put_e2e_login(e2e_login) do
    previous = Application.fetch_env(:meal_planner_api, :e2e_login)
    Application.put_env(:meal_planner_api, :e2e_login, e2e_login)

    on_exit(fn ->
      case previous do
        {:ok, value} -> Application.put_env(:meal_planner_api, :e2e_login, value)
        :error -> Application.delete_env(:meal_planner_api, :e2e_login)
      end
    end)

    :ok
  end

  defp user_with_account(email) do
    user_with_memberships(%{email: email}, [{%{plan: :individual, name: email}, :owner}])
  end

  # The email's and the IP's slots of the hourly request counters.
  defp request_events do
    Repo.aggregate(from(e in EmailAuthEvent, where: e.kind == "request"), :count)
  end

  defp session(user, membership), do: {:ok, %{user: user, membership: membership}}
end
