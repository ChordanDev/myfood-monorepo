defmodule MealPlannerApiWeb.Router do
  use MealPlannerApiWeb, :router

  pipeline :api do
    plug(:accepts, ["json"])
  end

  # Issue #11 — camelCase mobile contract. Opt-in: only the scopes that name
  # this pipeline translate request params to snake_case and response keys to
  # camelCase (see `Plugs.MobileCasing`). It goes right after `:api`, before
  # any pipeline that can halt, so the response of a halting plug is
  # translated too. Auth, `/auth/me`, `/account/*` and
  # `/api/accounts/:account_id/*` are deliberately left out.
  pipeline :mobile_casing do
    plug(MealPlannerApiWeb.Plugs.MobileCasing)
  end

  pipeline :auth do
    plug(MealPlannerApiWeb.AuthPipeline)
  end

  # Phase A — Tenancy Refactor (PR 3a task 3.1, formalized in task 3.7):
  # rejects `:account_id`-bearing routes when the URL id does not match
  # `current_membership.account_id` (403 account_mismatch).
  pipeline :enforce_account_scope do
    plug(MealPlannerApiWeb.Plugs.EnforceAccountScope)
  end

  # Phase 3 — `revenuecat-access-enforcement` (PR 3): Account-wide
  # capability guard. Runs AFTER `:auth` (so `current_membership` is
  # populated) and AFTER `:enforce_account_scope` (so the URL already
  # matches the membership). Routes that are explicitly exempt — auth,
  # `/me`, account context, the three billing recovery routes, and the
  # webhook — are NOT behind this pipeline (see `scope "/api"` below).
  pipeline :enforce_capability do
    plug(MealPlannerApiWeb.Plugs.EnforceCapability)
  end

  # Phase 4 — Conditional authentication for `/api/auth/switch-account`
  # (task 4.2). When the request body lacks `continuation_token` the
  # plug delegates to the standard `:auth` pipeline (legacy
  # bearer-authenticated switch). When the body carries a
  # `continuation_token` the plug validates it as the sole credential:
  # hash → row lookup → unconsumed / unexpired / optional bearer match.
  # See `Plugs.SwitchAccountAuth` for the full matrix.
  pipeline :switch_account_auth do
    plug(MealPlannerApiWeb.Plugs.SwitchAccountAuth)
  end

  scope "/api", MealPlannerApiWeb do
    pipe_through(:api)

    # Device session rotation and revocation (issue #9). Neither route
    # takes an access token: the refresh token in the body is the
    # credential.
    post("/auth/refresh", AuthController, :refresh)
    post("/auth/logout", AuthController, :logout)

    # Mobile login (issue #7) and sign-up (issue #8) with an email code.
    # Both answer with the mobile error envelope and say whether the
    # email has a User (`email_not_found`, `email_already_exists`).
    post("/auth/login/request-code", MobileAuthController, :request_login_code)
    post("/auth/login/verify-code", MobileAuthController, :verify_login_code)
    post("/auth/signup/request-code", MobileAuthController, :request_signup_code)
    post("/auth/signup/verify-code", MobileAuthController, :verify_signup_code)

    post("/billing/revenuecat/webhook", RevenuecatController, :webhook)

    # Phase A — Tenancy Refactor (PR 3a task 3.4): deliberately NOT behind
    # `:auth` — the "new User accepts" case has no account/token yet
    # (spec `invite-and-accept.md` §"New User accepts"). The controller
    # manually decodes an optional Authorization header for the
    # "existing User accepts" case instead of relying on the pipeline.
    post("/invites/:token/accept", InviteController, :accept)
  end

  # Phase 3 — `revenuecat-access-enforcement` (PR 3) billing recovery
  # pipeline: authenticated, NO `:enforce_capability`. These three routes
  # MUST remain available to an expired Account so the React Native SDK
  # can re-read server status and begin purchase/restore recovery without
  # being gated by the same webhook that hasn't yet arrived
  # (`design.md` §"Interfaces / Contracts").
  scope "/api", MealPlannerApiWeb do
    pipe_through([:api, :auth])

    get("/billing/revenuecat/status", RevenuecatController, :status)
    post("/billing/revenuecat/purchase", RevenuecatController, :purchase)
    post("/billing/revenuecat/restore", RevenuecatController, :restore)

    # Phase 3 — `revenuecat-access-enforcement` (PR 3): the client
    # entitlement-grant endpoint has been REMOVED. The router returns
    # 404 for any POST here. Clients must call the RevenueCat SDK and
    # wait for the signed webhook — no client-to-backend operation can
    # ever change eligibility again.
    #
    # NOTE: the previously-routed `POST /billing/revenuecat/sync` is
    # intentionally not declared here. See `revenuecat_controller_test.exs`
    # for the 404 guarantee.
  end

  # Phase 3 — `revenuecat-access-enforcement` (PR 3) design-exempt
  # auth/context pipeline: authenticated (`current_membership` populated),
  # capability-exempt. The routes in this scope and in the two below it
  # (`/auth/me`, `/account/context`, `/account/dietary-profile`,
  # `/account/excluded-ingredients`, `/auth/switch-account` and the `/me`
  # routes) MUST remain reachable for an expired Account so the React Native
  # client can read auth context, switch memberships, and start billing
  # recovery without being gated by the same webhook that hasn't yet arrived
  # (`design.md` §"Interfaces / Contracts"). `:enforce_account_scope` is
  # not applied because none of these routes carry `:account_id` in the
  # URL (it is a no-op without that path param — see
  # `enforce_account_scope.ex` §moduledoc).
  scope "/api", MealPlannerApiWeb do
    pipe_through([:api, :auth])

    # User endpoints (auth required, capability-exempt by design).
    # `GET /me` is declared in the `:mobile_casing` scope below.
    # Alias of `/me`
    get("/auth/me", AccountsController, :me)
    get("/account/context", AccountsController, :context)
    get("/account/dietary-profile", DietaryProfileController, :show)
    put("/account/dietary-profile", DietaryProfileController, :update)
    get("/account/excluded-ingredients", DietaryProfileController, :index_exclusions)
    post("/account/excluded-ingredients", DietaryProfileController, :create_exclusion)

    delete(
      "/account/excluded-ingredients/:ingredient_id",
      DietaryProfileController,
      :delete_exclusion
    )

    # Phase A — Tenancy Refactor (PR 3a task 3.5) + Phase 4 (task 4.2):
    # no `:account_id` in the URL, so `:enforce_account_scope` does not
    # apply (design §5.2). The route is re-declared below on the
    # `:switch_account_auth` pipeline so the conditional auth plug can
    # dispatch on the body — the duplicate declaration here would
    # raise `Phoenix.Router.NoRouteError`, so this scope intentionally
    # leaves the route empty.
    # post("/auth/switch-account", AccountLifecycleController, :switch_account)
  end

  # Phase 4 (task 4.2) — Conditional authentication for
  # `/api/auth/switch-account`. The `:switch_account_auth` pipeline:
  #
  #   * delegates to `MealPlannerApiWeb.AuthPipeline` when the request
  #     body lacks `continuation_token` (legacy bearer-authenticated
  #     switch — existing behaviour);
  #   * validates the opaque continuation token as the sole credential
  #     when the body carries one (task 3.4's continuation exchange).
  #
  # The route stays out of `:enforce_capability` per the design-exempt
  # matrix in `design.md` §"Interfaces / Contracts" so an expired
  # Account can still resolve a membership before billing recovery.
  scope "/api", MealPlannerApiWeb do
    pipe_through([:api, :switch_account_auth])

    post("/auth/switch-account", AccountLifecycleController, :switch_account)
  end

  # Issue #11 — `GET /me` through the opt-in `:mobile_casing` pipeline. Same
  # authentication and capability exemption as the design-exempt scope; its alias
  # `GET /auth/me` stays in that scope, outside the pipeline.
  #
  # Issue #17 — `PUT /me/profile` shares the exemption, so a User whose
  # Account Access state is `expired` can still edit the Onboarding profile.
  #
  # Issue #19 — `GET` and `PUT /me/slot-cooking-times` share the exemption
  # too: Slot cooking times belong to the User, not to the Account.
  #
  # Issue #18 — `GET` and `PUT /me/preferences` sit here for the same
  # exemption: a User of an Account whose Trial expired can still read and
  # save their preferences.
  #
  # Issue #20 — `POST /onboarding/complete` shares the exemption too: a User
  # whose Account Access state is `expired` can still finish Onboarding, which
  # saves their profile, preferences and Slot cooking times together.
  scope "/api", MealPlannerApiWeb do
    pipe_through([:api, :mobile_casing, :auth])

    get("/me", AccountsController, :me)
    put("/me/profile", ProfileController, :update)
    get("/me/slot-cooking-times", SlotCookingTimesController, :show)
    put("/me/slot-cooking-times", SlotCookingTimesController, :update)
    get("/me/preferences", PreferencesController, :show)
    put("/me/preferences", PreferencesController, :update)
    post("/onboarding/complete", OnboardingController, :complete)
  end

  # Product routes of the mobile app. `:mobile_casing` is opt-in and this is
  # the scope that opts in: camelCase params are accepted next to snake_case
  # ones and every JSON response leaves with camelCase keys.
  scope "/api", MealPlannerApiWeb do
    pipe_through([:api, :mobile_casing, :auth, :enforce_capability])

    # User endpoints (auth required, capability required)
    get("/recipes/:id", RecipeController, :show)
    get("/calendar", CalendarController, :index)
    get("/calendar/slot", CalendarController, :show_slot)
    put("/calendar/meals/range", CalendarController, :replace_range)
    get("/planning/weekly", PlanningController, :weekly)
    post("/planning/confirm", PlanningController, :confirm)
    get("/planning/favorites", PlanningChatController, :favorites)
    post("/planning/chat", PlanningChatController, :create)
    put("/planning/slots/favorite", PlanningController, :toggle_slot_favorite)
    post("/planning/proposals/:proposal_id/reject", PlanningChatController, :reject)

    post("/cooking/start", CookingController, :start)
    get("/cooking/sessions/:session_id", CookingController, :show)
    post("/cooking/sessions/:session_id/step", CookingController, :step)
    post("/cooking/sessions/:session_id/finish", CookingController, :finish)
    post("/cooking/sessions/:session_id/ask", CookingController, :ask)

    get("/shopping-list", ShoppingController, :index)
    post("/shopping-items/mark-cart", ShoppingController, :mark_cart)
    post("/shopping-items/manual", ShoppingController, :create_manual)
    post("/shopping-items/set-status", ShoppingController, :set_status)
    delete("/shopping-items/:item_id", ShoppingController, :delete_item)
    post("/cart/:session_id/activity", ShoppingController, :renew_cart)
    delete("/cart/:session_id", ShoppingController, :cancel_cart)
    post("/shopping-items/assign-supermarket", ShoppingController, :assign_supermarket)
    post("/checkout/confirm", ShoppingController, :confirm_checkout)

    post(
      "/checkout/sessions/:checkout_session_id/delivered",
      ShoppingController,
      :confirm_delivery
    )

    get("/inventory", InventoryController, :index)
    post("/inventory/items/add-extra", InventoryController, :add_extra)
    post("/inventory/items/:item_id/quantity", InventoryController, :update_quantity)
    post("/inventory/items/:item_id/dispose", InventoryController, :dispose)
    post("/inventory/voice/preview", InventoryController, :voice_preview)
    post("/inventory/voice/apply", InventoryController, :voice_apply)
    post("/planning/rescue", InventoryController, :rescue_plan)
  end

  # Phase A — Tenancy Refactor (PR 3a): membership / invite / lifecycle
  # endpoints scoped to an Account via the URL (design §5.2, §6).
  scope "/api/accounts/:account_id", MealPlannerApiWeb do
    pipe_through([:api, :auth, :enforce_account_scope, :enforce_capability])

    get("/memberships", MembershipController, :index)
    delete("/memberships/:user_id", MembershipController, :delete)
    post("/invites", InviteController, :create)
    post("/leave", AccountLifecycleController, :leave)
  end
end
