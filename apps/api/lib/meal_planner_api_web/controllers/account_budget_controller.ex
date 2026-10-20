defmodule MealPlannerApiWeb.AccountBudgetController do
  @moduledoc """
  `GET` and `PUT /api/account/budget` (issue #271): the weekly Budget of the
  Account of `conn.assigns.current_membership`, for the settings screen.

  Both answer `{ budget: { weeklyBudgetCents, isDefault,
  minWeeklyBudgetCents, currency } }`. `isDefault` is true while the Account
  never set a Budget and `weeklyBudgetCents` is the tier default.

  Every member may read it; only the owner may change it, so `PUT` from any
  other member answers `403 not_owner` whatever the body. The body carries
  `weeklyBudgetCents`, a whole number of cents at or above
  `minWeeklyBudgetCents` and above 0; anything else answers
  `validation_error` naming `weeklyBudgetCents`, and the stored value is left
  as it was. The rules belong to `BudgetService`.
  """
  use MealPlannerApiWeb, :controller

  alias MealPlannerApi.Services.BudgetService
  alias MealPlannerApiWeb.ApiError

  def show(conn, _params) do
    conn.assigns.current_membership.account_id
    |> BudgetService.weekly_budget()
    |> render_result(conn)
  end

  def update(conn, params) do
    conn.assigns.current_membership
    |> BudgetService.update_weekly_budget(Map.get(params, "weekly_budget_cents"))
    |> render_result(conn)
  end

  defp render_result({:ok, budget}, conn), do: json(conn, %{budget: budget})

  defp render_result({:error, :not_owner}, conn), do: conn |> ApiError.error(:not_owner)

  defp render_result({:error, :invalid_amount}, conn),
    do: conn |> ApiError.validation_error("weeklyBudgetCents")

  defp render_result({:error, :account_not_found}, conn),
    do: conn |> ApiError.error(:account_not_found)
end
