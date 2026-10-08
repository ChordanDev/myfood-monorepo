defmodule MealPlannerApi.Services.DeviceSessionsConcurrencyTest do
  @moduledoc """
  One active Device session per User and device when requests really
  overlap (issue #9).

  The other suites run inside the SQL sandbox, where every process
  shares one connection and one transaction, so nothing there can wait
  on a lock another request holds. Here every request runs in a process
  with a database connection of its own and commits: the sandbox is
  left in `:auto` mode and no connection is checked out, so the rows
  are real and `on_exit` deletes them. The suite leaves the database as
  it found it, the reference Plans included.

  Two kinds of test:

    * requests released together, for several rounds, because the
      interleaving that would break the invariant does not come up
      every time;
    * a request held in the middle of its transaction while a second
      one arrives, which is the same interleaving on every run.

  Neither depends on timing to pass: with the device lock in place the
  outcome is the same however the requests interleave.
  """
  use ExUnit.Case, async: false

  import Ecto.Query
  import MealPlannerApi.FactoryHelpers

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Persistence.Auth.DeviceSession
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.DeviceSessions
  alias MealPlannerApi.SubscriptionPlanFixtures

  @moduletag :runtime_db_concurrency

  @device_id "5b0f3c1e-7a44-4d0b-9d1c-2f6e8a9b0c11"

  # The pool holds ten connections: one for the test, one per request.
  @openers 8
  @rounds 5

  setup_all do
    # The mode `test/test_helper.exs` sets; a suite that ran before this
    # one may have left the sandbox shared with its own test process.
    Sandbox.mode(Repo, :auto)

    # Every Account here is `:individual`, so that is the only Plan the suite
    # needs. `ensure_plans!/0` is not used: outside the sandbox it would
    # commit every fixture Plan and rewrite the ones the migrations inserted.
    :ok = SubscriptionPlanFixtures.ensure_committed_plan!("individual")
  end

  setup do
    suffix = System.unique_integer([:positive])

    user =
      user_with_memberships(%{email: "sessions-race-#{suffix}@example.com"}, [
        {%{plan: :individual, name: "Race #{suffix}"}, :owner}
      ])

    [membership] = user.memberships
    on_exit(fn -> delete_committed(user, membership) end)

    {:ok, user: user, membership: membership}
  end

  describe "requests released together" do
    test "simultaneous opens for one User and device all succeed and leave one active session",
         %{user: user, membership: membership} do
      for round <- 1..@rounds do
        device_id = "phone-#{round}"

        requests =
          for _opener <- 1..@openers do
            start_request(fn -> DeviceSessions.open(user, membership, device_id) end)
          end

        assert_own_connections(requests)
        Enum.each(requests, &release/1)

        refresh_tokens =
          for request <- requests do
            assert {:returned, {:ok, %{access_token: _, refresh_token: refresh_token}}} =
                     outcome(request)

            refresh_token
          end

        sessions = sessions_on(user, device_id)
        assert length(sessions) == @openers

        assert [%DeviceSession{} = active] = Enum.filter(sessions, &is_nil(&1.revoked_at))
        assert active.token_hash in Enum.map(refresh_tokens, &token_hash/1)
      end
    end
  end

  describe "a request that arrives while another is in the middle of its transaction" do
    test "a login waits for the refresh in flight and then ends the session it produced",
         %{user: user, membership: membership} do
      {:ok, current} = DeviceSessions.open(user, membership, @device_id)

      refresh = start_request(fn -> DeviceSessions.rotate(current.refresh_token) end)
      login = start_request(fn -> DeviceSessions.open(user, membership, @device_id) end)

      one_after_the_other(membership, refresh, login)

      assert {:returned, {:ok, rotated}} = outcome(refresh)
      assert {:returned, {:ok, opened}} = outcome(login)

      assert %DeviceSession{revoked_at: %DateTime{}} = session_of(rotated.refresh_token)
      assert [active] = active_sessions_on(user, @device_id)
      assert active.token_hash == token_hash(opened.refresh_token)
    end

    test "a refresh waits for the login in flight and then finds its session revoked",
         %{user: user, membership: membership} do
      {:ok, current} = DeviceSessions.open(user, membership, @device_id)

      login = start_request(fn -> DeviceSessions.open(user, membership, @device_id) end)
      refresh = start_request(fn -> DeviceSessions.rotate(current.refresh_token) end)

      one_after_the_other(membership, login, refresh)

      assert {:returned, {:ok, opened}} = outcome(login)
      assert outcome(refresh) == {:returned, {:error, :refresh_token_revoked}}

      assert [active] = active_sessions_on(user, @device_id)
      assert active.token_hash == token_hash(opened.refresh_token)
      assert length(sessions_on(user, @device_id)) == 2
    end

    test "a second login waits for the first and replaces its session",
         %{user: user, membership: membership} do
      first = start_request(fn -> DeviceSessions.open(user, membership, @device_id) end)
      second = start_request(fn -> DeviceSessions.open(user, membership, @device_id) end)

      one_after_the_other(membership, first, second)

      assert {:returned, {:ok, replaced}} = outcome(first)
      assert {:returned, {:ok, opened}} = outcome(second)

      assert %DeviceSession{revoked_at: %DateTime{}} = session_of(replaced.refresh_token)
      assert [active] = active_sessions_on(user, @device_id)
      assert active.token_hash == token_hash(opened.refresh_token)
    end

    @tag :capture_log
    test "a second refresh with the same token waits for the first and is a replay",
         %{user: user, membership: membership} do
      {:ok, current} = DeviceSessions.open(user, membership, @device_id)

      first = start_request(fn -> DeviceSessions.rotate(current.refresh_token) end)
      second = start_request(fn -> DeviceSessions.rotate(current.refresh_token) end)

      one_after_the_other(membership, first, second)

      assert {:returned, {:ok, _rotated}} = outcome(first)
      assert outcome(second) == {:returned, {:error, :refresh_token_replayed}}

      # The replay ends the session on that device, the rotated one included.
      assert active_sessions_on(user, @device_id) == []
      assert length(sessions_on(user, @device_id)) == 2
    end
  end

  # ---- requests --------------------------------------------------------------

  # A process that holds a database connection of its own and runs `fun`
  # once it is released. Its answer is read with `outcome/1`.
  defp start_request(fun) do
    test = self()

    pid =
      spawn_link(fn ->
        %{rows: [[backend_pid]]} = Repo.query!("SELECT pg_backend_pid()")
        send(test, {:connected, self(), backend_pid})

        receive do
          :release -> send(test, {:outcome, self(), attempt(fun)})
        end
      end)

    assert_receive {:connected, ^pid, backend_pid}, 5_000
    %{pid: pid, backend_pid: backend_pid}
  end

  defp release(request), do: send(request.pid, :release)

  # `{:returned, value}`, or `{:raised, reason}` when the request did
  # not return.
  defp outcome(request) do
    assert_receive {:outcome, pid, outcome} when pid == request.pid, 15_000
    outcome
  end

  defp attempt(fun) do
    {:returned, fun.()}
  rescue
    exception -> {:raised, exception}
  catch
    kind, reason -> {:raised, {kind, reason}}
  end

  defp assert_own_connections(requests) do
    backend_pids = Enum.map(requests, & &1.backend_pid)
    assert Enum.uniq(backend_pids) == backend_pids
  end

  # Releases `first`, holds it in the middle of its transaction, releases
  # `second` and lets both finish once `second` is waiting too.
  #
  # What holds `first` is a row lock on the Membership: storing a Device
  # session checks that its Membership exists, and that check waits for
  # the lock taken here. By then the request has taken its own locks and
  # revoked what it was going to revoke, and has not committed.
  defp one_after_the_other(membership, first, second) do
    assert_own_connections([first, second])

    {:ok, :ok} =
      Repo.transaction(fn ->
        Repo.one!(from(m in AccountMembership, where: m.id == ^membership.id, lock: "FOR UPDATE"))

        release(first)
        await_waiting(first)

        release(second)
        await_waiting(second)
      end)
  end

  # Returns once the request waits for a lock another transaction holds.
  defp await_waiting(request, attempts \\ 500) do
    %{rows: [[waiting]]} =
      Repo.query!("SELECT count(*) FROM pg_locks WHERE pid = $1 AND NOT granted", [
        request.backend_pid
      ])

    cond do
      waiting > 0 ->
        :ok

      attempts == 0 ->
        flunk("the request never waited for a lock")

      true ->
        Process.sleep(10)
        await_waiting(request, attempts - 1)
    end
  end

  # ---- rows ------------------------------------------------------------------

  defp sessions_on(user, device_id) do
    Repo.all(from(s in DeviceSession, where: s.user_id == ^user.id and s.device_id == ^device_id))
  end

  defp active_sessions_on(user, device_id) do
    user |> sessions_on(device_id) |> Enum.filter(&is_nil(&1.revoked_at))
  end

  defp session_of(refresh_token) do
    Repo.get_by!(DeviceSession, token_hash: token_hash(refresh_token))
  end

  defp delete_committed(user, membership) do
    Repo.delete_all(from(s in DeviceSession, where: s.user_id == ^user.id))
    Repo.delete_all(from(m in AccountMembership, where: m.id == ^membership.id))
    Repo.delete_all(from(u in User, where: u.id == ^user.id))
    Repo.delete_all(from(a in Account, where: a.id == ^membership.account_id))
  end

  defp token_hash(token), do: :sha256 |> :crypto.hash(token) |> Base.encode16(case: :lower)
end
