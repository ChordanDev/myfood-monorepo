defmodule MealPlannerApiWeb.InventoryController do
  use MealPlannerApiWeb, :controller

  alias MealPlannerApi.Services.BudgetService
  alias MealPlannerApi.Services.InventoryService
  alias MealPlannerApiWeb.ApiError
  alias MealPlannerApiWeb.Controllers.AccountScopeHelpers

  # Phase A — Tenancy Refactor (PR 3c task 3.18): tenancy scope is always
  # resolved from `conn.assigns.current_membership.account_id`, never
  # from the legacy `current_user.account_id` field. See
  # `AccountScopeHelpers.scope_user_to_membership/2`.

  def index(conn, _params) do
    user = scoped_user(conn)

    case InventoryService.inventory_view(user) do
      {:ok, payload} -> json(conn, %{data: payload})
      {:error, reason} -> render_error(conn, reason)
    end
  end

  def add_extra(conn, payload) do
    user = scoped_user(conn)

    case InventoryService.add_extra_item(user, payload) do
      {:ok, payload} -> inventory_changed(conn, payload)
      {:error, reason} -> render_error(conn, reason)
    end
  end

  def update_quantity(conn, %{"item_id" => item_id} = payload) do
    user = scoped_user(conn)

    case InventoryService.adjust_item_quantity(user, item_id, payload) do
      {:ok, payload} -> inventory_changed(conn, payload)
      {:error, reason} -> render_error(conn, reason)
    end
  end

  def dispose(conn, %{"item_id" => item_id} = payload) do
    user = scoped_user(conn)

    case InventoryService.dispose_item(user, item_id, payload) do
      {:ok, payload} -> inventory_changed(conn, payload)
      {:error, reason} -> render_error(conn, reason)
    end
  end

  def voice_preview(conn, payload) do
    user = scoped_user(conn)

    case InventoryService.voice_preview(user, payload) do
      {:ok, data} -> json(conn, %{data: data})
      {:error, reason} -> render_error(conn, reason)
    end
  end

  def voice_apply(conn, payload) do
    user = scoped_user(conn)

    case InventoryService.voice_apply(user, payload) do
      {:ok, data} -> inventory_changed(conn, data)
      {:error, reason} -> render_error(conn, reason)
    end
  end

  def rescue_plan(conn, payload) do
    user = scoped_user(conn)
    budget = BudgetService.resolve(user)

    case InventoryService.rescue_plan(user, payload, budget) do
      {:ok, data} -> json(conn, %{data: data})
      {:error, reason} -> render_error(conn, reason)
    end
  end

  defp scoped_user(conn) do
    conn
    |> Guardian.Plug.current_resource()
    |> AccountScopeHelpers.scope_user_to_membership(conn.assigns.current_membership)
  end

  defp inventory_changed(conn, data) do
    MealPlannerApi.Cart.notify(conn.assigns.current_membership.account_id, "inventory_changed", %{
      refresh: true
    })

    json(conn, %{data: data})
  end

  # Every error leaves through the `ApiError` envelope. It carries a code and
  # the message of that code only, so it does not name the field that failed.
  @validation_reasons ~w(
    missing_ingredient invalid_ingredient_id ingredient_not_found
    missing_quantity invalid_quantity
    missing_unit invalid_unit
    invalid_expires_at invalid_notes invalid_is_leftover
    invalid_voice_payload no_ingredients_selected
  )a

  defp render_error(conn, reason) when reason in @validation_reasons do
    conn |> ApiError.error(:validation_error)
  end

  # A lot or a meal the payload described could not be stored as given.
  defp render_error(conn, %Ecto.Changeset{}), do: conn |> ApiError.error(:validation_error)

  defp render_error(conn, :inventory_item_not_found) do
    conn |> ApiError.error(:inventory_item_not_found)
  end

  defp render_error(conn, :voice_parse_failed), do: conn |> ApiError.error(:voice_parse_failed)

  defp render_error(conn, :voice_confirmation_required) do
    conn |> ApiError.error(:voice_confirmation_required)
  end

  defp render_error(conn, :no_rescue_recipe_found), do: conn |> ApiError.error(:not_found)
  defp render_error(conn, :invalid_identity), do: conn |> ApiError.error(:invalid_identity)
  defp render_error(conn, _reason), do: conn |> ApiError.server_fault()
end
