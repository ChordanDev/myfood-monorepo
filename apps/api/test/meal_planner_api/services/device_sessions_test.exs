defmodule MealPlannerApi.Services.DeviceSessionsTest do
  @moduledoc """
  Branches of `MealPlannerApi.Services.DeviceSessions` that the HTTP tests
  in `auth_controller_test.exs` and `mobile_auth_controller_test.exs` do
  not reach: the `deviceId` rule case by case, what the database itself
  refuses to store, refresh tokens that disagree with their row, a
  refresh JWT past its own expiry, a Membership that stopped being
  active, the retry window of a rotated token second by second, and the
  sweep.

  A token that disagrees with its row cannot come out of `open/3`, so
  those cases store a row by hand for a token minted here.

  Requests that overlap are in `device_sessions_concurrency_test.exs`:
  under the SQL sandbox used here they cannot wait on one another.
  """
  use ExUnit.Case, async: false

  import Ecto.Query
  import ExUnit.CaptureLog
  import MealPlannerApi.FactoryHelpers

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Auth.Guardian
  alias MealPlannerApi.Persistence.Auth.DeviceSession
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.DeviceSessions

  @device_id "9c1d7f6a-2b8e-4f0e-8a51-6d3b1e0c4f77"

  # The retry window the application ships with, in seconds.
  @window 10

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()
    :ok
  end

  describe "valid_device_id?/1" do
    test "accepts what the app sends and anything else the column can hold" do
      assert DeviceSessions.valid_device_id?(@device_id)
      assert DeviceSessions.valid_device_id?("d")
      assert DeviceSessions.valid_device_id?(String.duplicate("d", 255))
      assert DeviceSessions.valid_device_id?("teléfono de Ana 📱")
    end

    test "refuses a value that is not a string, or is blank" do
      refute DeviceSessions.valid_device_id?(nil)
      refute DeviceSessions.valid_device_id?(7)
      refute DeviceSessions.valid_device_id?(%{"id" => @device_id})
      refute DeviceSessions.valid_device_id?("")
      refute DeviceSessions.valid_device_id?(" \t\n")
    end

    test "refuses a NUL character and bytes that are not UTF-8" do
      refute DeviceSessions.valid_device_id?("phone" <> <<0>>)
      refute DeviceSessions.valid_device_id?(<<0>> <> "phone")
      refute DeviceSessions.valid_device_id?(<<0xFF, 0xFE>>)
    end

    test "counts bytes, not characters: 255 at most" do
      assert DeviceSessions.valid_device_id?(String.duplicate("é", 127))
      refute DeviceSessions.valid_device_id?(String.duplicate("é", 128))
      refute DeviceSessions.valid_device_id?(String.duplicate("d", 256))
      refute DeviceSessions.valid_device_id?(String.duplicate("😀", 100))
    end
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

    test "a device_id the rule refuses is an error, not a raise, and revokes nothing" do
      {user, membership} = insert_owner!("sessions-bad-device@example.com")
      {:ok, _current} = DeviceSessions.open(user, membership, @device_id)

      for refused <- ["phone" <> <<0>>, String.duplicate("😀", 100), <<0xFF>>, "  ", nil] do
        assert DeviceSessions.open(user, membership, refused) == {:error, :session_issue_failed}
      end

      assert [%DeviceSession{revoked_at: nil, device_id: @device_id}] = Repo.all(DeviceSession)
    end
  end

  describe "the Device session row" do
    test "its device_id is limited in bytes, like the rule" do
      {user, membership} = insert_owner!("sessions-row-bytes@example.com")

      wide = session_changeset(user, membership, "wide", device_id: String.duplicate("😀", 100))
      refute wide.valid?
      assert %{device_id: [_too_long]} = errors_on(wide)

      longest =
        session_changeset(user, membership, "longest", device_id: String.duplicate("d", 255))

      assert {:ok, %DeviceSession{}} = Repo.insert(longest)
    end

    test "the database refuses a second active row for the same User and device" do
      {user, membership} = insert_owner!("sessions-row-unique@example.com")
      {other_user, other_membership} = insert_owner!("sessions-row-unique-other@example.com")

      assert {:ok, first} = Repo.insert(session_changeset(user, membership, "first"))

      assert {:error, refused} = Repo.insert(session_changeset(user, membership, "second"))
      assert %{device_id: [_already_active]} = errors_on(refused)

      # Another device of the same User, and another User on the same
      # device, are other sessions.
      assert {:ok, _tablet} =
               Repo.insert(session_changeset(user, membership, "tablet", device_id: "tablet"))

      assert {:ok, _shared_phone} =
               Repo.insert(session_changeset(other_user, other_membership, "shared-phone"))

      # A revoked row makes room for the next one.
      first |> Ecto.Changeset.change(revoked_at: DateTime.utc_now()) |> Repo.update!()
      assert {:ok, second} = Repo.insert(session_changeset(user, membership, "second"))

      second |> Ecto.Changeset.change(revoked_at: DateTime.utc_now()) |> Repo.update!()
      assert {:ok, _third} = Repo.insert(session_changeset(user, membership, "third"))
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

      rotated_at = DateTime.utc_now()

      session_id = Ecto.UUID.generate()
      token = refresh_token!(user, session_id, ttl: {-1, :minute})

      insert_session!(user, membership, token,
        id: session_id,
        revoked_at: rotated_at,
        replaced_by_id: session_of(current.refresh_token).id
      )

      # Past the retry window; inside it the same token is checked like a
      # first rotation, which the retry tests below cover.
      assert DeviceSessions.rotate(token, DateTime.add(rotated_at, @window + 1, :second)) ==
               {:error, :refresh_token_replayed}

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

  # Every test below rotates token A into B at `t0` and presents A again
  # at a time it chooses. Only the clock handed to `rotate/2` moves: the
  # tokens are signed with the real time and live for thirty days.
  describe "rotate/2 — a rotated token presented again inside the retry window" do
    test "the window shipped in the configuration is ten seconds" do
      assert Application.fetch_env!(:meal_planner_api, :refresh_retry_window_seconds) == @window
    end

    test "gets a new pair, replaces the pair that was lost and keeps the session usable" do
      {user, membership} = insert_owner!("sessions-retry@example.com")
      {a, b, t0} = open_and_rotate!(user, membership)
      retried_at = DateTime.add(t0, @window - 1, :second)

      assert {:ok, c} = DeviceSessions.rotate(a.refresh_token, retried_at)
      assert c.refresh_token not in [a.refresh_token, b.refresh_token]
      assert {:ok, %{"typ" => "access_v2"}} = Guardian.decode_and_verify(c.access_token)

      %DeviceSession{id: new_id} = new = session_of(c.refresh_token)
      assert %DeviceSession{revoked_at: nil, replaced_by_id: nil} = new
      assert new.membership_id == membership.id

      # The pair of the lost response is revoked and points at the new one.
      assert %DeviceSession{replaced_by_id: ^new_id} = lost = session_of(b.refresh_token)
      assert DateTime.compare(lost.revoked_at, retried_at) == :eq

      # The presented row points at the new one and keeps the time of its
      # first rotation.
      assert %DeviceSession{replaced_by_id: ^new_id} = presented = session_of(a.refresh_token)
      assert DateTime.compare(presented.revoked_at, t0) == :eq

      assert [%DeviceSession{id: ^new_id}] = active_sessions(user)

      assert {:ok, d} = DeviceSessions.rotate(c.refresh_token, DateTime.add(t0, 3_600, :second))
      assert [active] = active_sessions(user)
      assert active.id == session_of(d.refresh_token).id
    end

    test "is tolerated at exactly the last second of the window" do
      {user, membership} = insert_owner!("sessions-retry-edge@example.com")
      {a, _b, t0} = open_and_rotate!(user, membership)

      assert {:ok, c} = DeviceSessions.rotate(a.refresh_token, DateTime.add(t0, @window, :second))
      assert [active] = active_sessions(user)
      assert active.id == session_of(c.refresh_token).id
    end

    @tag :capture_log
    test "one second after the window it is a replay and ends the session on that device" do
      {user, membership} = insert_owner!("sessions-retry-late@example.com")
      {a, b, t0} = open_and_rotate!(user, membership)

      assert DeviceSessions.rotate(a.refresh_token, DateTime.add(t0, @window + 1, :second)) ==
               {:error, :refresh_token_replayed}

      assert %DeviceSession{revoked_at: %DateTime{}} = session_of(b.refresh_token)
      assert active_sessions(user) == []
      assert Repo.aggregate(DeviceSession, :count) == 2
    end

    @tag :capture_log
    test "retrying twice works, and the window still counts from the first rotation" do
      {user, membership} = insert_owner!("sessions-retry-twice@example.com")
      {a, _b, t0} = open_and_rotate!(user, membership)

      assert {:ok, c} = DeviceSessions.rotate(a.refresh_token, DateTime.add(t0, 3, :second))
      assert {:ok, d} = DeviceSessions.rotate(a.refresh_token, DateTime.add(t0, 6, :second))

      new_id = session_of(d.refresh_token).id
      assert [%DeviceSession{id: ^new_id}] = active_sessions(user)

      assert %DeviceSession{revoked_at: %DateTime{}, replaced_by_id: ^new_id} =
               session_of(c.refresh_token)

      assert %DeviceSession{replaced_by_id: ^new_id} = presented = session_of(a.refresh_token)
      assert DateTime.compare(presented.revoked_at, t0) == :eq

      assert DeviceSessions.rotate(a.refresh_token, DateTime.add(t0, @window + 1, :second)) ==
               {:error, :refresh_token_replayed}

      assert active_sessions(user) == []
    end

    @tag :capture_log
    test "is a replay once the token that replaced it was used" do
      {user, membership} = insert_owner!("sessions-retry-used@example.com")
      {a, b, t0} = open_and_rotate!(user, membership)
      {:ok, c} = DeviceSessions.rotate(b.refresh_token, DateTime.add(t0, 2, :second))

      assert DeviceSessions.rotate(a.refresh_token, DateTime.add(t0, 4, :second)) ==
               {:error, :refresh_token_replayed}

      assert %DeviceSession{revoked_at: %DateTime{}} = session_of(c.refresh_token)
      assert active_sessions(user) == []
      assert Repo.aggregate(DeviceSession, :count) == 3
    end

    @tag :capture_log
    test "is a replay once the token that replaced it was logged out, not a new session" do
      {user, membership} = insert_owner!("sessions-retry-logout@example.com")
      {a, b, t0} = open_and_rotate!(user, membership)
      :ok = DeviceSessions.revoke(b.refresh_token)

      assert DeviceSessions.rotate(a.refresh_token, DateTime.add(t0, 4, :second)) ==
               {:error, :refresh_token_replayed}

      assert active_sessions(user) == []
      assert Repo.aggregate(DeviceSession, :count) == 2
    end

    @tag :capture_log
    test "is a replay after a later login on the device, and ends that login's session" do
      {user, membership} = insert_owner!("sessions-retry-login@example.com")
      {a, _b, t0} = open_and_rotate!(user, membership)
      {:ok, login} = DeviceSessions.open(user, membership, @device_id)

      assert DeviceSessions.rotate(a.refresh_token, DateTime.add(t0, 4, :second)) ==
               {:error, :refresh_token_replayed}

      assert %DeviceSession{revoked_at: %DateTime{}} = session_of(login.refresh_token)
      assert active_sessions(user) == []
    end

    test "the pair a retry replaced is a rotated token too: a retry inside its own window" do
      {user, membership} = insert_owner!("sessions-retry-superseded@example.com")
      {a, b, t0} = open_and_rotate!(user, membership)
      {:ok, c} = DeviceSessions.rotate(a.refresh_token, DateTime.add(t0, 3, :second))

      assert {:ok, d} = DeviceSessions.rotate(b.refresh_token, DateTime.add(t0, 5, :second))

      new_id = session_of(d.refresh_token).id
      assert [%DeviceSession{id: ^new_id}] = active_sessions(user)

      assert %DeviceSession{revoked_at: %DateTime{}, replaced_by_id: ^new_id} =
               session_of(c.refresh_token)
    end

    @tag :capture_log
    test "the pair a retry replaced is a rotated token too: a replay after its own window" do
      {user, membership} = insert_owner!("sessions-retry-superseded-late@example.com")
      {a, b, t0} = open_and_rotate!(user, membership)
      {:ok, c} = DeviceSessions.rotate(a.refresh_token, DateTime.add(t0, 3, :second))

      assert DeviceSessions.rotate(b.refresh_token, DateTime.add(t0, 60, :second)) ==
               {:error, :refresh_token_replayed}

      assert %DeviceSession{revoked_at: %DateTime{}} = session_of(c.refresh_token)
      assert active_sessions(user) == []
    end

    test "a Membership that is no longer active gets account_not_found and nothing changes" do
      {user, membership} = insert_owner!("sessions-retry-suspended@example.com")
      {a, b, t0} = open_and_rotate!(user, membership)
      successor_id = session_of(b.refresh_token).id

      membership |> Ecto.Changeset.change(status: :suspended) |> Repo.update!()

      assert DeviceSessions.rotate(a.refresh_token, DateTime.add(t0, 4, :second)) ==
               {:error, :account_not_found}

      assert [%DeviceSession{id: ^successor_id}] = active_sessions(user)
      assert %DeviceSession{replaced_by_id: ^successor_id} = session_of(a.refresh_token)
      assert Repo.aggregate(DeviceSession, :count) == 2
    end

    test "a rotated token whose JWT has expired gets refresh_token_expired and revokes nothing" do
      {user, membership} = insert_owner!("sessions-retry-expired@example.com")
      {:ok, current} = DeviceSessions.open(user, membership, @device_id)
      rotated_at = DateTime.utc_now()

      session_id = Ecto.UUID.generate()
      token = refresh_token!(user, session_id, ttl: {-1, :minute})

      insert_session!(user, membership, token,
        id: session_id,
        revoked_at: rotated_at,
        replaced_by_id: session_of(current.refresh_token).id
      )

      assert DeviceSessions.rotate(token, DateTime.add(rotated_at, 4, :second)) ==
               {:error, :refresh_token_expired}

      assert %DeviceSession{revoked_at: nil} = session_of(current.refresh_token)
      assert Repo.aggregate(DeviceSession, :count) == 2
    end

    test "a pair that cannot be issued gets session_issue_failed and nothing changes" do
      {user, membership} = insert_owner!("sessions-retry-unissuable@example.com")
      rotated_at = DateTime.utc_now()

      # A device_id the column holds and a new row is refused for, so the
      # retry gets as far as storing its pair and fails there.
      wide = String.duplicate("😀", 100)
      [presented_id, successor_id] = [Ecto.UUID.generate(), Ecto.UUID.generate()]
      token = refresh_token!(user, presented_id)

      insert_session!(user, membership, "successor", id: successor_id, device_id: wide)

      insert_session!(user, membership, token,
        id: presented_id,
        device_id: wide,
        revoked_at: rotated_at,
        replaced_by_id: successor_id
      )

      assert DeviceSessions.rotate(token, DateTime.add(rotated_at, 4, :second)) ==
               {:error, :session_issue_failed}

      assert %DeviceSession{revoked_at: nil, replaced_by_id: nil} =
               Repo.get!(DeviceSession, successor_id)

      assert %DeviceSession{replaced_by_id: ^successor_id} =
               Repo.get!(DeviceSession, presented_id)

      assert Repo.aggregate(DeviceSession, :count) == 2
    end

    test "is logged with the User and nothing that names the token or the phone" do
      level = Logger.level()
      Logger.configure(level: :info)
      on_exit(fn -> Logger.configure(level: level) end)

      {user, membership} = insert_owner!("sessions-retry-log@example.com")
      {a, b, t0} = open_and_rotate!(user, membership)

      log =
        capture_log(fn ->
          assert {:ok, _c} = DeviceSessions.rotate(a.refresh_token, DateTime.add(t0, 4, :second))
        end)

      assert log =~ "[info]"
      assert log =~ "user_id=#{user.id}"

      for secret <- [a.refresh_token, b.refresh_token, @device_id] ++ token_hashes([a, b]) do
        refute log =~ secret
      end
    end
  end

  describe "rotate/2 — a retry window that is off" do
    setup do
      window = Application.fetch_env!(:meal_planner_api, :refresh_retry_window_seconds)

      on_exit(fn ->
        Application.put_env(:meal_planner_api, :refresh_retry_window_seconds, window)
      end)
    end

    @tag :capture_log
    test "zero means a rotated token is a replay at once" do
      Application.put_env(:meal_planner_api, :refresh_retry_window_seconds, 0)

      {user, membership} = insert_owner!("sessions-window-zero@example.com")
      {a, _b, t0} = open_and_rotate!(user, membership)

      assert DeviceSessions.rotate(a.refresh_token, t0) == {:error, :refresh_token_replayed}
      assert active_sessions(user) == []
    end

    @tag :capture_log
    test "a value that is not a positive number of seconds counts as zero" do
      for {invalid, index} <- Enum.with_index([-5, "10", 10.0, nil, :unset]) do
        case invalid do
          :unset -> Application.delete_env(:meal_planner_api, :refresh_retry_window_seconds)
          value -> Application.put_env(:meal_planner_api, :refresh_retry_window_seconds, value)
        end

        {user, membership} = insert_owner!("sessions-window-invalid-#{index}@example.com")
        {a, _b, t0} = open_and_rotate!(user, membership)

        assert DeviceSessions.rotate(a.refresh_token, t0) == {:error, :refresh_token_replayed}
        assert active_sessions(user) == []
      end
    end
  end

  describe "rotate/2 — arguments" do
    test "a token that is not a string is invalid, with or without a clock" do
      assert DeviceSessions.rotate(nil) == {:error, :refresh_token_invalid}
      assert DeviceSessions.rotate(42, DateTime.utc_now()) == {:error, :refresh_token_invalid}
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

      # On another device: a User has one row that is not revoked per device.
      expired =
        insert_session!(user, membership, "expired",
          device_id: "old-phone",
          expires_at: DateTime.add(now, -1, :second)
        )

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
        device_id: "old-phone",
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

      # A minute later, well past the retry window.
      assert DeviceSessions.rotate(first.refresh_token, DateTime.add(now, 60, :second)) ==
               {:error, :refresh_token_replayed}

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

  # The changeset `DeviceSessions` stores a row through, for `token`;
  # `overrides` replaces any attribute.
  defp session_changeset(user, membership, token, overrides \\ []) do
    attrs =
      Map.merge(
        %{
          id: Ecto.UUID.generate(),
          user_id: user.id,
          membership_id: membership.id,
          device_id: @device_id,
          token_hash: token_hash(token),
          expires_at: DateTime.add(DateTime.utc_now(), 30 * 86_400, :second)
        },
        Map.new(overrides)
      )

    DeviceSession.changeset(%DeviceSession{}, attrs)
  end

  defp errors_on(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {message, _opts} -> message end)
  end

  defp session_of(refresh_token) do
    Repo.get_by!(DeviceSession, token_hash: token_hash(refresh_token))
  end

  # Opens a session, rotates its token A into B at `t0` and returns both
  # pairs with `t0`.
  defp open_and_rotate!(user, membership) do
    t0 = DateTime.utc_now()
    {:ok, a} = DeviceSessions.open(user, membership, @device_id)
    {:ok, b} = DeviceSessions.rotate(a.refresh_token, t0)
    {a, b, t0}
  end

  defp active_sessions(user) do
    Repo.all(
      from(s in DeviceSession,
        where: s.user_id == ^user.id and s.device_id == @device_id and is_nil(s.revoked_at)
      )
    )
  end

  defp token_hashes(pairs), do: Enum.map(pairs, &token_hash(&1.refresh_token))

  defp token_hash(token), do: :sha256 |> :crypto.hash(token) |> Base.encode16(case: :lower)
end
