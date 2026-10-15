defmodule MealPlannerApiWeb.PlanningController do
  use MealPlannerApiWeb, :controller

  alias MealPlannerApi.Data.PlanningRepo
  alias MealPlannerApi.Services.PlanningChatService
  alias MealPlannerApi.Services.PlanningService
  alias MealPlannerApiWeb.ApiError
  alias MealPlannerApiWeb.Controllers.AccountScopeHelpers
  alias MealPlannerApiWeb.MealSummary

  # Phase A — Tenancy Refactor (PR 3c task 3.15): tenancy scope is always
  # resolved from `conn.assigns.current_membership.account_id`, never
  # from the legacy `current_user.account_id` field. See
  # `AccountScopeHelpers.scope_user_to_membership/2` for why the User
  # struct is corrected at the controller boundary rather than rewriting
  # every downstream service signature.

  def weekly(conn, params) do
    user = scoped_user(conn)

    case PlanningService.generate_weekly_plan(user, params) do
      {:ok, plan} ->
        json(conn, %{data: serialize_weekly(plan)})

      {:error, reason} ->
        render_error(conn, reason)
    end
  end

  # Issue #28 — confirms a proposal through the session flow, with the
  # Planning session that holds its range (`{proposalId, sessionId}`). Every
  # error leaves through the `ApiError` envelope.
  def confirm(conn, payload) do
    account_id = conn.assigns.current_membership.account_id

    case PlanningChatService.confirm_proposal(
           account_id,
           payload["proposal_id"],
           payload["session_id"]
         ) do
      {:ok, result} -> json(conn, %{data: result})
      {:error, reason} -> render_session_error(conn, reason)
    end
  end

  # Issue #28 — the Planner renews the lease of its session while its screen
  # is open, as the Shopping screen renews a Cart.
  def renew_session(conn, %{"session_id" => session_id}) do
    membership = conn.assigns.current_membership

    with {:ok, session_id} <- Ecto.UUID.cast(session_id),
         {:ok, session} <-
           PlanningRepo.renew_session_lease(membership.account_id, session_id, membership.id) do
      json(conn, %{data: %{session_id: session.id, lease_expires_at: session.lease_expires_at}})
    else
      :error -> render_session_error(conn, :not_found)
      {:error, reason} -> render_session_error(conn, reason)
    end
  end

  def toggle_slot_favorite(conn, payload) do
    user = scoped_user(conn)

    case PlanningService.toggle_slot_favorite(user, payload) do
      {:ok, result} ->
        json(conn, result)

      {:error, reason} ->
        conn
        |> put_status(error_status(reason))
        |> json(%{error: Atom.to_string(reason)})
    end
  end

  # The optimizer meals carry the candidate fields (`label`,
  # `calories_per_serving`, ...); the response describes each one with the
  # shared `MealSummary`. Candidates know neither favorites nor prep time, so
  # `is_favorite` is false and `prep_time_minutes` is nil here.
  defp serialize_weekly(plan) do
    Map.update!(plan, :days, fn days -> Enum.map(days, &serialize_weekly_day/1) end)
  end

  defp serialize_weekly_day(day) do
    Map.update!(day, :meals, &Enum.map(&1, fn m -> weekly_meal(m) end))
  end

  defp weekly_meal(meal) do
    MealSummary.serialize(%{
      recipe_id: meal["recipe_id"],
      recipe_name: meal["label"],
      slot: meal["slot"],
      calories: meal["calories_per_serving"]
    })
  end

  defp scoped_user(conn) do
    conn
    |> Guardian.Plug.current_resource()
    |> AccountScopeHelpers.scope_user_to_membership(conn.assigns.current_membership)
  end

  defp error_status(:invalid_date), do: :bad_request
  defp error_status(:invalid_slot), do: :bad_request
  defp error_status(:meal_not_found), do: :not_found
  defp error_status(:invalid_identity), do: :unauthorized
  defp error_status(:optimization_failed), do: :unprocessable_entity
  defp error_status(_), do: :unprocessable_entity

  defp render_error(conn, reason) when is_atom(reason) do
    conn
    |> put_status(status_for(reason))
    |> json(%{error: Atom.to_string(reason)})
  end

  defp render_error(conn, _reason) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: "optimization_failed"})
  end

  # The reasons of a confirm or a lease renewal, the engine's included. Any
  # other reason is a fault of the server.
  defp render_session_error(conn, :invalid_proposal_id),
    do: conn |> ApiError.error(:invalid_proposal_id)

  defp render_session_error(conn, :missing_session_id),
    do: conn |> ApiError.error(:missing_session_id)

  defp render_session_error(conn, :not_found), do: conn |> ApiError.error(:not_found)

  defp render_session_error(conn, :planning_proposal_not_pending),
    do: conn |> ApiError.error(:planning_proposal_not_pending)

  defp render_session_error(conn, :no_active_generation),
    do: conn |> ApiError.error(:no_active_generation)

  defp render_session_error(conn, :forbidden), do: conn |> ApiError.error(:forbidden)
  defp render_session_error(conn, :not_a_member), do: conn |> ApiError.error(:not_a_member)
  defp render_session_error(conn, :missing_lock), do: conn |> ApiError.error(:missing_lock)
  defp render_session_error(conn, :foreign_lock), do: conn |> ApiError.error(:foreign_lock)
  defp render_session_error(conn, :lost_lock), do: conn |> ApiError.error(:lost_lock)
  defp render_session_error(conn, :terminal_lock), do: conn |> ApiError.error(:terminal_lock)

  defp render_session_error(conn, :transaction_failed),
    do: conn |> ApiError.error(:transaction_failed)

  defp render_session_error(conn, _reason), do: conn |> ApiError.server_fault()

  defp status_for(:invalid_identity), do: :unauthorized
  defp status_for(:optimization_failed), do: :unprocessable_entity
  defp status_for(:exceeds_max_planning_days), do: :bad_request
  defp status_for(_), do: :unprocessable_entity
end
