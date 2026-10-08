defmodule MealPlannerApi.Services.DeviceSessionsTest do
  @moduledoc """
  Branches of `MealPlannerApi.Services.DeviceSessions` that the HTTP tests
  in `auth_controller_test.exs` and `mobile_auth_controller_test.exs` do
  not reach: refresh tokens that disagree with their row, a refresh JWT
  past its own expiry, a Membership that stopped being active, and the
  sweep.

  A token that disagrees with its row cannot come out of `open/3`, so
  those cases store a row by hand for a token minted here.
  """
  use ExUnit.Case, async: false

  import MealPlannerApi.FactoryHelpers

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Auth.Guardian
  alias MealPlannerApi.Persistence.Auth.DeviceSession
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.DeviceSessions

  @device_id "9c1d7f6a-2b8e-4f0e-8a51-6d3b1e0c4f77"

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()
    :ok
  end

  describe "open/3" do
    test "a session that cannot be stored is an error and revokes nothing" do
      {user, membership} = insert_owner!("sessions-unstorable@example.com")
      {:ok, current} = DeviceSessions.open(user, membership, @device_id)

      # The Membership is gone, so the new row has nothing to point at.
      gone = %{membership | id: Ecto.UUID.generate()}

      assert DeviceSessions.open(user, gone, @device_id) == {:error, :session_issue_failed}
      assert [%DeviceSession{revoked_at: nil} = session] = Repo.all(DeviceSession)
      assert session.id == session_of(current.refresh_token).id
    end
  end

  describe "rotate/1 — a token that disagrees with its Device session" do
    test "a refresh JWT past its own expiry gets refresh_token_expired" do
      {user, membership} = insert_owner!("sessions-jwt-expired@example.com")
      session_id = Ecto.UUID.generate()
      token = refresh_token!(user, session_id, ttl: {-1, :minute})
      insert_session!(user, membership, token, id: session_id)

      assert DeviceSessions.rotate(token) == {:error, :refresh_token_expired}
      assert %DeviceSession{revoked_at: nil} = Repo.get!(DeviceSession, session_id)
    end

    test "a token that names another Device session gets refresh_token_session_mismatch" do
      {user, membership} = insert_owner!("sessions-sid@example.com")
      token = refresh_token!(user, Ecto.UUID.generate())
      session = insert_session!(user, membership, token)

      assert DeviceSessions.rotate(token) == {:error, :refresh_token_session_mismatch}
      assert %DeviceSession{revoked_at: nil} = Repo.get!(DeviceSession, session.id)
    end

    test "a token issued to another User gets refresh_token_session_mismatch" do
      {user, membership} = insert_owner!("sessions-sub@example.com")
      {other_user, _membership} = insert_owner!("sessions-sub-other@example.com")
      session_id = Ecto.UUID.generate()
      token = refresh_token!(other_user, session_id)
      insert_session!(user, membership, token, id: session_id)

      assert DeviceSessions.rotate(token) == {:error, :refresh_token_session_mismatch}
      assert Repo.aggregate(DeviceSession, :count) == 1
    end

    test "a stored token that is not a refresh token gets refresh_token_invalid" do
      {user, membership} = insert_owner!("sessions-typ@example.com")
      session_id = Ecto.UUID.generate()

      {:ok, access_token, _claims} =
        Guardian.encode_and_sign(user, %{"sid" => session_id}, token_type: "access")

      insert_session!(user, membership, access_token, id: session_id)

      assert DeviceSessions.rotate(access_token) == {:error, :refresh_token_invalid}
      assert Repo.aggregate(DeviceSession, :count) == 1
    end
  end

  describe "rotate/1 — what the row says comes before what the token says" do
    @tag :capture_log
    test "a rotated token whose JWT has expired is still a replay" do
      {user, membership} = insert_owner!("sessions-replay-expired@example.com")
      {:ok, current} = DeviceSessions.open(user, membership, @device_id)

      session_id = Ecto.UUID.generate()
      token = refresh_token!(user, session_id, ttl: {-1, :minute})

      insert_session!(user, membership, token,
        id: session_id,
        revoked_at: DateTime.utc_now(),
        replaced_by_id: session_of(current.refresh_token).id
      )

      assert DeviceSessions.rotate(token) == {:error, :refresh_token_replayed}
      assert %DeviceSession{revoked_at: %DateTime{}} = session_of(current.refresh_token)
    end

    test "a revoked token whose JWT has expired is still reported as revoked" do
      {user, membership} = insert_owner!("sessions-revoked-expired@example.com")
      session_id = Ecto.UUID.generate()
      token = refresh_token!(user, session_id, ttl: {-1, :minute})
      insert_session!(user, membership, token, id: session_id, revoked_at: DateTime.utc_now())

      assert DeviceSessions.rotate(token) == {:error, :refresh_token_revoked}
    end
  end

  describe "rotate/1 — Account scope" do
    test "the new pair is scoped to the Membership the session was opened with" do
      user =
        user_with_memberships(%{email: "sessions-scope@example.com"}, [
          {%{plan: :individual, name: "Own account"}, :owner},
          {%{plan: :family_4, name: "Someone else's family"}, :member}
        ])

      member = Enum.find(user.memberships, &(&1.role == :member))
      {:ok, opened} = DeviceSessions.open(user, member, @device_id)

      assert {:ok, rotated} = DeviceSessions.rotate(opened.refresh_token)

      assert {:ok, claims} = Guardian.decode_and_verify(rotated.access_token)
      assert claims["membership_id"] == member.id
      assert claims["account_id"] == member.account_id
      assert claims["role"] == "member"
      assert session_of(rotated.refresh_token).membership_id == member.id
    end

    test "a Membership that is no longer active gets account_not_found and nothing rotates" do
      {user, membership} = insert_owner!("sessions-suspended@example.com")
      {:ok, opened} = DeviceSessions.open(user, membership, @device_id)

      membership |> Ecto.Changeset.change(status: :suspended) |> Repo.update!()

      assert DeviceSessions.rotate(opened.refresh_token) == {:error, :account_not_found}
      assert [%DeviceSession{revoked_at: nil, replaced_by_id: nil}] = Repo.all(DeviceSession)
    end

    test "access claims are rebuilt from the User as they are now" do
      {user, membership} = insert_owner!("sessions-renamed@example.com")
      {:ok, opened} = DeviceSessions.open(user, membership, @device_id)

      user |> Ecto.Changeset.change(name: "Renamed Owner") |> Repo.update!()

      assert {:ok, rotated} = DeviceSessions.rotate(opened.refresh_token)

      assert {:ok, %{"name" => "Renamed Owner"}} =
               Guardian.decode_and_verify(rotated.access_token)
    end
  end

  describe "sweep/1" do
    test "deletes expired rows and rows revoked more than seven days ago, and counts them" do
      {user, membership} = insert_owner!("sessions-sweep@example.com")
      now = DateTime.utc_now()

      active = insert_session!(user, membership, "active")

      expired =
        insert_session!(user, membership, "expired", expires_at: DateTime.add(now, -1, :second))

      revoked_long_ago =
        insert_session!(user, membership, "revoked-long-ago",
          revoked_at: DateTime.add(now, -7 * 86_400 - 1, :second)
        )

      revoked_recently =
        insert_session!(user, membership, "revoked-recently",
          revoked_at: DateTime.add(now, -7 * 86_400 + 60, :second)
        )

      assert DeviceSessions.sweep(now) == 2

      assert Repo.get(DeviceSession, expired.id) == nil
      assert Repo.get(DeviceSession, revoked_long_ago.id) == nil
      assert %DeviceSession{} = Repo.get(DeviceSession, active.id)
      assert %DeviceSession{} = Repo.get(DeviceSession, revoked_recently.id)
    end

    test "is measured against the time it is given" do
      {user, membership} = insert_owner!("sessions-sweep-clock@example.com")
      {:ok, _tokens} = DeviceSessions.open(user, membership, @device_id)
      now = DateTime.utc_now()

      assert DeviceSessions.sweep(DateTime.add(now, 29 * 86_400, :second)) == 0
      assert DeviceSessions.sweep(DateTime.add(now, 31 * 86_400, :second)) == 1
      assert Repo.aggregate(DeviceSession, :count) == 0
    end

    test "defaults to the current time and deletes nothing that is still live" do
      {user, membership} = insert_owner!("sessions-sweep-now@example.com")
      {:ok, _tokens} = DeviceSessions.open(user, membership, @device_id)

      insert_session!(user, membership, "expired",
        expires_at: DateTime.add(DateTime.utc_now(), -60, :second)
      )

      assert DeviceSessions.sweep() == 1
      assert [%DeviceSession{revoked_at: nil}] = Repo.all(DeviceSession)
    end

    @tag :capture_log
    test "a rotated token is still recognised as a replay until its row is swept" do
      {user, membership} = insert_owner!("sessions-sweep-replay@example.com")
      {:ok, first} = DeviceSessions.open(user, membership, @device_id)
      {:ok, _second} = DeviceSessions.rotate(first.refresh_token)
      now = DateTime.utc_now()

      assert DeviceSessions.sweep(DateTime.add(now, 6 * 86_400, :second)) == 0
      assert DeviceSessions.rotate(first.refresh_token) == {:error, :refresh_token_replayed}

      # The replay revoked the rest of the chain, so both rows are now
      # past the retention window.
      assert DeviceSessions.sweep(DateTime.add(now, 8 * 86_400, :second)) == 2
      assert DeviceSessions.rotate(first.refresh_token) == {:error, :refresh_token_invalid}
    end

    test "sweeping the row that replaced another leaves the older row in place" do
      {user, membership} = insert_owner!("sessions-sweep-chain@example.com")
      now = DateTime.utc_now()

      successor =
        insert_session!(user, membership, "successor", expires_at: DateTime.add(now, -1, :second))

      predecessor =
        insert_session!(user, membership, "predecessor",
          revoked_at: now,
          replaced_by_id: successor.id
        )

      assert DeviceSessions.sweep(now) == 1
      assert %DeviceSession{replaced_by_id: nil} = Repo.get!(DeviceSession, predecessor.id)
    end
  end

  # ---- helpers ---------------------------------------------------------------

  defp insert_owner!(email) do
    user =
      user_with_memberships(%{email: email, name: "Owner #{email}"}, [
        {%{plan: :individual, name: "Solo #{email}"}, :owner}
      ])

    [membership] = user.memberships
    {user, membership}
  end

  # A signed refresh token for `user` that names `session_id`.
  defp refresh_token!(user, session_id, opts \\ []) do
    {:ok, token, _claims} =
      Guardian.encode_and_sign(user, %{"sid" => session_id}, [token_type: "refresh"] ++ opts)

    token
  end

  # Stores a Device session row for `token`; `overrides` replaces any column.
  defp insert_session!(user, membership, token, overrides \\ []) do
    attrs =
      Map.merge(
        %{
          user_id: user.id,
          membership_id: membership.id,
          device_id: @device_id,
          token_hash: token_hash(token),
          expires_at: DateTime.add(DateTime.utc_now(), 30 * 86_400, :second)
        },
        Map.new(overrides)
      )

    %DeviceSession{} |> Ecto.Changeset.change(attrs) |> Repo.insert!()
  end

  defp session_of(refresh_token) do
    Repo.get_by!(DeviceSession, token_hash: token_hash(refresh_token))
  end

  defp token_hash(token), do: :sha256 |> :crypto.hash(token) |> Base.encode16(case: :lower)
end
