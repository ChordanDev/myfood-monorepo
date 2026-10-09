defmodule MealPlannerApiWeb.PlanningStartTest do
  @moduledoc """
  `start_planning` as the Planner screen uses it (issue #25): the command
  validates a range of 1 to 10 days that starts today or later, starts the
  Planning session, starts the generation, and the five events the screen
  reads reach the client in camelCase with a frozen shape.

  The frozen shapes are documented in `apps/api/docs/CHANNELS.md`.
  """
  use MealPlannerApiWeb.ChannelCase, async: false

  import Ecto.Query, only: [from: 2]
  import MealPlannerApiWeb.CasingAssertions, only: [assert_camel_case_keys: 1]
  import MealPlannerApiWeb.ChannelHelpers, only: [issue_identity_and_token: 2]

  alias MealPlannerApi.Data.PlanningRepo
  alias MealPlannerApi.Persistence.Accounts.{AccountMembership, User}
  alias MealPlannerApi.Persistence.Planning.PlanningSession
  alias MealPlannerApi.Repo
  alias MealPlannerApiWeb.{ApiError, PlanningChannel, UserSocket}

  @moduletag :capture_log

  setup do
    {:ok, user, account, token} = issue_identity_and_token("u_plan_start", "acct_plan_start")
    _ = persist_trial_window!(account)

    on_exit(fn ->
      for {pid, _value} <-
            Registry.lookup(MealPlannerApi.Generation.Generations, {:generation, account.id}) do
        DynamicSupervisor.terminate_child(MealPlannerApi.Generation.ServerSupervisor, pid)
      end
    end)

    %{user: user, account: account, token: token}
  end

  describe "error codes (T1)" do
    test "ApiError holds planning_invalid_range (422) and planning_range_locked (409)" do
      assert :planning_invalid_range in ApiError.codes()
      assert :planning_range_locked in ApiError.codes()

      assert %{error: %{code: :planning_invalid_range}} =
               ApiError.envelope(:planning_invalid_range)

      assert %{error: %{code: :planning_range_locked}} =
               ApiError.envelope(:planning_range_locked)
    end

    test "an unparseable date replies planning_invalid_range", %{account: account, token: token} do
      socket = join_planning!(token, account)

      ref =
        push(socket, "start_planning", %{"rangeFrom" => "not-a-date", "rangeTo" => in_days(2)})

      assert_error_reply(ref, :planning_invalid_range)
    end

    test "a range that ends before it starts replies planning_invalid_range", %{
      account: account,
      token: token
    } do
      socket = join_planning!(token, account)

      ref = push(socket, "start_planning", %{"rangeFrom" => in_days(3), "rangeTo" => in_days(1)})

      assert_error_reply(ref, :planning_invalid_range)
    end

    test "an overlap with the caller's own session replies planning_range_locked, no details",
         %{account: account, user: user, token: token} do
      {:ok, _existing} =
        insert_session(account, user, owner_membership_id(account.id, user.id), 1, 5)

      socket = join_planning!(token, account)

      ref = push(socket, "start_planning", %{"rangeFrom" => in_days(3), "rangeTo" => in_days(7)})

      payload = assert_error_reply(ref, :planning_range_locked)
      refute Map.has_key?(payload["error"], "details")
    end

    test "an overlap with another member's session names its owner", %{
      account: account,
      token: token
    } do
      {peer_user, peer_membership} = insert_peer(account, "Ana Peer")
      {:ok, _existing} = insert_session(account, peer_user, peer_membership.id, 1, 5)

      socket = join_planning!(token, account)

      ref = push(socket, "start_planning", %{"rangeFrom" => in_days(3), "rangeTo" => in_days(7)})

      payload = assert_error_reply(ref, :planning_range_locked)
      assert payload["error"]["details"] == %{"ownerName" => "Ana Peer"}
      assert_camel_case_keys(payload)

      active =
        Repo.aggregate(
          from(s in PlanningSession, where: s.account_id == ^account.id and s.status == :active),
          :count
        )

      assert active == 1
    end
  end

  # ==========================================================================
  # Helpers
  # ==========================================================================

  defp in_days(offset), do: Date.utc_today() |> Date.add(offset) |> Date.to_iso8601()

  defp join_planning!(token, account) do
    {:ok, socket} = connect(UserSocket, %{"token" => token})
    {:ok, _reply, socket} = subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")
    socket
  end

  defp persist_trial_window!(account) do
    started = DateTime.utc_now()
    ends = DateTime.add(started, 7 * 86_400, :second)

    {:ok, updated} =
      account
      |> MealPlannerApi.Persistence.Accounts.Account.changeset(%{
        trial_started_at: started,
        trial_ends_at: ends
      })
      |> Repo.update()

    updated
  end

  defp owner_membership_id(account_id, user_id) do
    Repo.one!(
      from(m in AccountMembership,
        where: m.account_id == ^account_id and m.user_id == ^user_id and m.status == :active,
        select: m.id
      )
    )
  end

  defp insert_peer(account, name) do
    peer_user =
      %User{}
      |> User.changeset(%{
        email: "peer-#{System.unique_integer([:positive])}@example.com",
        name: name,
        role: :member
      })
      |> Repo.insert!()

    {:ok, membership} =
      %AccountMembership{}
      |> AccountMembership.changeset(%{
        account_id: account.id,
        user_id: peer_user.id,
        role: :member,
        status: :active,
        joined_at: DateTime.utc_now()
      })
      |> Repo.insert()

    {peer_user, membership}
  end

  defp insert_session(account, user, membership_id, from_offset, to_offset) do
    PlanningRepo.create_session(account.id, %{
      range_from: Date.add(Date.utc_today(), from_offset),
      range_to: Date.add(Date.utc_today(), to_offset),
      lock_owner_user_id: user.id,
      lock_owner_membership_id: membership_id,
      lease_expires_at: DateTime.add(DateTime.utc_now(), 120, :second)
    })
  end

  defp assert_error_reply(ref, code) do
    assert_receive %Phoenix.Socket.Reply{ref: ^ref, status: :error, payload: payload}
    assert %{"error" => %{"code" => ^code, "message" => message}} = payload
    assert is_binary(message) and message != ""
    payload
  end
end
