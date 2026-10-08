defmodule MealPlannerApi.Services.EmailCodeAuthTest do
  @moduledoc """
  Tests for what `MealPlannerApi.Services.EmailCodeAuth` owns: code
  minting and hashing, the hourly request counters and the
  account-selection continuation exchange.

  The request and verify paths built on top of them are covered by
  `email_code_login_test.exs`, `email_code_signup_test.exs` and
  `mobile_auth_controller_test.exs`.
  """
  use ExUnit.Case, async: false

  import Ecto.Query
  import MealPlannerApi.FactoryHelpers

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Persistence.Accounts.AccountMembership, as: PersistenceAccountMembership
  alias MealPlannerApi.Persistence.Accounts.User, as: PersistenceUser
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.EmailCodeAuth

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()
    :ok
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

  # ---------------------------------------------------------------------------
  # Phase 3 — Continuations (issue #31 task 3.3)
  # ---------------------------------------------------------------------------
  #
  # Coverage (`design.md` §"Interfaces / Contracts"):
  #
  #   * bearerless first exchange returns a scoped `access_v2` JWT
  #     and consumes the continuation row.
  #   * replay/concurrent exchange (same continuation) fails exactly
  #     once with `:consumed_continuation`; subsequent attempts cannot
  #     mint.
  #   * expired continuation fails with `:expired_continuation`.
  #   * membership outside the continuation's set fails with
  #     `:not_in_continuation_set`; the continuation is NOT consumed.
  #   * foreign bearer (User B's JWT) with User A's continuation fails
  #     with `:foreign_bearer`; the continuation is NOT consumed.
  #   * `switch_account/2` failure (membership inactive) leaves the
  #     continuation UNCONSUMED.
  #
  # Each test calls `EmailCodeAuth.exchange_continuation/3` on a
  # continuation minted by `EmailCodeAuth.mint_test_continuation/3`.
  describe "exchange_continuation/3 (Phase 3 task 3.3)" do
    setup do
      # The exchange MUST mint `access_v2` claims (with `membership_id`)
      # — continuation selection is a v2-only flow. `AccountsMembership.
      # switch_account/2` gates claim shape on `:tenancy_v2_only`; flip
      # the flag for this describe block and restore via `on_exit`.
      previous = Application.get_env(:meal_planner_api, :tenancy_v2_only)
      Application.put_env(:meal_planner_api, :tenancy_v2_only, true)
      on_exit(fn -> Application.put_env(:meal_planner_api, :tenancy_v2_only, previous) end)
      :ok
    end

    test "bearerless first exchange mints a scoped access_v2 JWT and consumes the continuation" do
      user = insert_user_with_two_memberships!("exchange-first@example.com")
      [m1, m2] = user.memberships

      plaintext = EmailCodeAuth.mint_test_continuation(user.id, [m1.id, m2.id])

      assert {:ok, %{membership: membership, claims: claims, access_token: token}} =
               EmailCodeAuth.exchange_continuation(plaintext, to_string(m1.id), principal: nil)

      assert membership.id == m1.id
      assert claims["membership_id"] == Ecto.UUID.cast!(m1.id)
      assert is_binary(token)

      consumed =
        Repo.get_by(MealPlannerApi.Persistence.Auth.AccountSelectionContinuation,
          user_id: user.id
        )

      refute is_nil(consumed.consumed_at)
    end

    test "replay / concurrent exchange fails with :consumed_continuation and mints zero JWTs" do
      user = insert_user_with_two_memberships!("exchange-replay@example.com")
      [m1, m2] = user.memberships

      plaintext = EmailCodeAuth.mint_test_continuation(user.id, [m1.id, m2.id])

      assert {:ok, _} =
               EmailCodeAuth.exchange_continuation(plaintext, to_string(m1.id), principal: nil)

      assert {:error, :consumed_continuation} =
               EmailCodeAuth.exchange_continuation(plaintext, to_string(m1.id), principal: nil)
    end

    # Phase 1+2+verify-report follow-up — the serial first/second
    # exchange above exercises the consume path but cannot race it. The
    # continuation's `SELECT … FOR UPDATE` + advisory lock must serialize
    # N concurrent exchange attempts into exactly one success and N-1
    # :consumed_continuation outcomes (spec §"Selection Continuation
    # Security" / Scenario "Reusing the continuation fails" + design.md
    # §"Interfaces / Contracts" — "concurrent/replayed exchange has one
    # success; pre-mint failures do not consume").
    test "concurrent exchange of the same continuation yields exactly one success and N-1 :consumed_continuation" do
      user = insert_user_with_two_memberships!("exchange-concurrent@example.com")
      [m1, m2] = user.memberships

      plaintext = EmailCodeAuth.mint_test_continuation(user.id, [m1.id, m2.id])

      Sandbox.mode(Repo, {:shared, self()})
      on_exit(fn -> Sandbox.mode(Repo, :auto) end)

      concurrency = 6

      results =
        1..concurrency
        |> Task.async_stream(
          fn _idx ->
            EmailCodeAuth.exchange_continuation(plaintext, to_string(m1.id), principal: nil)
          end,
          max_concurrency: concurrency,
          timeout: 10_000,
          on_timeout: :kill_task
        )
        |> Enum.map(fn {:ok, value} -> value end)

      successes = Enum.count(results, &match?({:ok, _}, &1))
      consumed = Enum.count(results, &match?({:error, :consumed_continuation}, &1))

      assert successes == 1,
             "expected exactly one success among #{concurrency} concurrent exchanges, " <>
               "got #{successes}. results=#{inspect(results)}"

      assert consumed == concurrency - 1,
             "expected #{concurrency - 1} :consumed_continuation, got #{consumed}. " <>
               "results=#{inspect(results)}"

      # Continuation row consumed exactly once.
      consumed_row =
        Repo.get_by(MealPlannerApi.Persistence.Auth.AccountSelectionContinuation,
          user_id: user.id
        )

      refute is_nil(consumed_row.consumed_at)
    end

    test "expired continuation fails with :expired_continuation" do
      user = insert_user_with_two_memberships!("exchange-expired@example.com")
      [m1, m2] = user.memberships

      past = DateTime.add(DateTime.utc_now(), -60, :second)
      plaintext = EmailCodeAuth.mint_test_continuation(user.id, [m1.id, m2.id], expires_at: past)

      assert {:error, :expired_continuation} =
               EmailCodeAuth.exchange_continuation(plaintext, to_string(m1.id), principal: nil)
    end

    test "membership outside the continuation's set fails with :not_in_continuation_set and does NOT consume" do
      user = insert_user_with_two_memberships!("exchange-foreign-set@example.com")
      [m1, m2] = user.memberships

      third_user = insert_user!("exchange-third@example.com", "Third")
      foreign_membership = insert_membership!(third_user)
      plaintext = EmailCodeAuth.mint_test_continuation(user.id, [m1.id, m2.id])

      assert {:error, :not_in_continuation_set} =
               EmailCodeAuth.exchange_continuation(plaintext, to_string(foreign_membership.id),
                 principal: nil
               )

      consumed =
        Repo.get_by(MealPlannerApi.Persistence.Auth.AccountSelectionContinuation,
          user_id: user.id
        )

      assert is_nil(consumed.consumed_at),
             "continuation must NOT be consumed when the membership is outside its set"
    end

    test "foreign bearer (User B's principal for User A's continuation) fails with :foreign_bearer" do
      user_a = insert_user_with_two_memberships!("exchange-a@example.com")
      user_b = insert_user!("exchange-b@example.com", "B Exchange")
      [m1, m2] = user_a.memberships

      plaintext = EmailCodeAuth.mint_test_continuation(user_a.id, [m1.id, m2.id])

      assert {:error, :foreign_bearer} =
               EmailCodeAuth.exchange_continuation(
                 plaintext,
                 to_string(m1.id),
                 principal: user_b.id
               )

      consumed =
        Repo.get_by(MealPlannerApi.Persistence.Auth.AccountSelectionContinuation,
          user_id: user_a.id
        )

      assert is_nil(consumed.consumed_at),
             "continuation must NOT be consumed when the bearer is foreign"
    end

    test "switch_account/2 failure (membership not active) leaves the continuation UNCONSUMED" do
      user = insert_user_with_two_memberships!("exchange-premint@example.com")
      [m1, m2] = user.memberships

      # Flip m2 to :invited (non-active) so switch_account/2 will reject
      # it. The continuation still binds m1+m2, but the switch fails.
      Repo.update_all(
        from(am in MealPlannerApi.Persistence.Accounts.AccountMembership,
          where: am.id == ^m2.id
        ),
        set: [status: :invited]
      )

      plaintext = EmailCodeAuth.mint_test_continuation(user.id, [m1.id, m2.id])

      assert {:error, :membership_not_active} =
               EmailCodeAuth.exchange_continuation(plaintext, to_string(m2.id), principal: nil)

      consumed =
        Repo.get_by(MealPlannerApi.Persistence.Auth.AccountSelectionContinuation,
          user_id: user.id
        )

      assert is_nil(consumed.consumed_at),
             "pre-mint failure must NOT consume the continuation"
    end
  end

  # ---- Helpers ----------------------------------------------------------------
  #
  # The fixtures insert rows through the standard Ecto changesets so the
  # assertions observe the production schema.

  defp insert_user!(email, name) do
    %PersistenceUser{}
    |> PersistenceUser.changeset(%{email: email, name: name, role: :member})
    |> Repo.insert!()
  end

  defp insert_user_with_two_memberships!(email) do
    user =
      user_with_memberships(
        %{email: email, name: "Multi #{email}"},
        [
          {%{plan: :individual, name: "Solo #{email}"}, :owner},
          {%{plan: :family_4, name: "Family #{email}"}, :member}
        ]
      )

    user
  end

  defp insert_membership!(user) do
    plan_row =
      case MealPlannerApi.Subscriptions.get_plan_by_name("individual") do
        {:ok, p} -> p
      end

    account =
      %Account{}
      |> Ecto.Changeset.change(%{
        name: "Factory Account #{Ecto.UUID.generate()}",
        plan: :individual,
        default_budget_cents: 0,
        subscription_plan_id: plan_row.id
      })
      |> Repo.insert!()

    %PersistenceAccountMembership{}
    |> Ecto.Changeset.change(%{
      account_id: account.id,
      user_id: user.id,
      role: :member,
      status: :active,
      joined_at: DateTime.utc_now()
    })
    |> Repo.insert!()
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
