defmodule MealPlannerApiWeb.InviteAcceptControllerTest do
  use MealPlannerApiWeb.ConnCase, async: false

  import Ecto.Query
  import MealPlannerApi.FactoryHelpers

  alias MealPlannerApi.AccountsMembership
  alias MealPlannerApi.Auth.Guardian
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Persistence.Auth.EmailAuthEvent
  alias MealPlannerApi.Persistence.Auth.EmailVerificationCode
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.InviteService
  alias MealPlannerApiWeb.Controllers.AccountScopeHelpers

  @device_id "6f1c2d3e-4a5b-4c6d-8e7f-901234567890"

  describe "POST /api/invites/:token/accept (task 3.4)" do
    test "existing User accepts and receives a fresh auth payload", %{conn: conn} do
      owner =
        user_with_memberships(%{email: "owner_accept_a@example.com"}, [
          {%{plan: :family_4, name: "Family Accept A"}, :owner}
        ])

      [owner_membership] = owner.memberships
      account = owner_membership.account

      invitee =
        user_with_memberships(%{email: "invitee_existing@example.com"}, [
          {%{plan: :individual, name: "Invitee Own Account"}, :owner}
        ])

      [invitee_own_membership] = invitee.memberships
      invitee_token = issue_access_v2_token(invitee, invitee_own_membership)

      {:ok, %{token: plaintext}} =
        AccountsMembership.invite(account, owner_membership, "invitee_existing@example.com")

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> invitee_token)
        |> post("/api/invites/#{plaintext}/accept", %{})

      body = json_response(conn, 200)

      assert is_binary(body["access_token"])
      assert is_binary(body["refresh_token"])
      assert body["membership"]["account_id"] == account.id
      assert body["membership"]["status"] == "active"
      assert body["account"]["id"] == account.id
    end

    # Holding the token is not enough to join (#274): a `name` without a
    # `code` and without a Bearer token is refused as an empty body is.
    test "a name accept of a stub invite is refused and leaves the stub unclaimed",
         %{conn: conn} do
      owner = owner!("owner_accept_b@example.com", "Family Accept B")

      {:ok, %{token: plaintext, membership_id: membership_id}} =
        AccountsMembership.invite(owner.account, owner, "brand_new@example.com")

      conn = post(conn, "/api/invites/#{plaintext}/accept", %{"name" => "Brand New"})

      body = json_response(conn, 401)
      assert body["error"] == "unauthorized"
      refute Map.has_key?(body, "access_token")
      refute Map.has_key?(body, "accessToken")

      stub = Repo.get_by!(User, email: "brand_new@example.com")
      assert stub.invite_stub
      assert stub.name == "brand_new@example.com"
      assert Repo.get!(AccountMembership, membership_id).status == :invited
    end

    test "a code accept with a name on a stub invite sets the name and claims the stub",
         %{conn: conn} do
      owner = owner!("owner_accept_named@example.com", "Family Accept Named")

      {:ok, %{token: plaintext, membership_id: membership_id}} =
        AccountsMembership.invite(owner.account, owner, "named_stub@example.com")

      body = accept_with_code!(conn, plaintext, %{"name" => "Named Stub"})

      assert body["me"]["user"]["email"] == "named_stub@example.com"
      assert body["me"]["user"]["displayName"] == "Named Stub"

      user = Repo.get_by!(User, email: "named_stub@example.com")
      refute user.invite_stub
      assert user.name == "Named Stub"
      assert Repo.get!(AccountMembership, membership_id).status == :active
    end

    # A `name` that is not a non-empty string is ignored like an unknown
    # key, and so is one the `name` column cannot hold: blank, longer than
    # 255 characters or with a NUL character.
    test "a code accept without a usable name keeps the stub's placeholder name",
         %{conn: conn} do
      # Six invites, so two Accounts with room for them.
      owners =
        for plan_n <- 1..2 do
          [owner] =
            user_with_memberships(%{email: "owner_accept_unnamed_#{plan_n}@example.com"}, [
              {%{plan: :family_4, name: "Family Accept Unnamed #{plan_n}"}, :owner}
            ]).memberships

          owner
        end

      for {extra, n} <-
            Enum.with_index([
              %{},
              %{"name" => ""},
              %{"name" => "   "},
              %{"name" => 42},
              %{"name" => String.duplicate("a", 256)},
              %{"name" => "Ana" <> <<0>>}
            ]) do
        email = "unnamed_stub_#{n}@example.com"
        owner = Enum.at(owners, div(n, 3))
        {:ok, %{token: plaintext}} = AccountsMembership.invite(owner.account, owner, email)

        body = accept_with_code!(conn, plaintext, extra)

        assert body["me"]["user"]["displayName"] == email

        user = Repo.get_by!(User, email: email)
        refute user.invite_stub
        assert user.name == email
      end
    end

    test "a code accept with a name on an invite to a registered User keeps that User's name",
         %{conn: conn} do
      owner = owner!("owner_accept_registered@example.com", "Family Accept Registered")

      registered =
        user_with_memberships(%{email: "registered_named@example.com", name: "Registered"}, [
          {%{plan: :individual, name: "Registered Own Account"}, :owner}
        ])

      {:ok, %{token: plaintext, membership_id: membership_id}} =
        AccountsMembership.invite(owner.account, owner, registered.email)

      body = accept_with_code!(conn, plaintext, %{"name" => "Renamed"})

      assert body["me"]["user"]["id"] == registered.id
      assert body["me"]["user"]["displayName"] == "Registered"
      assert Repo.get!(User, registered.id).name == "Registered"
      assert Repo.get!(AccountMembership, membership_id).status == :active
    end

    # Any other key in the body is ignored, `password` included.
    test "a code accept ignores a password key in the body", %{conn: conn} do
      owner = owner!("owner_accept_stray@example.com", "Family Accept Stray")

      {:ok, %{token: plaintext}} =
        AccountsMembership.invite(owner.account, owner, "stray_key@example.com")

      body =
        accept_with_code!(conn, plaintext, %{
          "name" => "Stray Key",
          "password" => "supersecret123"
        })

      assert body["me"]["user"]["email"] == "stray_key@example.com"
      assert body["me"]["user"]["displayName"] == "Stray Key"
    end

    test "replaying an already-accepted token returns 410 invite_token_used", %{conn: conn} do
      owner =
        user_with_memberships(%{email: "owner_accept_c@example.com"}, [
          {%{plan: :family_4, name: "Family Accept C"}, :owner}
        ])

      [owner_membership] = owner.memberships
      account = owner_membership.account

      {:ok, %{token: plaintext}} =
        AccountsMembership.invite(account, owner_membership, "replay@example.com")

      accept_with_code!(conn, plaintext)

      conn =
        post(build_conn(), "/api/invites/#{plaintext}/accept", %{
          "deviceId" => @device_id,
          "code" => mailed_code()
        })

      assert json_response(conn, 410)["error"] == "invite_token_used"
    end

    test "an expired token returns 410 invite_token_expired", %{conn: conn} do
      owner =
        user_with_memberships(%{email: "owner_accept_d@example.com"}, [
          {%{plan: :family_4, name: "Family Accept D"}, :owner}
        ])

      [owner_membership] = owner.memberships
      account = owner_membership.account

      {:ok, %{token: plaintext, membership_id: membership_id}} =
        AccountsMembership.invite(account, owner_membership, "expired@example.com")

      Repo.get!(AccountMembership, membership_id)
      |> AccountMembership.changeset(%{
        invite_expires_at: DateTime.add(DateTime.utc_now(), -1, :day)
      })
      |> Repo.update!()

      conn =
        post(conn, "/api/invites/#{plaintext}/accept", %{
          "deviceId" => @device_id,
          "code" => "123456"
        })

      assert json_response(conn, 410)["error"] == "invite_token_expired"
    end

    # Post-review fix pass, item 6: this route is deliberately OUTSIDE the
    # `:auth` pipeline (per its own moduledoc) — `resolve_invitee/2`'s own
    # Bearer-header handling is the ONLY thing preventing unauthenticated
    # access to the "existing User accepts" path. No test previously
    # exercised a request with no/invalid Authorization header and an
    # empty body.
    test "no Authorization header and an empty body returns 401 unauthorized", %{conn: conn} do
      owner =
        user_with_memberships(%{email: "owner_accept_noauth@example.com"}, [
          {%{plan: :family_4, name: "Family Accept NoAuth"}, :owner}
        ])

      [owner_membership] = owner.memberships
      account = owner_membership.account

      {:ok, %{token: plaintext}} =
        AccountsMembership.invite(account, owner_membership, "noauth@example.com")

      conn = post(conn, "/api/invites/#{plaintext}/accept", %{})

      assert json_response(conn, 401)["error"] == "unauthorized"
    end

    test "an invalid (malformed) Authorization header and an empty body returns 401 unauthorized",
         %{conn: conn} do
      owner =
        user_with_memberships(%{email: "owner_accept_badauth@example.com"}, [
          {%{plan: :family_4, name: "Family Accept BadAuth"}, :owner}
        ])

      [owner_membership] = owner.memberships
      account = owner_membership.account

      {:ok, %{token: plaintext}} =
        AccountsMembership.invite(account, owner_membership, "badauth@example.com")

      conn =
        conn
        |> put_req_header("authorization", "Bearer not-a-real-token")
        |> post("/api/invites/#{plaintext}/accept", %{})

      assert json_response(conn, 401)["error"] == "unauthorized"
    end

    # Post-review fix pass, item 7: `error_status/1`'s `invite_token_unknown`
    # mapping (404) had zero HTTP-level test coverage.
    test "an unknown/bogus token returns 404 invite_token_unknown", %{conn: conn} do
      conn =
        post(conn, "/api/invites/#{Ecto.UUID.generate()}/accept", %{
          "deviceId" => @device_id,
          "code" => "123456"
        })

      assert json_response(conn, 404)["error"] == "invite_token_unknown"
    end
  end

  # Post-review fix pass, item 8 (security): Guardian's `token_type:`
  # option is never actually checked by Guardian at decode time — without
  # an explicit `claims["typ"] in ["access", "access_v2"]` assertion in
  # `resolve_invitee/2`, a `refresh` token presented as a Bearer header
  # would authenticate the "existing User accepts" path.
  describe "Bearer token typ validation (post-review fix, item 8)" do
    test "a refresh token used as Bearer is treated as unauthenticated", %{conn: conn} do
      owner =
        user_with_memberships(%{email: "owner_accept_reftyp@example.com"}, [
          {%{plan: :family_4, name: "Family Accept RefTyp"}, :owner}
        ])

      [owner_membership] = owner.memberships
      account = owner_membership.account

      invitee =
        user_with_memberships(%{email: "invitee_reftyp@example.com", name: "Invitee RefTyp"}, [
          {%{plan: :individual, name: "Invitee RefTyp Own Account"}, :owner}
        ])

      [invitee_own_membership] = invitee.memberships

      {:ok, _access_token, refresh_token} =
        AccountScopeHelpers.mint_token_pair(
          invitee,
          AccountsMembership.claims_for(invitee, invitee_own_membership)
        )

      {:ok, refresh_claims} =
        Guardian.decode_and_verify(refresh_token, %{}, token_type: "refresh")

      assert refresh_claims["typ"] == "refresh"

      {:ok, %{token: plaintext}} =
        AccountsMembership.invite(account, owner_membership, "invitee_reftyp@example.com")

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> refresh_token)
        |> post("/api/invites/#{plaintext}/accept", %{})

      assert json_response(conn, 401)["error"] == "unauthorized"
    end
  end

  # Post-review fix pass, item 2: `accept_invite/2` must consult the
  # `MEAL_PLANNER_TENANCY_V2` flag, instead of unconditionally minting
  # `access_v2` regardless of the flag.
  describe "tenancy_v2_only flag (post-review fix)" do
    setup do
      previous = Application.get_env(:meal_planner_api, :tenancy_v2_only)

      on_exit(fn ->
        Application.put_env(:meal_planner_api, :tenancy_v2_only, previous)
      end)

      :ok
    end

    test "a Bearer accept mints access (not access_v2) when the flag is off", %{conn: conn} do
      owner =
        user_with_memberships(%{email: "owner_accept_flagoff@example.com"}, [
          {%{plan: :family_4, name: "Family Accept FlagOff"}, :owner}
        ])

      [owner_membership] = owner.memberships
      account = owner_membership.account

      invitee =
        user_with_memberships(%{email: "flagoff_invitee@example.com"}, [
          {%{plan: :individual, name: "Flag Off Own Account"}, :owner}
        ])

      [invitee_own_membership] = invitee.memberships
      invitee_token = issue_access_v2_token(invitee, invitee_own_membership)

      {:ok, %{token: plaintext}} =
        AccountsMembership.invite(account, owner_membership, invitee.email)

      Application.put_env(:meal_planner_api, :tenancy_v2_only, false)

      body =
        conn
        |> put_req_header("authorization", "Bearer " <> invitee_token)
        |> post("/api/invites/#{plaintext}/accept", %{})
        |> json_response(200)

      {:ok, claims} = Guardian.decode_and_verify(body["access_token"])

      assert claims["typ"] == "access"
      refute Map.has_key?(claims, "membership_id")
    end
  end

  # Second post-review fix pass: `accept/2`'s generic `{:error, reason} ->
  # ... Atom.to_string(reason)` clause assumes `reason` is always an atom.
  # `accept_invite_with_lookup/2`'s `Repo.update/1` call can propagate
  # `{:error, %Ecto.Changeset{}}` from the
  # `account_memberships_active_account_user_unique_index` partial unique
  # constraint when two DIFFERENT `:invited` rows exist for the same
  # `(account_id, user_id)` pair and the second one is accepted after the
  # first already flipped to `:active` (a retried/duplicate invite, or a
  # concurrent accept race — `AccountsMembership.invite/3`'s app-layer
  # `:already_invited` guard only stops a SECOND invite call; it does not
  # stop a SECOND accept of two invites that were already both minted).
  # `Atom.to_string/1` on a `%Ecto.Changeset{}` raises `ArgumentError`,
  # turning a controlled 409 into an unhandled 500.
  describe "changeset-level unique-constraint conflict on accept (second post-review fix pass)" do
    test "accepting a second invite for a user already active on the account returns 409, not a crash",
         %{conn: conn} do
      owner =
        user_with_memberships(%{email: "owner_accept_dupe@example.com"}, [
          {%{plan: :family_4, name: "Family Accept Dupe"}, :owner}
        ])

      [owner_membership] = owner.memberships

      # Two independent :invited rows for the SAME email/user on the SAME
      # account, created directly via InviteService (bypassing
      # AccountsMembership.invite/3's :already_invited app-layer guard) —
      # this is the only way to reach the changeset-level constraint
      # instead of the earlier app-layer check.
      {:ok, %{token: first_plaintext}} =
        InviteService.create_invite_row(owner_membership, "dupe_invitee@example.com")

      {:ok, %{token: second_plaintext}} =
        InviteService.create_invite_row(owner_membership, "dupe_invitee@example.com")

      # The first accept claimed the stub, so the second accept comes from
      # that now-registered User.
      %{"accessToken" => access_token} = accept_with_code!(conn, first_plaintext)

      second_conn =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> access_token)
        |> post("/api/invites/#{second_plaintext}/accept", %{})

      assert json_response(second_conn, 409)["error"] == "already_a_member"
    end
  end

  # There is no name path (#274): a `name` without a `code` and without a
  # Bearer token never joins, whoever the invite is bound to.
  describe "name-only accept" do
    test "returns 401 and leaves the User and the invite untouched", %{conn: conn} do
      owner =
        user_with_memberships(%{email: "owner_takeover@example.com"}, [
          {%{plan: :family_4, name: "Family Takeover"}, :owner}
        ])

      [owner_membership] = owner.memberships

      victim =
        user_with_memberships(%{email: "victim_takeover@example.com", name: "Victim"}, [
          {%{plan: :individual, name: "Victim Own Account"}, :owner}
        ])

      [victim_own_membership] = victim.memberships

      {:ok, %{token: plaintext, membership_id: membership_id}} =
        AccountsMembership.invite(
          owner_membership.account,
          owner_membership,
          "victim_takeover@example.com"
        )

      conn = post(conn, "/api/invites/#{plaintext}/accept", %{"name" => "Attacker"})

      body = json_response(conn, 401)
      assert body["error"] == "unauthorized"
      refute Map.has_key?(body, "access_token")
      refute Map.has_key?(body, "refresh_token")

      assert Repo.get!(User, victim.id).name == "Victim"
      assert Repo.get!(AccountMembership, membership_id).status == :invited

      # The invite still works for the User it is bound to.
      accepted =
        build_conn()
        |> put_req_header(
          "authorization",
          "Bearer " <> issue_access_v2_token(victim, victim_own_membership)
        )
        |> post("/api/invites/#{plaintext}/accept", %{})
        |> json_response(200)

      assert accepted["user"]["id"] == victim.id
      assert accepted["membership"]["status"] == "active"
    end

    test "a User claimed through one invite is not renamed through another",
         %{conn: conn} do
      family_a =
        user_with_memberships(%{email: "owner_claim_a@example.com"}, [
          {%{plan: :family_4, name: "Family Claim A"}, :owner}
        ])

      family_b =
        user_with_memberships(%{email: "owner_claim_b@example.com"}, [
          {%{plan: :family_4, name: "Family Claim B"}, :owner}
        ])

      [membership_a] = family_a.memberships
      [membership_b] = family_b.memberships

      {:ok, %{token: token_a}} =
        AccountsMembership.invite(membership_a.account, membership_a, "claimed_once@example.com")

      {:ok, %{token: token_b}} =
        AccountsMembership.invite(membership_b.account, membership_b, "claimed_once@example.com")

      first = accept_with_code!(conn, token_a, %{"name" => "Real Invitee"})
      assert first["me"]["user"]["displayName"] == "Real Invitee"

      second = post(build_conn(), "/api/invites/#{token_b}/accept", %{"name" => "Attacker"})
      assert json_response(second, 401)["error"] == "unauthorized"

      assert Repo.get_by!(User, email: "claimed_once@example.com").name == "Real Invitee"
    end

    test "a removed member cannot join by name through a new invite", %{conn: conn} do
      first_owner =
        user_with_memberships(%{email: "owner_removed_a@example.com"}, [
          {%{plan: :family_4, name: "Family Removed A"}, :owner}
        ])

      second_owner =
        user_with_memberships(%{email: "owner_removed_b@example.com"}, [
          {%{plan: :family_4, name: "Family Removed B"}, :owner}
        ])

      [first_membership] = first_owner.memberships
      [second_membership] = second_owner.memberships

      {:ok, %{token: first_token}} =
        AccountsMembership.invite(
          first_membership.account,
          first_membership,
          "removed_member@example.com"
        )

      %{"me" => %{"user" => %{"id" => member_id}}} =
        accept_with_code!(conn, first_token, %{"name" => "Removed Member"})

      :ok =
        AccountsMembership.remove_member(first_membership.account, member_id, first_membership)

      {:ok, %{token: second_token}} =
        AccountsMembership.invite(
          second_membership.account,
          second_membership,
          "removed_member@example.com"
        )

      conn = post(build_conn(), "/api/invites/#{second_token}/accept", %{"name" => "Attacker"})

      assert json_response(conn, 401)["error"] == "unauthorized"
      assert Repo.get!(User, member_id).name == "Removed Member"
    end
  end

  # The Bearer path accepts only for the User the invite is bound to.
  describe "Bearer accept by a User the invite is not bound to" do
    test "returns 403 for an invite bound to another registered User", %{conn: conn} do
      owner =
        user_with_memberships(%{email: "owner_bearer_other@example.com"}, [
          {%{plan: :family_4, name: "Family Bearer Other"}, :owner}
        ])

      [owner_membership] = owner.memberships

      _invitee =
        user_with_memberships(%{email: "invitee_bearer_other@example.com"}, [
          {%{plan: :individual, name: "Invitee Bearer Other Account"}, :owner}
        ])

      {:ok, %{token: plaintext, membership_id: membership_id}} =
        AccountsMembership.invite(
          owner_membership.account,
          owner_membership,
          "invitee_bearer_other@example.com"
        )

      conn =
        conn
        |> put_req_header(
          "authorization",
          "Bearer " <> issue_access_v2_token(owner, owner_membership)
        )
        |> post("/api/invites/#{plaintext}/accept", %{})

      assert json_response(conn, 403)["error"] == "invite_for_another_user"
      assert Repo.get!(AccountMembership, membership_id).status == :invited
    end

    test "returns 403 for an invite bound to a stub", %{conn: conn} do
      owner =
        user_with_memberships(%{email: "owner_bearer_stub@example.com"}, [
          {%{plan: :family_4, name: "Family Bearer Stub"}, :owner}
        ])

      [owner_membership] = owner.memberships

      other =
        user_with_memberships(%{email: "other_bearer_stub@example.com"}, [
          {%{plan: :individual, name: "Other Bearer Stub Account"}, :owner}
        ])

      [other_membership] = other.memberships

      {:ok, %{token: plaintext, membership_id: membership_id}} =
        AccountsMembership.invite(
          owner_membership.account,
          owner_membership,
          "stub_bearer@example.com"
        )

      conn =
        conn
        |> put_req_header(
          "authorization",
          "Bearer " <> issue_access_v2_token(other, other_membership)
        )
        |> post("/api/invites/#{plaintext}/accept", %{})

      assert json_response(conn, 403)["error"] == "invite_for_another_user"
      assert Repo.get!(AccountMembership, membership_id).status == :invited
    end
  end

  describe "email-code accept of an invite (#297)" do
    setup do
      Bamboo.SentEmail.reset()
      :ok
    end

    test "a removed member invited again accepts with the code mailed to the invite's email",
         %{conn: conn} do
      %{member_id: member_id, token: token, membership_id: membership_id} =
        removed_member_invited_again!("rejoin_code@example.com")

      sent =
        build_conn()
        |> post("/api/invites/#{token}/code", %{"email" => "attacker@example.com"})
        |> json_response(200)

      assert sent["status"] == "code_sent"
      assert sent["expires_in_seconds"] == 600
      assert sent["resend_available_in_seconds"] == 60

      assert [email] = Bamboo.SentEmail.all()
      assert [{_name, "rejoin_code@example.com"}] = email.to
      # The code cannot sign in, so the mail must not call it a sign-in code.
      assert email.subject == "Your Myfood invite code"
      assert email.text_body =~ "accept your invite"
      refute email.text_body =~ "sign-in"

      body =
        build_conn()
        |> post("/api/invites/#{token}/accept", %{
          "deviceId" => @device_id,
          "code" => mailed_code()
        })
        |> json_response(200)

      # The session a login opens: a Device session whose refresh token
      # keeps the invitee signed in.
      assert body["tokenType"] == "Bearer"
      assert body["me"]["user"]["id"] == member_id
      assert body["me"]["membership"] == %{"role" => "member"}

      assert {:ok, claims} = Guardian.decode_and_verify(body["accessToken"])
      assert claims["membership_id"] == membership_id

      refreshed =
        build_conn()
        |> post("/api/auth/refresh", %{"refreshToken" => body["refreshToken"]})
        |> json_response(200)

      assert is_binary(refreshed["accessToken"])

      assert %AccountMembership{status: :active, user_id: ^member_id} =
               Repo.get!(AccountMembership, membership_id)

      assert [%EmailVerificationCode{consumed_at: %DateTime{}}] =
               Repo.all(EmailVerificationCode)
    end

    # As in the email-code login, a `deviceId` no Device session could be
    # stored with is refused before the code is looked at.
    test "a code accept without a valid deviceId is refused and leaves the code untouched",
         %{conn: conn} do
      %{token: token, membership_id: membership_id} =
        removed_member_invited_again!("rejoin_no_device@example.com")

      build_conn() |> post("/api/invites/#{token}/code", %{}) |> json_response(200)
      code = mailed_code()

      for body <- [%{"code" => code}, %{"code" => code, "deviceId" => "  "}] do
        conn = post_json("/api/invites/#{token}/accept", body)
        assert json_response(conn, 422)["error"] == "code_invalid"
      end

      assert Repo.get!(AccountMembership, membership_id).status == :invited

      assert [%EmailVerificationCode{attempts: 0, consumed_at: nil}] =
               Repo.all(EmailVerificationCode)

      assert Repo.aggregate(
               from(e in EmailAuthEvent, where: e.kind == "verification_failure"),
               :count
             ) == 0
    end

    test "a wrong code is refused and counts as a failed verification", %{conn: conn} do
      %{token: token, membership_id: membership_id} =
        removed_member_invited_again!("rejoin_wrong@example.com")

      build_conn() |> post("/api/invites/#{token}/code", %{}) |> json_response(200)
      wrong = if mailed_code() == "000000", do: "111111", else: "000000"

      conn =
        post(build_conn(), "/api/invites/#{token}/accept", %{
          "deviceId" => @device_id,
          "code" => wrong
        })

      assert json_response(conn, 422)["error"] == "code_invalid"
      assert Repo.get!(AccountMembership, membership_id).status == :invited

      assert [%EmailVerificationCode{attempts: 1, consumed_at: nil}] =
               Repo.all(EmailVerificationCode)

      assert Repo.aggregate(
               from(e in EmailAuthEvent, where: e.kind == "verification_failure"),
               :count
             ) == 1
    end

    test "the right code accepts from an IP over the failed-verification limit", %{conn: conn} do
      %{token: token, membership_id: membership_id} =
        removed_member_invited_again!("rejoin_ip_limited@example.com")

      build_conn() |> post("/api/invites/#{token}/code", %{}) |> json_response(200)
      code = mailed_code()

      # Anyone sharing the IP spends its 20 failures on made-up emails.
      for n <- 1..20 do
        conn =
          post(build_conn(), "/api/auth/login/verify-code", %{
            "email" => "rejoin-lockout-#{n}@example.com",
            "code" => "000000",
            "deviceId" => @device_id
          })

        assert json_response(conn, 422)["error"]["code"] == "code_invalid"
      end

      conn =
        post(build_conn(), "/api/invites/#{token}/accept", %{
          "deviceId" => @device_id,
          "code" => code
        })

      assert %{"accessToken" => _} = json_response(conn, 200)
      assert Repo.get!(AccountMembership, membership_id).status == :active
    end

    test "a wrong code from an IP over the limit is rate limited and still counts as an attempt",
         %{conn: conn} do
      %{token: token, membership_id: membership_id} =
        removed_member_invited_again!("rejoin_ip_wrong@example.com")

      build_conn() |> post("/api/invites/#{token}/code", %{}) |> json_response(200)
      wrong = if mailed_code() == "000000", do: "111111", else: "000000"

      for n <- 1..20 do
        conn =
          post(build_conn(), "/api/auth/login/verify-code", %{
            "email" => "rejoin-wrong-#{n}@example.com",
            "code" => "000000",
            "deviceId" => @device_id
          })

        assert json_response(conn, 422)["error"]["code"] == "code_invalid"
      end

      conn =
        post(build_conn(), "/api/invites/#{token}/accept", %{
          "deviceId" => @device_id,
          "code" => wrong
        })

      assert json_response(conn, 429)["error"] == "rate_limited"
      assert [retry_after] = get_resp_header(conn, "retry-after")
      assert String.to_integer(retry_after) in 3_590..3_600
      assert Repo.get!(AccountMembership, membership_id).status == :invited

      # The refused failure is not recorded against the IP, but it still
      # counts as an attempt on the invite code.
      assert [%EmailVerificationCode{attempts: 1, consumed_at: nil}] =
               Repo.all(from(c in EmailVerificationCode, where: c.purpose == :invite))

      assert Repo.aggregate(
               from(e in EmailAuthEvent, where: e.kind == "verification_failure"),
               :count
             ) == 20
    end

    test "the code locks after the attempt cap, and the right code is refused too",
         %{conn: conn} do
      %{token: token, membership_id: membership_id} =
        removed_member_invited_again!("rejoin_locked@example.com")

      build_conn() |> post("/api/invites/#{token}/code", %{}) |> json_response(200)
      code = mailed_code()
      wrong = if code == "000000", do: "111111", else: "000000"

      for _ <- 1..4 do
        conn =
          post(build_conn(), "/api/invites/#{token}/accept", %{
            "deviceId" => @device_id,
            "code" => wrong
          })

        assert json_response(conn, 422)["error"] == "code_invalid"
      end

      fifth =
        post(build_conn(), "/api/invites/#{token}/accept", %{
          "deviceId" => @device_id,
          "code" => wrong
        })

      assert json_response(fifth, 429)["error"] == "too_many_attempts"

      right =
        post(build_conn(), "/api/invites/#{token}/accept", %{
          "deviceId" => @device_id,
          "code" => code
        })

      assert json_response(right, 429)["error"] == "too_many_attempts"
      assert Repo.get!(AccountMembership, membership_id).status == :invited
    end

    test "a login code does not accept the invite", %{conn: conn} do
      owner = owner!("owner_login_code@example.com", "Family Login Code")

      invitee =
        user_with_memberships(%{email: "login_code_invitee@example.com"}, [
          {%{plan: :individual, name: "Login Code Invitee"}, :owner}
        ])

      {:ok, %{token: token, membership_id: membership_id}} =
        AccountsMembership.invite(owner.account, owner, invitee.email)

      conn
      |> post("/api/auth/login/request-code", %{"email" => invitee.email})
      |> json_response(200)

      conn =
        post(build_conn(), "/api/invites/#{token}/accept", %{
          "deviceId" => @device_id,
          "code" => mailed_code()
        })

      assert json_response(conn, 422)["error"] == "code_invalid"
      assert Repo.get!(AccountMembership, membership_id).status == :invited
    end

    test "an invite code does not log in", %{conn: conn} do
      owner = owner!("owner_invite_login@example.com", "Family Invite Login")

      invitee =
        user_with_memberships(%{email: "invite_code_login@example.com"}, [
          {%{plan: :individual, name: "Invite Code Login"}, :owner}
        ])

      {:ok, %{token: token}} = AccountsMembership.invite(owner.account, owner, invitee.email)

      conn |> post("/api/invites/#{token}/code", %{}) |> json_response(200)

      conn =
        post(build_conn(), "/api/auth/login/verify-code", %{
          "email" => invitee.email,
          "code" => mailed_code(),
          "deviceId" => Ecto.UUID.generate()
        })

      assert json_response(conn, 422)["error"]["code"] == "code_invalid"
    end

    test "a second code request inside the cooldown is rate limited", %{conn: conn} do
      %{token: token} = removed_member_invited_again!("rejoin_cooldown@example.com")

      build_conn() |> post("/api/invites/#{token}/code", %{}) |> json_response(200)
      again = post(build_conn(), "/api/invites/#{token}/code", %{})

      assert json_response(again, 429)["error"] == "rate_limited"
      assert [retry_after] = get_resp_header(again, "retry-after")
      assert String.to_integer(retry_after) in 1..60
      assert [_only_the_first] = Bamboo.SentEmail.all()
    end

    test "a code for an unknown, used or expired invite is refused and nothing is mailed",
         %{conn: conn} do
      owner = owner!("owner_code_refused@example.com", "Family Code Refused")

      unknown = post(conn, "/api/invites/not-a-real-token/code", %{})
      assert json_response(unknown, 404)["error"] == "invite_token_unknown"

      used_invitee =
        user_with_memberships(%{email: "code_used@example.com"}, [
          {%{plan: :individual, name: "Code Used Own Account"}, :owner}
        ])

      [used_own_membership] = used_invitee.memberships

      {:ok, %{token: used}} = AccountsMembership.invite(owner.account, owner, used_invitee.email)

      build_conn()
      |> put_req_header(
        "authorization",
        "Bearer " <> issue_access_v2_token(used_invitee, used_own_membership)
      )
      |> post("/api/invites/#{used}/accept", %{})
      |> json_response(200)

      used_conn = post(build_conn(), "/api/invites/#{used}/code", %{})
      assert json_response(used_conn, 410)["error"] == "invite_token_used"

      {:ok, %{token: expired, membership_id: expired_id}} =
        AccountsMembership.invite(owner.account, owner, "code_expired@example.com")

      Repo.get!(AccountMembership, expired_id)
      |> Ecto.Changeset.change(invite_expires_at: DateTime.add(DateTime.utc_now(), -60, :second))
      |> Repo.update!()

      expired_conn = post(build_conn(), "/api/invites/#{expired}/code", %{})
      assert json_response(expired_conn, 410)["error"] == "invite_token_expired"

      assert Bamboo.SentEmail.all() == []
    end

    test "a User who accepted with a code cannot join another Account by name", %{conn: conn} do
      first = owner!("owner_stub_code_a@example.com", "Family Stub Code A")
      second = owner!("owner_stub_code_b@example.com", "Family Stub Code B")

      {:ok, %{token: token_a}} =
        AccountsMembership.invite(first.account, first, "stub_code@example.com")

      {:ok, %{token: token_b, membership_id: membership_b}} =
        AccountsMembership.invite(second.account, second, "stub_code@example.com")

      conn |> post("/api/invites/#{token_a}/code", %{}) |> json_response(200)

      build_conn()
      |> post("/api/invites/#{token_a}/accept", %{
        "deviceId" => @device_id,
        "code" => mailed_code()
      })
      |> json_response(200)

      refused = post(build_conn(), "/api/invites/#{token_b}/accept", %{"name" => "Attacker"})

      assert json_response(refused, 401)["error"] == "unauthorized"
      assert Repo.get!(AccountMembership, membership_b).status == :invited
      refute Repo.get_by!(User, email: "stub_code@example.com").invite_stub
    end

    test "any body with a code takes the code path, so a malformed code is never a name accept",
         %{conn: conn} do
      owner = owner!("owner_malformed_code@example.com", "Family Malformed Code")

      {:ok, %{token: token, membership_id: membership_id}} =
        AccountsMembership.invite(owner.account, owner, "malformed_code@example.com")

      conn |> post("/api/invites/#{token}/code", %{}) |> json_response(200)

      for code <- [123_456, nil, ""] do
        conn =
          post_json("/api/invites/#{token}/accept", %{
            "deviceId" => @device_id,
            "code" => code,
            "name" => "By Name"
          })

        assert json_response(conn, 422)["error"] == "code_invalid"
      end

      assert Repo.get!(AccountMembership, membership_id).status == :invited
      assert Repo.get_by!(User, email: "malformed_code@example.com").invite_stub
    end

    # A code that is not a string is refused as the email-code login
    # refuses it: without a check, so no failed verification is counted.
    test "a code that is not a string is refused without counting a failed verification",
         %{conn: conn} do
      %{token: token, membership_id: membership_id} =
        removed_member_invited_again!("rejoin_number_code@example.com")

      build_conn() |> post("/api/invites/#{token}/code", %{}) |> json_response(200)

      for code <- [String.to_integer(mailed_code()), nil] do
        conn =
          post_json("/api/invites/#{token}/accept", %{"deviceId" => @device_id, "code" => code})

        assert json_response(conn, 422)["error"] == "code_invalid"
      end

      assert Repo.get!(AccountMembership, membership_id).status == :invited

      assert [%EmailVerificationCode{attempts: 0, consumed_at: nil}] =
               Repo.all(EmailVerificationCode)

      assert Repo.aggregate(
               from(e in EmailAuthEvent, where: e.kind == "verification_failure"),
               :count
             ) == 0
    end

    test "a code accept whose activation fails leaves the code pending and the stub as it was",
         %{conn: conn} do
      owner =
        user_with_memberships(%{email: "owner_code_conflict@example.com"}, [
          {%{plan: :family_4, name: "Family Code Conflict"}, :owner}
        ])

      [owner_membership] = owner.memberships

      # Two invite rows for the same stub User; the first is activated as a
      # concurrent accept would, so activating the second one conflicts.
      {:ok, %{membership: first}} =
        InviteService.create_invite_row(owner_membership, "code_conflict@example.com")

      {:ok, %{token: token, membership: second}} =
        InviteService.create_invite_row(owner_membership, "code_conflict@example.com")

      first
      |> Ecto.Changeset.change(status: :active, joined_at: DateTime.utc_now())
      |> Repo.update!()

      conn |> post("/api/invites/#{token}/code", %{}) |> json_response(200)

      conflict =
        post(build_conn(), "/api/invites/#{token}/accept", %{
          "deviceId" => @device_id,
          "code" => mailed_code(),
          "name" => "Rolled Back"
        })

      assert json_response(conflict, 409)["error"] == "already_a_member"
      assert Repo.get!(AccountMembership, second.id).status == :invited

      stub = Repo.get_by!(User, email: "code_conflict@example.com")
      assert stub.invite_stub
      assert stub.name == "code_conflict@example.com"

      assert [%EmailVerificationCode{attempts: 0, consumed_at: nil}] =
               Repo.all(EmailVerificationCode)
    end
  end

  defp owner!(email, account_name) do
    [membership] =
      user_with_memberships(%{email: email}, [{%{plan: :family_4, name: account_name}, :owner}]).memberships

    membership
  end

  # A User who joined one Account, was removed, and is invited to another
  # Account: no Membership left and no longer an invite stub. The first
  # accept is written straight to the database, so it leaves no code behind
  # and starts no code cooldown for the email.
  defp removed_member_invited_again!(email) do
    first = owner!("first_" <> email, "First " <> email)
    second = owner!("second_" <> email, "Second " <> email)

    {:ok, %{membership_id: first_membership_id}} =
      AccountsMembership.invite(first.account, first, email)

    %User{id: member_id} = Repo.get_by!(User, email: email)

    {1, _} =
      Repo.update_all(from(u in User, where: u.id == ^member_id),
        set: [invite_stub: false, name: "Former Member"]
      )

    Repo.get!(AccountMembership, first_membership_id)
    |> Ecto.Changeset.change(status: :active, joined_at: DateTime.utc_now())
    |> Repo.update!()

    :ok = AccountsMembership.remove_member(first.account, member_id, first)

    {:ok, %{token: token, membership_id: membership_id}} =
      AccountsMembership.invite(second.account, second, email)

    %{member_id: member_id, token: token, membership_id: membership_id}
  end

  # Accepts with the code mailed to the invite's email, as an invitee with
  # no session does, and answers the `200` body. The body is real JSON, so
  # a `name` keeps its JSON type.
  defp accept_with_code!(conn, token, extra \\ %{}) do
    conn |> post("/api/invites/#{token}/code", %{}) |> json_response(200)

    "/api/invites/#{token}/accept"
    |> post_json(Map.merge(%{"deviceId" => @device_id, "code" => mailed_code()}, extra))
    |> json_response(200)
  end

  # A real JSON body, so the code keeps its JSON type (a number or null).
  defp post_json(path, body) do
    build_conn()
    |> put_req_header("content-type", "application/json")
    |> post(path, Jason.encode!(body))
  end

  # The newest mail comes first.
  defp mailed_code do
    [email | _older] = Bamboo.SentEmail.all()
    [code] = Regex.run(~r/\b\d{6}\b/, email.text_body)
    code
  end
end
