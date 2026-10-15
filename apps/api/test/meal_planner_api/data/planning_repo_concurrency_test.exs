defmodule MealPlannerApi.Data.PlanningRepoConcurrencyTest do
  @moduledoc """
  A Planning session that a confirm commits stays committed when a cancel,
  an expiry or a lost lock lands at the same time (issue #303).

  The confirm locks the session row and moves it to `:committed`. Each end
  transition here starts while that transaction is still open, so it reads
  the row as it was before the confirm. It must wait for the confirm, see
  the row is no longer `:active`, and give up with `{:error, :not_active}`:
  the row keeps `:committed` and its messages and exceptions, the audit
  trail of a committed session.

  Like `DeviceSessionsConcurrencyTest`, every request runs in a process with
  a database connection of its own and commits: the sandbox is left in
  `:auto` mode, the rows are real and `on_exit` deletes them.
  """
  use ExUnit.Case, async: false

  import Ecto.Query
  import MealPlannerApi.FactoryHelpers

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Data.PlanningRepo
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Persistence.Planning.PlanningException
  alias MealPlannerApi.Persistence.Planning.PlanningMessage
  alias MealPlannerApi.Persistence.Planning.PlanningSession
  alias MealPlannerApi.Repo
  alias MealPlannerApi.SubscriptionPlanFixtures

  @moduletag :runtime_db_concurrency

  setup_all do
    # The mode `test/test_helper.exs` sets; a suite that ran before this
    # one may have left the sandbox shared with its own test process.
    Sandbox.mode(Repo, :auto)

    :ok = SubscriptionPlanFixtures.ensure_committed_plan!("individual")
  end

  setup do
    suffix = System.unique_integer([:positive])

    user =
      user_with_memberships(%{email: "planning-race-#{suffix}@example.com"}, [
        {%{plan: :individual, name: "Planning race #{suffix}"}, :owner}
      ])

    [membership] = user.memberships
    on_exit(fn -> delete_committed(user, membership) end)

    {:ok, session} =
      PlanningRepo.create_session(membership.account_id, %{
        range_from: ~D[2026-06-01],
        range_to: ~D[2026-06-08],
        lock_owner_user_id: user.id,
        lock_owner_membership_id: membership.id,
        lease_expires_at: DateTime.add(DateTime.utc_now(), 120, :second)
      })

    seed_children!(session)

    {:ok, account_id: membership.account_id, membership: membership, session: session}
  end

  describe "an end transition that arrives while a confirm is in flight" do
    test "a cancel waits for the confirm and leaves the session committed", ctx do
      cancel =
        start_request(fn ->
          PlanningRepo.cancel_session(ctx.account_id, ctx.session.id, ctx.membership.id, false)
        end)

      confirm_while_waiting(ctx, cancel)

      assert outcome(cancel) == {:returned, {:error, :not_active}}
      assert_still_committed(ctx.session)
    end

    test "an expiry waits for the confirm and leaves the session committed", ctx do
      expire =
        start_request(fn -> PlanningRepo.expire_session(ctx.account_id, ctx.session.id) end)

      confirm_while_waiting(ctx, expire)

      assert outcome(expire) == {:returned, {:error, :not_active}}
      assert_still_committed(ctx.session)
    end

    test "a lost lock waits for the confirm and leaves the session committed", ctx do
      lost_lock =
        start_request(fn -> PlanningRepo.mark_lost_lock(ctx.account_id, ctx.session.id) end)

      confirm_while_waiting(ctx, lost_lock)

      assert outcome(lost_lock) == {:returned, {:error, :not_active}}
      assert_still_committed(ctx.session)
    end
  end

  # ---- requests --------------------------------------------------------------

  # Runs the confirm step on the session and, before its transaction
  # commits, releases `request` and waits until it is blocked on the row
  # the confirm holds.
  defp confirm_while_waiting(ctx, request) do
    {:ok, %{mark_committed: %PlanningSession{status: :committed}}} =
      Ecto.Multi.new()
      |> PlanningRepo.mark_committed(ctx.account_id, ctx.session.id)
      |> Ecto.Multi.run(:hold, fn _repo, _changes ->
        release(request)
        await_waiting(request)
        {:ok, :held}
      end)
      |> Repo.transaction()
  end

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

  defp seed_children!(session) do
    Repo.insert!(%PlanningMessage{
      account_id: session.account_id,
      session_id: session.id,
      role: :user,
      content: "hello"
    })

    Repo.insert!(%PlanningException{
      account_id: session.account_id,
      session_id: session.id,
      kind: "test",
      note: "seeded"
    })
  end

  defp assert_still_committed(session) do
    assert %PlanningSession{status: :committed} = Repo.get!(PlanningSession, session.id)

    assert Repo.aggregate(from(m in PlanningMessage, where: m.session_id == ^session.id), :count) ==
             1

    assert Repo.aggregate(
             from(e in PlanningException, where: e.session_id == ^session.id),
             :count
           ) ==
             1
  end

  # Deleting the Account removes its Memberships, Planning sessions and
  # their children.
  defp delete_committed(user, membership) do
    Repo.delete_all(from(a in Account, where: a.id == ^membership.account_id))
    Repo.delete_all(from(u in User, where: u.id == ^user.id))
  end
end
