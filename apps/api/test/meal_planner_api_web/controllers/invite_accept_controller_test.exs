defmodule MealPlannerApiWeb.InviteAcceptControllerTest do
  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.FactoryHelpers

  alias MealPlannerApi.AccountsMembership
  alias MealPlannerApi.Auth.Guardian
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.InviteService
  alias MealPlannerApiWeb.Controllers.AccountScopeHelpers

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
end
