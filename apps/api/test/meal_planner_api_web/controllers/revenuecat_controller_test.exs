defmodule MealPlannerApiWeb.RevenuecatControllerTest do
  @moduledoc """
  Tests for the revenuecat HTTP boundary after
  `revenuecat-access-enforcement` (PR 3 — HTTP capability and recovery).

  Contracts covered (from `specs/account-subscription-access/spec.md`):

    * signed RevenueCat webhooks (200 processed|duplicate|stale|ignored
      | 401 invalid_webhook_signature | 400 invalid_webhook_payload)
    * removed client `/sync` is unavailable (404) and cannot mutate state
    * GET `/billing/revenuecat/status` returns state, source, trial
      dates, latest provider timestamp, and a server-issued
      `app_user_id` — works for both eligible and expired Accounts
    * POST `/billing/revenuecat/purchase` and
      POST `/billing/revenuecat/restore` are payloadless post-SDK rechecks
      (200 when eligible, 202 `pending_webhook` when the webhook has
      not yet arrived). Entitlement/receipt input is rejected with
      `422 client_entitlement_grant_forbidden`.
    * the three recovery routes are exempt from the capability guard
      (an expired Account can still hit them); other product routes
      return `403 subscription_required` without deleting data.
  """

  use MealPlannerApiWeb.ConnCase, async: false

  import Ecto.Query
  import MealPlannerApi.FactoryHelpers

  alias MealPlannerApi.AccountAccess
  alias MealPlannerApi.Persistence.Accounts, as: AccountsPersistence
  alias MealPlannerApi.Persistence.Accounts.Account, as: PersistenceAccount
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Accounts.RevenuecatCustomer
  alias MealPlannerApi.Repo

  @secret "whsec_test_revenuecat"
  @app_user_id "rc_app_user_pr3"

  setup do
    previous = Application.get_env(:meal_planner_api, :revenuecat_webhook_signing_secret)
    Application.put_env(:meal_planner_api, :revenuecat_webhook_signing_secret, @secret)

    on_exit(fn ->
      Application.put_env(:meal_planner_api, :revenuecat_webhook_signing_secret, previous)
    end)

    # Ensure a RevenueCat customer exists for the webhook ingest path so
    # the provider's `app_user_id` resolves to a known Account. Each test
    # creates its own UUID-scoped customer so the SQL sandbox isolation is
    # respected.
    alias MealPlannerApi.Persistence.Accounts.User, as: PersistenceUser

    {:ok, account} =
      %PersistenceAccount{}
      |> PersistenceAccount.changeset(%{
        name: "RC PR3 Customer #{Ecto.UUID.generate()}",
        plan: :individual,
        default_budget_cents: 0
      })
      |> Repo.insert()

    {:ok, user} =
      %PersistenceUser{}
      |> PersistenceUser.changeset(%{
        email: "rc_pr3_#{Ecto.UUID.generate()}@myfood.local",
        name: "RC PR3 User #{Ecto.UUID.generate()}",
        role: :member
      })
      |> Repo.insert()

    {:ok, _customer} =
      AccountsPersistence.upsert_revenuecat_customer(%{
        account_id: account.id,
        user_id: user.id,
        rc_app_user_id: @app_user_id
      })

    :ok
  end

  # ─── Webhook ────────────────────────────────────────────────────────────

  describe "signed webhook ingestion" do
    test "valid signature is accepted and the body bytes are honored", %{conn: conn} do
      body = signed_webhook(%{})

      assert %Plug.Conn{status: 200, resp_body: body_json} =
               conn
               |> put_req_header("content-type", "application/json")
               |> put_req_header("x-revenuecat-webhook-signature", signature_header(body))
               |> post("/api/billing/revenuecat/webhook", body)

      decoded = Jason.decode!(body_json)
      assert decoded["data"]["status"] == "processed"
    end

    test "an invalid signature is rejected with 401 invalid_webhook_signature", %{conn: conn} do
      body = signed_webhook(%{})

      tampered_header =
        body
        |> signature_header_for_other_secret()
        |> String.replace(~s("t=), ~s("t=))

      assert %Plug.Conn{status: 401, resp_body: resp_body} =
               conn
               |> put_req_header("content-type", "application/json")
               |> put_req_header("x-revenuecat-webhook-signature", tampered_header)
               |> post("/api/billing/revenuecat/webhook", body)

      assert Jason.decode!(resp_body)["error"] == "invalid_webhook_signature"
    end

    test "a body whose JSON does not match the signed bytes is rejected with 401", %{conn: conn} do
      body = signed_webhook(%{})
      tampered_body = Jason.encode!(%{"event" => %{"id" => "evt_x", "type" => "TEST"}})

      assert %Plug.Conn{status: 401, resp_body: resp_body} =
               conn
               |> put_req_header("content-type", "application/json")
               |> put_req_header("x-revenuecat-webhook-signature", signature_header(body))
               |> post("/api/billing/revenuecat/webhook", tampered_body)

      assert Jason.decode!(resp_body)["error"] == "invalid_webhook_signature"
    end

    test "a verified but malformed payload is rejected with 400", %{conn: conn} do
      body = ~s({"event":{"id":"evt_x","type":"TEST"}})

      assert %Plug.Conn{status: 400, resp_body: resp_body} =
               conn
               |> put_req_header("content-type", "application/json")
               |> put_req_header("x-revenuecat-webhook-signature", signature_header(body))
               |> post("/api/billing/revenuecat/webhook", body)

      assert Jason.decode!(resp_body)["error"] == "invalid_webhook_payload"
    end

    test "duplicate replay returns 200 duplicate without reapplying", %{conn: conn} do
      body = signed_webhook(%{})
      header_value = signature_header(body)

      first =
        conn
        |> put_req_header("content-type", "application/json")
        |> put_req_header("x-revenuecat-webhook-signature", header_value)
        |> post("/api/billing/revenuecat/webhook", body)

      assert %Plug.Conn{status: 200, resp_body: first_body} = first
      assert Jason.decode!(first_body)["data"]["status"] == "processed"

      second =
        build_conn()
        |> put_req_header("content-type", "application/json")
        |> put_req_header("x-revenuecat-webhook-signature", header_value)
        |> post("/api/billing/revenuecat/webhook", body)

      assert %Plug.Conn{status: 200, resp_body: second_body} = second
      assert Jason.decode!(second_body)["data"]["status"] == "duplicate"
    end

    test "an unlinked app_user_id is 200 ignored", %{conn: conn} do
      body = signed_webhook(%{"app_user_id" => "rc_unlinked_for_pr3"})

      assert %Plug.Conn{status: 200, resp_body: resp_body} =
               conn
               |> put_req_header("content-type", "application/json")
               |> put_req_header("x-revenuecat-webhook-signature", signature_header(body))
               |> post("/api/billing/revenuecat/webhook", body)

      decoded = Jason.decode!(resp_body)
      assert decoded["data"]["status"] == "ignored"
    end
  end

  # ─── /sync removal ──────────────────────────────────────────────────────

  describe "removed client /sync endpoint" do
    test "POST /api/billing/revenuecat/sync is no longer routed (404)", %{conn: conn} do
      user =
        user_with_memberships(%{email: "rc_sync_gone@myfood.local"}, [
          {%{plan: :individual, name: "Sync Gone"}, :owner}
        ])

      [membership] = user.memberships
      token = issue_access_v2_token(user, membership)

      before = AccountsPersistence.get_revenuecat_customer_by_app_user_id("rc_sync_should_404")

      assert %Plug.Conn{status: 404} =
               conn
               |> put_req_header("authorization", "Bearer " <> token)
               |> post("/api/billing/revenuecat/sync", %{
                 "rc_app_user_id" => "rc_sync_should_404",
                 "entitlements" => [
                   %{
                     "entitlement_id" => "pro",
                     "is_active" => true,
                     "will_renew" => true,
                     "store" => "app_store"
                   }
                 ]
               })

      after_ = AccountsPersistence.get_revenuecat_customer_by_app_user_id("rc_sync_should_404")
      assert before == after_
    end
  end

  # ─── Status ─────────────────────────────────────────────────────────────

  describe "GET /api/billing/revenuecat/status" do
    test "eligible account returns state, source, trial dates, app_user_id, and latest_provider_event_at",
         %{conn: conn} do
      {:ok, account} = insert_account_with_eligible_trial!()

      # Persist a known provider-event timestamp on the Account so the
      # assertion below proves the controller round-trips the field —
      # not that the JSON shape merely contains the key with `null`.
      provider_event_at = ~U[2026-08-25 12:00:00.000000Z]

      {:ok, account} =
        account
        |> PersistenceAccount.changeset(%{latest_provider_event_at: provider_event_at})
        |> Repo.update()

      {user, membership} = user_with_membership_for_account(account)

      token = issue_access_v2_token(user, membership)

      assert %Plug.Conn{status: 200, resp_body: resp_body} =
               conn
               |> put_req_header("authorization", "Bearer " <> token)
               |> get("/api/billing/revenuecat/status")

      decoded = Jason.decode!(resp_body)
      data = decoded["data"]
      assert data["state"] in ["trial", "active"]
      assert is_binary(data["source"])
      assert is_binary(data["app_user_id"])
      assert data["trial_started_at"]
      assert data["trial_ends_at"]

      # RED: assert the controller surfaces the persisted provider-event
      # timestamp in ISO8601 form. Closes the verify pass WARNING
      # "the test name promised a check the body never delivered".
      assert data["latest_provider_event_at"] == DateTime.to_iso8601(provider_event_at)
    end

    test "expired account still returns a status payload (recovery route)", %{conn: conn} do
      {:ok, account} = insert_account!()
      expire_account!(account)
      {user, membership} = user_with_membership_for_account(account)

      token = issue_access_v2_token(user, membership)

      assert %Plug.Conn{status: 200, resp_body: resp_body} =
               conn
               |> put_req_header("authorization", "Bearer " <> token)
               |> get("/api/billing/revenuecat/status")

      decoded = Jason.decode!(resp_body)
      assert decoded["data"]["state"] == "expired"
    end

    # Issue #412: nothing created the Account's `RevenuecatCustomer`, so
    # `app_user_id` was always null and no webhook could reach an Account.
    test "issues a random UUID app_user_id to an Account that has none", %{conn: conn} do
      {:ok, account} = insert_account_with_eligible_trial!()
      {user, membership} = member_of(account)

      assert AccountsPersistence.get_revenuecat_customer_by_account_id(account.id) == nil

      app_user_id = get_app_user_id(conn, user, membership)

      assert {:ok, ^app_user_id} = Ecto.UUID.cast(app_user_id)
      assert app_user_id != account.id
      assert app_user_id != user.id
      refute String.contains?(app_user_id, user.email)

      assert %{rc_app_user_id: ^app_user_id, account_id: account_id} =
               AccountsPersistence.get_revenuecat_customer_by_account_id(account.id)

      assert account_id == account.id
    end

    test "a second call returns the same app_user_id and keeps one row", %{conn: conn} do
      {:ok, account} = insert_account_with_eligible_trial!()
      {user, membership} = member_of(account)

      first = get_app_user_id(conn, user, membership)
      second = get_app_user_id(build_conn(), user, membership)

      assert first == second
      assert customer_count(account.id) == 1
    end

    test "every member of the Account gets the Account's app_user_id", %{conn: conn} do
      {:ok, account} = insert_account_with_eligible_trial!()
      {owner, owner_membership} = member_of(account)
      {member, member_membership} = member_of(account, :member)

      from_owner = get_app_user_id(conn, owner, owner_membership)
      from_member = get_app_user_id(build_conn(), member, member_membership)

      assert from_owner == from_member
      assert customer_count(account.id) == 1
    end

    test "an Account that already has a customer keeps its app_user_id", %{conn: conn} do
      {:ok, account} = insert_account_with_eligible_trial!()
      {user, membership} = member_of(account)

      {:ok, _} =
        AccountsPersistence.upsert_revenuecat_customer(%{
          account_id: account.id,
          rc_app_user_id: "rc_existing_#{Ecto.UUID.generate()}"
        })

      existing = AccountsPersistence.get_revenuecat_customer_by_account_id(account.id)

      assert get_app_user_id(conn, user, membership) == existing.rc_app_user_id
      assert customer_count(account.id) == 1
    end

    test "a signed webhook for the issued app_user_id activates the Account", %{conn: conn} do
      {:ok, account} = insert_account!()
      expire_account!(account)
      {user, membership} = member_of(account)

      app_user_id = get_app_user_id(conn, user, membership)
      body = signed_webhook(%{"app_user_id" => app_user_id})

      assert %Plug.Conn{status: 200, resp_body: webhook_body} =
               build_conn()
               |> put_req_header("content-type", "application/json")
               |> put_req_header("x-revenuecat-webhook-signature", signature_header(body))
               |> post("/api/billing/revenuecat/webhook", body)

      assert Jason.decode!(webhook_body)["data"]["status"] == "processed"

      token = issue_access_v2_token(user, membership)

      assert %Plug.Conn{status: 200, resp_body: status_body} =
               build_conn()
               |> put_req_header("authorization", "Bearer " <> token)
               |> get("/api/billing/revenuecat/status")

      assert %{"state" => "active", "app_user_id" => ^app_user_id} =
               Jason.decode!(status_body)["data"]
    end

    # A purchase during the trial does not change `state` or `source`: the
    # trial ranks above an active entitlement until it ends.
    test "an Account that subscribes during its trial still reports the trial", %{conn: conn} do
      {:ok, account} = insert_account_with_eligible_trial!()
      {user, membership} = member_of(account)

      app_user_id = get_app_user_id(conn, user, membership)
      body = signed_webhook(%{"app_user_id" => app_user_id})

      assert %Plug.Conn{status: 200} =
               build_conn()
               |> put_req_header("content-type", "application/json")
               |> put_req_header("x-revenuecat-webhook-signature", signature_header(body))
               |> post("/api/billing/revenuecat/webhook", body)

      token = issue_access_v2_token(user, membership)

      assert %Plug.Conn{status: 200, resp_body: status_body} =
               build_conn()
               |> put_req_header("authorization", "Bearer " <> token)
               |> get("/api/billing/revenuecat/status")

      data = Jason.decode!(status_body)["data"]
      assert %{"state" => "trial", "source" => "trial"} = data
      assert data["latest_provider_event_at"]
    end
  end

  # ─── Purchase / Restore (payloadless recovery) ───────────────────────────

  describe "POST /api/billing/revenuecat/purchase and /restore" do
    test "purchase with no eligibility on record returns 202 pending_webhook", %{conn: conn} do
      {:ok, account} = insert_account!()
      {user, membership} = user_with_membership_for_account(account)

      token = issue_access_v2_token(user, membership)

      assert %Plug.Conn{status: 202, resp_body: resp_body} =
               conn
               |> put_req_header("authorization", "Bearer " <> token)
               |> post("/api/billing/revenuecat/purchase", %{})

      decoded = Jason.decode!(resp_body)
      assert decoded["data"]["state"] == "pending_webhook"
    end

    test "restore with no eligibility on record returns 202 pending_webhook", %{conn: conn} do
      {:ok, account} = insert_account!()
      {user, membership} = user_with_membership_for_account(account)

      token = issue_access_v2_token(user, membership)

      assert %Plug.Conn{status: 202, resp_body: resp_body} =
               conn
               |> put_req_header("authorization", "Bearer " <> token)
               |> post("/api/billing/revenuecat/restore", %{})

      decoded = Jason.decode!(resp_body)
      assert decoded["data"]["state"] == "pending_webhook"
    end

    test "purchase on an eligible account returns 200 with the current state", %{conn: conn} do
      {:ok, account} = insert_account_with_eligible_trial!()
      {user, membership} = user_with_membership_for_account(account)

      token = issue_access_v2_token(user, membership)

      assert %Plug.Conn{status: 200, resp_body: resp_body} =
               conn
               |> put_req_header("authorization", "Bearer " <> token)
               |> post("/api/billing/revenuecat/purchase", %{})

      decoded = Jason.decode!(resp_body)
      assert decoded["data"]["state"] in ["trial", "active"]
    end

    test "restore on an eligible account returns 200 with the current state", %{conn: conn} do
      {:ok, account} = insert_account_with_eligible_trial!()
      {user, membership} = user_with_membership_for_account(account)

      token = issue_access_v2_token(user, membership)

      assert %Plug.Conn{status: 200, resp_body: resp_body} =
               conn
               |> put_req_header("authorization", "Bearer " <> token)
               |> post("/api/billing/revenuecat/restore", %{})

      decoded = Jason.decode!(resp_body)
      assert decoded["data"]["state"] in ["trial", "active"]
    end
  end

  # ─── Forbidden client grant ─────────────────────────────────────────────

  describe "client grant requests are forbidden" do
    test "POST /purchase with entitlement payload is rejected with 422", %{conn: conn} do
      user =
        user_with_memberships(%{email: "rc_grant_purchase@myfood.local"}, [
          {%{plan: :individual, name: "Grant Purchase"}, :owner}
        ])

      [membership] = user.memberships
      token = issue_access_v2_token(user, membership)

      assert %Plug.Conn{status: 422, resp_body: resp_body} =
               conn
               |> put_req_header("authorization", "Bearer " <> token)
               |> post("/api/billing/revenuecat/purchase", %{
                 "entitlements" => [
                   %{"entitlement_id" => "pro", "is_active" => true}
                 ]
               })

      assert Jason.decode!(resp_body)["error"] == "client_entitlement_grant_forbidden"
    end

    test "POST /restore with entitlement payload is rejected with 422", %{conn: conn} do
      user =
        user_with_memberships(%{email: "rc_grant_restore@myfood.local"}, [
          {%{plan: :individual, name: "Grant Restore"}, :owner}
        ])

      [membership] = user.memberships
      token = issue_access_v2_token(user, membership)

      assert %Plug.Conn{status: 422, resp_body: resp_body} =
               conn
               |> put_req_header("authorization", "Bearer " <> token)
               |> post("/api/billing/revenuecat/restore", %{
                 "entitlements" => [
                   %{"entitlement_id" => "pro", "is_active" => true}
                 ]
               })

      assert Jason.decode!(resp_body)["error"] == "client_entitlement_grant_forbidden"
    end

    test "POST /purchase with receipt payload is rejected with 422", %{conn: conn} do
      user =
        user_with_memberships(%{email: "rc_grant_receipt@myfood.local"}, [
          {%{plan: :individual, name: "Grant Receipt"}, :owner}
        ])

      [membership] = user.memberships
      token = issue_access_v2_token(user, membership)

      assert %Plug.Conn{status: 422, resp_body: resp_body} =
               conn
               |> put_req_header("authorization", "Bearer " <> token)
               |> post("/api/billing/revenuecat/purchase", %{
                 "receipt" => "base64-blob",
                 "product_identifier" => "myfood_premium_monthly"
               })

      assert Jason.decode!(resp_body)["error"] == "client_entitlement_grant_forbidden"
    end
  end

  # ─── Routed capability guard (full router pipeline) ──────────────────────
  # Exercises `:auth → :enforce_account_scope → :enforce_capability →
  # controller` exactly as production does — the verify pass flagged the
  # previous plug-only coverage for "Eligible uses product capabilities"
  # and "Expired is denied without data loss". The flag is flipped and
  # restored inside the describe so the global Application env cannot
  # leak to other async tests.

  describe "routed capability guard (full router pipeline)" do
    setup do
      previous_flag = Application.get_env(:meal_planner_api, :revenuecat_access_enforcement)
      Application.put_env(:meal_planner_api, :revenuecat_access_enforcement, true)

      on_exit(fn ->
        Application.put_env(:meal_planner_api, :revenuecat_access_enforcement, previous_flag)
      end)

      :ok
    end

    test "eligible Account reaches a routed product endpoint (no 403)", %{conn: conn} do
      {:ok, account} = insert_account_with_eligible_trial!()
      {user, membership} = user_with_membership_for_account(account)
      token = issue_access_v2_token(user, membership)

      today = Date.utc_today()

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/calendar", %{
          "start_date" => Date.to_iso8601(today),
          "end_date" => Date.to_iso8601(Date.add(today, 6))
        })

      refute conn.status == 403
      assert conn.status == 200
      assert %{"data" => _} = Jason.decode!(conn.resp_body)
    end

    test "expired Account is denied 403 trial_expired at the router (data intact)",
         %{conn: conn} do
      {:ok, account} = insert_account!()
      expire_account!(account)
      {user, membership} = user_with_membership_for_account(account)
      token = issue_access_v2_token(user, membership)

      today = Date.utc_today()

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/calendar", %{
          "start_date" => Date.to_iso8601(today),
          "end_date" => Date.to_iso8601(Date.add(today, 6))
        })

      assert conn.status == 403
      assert conn.halted
      assert Jason.decode!(conn.resp_body)["error"]["code"] == "trial_expired"
      assert Repo.get!(PersistenceAccount, account.id)
    end

    test "expired Account still reaches the exempt recovery /status route", %{conn: conn} do
      {:ok, account} = insert_account!()
      expire_account!(account)
      {user, membership} = user_with_membership_for_account(account)
      token = issue_access_v2_token(user, membership)

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/billing/revenuecat/status")

      # Recovery routes are NOT behind `:enforce_capability`; an
      # expired Account must still be able to read its billing state
      # so the React Native SDK can begin purchase/restore recovery.
      assert conn.status == 200
      assert Jason.decode!(conn.resp_body)["data"]["state"] == "expired"
    end
  end

  # ─── Design-exempt auth/context routes (full router pipeline) ─────────
  # The verify pass flagged "the router retains four auth/context routes
  # behind capability enforcement despite the design exemption matrix"
  # (`design.md` §"Interfaces / Contracts"). The four routes below MUST
  # remain reachable for an EXPIRED Account so the React Native client
  # can still read auth context, switch memberships, and start billing
  # recovery. Auth (`:auth` populates `current_membership`) and
  # `:enforce_account_scope` (no-op when no `:account_id` URL param,
  # see `enforce_account_scope.ex` §moduledoc) remain in effect.

  describe "design-exempt auth/context routes bypass :enforce_capability" do
    setup do
      previous_flag = Application.get_env(:meal_planner_api, :revenuecat_access_enforcement)
      Application.put_env(:meal_planner_api, :revenuecat_access_enforcement, true)

      on_exit(fn ->
        Application.put_env(:meal_planner_api, :revenuecat_access_enforcement, previous_flag)
      end)

      :ok
    end

    test "expired Account reaches GET /api/me (auth context, capability-exempt)", %{conn: conn} do
      {:ok, account} = insert_account!()
      expire_account!(account)
      {user, membership} = user_with_membership_for_account(account)
      token = issue_access_v2_token(user, membership)

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/me")

      # RED: today this returns 403 subscription_required because the
      # route sits behind `:enforce_capability`. After the router fix
      # it returns 200 with the auth/claims payload.
      refute conn.status == 403
      assert conn.status == 200
      assert Repo.get!(PersistenceAccount, account.id)
    end

    test "expired Account reaches GET /api/auth/me (frontend alias)", %{conn: conn} do
      {:ok, account} = insert_account!()
      expire_account!(account)
      {user, membership} = user_with_membership_for_account(account)
      token = issue_access_v2_token(user, membership)

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/auth/me")

      refute conn.status == 403
      assert conn.status == 200
    end

    test "expired Account reaches GET /api/account/context (bypass :enforce_capability)",
         %{conn: conn} do
      {:ok, account} = insert_account!()
      expire_account!(account)
      {user, membership} = user_with_membership_for_account(account)
      token = issue_access_v2_token(user, membership)

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/account/context")

      # The bypass contract: the route must reach the controller even
      # for an expired Account — i.e. NOT be halted by
      # `:enforce_capability` with `403 subscription_required`.
      refute conn.status == 403
      refute conn.halted

      # The controller still serves its payload (which is independent
      # of the capability gate).
      body = json_response(conn, 200)
      assert body["account"]["id"] == account.id

      # Account data must remain intact (the plug never deletes).
      assert Repo.get!(PersistenceAccount, account.id)
    end

    test "expired Account can still POST /api/auth/switch-account", %{conn: conn} do
      user =
        user_with_memberships(%{email: "switch_exempt_#{Ecto.UUID.generate()}@myfood.local"}, [
          {%{plan: :family_4, name: "Switch From Exempt #{Ecto.UUID.generate()}"}, :owner},
          {%{plan: :individual, name: "Switch To Exempt #{Ecto.UUID.generate()}"}, :owner}
        ])

      [from_membership, to_membership] = user.memberships
      expire_account!(from_membership.account)
      token = issue_access_v2_token(user, from_membership)

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> post("/api/auth/switch-account", %{"membership_id" => to_membership.id})

      # RED: today this returns 403 subscription_required. After the
      # router fix the switch succeeds and returns 200 with a fresh
      # token bound to the destination membership.
      refute conn.status == 403
      assert conn.status == 200
      assert is_binary(Jason.decode!(conn.resp_body)["access_token"])
    end
  end

  # ─── Helpers ────────────────────────────────────────────────────────────

  defp signed_webhook(overrides) do
    event =
      Map.merge(
        %{
          "id" => "evt_pr3_" <> Ecto.UUID.generate(),
          "type" => "INITIAL_PURCHASE",
          "app_user_id" => @app_user_id,
          "event_timestamp_ms" => System.system_time(:millisecond),
          "expiration_at_ms" => System.system_time(:millisecond) + 30 * 86_400_000,
          "product_id" => "myfood_premium_monthly",
          "entitlement_ids" => ["pro"],
          "store" => "APP_STORE"
        },
        overrides
      )

    Jason.encode!(%{"event" => event})
  end

  defp signature_header(raw_body, timestamp \\ nil) do
    timestamp = timestamp || System.system_time(:second)

    signature =
      :crypto.mac(:hmac, :sha256, @secret, "#{timestamp}.#{raw_body}")
      |> Base.encode16(case: :lower)

    "t=#{timestamp},v1=#{signature}"
  end

  defp signature_header_for_other_secret(raw_body) do
    timestamp = System.system_time(:second)

    signature =
      :crypto.mac(:hmac, :sha256, "whsec_OTHER", "#{timestamp}.#{raw_body}")
      |> Base.encode16(case: :lower)

    "t=#{timestamp},v1=#{signature}"
  end

  defp insert_account! do
    %PersistenceAccount{}
    |> PersistenceAccount.changeset(%{
      name: "RC PR3 #{Ecto.UUID.generate()}",
      plan: :individual,
      default_budget_cents: 0
    })
    |> Repo.insert()
  end

  defp insert_account_with_eligible_trial! do
    {:ok, account} = insert_account!()

    started = DateTime.utc_now()
    window = AccountAccess.trial_window(started)

    {:ok, updated} =
      account
      |> PersistenceAccount.changeset(%{
        trial_started_at: window.started_at,
        trial_ends_at: window.ends_at
      })
      |> Repo.update()

    {:ok, updated}
  end

  defp expire_account!(account) do
    past = DateTime.add(DateTime.utc_now(), -30 * 86_400, :second)

    account
    |> PersistenceAccount.changeset(%{trial_started_at: past, trial_ends_at: past})
    |> Repo.update!()
  end

  # Insert a fresh user + membership pointing at the supplied account, and a
  # matching RevenueCat customer. The factory always creates its own Account
  # (so it can return a User preloaded with memberships), but for the
  # recovery routes we need the user's membership to land on the Account
  # whose trial/entitlement state we just arranged.
  defp user_with_membership_for_account(%PersistenceAccount{} = account) do
    {user, membership} = member_of(account)

    {:ok, _} =
      AccountsPersistence.upsert_revenuecat_customer(%{
        account_id: account.id,
        user_id: user.id,
        rc_app_user_id: "rc_pr3_app_#{Ecto.UUID.generate()}"
      })

    {user, membership}
  end

  # A fresh User with an active membership on the Account, and no
  # RevenueCat customer, so `/status` has to issue the `app_user_id`.
  defp member_of(%PersistenceAccount{} = account, role \\ :owner) do
    alias MealPlannerApi.Persistence.Accounts.User, as: PersistenceUser

    user =
      %PersistenceUser{}
      |> PersistenceUser.changeset(%{
        email: "rc_pr3_#{Ecto.UUID.generate()}@myfood.local",
        name: "RC PR3 User #{Ecto.UUID.generate()}",
        role: :member
      })
      |> Repo.insert!()

    membership =
      %AccountMembership{}
      |> AccountMembership.changeset(%{
        account_id: account.id,
        user_id: user.id,
        role: role,
        status: :active,
        joined_at: DateTime.utc_now()
      })
      |> Repo.insert!()

    {user, membership}
  end

  defp get_app_user_id(conn, user, membership) do
    token = issue_access_v2_token(user, membership)

    assert %Plug.Conn{status: 200, resp_body: resp_body} =
             conn
             |> put_req_header("authorization", "Bearer " <> token)
             |> get("/api/billing/revenuecat/status")

    Jason.decode!(resp_body)["data"]["app_user_id"]
  end

  defp customer_count(account_id) do
    Repo.aggregate(
      from(c in RevenuecatCustomer, where: c.account_id == ^account_id),
      :count
    )
  end
end
