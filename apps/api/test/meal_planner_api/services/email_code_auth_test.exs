defmodule MealPlannerApi.Services.EmailCodeAuthTest do
  @moduledoc """
  Tests for what `MealPlannerApi.Services.EmailCodeAuth` owns: code
  minting and hashing, the verification-code email and the hourly
  request counters.

  The request and verify paths built on top of them are covered by
  `email_code_login_test.exs`, `email_code_signup_test.exs` and
  `mobile_auth_controller_test.exs`.
  """
  use ExUnit.Case, async: false

  import Ecto.Query

  alias Ecto.Adapters.SQL
  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Accounts.User, as: PersistenceUser
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.EmailCodeAuth

  setup do
    :ok = Sandbox.checkout(Repo)
  end

  # Nothing in `lib` subscribes to these two telemetry events; the tests
  # pin that each function still emits its own and only its own.
  describe "code minting and hashing" do
    setup do
      test_pid = self()
      handler_id = "code-telemetry-test-#{System.unique_integer([:positive])}"

      :telemetry.attach_many(
        handler_id,
        [
          [:meal_planner_api, :email_code_auth, :mint_code],
          [:meal_planner_api, :email_code_auth, :hash_code]
        ],
        fn event_name, _measurements, _metadata, _config ->
          send(test_pid, {:telemetry_event, event_name})
        end,
        nil
      )

      on_exit(fn -> :telemetry.detach(handler_id) end)
    end

    test "mint_code/0 returns six digits and emits its telemetry event" do
      assert EmailCodeAuth.mint_code() =~ ~r/^\d{6}$/

      assert_received {:telemetry_event, [:meal_planner_api, :email_code_auth, :mint_code]}
      refute_received {:telemetry_event, _other}
    end

    test "hash_code/1 returns the lower-case SHA-256 hex digest and emits its telemetry event" do
      assert EmailCodeAuth.hash_code("123456") ==
               "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92"

      assert_received {:telemetry_event, [:meal_planner_api, :email_code_auth, :hash_code]}
      refute_received {:telemetry_event, _other}
    end
  end

  describe "code_email/3" do
    test "addresses the email by the User's name and carries the code in both bodies" do
      user = %PersistenceUser{name: "Known User", email: "known@example.com"}

      email = EmailCodeAuth.code_email(user, "known@example.com", "123456")

      assert email.to == {"Known User", "known@example.com"}
      assert email.text_body =~ "123456"
      assert email.html_body =~ "123456"
    end

    test "falls back to the local part of the address for a User without a name" do
      for name <- [nil, ""] do
        user = %PersistenceUser{name: name, email: "nameless@example.com"}

        email = EmailCodeAuth.code_email(user, "nameless@example.com", "123456")

        assert email.to == {"nameless", "nameless@example.com"}
      end
    end
  end

  # The login and sign-up request paths cannot reach this boundary on
  # their own: their 60-second resend cooldown refuses a second request
  # long before the fifth.
  describe "per-email request slots" do
    test "reserve_request_slots/2 allows five requests for one email in an hour and rate limits the sixth" do
      for n <- 1..5 do
        assert :ok =
                 in_transaction(fn ->
                   EmailCodeAuth.reserve_request_slots("limit@example.com", "203.0.113.#{n}")
                 end)
      end

      assert {:error, :rate_limited, retry_after} =
               in_transaction(fn ->
                 EmailCodeAuth.reserve_request_slots("limit@example.com", "203.0.113.6")
               end)

      assert retry_after in 3_590..3_600

      # The refused request is not counted against its IP either.
      refute "203.0.113.6" in request_ips()

      # Another email still has its own counter.
      assert :ok =
               in_transaction(fn ->
                 EmailCodeAuth.reserve_request_slots("other@example.com", "203.0.113.6")
               end)
    end
  end

  # The per-IP counter is the only bound on mail sent to addresses nobody
  # registered, so every request has to land in some bucket: its own
  # address, IPv4 or IPv6, or the one shared by the requests whose
  # address could not be resolved.
  describe "per-IP request slots" do
    test "reserve_ip_request_slot/1 counts an unresolvable IP in the shared bucket" do
      for client_ip <- [nil, "", "not-an-ip", "203.0.113", String.duplicate("1", 4_096), 42] do
        assert :ok = in_transaction(fn -> EmailCodeAuth.reserve_ip_request_slot(client_ip) end)
      end

      assert request_ips() == List.duplicate("unresolved", 6)
    end

    test "reserve_ip_request_slot/1 rate limits the shared bucket once its hourly limit is spent" do
      for client_ip <- Enum.take(Stream.cycle([nil, "not-an-ip"]), 20) do
        assert :ok = in_transaction(fn -> EmailCodeAuth.reserve_ip_request_slot(client_ip) end)
      end

      assert {:error, :rate_limited, retry_after} =
               in_transaction(fn -> EmailCodeAuth.reserve_ip_request_slot(nil) end)

      assert retry_after in 3_590..3_600

      # A resolved address still has its own bucket.
      assert :ok = in_transaction(fn -> EmailCodeAuth.reserve_ip_request_slot("203.0.113.50") end)
    end

    test "reserve_request_slots/2 counts an unresolvable IP in the shared bucket" do
      assert :ok =
               in_transaction(fn ->
                 EmailCodeAuth.reserve_request_slots("slots@example.com", nil)
               end)

      assert request_ips() == ["unresolved"]

      assert Repo.aggregate(from(e in "email_auth_events", where: is_nil(e.client_ip)), :count) ==
               1
    end

    test "reserve_request_slots/2 rate limits the shared bucket once its hourly limit is spent" do
      for n <- 1..20 do
        assert :ok =
                 in_transaction(fn ->
                   EmailCodeAuth.reserve_request_slots("slots-#{n}@example.com", "not-an-ip")
                 end)
      end

      assert {:error, :rate_limited, retry_after} =
               in_transaction(fn ->
                 EmailCodeAuth.reserve_request_slots("slots-21@example.com", nil)
               end)

      assert retry_after in 3_590..3_600
    end

    test "an IPv6 address is a bucket of its own, whatever its spelling" do
      for client_ip <- ["2001:db8::1", " 2001:0DB8:0:0:0:0:0:1 "] do
        assert :ok = in_transaction(fn -> EmailCodeAuth.reserve_ip_request_slot(client_ip) end)
      end

      assert :ok =
               in_transaction(fn ->
                 EmailCodeAuth.reserve_request_slots("slots@example.com", "2001:db8::1")
               end)

      assert request_ips() == List.duplicate("2001:db8::1", 3)
    end

    test "an IPv6 address is rate limited once its hourly limit is spent" do
      for _ <- 1..20 do
        assert :ok =
                 in_transaction(fn -> EmailCodeAuth.reserve_ip_request_slot("2001:db8::1") end)
      end

      assert {:error, :rate_limited, _retry_after} =
               in_transaction(fn -> EmailCodeAuth.reserve_ip_request_slot("2001:db8::1") end)

      assert :ok = in_transaction(fn -> EmailCodeAuth.reserve_ip_request_slot("2001:db8::2") end)
    end
  end

  describe "all-or-nothing request slots" do
    test "reserve_request_slots/2 refused by the per-IP limit spends no slot of the email" do
      for _ <- 1..20 do
        assert :ok =
                 in_transaction(fn -> EmailCodeAuth.reserve_ip_request_slot("203.0.113.70") end)
      end

      assert {:error, :rate_limited, _retry_after} =
               in_transaction(fn ->
                 EmailCodeAuth.reserve_request_slots("spared@example.com", "203.0.113.70")
               end)

      assert email_request_count("spared@example.com") == 0
    end

    test "reserve_request_slots/2 refused by the per-email limit spends no slot of the IP" do
      for n <- 1..5 do
        assert :ok =
                 in_transaction(fn ->
                   EmailCodeAuth.reserve_request_slots("busy@example.com", "203.0.113.#{n}")
                 end)
      end

      assert {:error, :rate_limited, _retry_after} =
               in_transaction(fn ->
                 EmailCodeAuth.reserve_request_slots("busy@example.com", "203.0.113.80")
               end)

      refute "203.0.113.80" in request_ips()
    end
  end

  describe "per-IP verify failures" do
    test "check_verify_failures/1 rate limits an IP once it has 20 failures in the hour" do
      for _ <- 1..19 do
        in_transaction(fn -> EmailCodeAuth.record_verify_failure("203.0.113.90") end)
      end

      assert :ok = in_transaction(fn -> EmailCodeAuth.check_verify_failures("203.0.113.90") end)

      in_transaction(fn -> EmailCodeAuth.record_verify_failure("203.0.113.90") end)

      assert {:error, :rate_limited, retry_after} =
               in_transaction(fn -> EmailCodeAuth.check_verify_failures("203.0.113.90") end)

      assert retry_after in 3_590..3_600
      assert :ok = in_transaction(fn -> EmailCodeAuth.check_verify_failures("203.0.113.91") end)
    end

    test "check_verify_failures/1 takes no lock, so verifications from one IP do not wait on each other" do
      in_transaction(fn -> EmailCodeAuth.record_verify_failure("203.0.113.94") end)

      assert 0 ==
               in_transaction(fn ->
                 assert :ok = EmailCodeAuth.check_verify_failures("203.0.113.94")
                 advisory_lock_count()
               end)
    end

    test "verify failures and code requests are counted apart" do
      for _ <- 1..20 do
        assert :ok =
                 in_transaction(fn -> EmailCodeAuth.reserve_ip_request_slot("203.0.113.92") end)

        in_transaction(fn -> EmailCodeAuth.record_verify_failure("203.0.113.93") end)
      end

      assert :ok = in_transaction(fn -> EmailCodeAuth.check_verify_failures("203.0.113.92") end)
      assert :ok = in_transaction(fn -> EmailCodeAuth.reserve_ip_request_slot("203.0.113.93") end)
    end

    test "an unresolvable IP draws from one shared bucket" do
      for client_ip <- List.duplicate(nil, 10) ++ List.duplicate("not-an-ip", 10) do
        in_transaction(fn -> EmailCodeAuth.record_verify_failure(client_ip) end)
      end

      assert {:error, :rate_limited, _retry_after} =
               in_transaction(fn -> EmailCodeAuth.check_verify_failures(nil) end)
    end
  end

  # ---- Helpers ----------------------------------------------------------------

  # Advisory locks this connection holds right now.
  defp advisory_lock_count do
    %{rows: [[count]]} =
      SQL.query!(
        Repo,
        "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()",
        []
      )

    count
  end

  # The per-email request events counted for `email`.
  defp email_request_count(email) do
    Repo.aggregate(
      from(e in "email_auth_events", where: e.kind == "request" and e.email == ^email),
      :count
    )
  end

  defp in_transaction(fun) do
    {:ok, result} = Repo.transaction(fun)
    result
  end

  # The `client_ip` of every per-IP request event, in no particular order.
  defp request_ips do
    Repo.all(
      from(e in "email_auth_events",
        where: e.kind == "request" and not is_nil(e.client_ip),
        select: e.client_ip
      )
    )
  end
end
