defmodule MealPlannerApi.RuntimeConfigTest do
  @moduledoc """
  `config/runtime.exs` read for each environment, with the variables a
  shell could set. The `e2e` test doubles (`AI_CLIENT=mock`, the fixed
  login code of `E2E_LOGIN_EMAIL` and a shorter access token) must never
  reach another environment: the release is built with `MIX_ENV=prod`.
  """
  use ExUnit.Case, async: false

  alias MealPlannerApi.AI.GeminiClient
  alias MealPlannerApi.AI.MockClient
  alias MealPlannerApi.Auth.Guardian

  @runtime_config Path.expand("../../config/runtime.exs", __DIR__)

  # Every variable runtime.exs reads that a test here sets, plus the
  # secrets `prod` requires to read the file at all.
  @variables ~w(AI_CLIENT E2E_LOGIN_EMAIL E2E_LOGIN_CODE E2E_ACCESS_TOKEN_TTL_SECONDS
                GUARDIAN_SECRET_KEY SECRET_KEY_BASE)

  setup do
    saved = Map.new(@variables, &{&1, System.get_env(&1)})

    on_exit(fn ->
      Enum.each(saved, fn
        {name, nil} -> System.delete_env(name)
        {name, value} -> System.put_env(name, value)
      end)
    end)

    Enum.each(@variables, &System.delete_env/1)
    System.put_env("GUARDIAN_SECRET_KEY", "runtime-config-test-guardian-key")
    System.put_env("SECRET_KEY_BASE", String.duplicate("k", 64))
    :ok
  end

  describe "AI_CLIENT" do
    test "mock selects MockClient in e2e" do
      System.put_env("AI_CLIENT", "mock")

      assert app_config(:e2e)[:ai_client] == MockClient
    end

    for env <- [:dev, :prod] do
      test "mock raises in #{env}" do
        System.put_env("AI_CLIENT", "mock")

        assert_raise RuntimeError, ~r/AI_CLIENT=mock is forbidden/, fn ->
          app_config(unquote(env))
        end
      end

      test "gemini stays the default in #{env}" do
        assert app_config(unquote(env))[:ai_client] == GeminiClient
      end
    end

    test "gemini stays the default in e2e" do
      assert app_config(:e2e)[:ai_client] == GeminiClient
    end
  end

  describe "E2E_LOGIN_EMAIL and E2E_LOGIN_CODE" do
    test "e2e configures the fixed login code" do
      put_login_variables()

      assert app_config(:e2e)[:e2e_login] == [email: "e2e-user@example.test", code: "123456"]
    end

    for env <- [:dev, :prod, :test] do
      test "#{env} ignores them" do
        put_login_variables()

        refute Keyword.has_key?(app_config(unquote(env)), :e2e_login)
      end
    end

    test "e2e without them has no fixed login code" do
      refute Keyword.has_key?(app_config(:e2e), :e2e_login)
    end

    test "e2e refuses an email without a code" do
      System.put_env("E2E_LOGIN_EMAIL", "e2e-user@example.test")

      assert_raise RuntimeError, ~r/E2E_LOGIN_EMAIL and E2E_LOGIN_CODE/, fn ->
        app_config(:e2e)
      end
    end

    test "e2e refuses a code without an email" do
      System.put_env("E2E_LOGIN_CODE", "123456")

      assert_raise RuntimeError, ~r/E2E_LOGIN_EMAIL and E2E_LOGIN_CODE/, fn ->
        app_config(:e2e)
      end
    end

    test "e2e refuses a code that is not six digits" do
      System.put_env("E2E_LOGIN_EMAIL", "e2e-user@example.test")
      System.put_env("E2E_LOGIN_CODE", "12345")

      assert_raise RuntimeError, ~r/E2E_LOGIN_CODE must be six digits/, fn ->
        app_config(:e2e)
      end
    end
  end

  describe "E2E_ACCESS_TOKEN_TTL_SECONDS" do
    test "e2e shortens both access tokens and keeps the refresh token" do
      System.put_env("E2E_ACCESS_TOKEN_TTL_SECONDS", "2")

      assert app_config(:e2e)[Guardian][:token_ttl] == %{
               "access" => {2, :seconds},
               "access_v2" => {2, :seconds},
               "refresh" => {30, :days}
             }
    end

    test "e2e without it keeps the token lifetimes of config.exs" do
      refute Keyword.has_key?(app_config(:e2e)[Guardian] || [], :token_ttl)
    end

    for env <- [:dev, :prod, :test] do
      test "#{env} ignores it" do
        System.put_env("E2E_ACCESS_TOKEN_TTL_SECONDS", "2")

        refute Keyword.has_key?(app_config(unquote(env))[Guardian] || [], :token_ttl)
      end
    end

    for value <- ["0", "-1", "two", "2s"] do
      test "e2e refuses #{inspect(value)}" do
        System.put_env("E2E_ACCESS_TOKEN_TTL_SECONDS", unquote(value))

        assert_raise RuntimeError,
                     ~r/E2E_ACCESS_TOKEN_TTL_SECONDS must be a positive integer/,
                     fn ->
                       app_config(:e2e)
                     end
      end
    end
  end

  defp app_config(env) do
    @runtime_config
    |> Config.Reader.read!(env: env, target: :host)
    |> Keyword.get(:meal_planner_api, [])
  end

  defp put_login_variables do
    System.put_env("E2E_LOGIN_EMAIL", "e2e-user@example.test")
    System.put_env("E2E_LOGIN_CODE", "123456")
  end
end
