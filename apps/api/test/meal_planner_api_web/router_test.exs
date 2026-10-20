defmodule MealPlannerApiWeb.RouterTest do
  @moduledoc """
  Dedicated checkpoint (Phase A — Tenancy Refactor, PR 3a task 3.7):
  asserts all 6 tenancy routes from design §5.2 resolve. Each route's
  full behavior (errors, ordering, payload shape) is already covered by
  its own controller test — this file only proves the router wiring
  itself is complete and consistent.
  """

  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.FactoryHelpers

  alias MealPlannerApi.AccountsMembership
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Accounts.User, as: PersistenceUser
  alias MealPlannerApi.Repo
  alias MealPlannerApiWeb.AccountLifecycleController
  alias MealPlannerApiWeb.AuthController
  alias MealPlannerApiWeb.MobileAuthController

  test "all 6 Phase A tenancy routes resolve", %{conn: conn} do
    owner =
      user_with_memberships(%{email: "router_owner@example.com"}, [
        {%{plan: :family_4, name: "Router Family"}, :owner},
        {%{plan: :individual, name: "Router Solo"}, :owner}
      ])

    [owner_membership, second_membership] = owner.memberships
    account = owner_membership.account
    owner_token = issue_access_v2_token(owner, owner_membership)

    # GET /api/accounts/:account_id/memberships
    conn1 =
      conn
      |> put_req_header("authorization", "Bearer " <> owner_token)
      |> get("/api/accounts/#{account.id}/memberships")

    assert conn1.status == 200

    # POST /api/accounts/:account_id/invites
    conn2 =
      conn
      |> put_req_header("authorization", "Bearer " <> owner_token)
      |> post("/api/accounts/#{account.id}/invites", %{"email" => "router_invitee@example.com"})

    assert conn2.status == 201
    invite_token = json_response(conn2, 201)["invite"]["token"]

    # POST /api/invites/:token/code
    assert post(build_conn(), "/api/invites/#{invite_token}/code", %{}).status == 200
    [code] = Regex.run(~r/\b\d{6}\b/, hd(Bamboo.SentEmail.all()).text_body)

    # POST /api/invites/:token/accept
    conn3 =
      post(build_conn(), "/api/invites/#{invite_token}/accept", %{
        "code" => code,
        "deviceId" => Ecto.UUID.generate(),
        "name" => "Router Invitee"
      })

    assert conn3.status == 200

    # DELETE /api/accounts/:account_id/memberships/:user_id
    invitee = Repo.get_by!(PersistenceUser, email: "router_invitee@example.com")

    conn4 =
      conn
      |> put_req_header("authorization", "Bearer " <> owner_token)
      |> delete("/api/accounts/#{account.id}/memberships/#{invitee.id}")

    assert conn4.status == 204

    # POST /api/auth/switch-account
    conn5 =
      conn
      |> put_req_header("authorization", "Bearer " <> owner_token)
      |> post("/api/auth/switch-account", %{"membership_id" => second_membership.id})

    assert conn5.status == 200

    # POST /api/accounts/:account_id/leave (non-owner member leaves)
    member_user =
      %PersistenceUser{}
      |> PersistenceUser.changeset(%{
        email: "router_member@example.com",
        name: "Router Member",
        role: :member
      })
      |> Repo.insert!()

    member_membership =
      %AccountMembership{}
      |> AccountMembership.changeset(%{
        account_id: account.id,
        user_id: member_user.id,
        role: :member,
        status: :active,
        joined_at: DateTime.utc_now()
      })
      |> Repo.insert!()

    member_token = issue_access_v2_token(member_user, member_membership)

    conn6 =
      conn
      |> put_req_header("authorization", "Bearer " <> member_token)
      |> post("/api/accounts/#{account.id}/leave", %{})

    assert conn6.status == 204

    # Sanity: the invite/accept flow above actually used
    # AccountsMembership under the hood (not a stub) — the roster no
    # longer contains the departed member.
    remaining = AccountsMembership.list_memberships(account)
    refute Enum.any?(remaining, &(&1.user_id == member_user.id))
  end

  # Legacy authentication sweep (issue #14): the password, social and
  # `/api/auth/email-code/*` routes are gone. `POST /api/auth/social` is
  # mounted again on the mobile contract (issue #106); its old
  # `/google`, `/facebook` and `/apple` aliases are not. Each body is one the removed
  # action answered without a 404, so a route that is still mounted fails
  # the test: the password action registered the User (200), the social
  # action refused a payload without `id_token` (400), the code request
  # answered 202 and the code verification refused an unknown code (401).
  describe "removed legacy auth routes" do
    password_body = %{
      "mode" => "register",
      "email" => "router_legacy_auth_gone@example.com",
      "password" => "supersecret123",
      "name" => "Router Legacy Auth Gone"
    }

    social_body = %{"provider" => "google"}

    email_code_body = %{"email" => "router_legacy_auth_gone@example.com", "code" => "123456"}

    for {path, body} <- [
          {"/api/auth/password", password_body},
          {"/api/auth/login", password_body},
          {"/api/auth/register", password_body},
          {"/api/auth/google", social_body},
          {"/api/auth/facebook", social_body},
          {"/api/auth/apple", social_body},
          {"/api/auth/email-code/request", email_code_body},
          {"/api/auth/email-code/verify", email_code_body}
        ] do
      test "POST #{path} is no longer routed (404)", %{conn: conn} do
        conn = post(conn, unquote(path), unquote(Macro.escape(body)))

        assert json_response(conn, 404) == %{"errors" => %{"detail" => "Not Found"}}
        refute Repo.get_by(PersistenceUser, email: "router_legacy_auth_gone@example.com")
      end
    end

    test "the routes that stay under /api/auth are still routed" do
      for {path, controller, action} <- [
            {"/api/auth/login/request-code", MobileAuthController, :request_login_code},
            {"/api/auth/login/verify-code", MobileAuthController, :verify_login_code},
            {"/api/auth/signup/request-code", MobileAuthController, :request_signup_code},
            {"/api/auth/signup/verify-code", MobileAuthController, :verify_signup_code},
            {"/api/auth/social", MobileAuthController, :social},
            {"/api/auth/refresh", AuthController, :refresh},
            {"/api/auth/logout", AuthController, :logout},
            {"/api/auth/switch-account", AccountLifecycleController, :switch_account}
          ] do
        assert %{plug: ^controller, plug_opts: ^action} =
                 Phoenix.Router.route_info(MealPlannerApiWeb.Router, "POST", path, "")
      end
    end
  end
end
