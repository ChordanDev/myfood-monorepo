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

    test "new User accepts, creating the User row", %{conn: conn} do
      owner =
        user_with_memberships(%{email: "owner_accept_b@example.com"}, [
          {%{plan: :family_4, name: "Family Accept B"}, :owner}
        ])

      [owner_membership] = owner.memberships
      account = owner_membership.account

      {:ok, %{token: plaintext}} =
        AccountsMembership.invite(account, owner_membership, "brand_new@example.com")

      conn = post(conn, "/api/invites/#{plaintext}/accept", %{"name" => "Brand New"})

      body = json_response(conn, 200)

      assert body["user"]["email"] == "brand_new@example.com"
      assert body["membership"]["status"] == "active"

      new_user =
        Repo.get_by(MealPlannerApi.Persistence.Accounts.User, email: "brand_new@example.com")

      assert new_user.name == "Brand New"
    end

    # The new User path is selected by `name` alone: any other key in the
    # body is ignored, `password` included.
    test "new User accepts when the body also carries a password key", %{conn: conn} do
      owner =
        user_with_memberships(%{email: "owner_accept_stray@example.com"}, [
          {%{plan: :family_4, name: "Family Accept Stray"}, :owner}
        ])

      [owner_membership] = owner.memberships
      account = owner_membership.account

      {:ok, %{token: plaintext}} =
        AccountsMembership.invite(account, owner_membership, "stray_key@example.com")

      conn =
        post(conn, "/api/invites/#{plaintext}/accept", %{
          "name" => "Stray Key",
          "password" => "supersecret123"
        })

      body = json_response(conn, 200)

      assert body["user"]["email"] == "stray_key@example.com"
      assert body["user"]["name"] == "Stray Key"
      assert body["membership"]["status"] == "active"
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

      _first = post(conn, "/api/invites/#{plaintext}/accept", %{"name" => "Replay User"})

      conn = post(conn, "/api/invites/#{plaintext}/accept", %{"name" => "Replay User"})

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

      conn = post(conn, "/api/invites/#{plaintext}/accept", %{"name" => "Expired User"})

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
      conn = post(conn, "/api/invites/#{Ecto.UUID.generate()}/accept", %{"name" => "Nobody"})

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

    test "new User accept mints access (not access_v2) when the flag is off", %{conn: conn} do
      owner =
        user_with_memberships(%{email: "owner_accept_flagoff@example.com"}, [
          {%{plan: :family_4, name: "Family Accept FlagOff"}, :owner}
        ])

      [owner_membership] = owner.memberships
      account = owner_membership.account

      {:ok, %{token: plaintext}} =
        AccountsMembership.invite(account, owner_membership, "flagoff_new@example.com")

      Application.put_env(:meal_planner_api, :tenancy_v2_only, false)

      body =
        conn
        |> post("/api/invites/#{plaintext}/accept", %{"name" => "Flag Off New"})
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

      first_conn =
        post(conn, "/api/invites/#{first_plaintext}/accept", %{"name" => "Dupe Invitee"})

      assert json_response(first_conn, 200)

      # The first accept claimed the stub, so the second accept has to come
      # from that now-registered User.
      %{"access_token" => access_token} = json_response(first_conn, 200)

      second_conn =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> access_token)
        |> post("/api/invites/#{second_plaintext}/accept", %{})

      assert json_response(second_conn, 409)["error"] == "already_a_member"
    end
  end

  # The name path is unauthenticated, so it may only claim the stub User an
  # invite created for an email nobody has signed in with. An invite bound
  # to any other User needs that User's own Bearer token.
  describe "name-only accept of an invite bound to a registered User" do
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

    test "a stub claimed through one invite cannot be claimed again through another",
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

      first = post(conn, "/api/invites/#{token_a}/accept", %{"name" => "Real Invitee"})
      assert json_response(first, 200)["user"]["name"] == "Real Invitee"

      second = post(build_conn(), "/api/invites/#{token_b}/accept", %{"name" => "Attacker"})
      assert json_response(second, 401)["error"] == "unauthorized"

      assert Repo.get_by!(User, email: "claimed_once@example.com").name == "Real Invitee"
    end

    test "a removed member cannot be claimed by name through a new invite", %{conn: conn} do
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

      %{"user" => %{"id" => member_id}} =
        conn
        |> post("/api/invites/#{first_token}/accept", %{"name" => "Removed Member"})
        |> json_response(200)

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

    test "a claim whose membership update fails is undone", %{conn: conn} do
      owner =
        user_with_memberships(%{email: "owner_claim_rollback@example.com"}, [
          {%{plan: :family_4, name: "Family Claim Rollback"}, :owner}
        ])

      [owner_membership] = owner.memberships

      {:ok, %{membership: first}} =
        InviteService.create_invite_row(owner_membership, "claim_rollback@example.com")

      {:ok, %{token: second_token}} =
        InviteService.create_invite_row(owner_membership, "claim_rollback@example.com")

      # The stub already holds an active row on this Account, so activating
      # the second invite fails after the stub has been claimed.
      first |> AccountMembership.changeset(%{status: :active}) |> Repo.update!()

      conn = post(conn, "/api/invites/#{second_token}/accept", %{"name" => "Rolled Back"})

      assert json_response(conn, 409)["error"] == "already_a_member"

      stub = Repo.get_by!(User, email: "claim_rollback@example.com")
      assert stub.invite_stub
      assert stub.name == "claim_rollback@example.com"
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
        removed_member_invited_again!(conn, "rejoin_code@example.com")

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
        removed_member_invited_again!(conn, "rejoin_no_device@example.com")

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
        removed_member_invited_again!(conn, "rejoin_wrong@example.com")

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
        removed_member_invited_again!(conn, "rejoin_ip_limited@example.com")

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

    test "the code locks after the attempt cap, and the right code is refused too",
         %{conn: conn} do
      %{token: token, membership_id: membership_id} =
        removed_member_invited_again!(conn, "rejoin_locked@example.com")

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
      %{token: token} = removed_member_invited_again!(conn, "rejoin_cooldown@example.com")

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

      {:ok, %{token: used}} =
        AccountsMembership.invite(owner.account, owner, "code_used@example.com")

      build_conn()
      |> post("/api/invites/#{used}/accept", %{"name" => "Used"})
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

    test "a stub accepted with a code can no longer be claimed by name", %{conn: conn} do
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
        removed_member_invited_again!(conn, "rejoin_number_code@example.com")

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

    test "a code accept whose activation fails leaves the code pending and the stub unclaimed",
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
          "code" => mailed_code()
        })

      assert json_response(conflict, 409)["error"] == "already_a_member"
      assert Repo.get!(AccountMembership, second.id).status == :invited
      assert Repo.get_by!(User, email: "code_conflict@example.com").invite_stub

      assert [%EmailVerificationCode{attempts: 0, consumed_at: nil}] =
               Repo.all(EmailVerificationCode)
    end
  end

  defp owner!(email, account_name) do
    [membership] =
      user_with_memberships(%{email: email}, [{%{plan: :family_4, name: account_name}, :owner}]).memberships

    membership
  end

  # A User who joined one Account by name, was removed, and is invited to
  # another Account: no Membership left and no longer an invite stub.
  defp removed_member_invited_again!(conn, email) do
    first = owner!("first_" <> email, "First " <> email)
    second = owner!("second_" <> email, "Second " <> email)

    {:ok, %{token: first_token}} = AccountsMembership.invite(first.account, first, email)

    %{"user" => %{"id" => member_id}} =
      conn
      |> post("/api/invites/#{first_token}/accept", %{"name" => "Former Member"})
      |> json_response(200)

    :ok = AccountsMembership.remove_member(first.account, member_id, first)

    {:ok, %{token: token, membership_id: membership_id}} =
      AccountsMembership.invite(second.account, second, email)

    %{member_id: member_id, token: token, membership_id: membership_id}
  end

  # A real JSON body, so the code keeps its JSON type (a number or null).
  defp post_json(path, body) do
    build_conn()
    |> put_req_header("content-type", "application/json")
    |> post(path, Jason.encode!(body))
  end

  defp mailed_code do
    email = List.last(Bamboo.SentEmail.all())
    [code] = Regex.run(~r/\b\d{6}\b/, email.text_body)
    code
  end
end
