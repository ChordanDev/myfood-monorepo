defmodule MealPlannerApiWeb.AccountsController do
  use MealPlannerApiWeb, :controller

  alias MealPlannerApi.Services.AccountService
  alias MealPlannerApiWeb.ApiError
  alias MealPlannerApiWeb.Controllers.AccountScopeHelpers
  alias MealPlannerApiWeb.CurrentMe

  # Phase A — Tenancy Refactor (PR 3c task 3.22): tenancy scope is always
  # resolved from `conn.assigns.current_membership.account_id`, never
  # from the legacy `current_user.account_id` field. This task only
  # updates this existing controller's own reads — roster/remove is
  # handled by `MembershipController` (PR 3a).

  # `GET /api/me` and its alias `GET /api/auth/me`: the body is the mobile
  # `CurrentMe` payload itself, with no wrapper.
  def me(conn, _params) do
    user = Guardian.Plug.current_resource(conn)
    membership = conn.assigns.current_membership

    case CurrentMe.load(user, membership) do
      {:ok, me} -> json(conn, me)
      {:error, :account_not_found} -> conn |> ApiError.error(:account_not_found)
    end
  end

  def context(conn, _params) do
    user = Guardian.Plug.current_resource(conn)
    membership = conn.assigns.current_membership

    # `AccountService.context/1` resolves the identity from the User's
    # `id` and `account_id`, so the User is scoped to the membership's
    # Account like the other account routes do.
    case user
         |> AccountScopeHelpers.scope_user_to_membership(membership)
         |> AccountService.context() do
      {:ok, data} ->
        json(conn, %{
          user: %{
            id: user.id,
            email: user.email,
            name: user.name,
            subscription_tier: data.account.subscription_tier
          },
          account: data.account,
          subscription: data.subscription,
          active_users: data.active_users
        })

      {:error, reason} ->
        render_error(conn, reason)
    end
  end

  defp render_error(conn, reason) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: Atom.to_string(reason)})
  end
end
