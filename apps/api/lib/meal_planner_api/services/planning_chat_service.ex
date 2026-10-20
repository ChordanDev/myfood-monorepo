defmodule MealPlannerApi.Services.PlanningChatService do
  @moduledoc """
  Planning chat orchestration — menu generation, quick favorites, and proposal flow.

  This service is the new replacement for the tangled PlanningChat + Planning modules.
  It coordinates identity resolution, proposal creation, and the confirm/reject lifecycle.
  """

  alias MealPlannerApi.Data.PlanningRepo
  alias MealPlannerApi.Data.RecipeRepo
  alias MealPlannerApi.Generation.Server
  alias MealPlannerApi.Persistence.Identity
  alias MealPlannerApi.Services.BudgetService
  alias MealPlannerApi.Services.PlanningService

  # -------------------------------------------------------------------------
  # Quick favorites
  # -------------------------------------------------------------------------

  @spec quick_favorites(map(), non_neg_integer()) :: {:ok, [map()]} | {:error, term()}
  def quick_favorites(current_user, limit \\ 10) do
    with {:ok, ids} <- Identity.ensure_persistent_identity(current_user) do
      recipes =
        RecipeRepo.list_favorites(ids)
        |> Enum.take(limit)
        |> Enum.map(fn recipe ->
          %{
            recipe_id: recipe.id,
            recipe_name: recipe.name,
            slots:
              Enum.map(recipe.suitable_for_slots || [], fn
                slot when is_atom(slot) -> Atom.to_string(slot)
                slot when is_binary(slot) -> slot
              end),
            prep_time_minutes: recipe.prep_time_minutes,
            calories_per_serving: recipe.calories_per_serving
          }
        end)

      {:ok, recipes}
    end
  end

  # -------------------------------------------------------------------------
  # Menu generation
  # -------------------------------------------------------------------------

  @spec generate_menu(map(), map()) :: {:ok, map()} | {:error, term()}
  def generate_menu(current_user, payload) when is_map(payload) do
    with {:ok, ids} <- Identity.ensure_persistent_identity(current_user),
         {:ok, parsed} <- parse_payload(payload, PlanningService.max_planning_days()),
         budget = BudgetService.resolve(current_user),
         budget_cents = budget.weekly_limit_cents,
         user_with_budget = Map.merge(current_user, %{weekly_budget_cents: budget_cents}),
         {:ok, %{days: plan}} <- PlanningService.generate_weekly_plan(user_with_budget, %{}),
         {:ok, scheduled_meals} <-
           scheduled_meals_from_plan(plan, parsed.date_from, parsed.date_to),
         {:ok, run} <-
           PlanningRepo.create_generation_run(%{
             account_id: ids.account_id,
             user_id: ids.user_id,
             status: :completed,
             started_at: DateTime.utc_now(),
             completed_at: DateTime.utc_now(),
             input_context: %{
               message: parsed.message,
               date_from: Date.to_iso8601(parsed.date_from),
               date_to: Date.to_iso8601(parsed.date_to),
               content_type: parsed.content_type,
               requested_recipe_ids: parsed.requested_recipe_ids,
               weekly_budget_cents: budget_cents
             }
           }),
         proposal_json = build_proposal_json(scheduled_meals, plan, parsed),
         {:ok, proposal} <-
           PlanningRepo.create_proposal(%{
             generation_run_id: run.id,
             proposal_json: proposal_json
           }) do
      {:ok,
       %{
         run: run,
         proposal: proposal,
         proposal_json: proposal_json,
         date_from: parsed.date_from,
         date_to: parsed.date_to
       }}
    else
      {:error, _} = error -> error
    end
  end

  # -------------------------------------------------------------------------
  # Confirm / reject over HTTP (issue #28)
  # -------------------------------------------------------------------------

  @doc """
  Confirms a pending proposal of the Account through the session flow:
  `Generation.Server.confirm/3` writes the Scheduled meals, rebuilds the
  Shopping list and commits the Planning session `session_id` in one
  transaction. Once it commits, `session_committed` is broadcast on
  `planning:<account_id>` with the meal count, next to the
  `proposal_confirmed` the engine broadcasts.

  A proposal already accepted answers the same result again, writes nothing
  and broadcasts `session_committed` again, as long as `session_id` names a
  committed session of the Account (`:missing_lock` otherwise). Any other
  status answers `:planning_proposal_not_pending`.
  """
  @spec confirm_proposal(Ecto.UUID.t(), term(), term()) :: {:ok, map()} | {:error, atom()}
  def confirm_proposal(account_id, proposal_id, session_id) do
    with {:ok, proposal_id} <- cast_id(proposal_id, :invalid_proposal_id),
         {:ok, session_id} <- cast_id(session_id, :missing_session_id),
         {:ok, proposal} <- PlanningRepo.get_account_proposal(account_id, proposal_id) do
      case proposal.status do
        :pending -> confirm_pending(account_id, proposal, session_id)
        :accepted -> confirmed_result(account_id, proposal, session_id)
        _status -> {:error, :planning_proposal_not_pending}
      end
    end
  end

  @doc """
  Rejects a pending proposal of the Account. The generation server of the
  Account rejects it when one is running; otherwise the proposal is rejected
  here. Either way the topic
  hears `proposal_rejected`. Any status but pending answers
  `:planning_proposal_not_pending`.

  The proposal is read once the generation server has finished what it was
  doing: a confirm still running there (its own HTTP call may have timed out)
  is not overwritten by a reject that read the proposal before it committed.
  A confirm that reaches the server after that read is caught by the
  server's own pending guard, and the reject answers
  `:planning_proposal_not_pending`. With no server running, the write itself
  checks the proposal is still pending: a confirm that commits after the read
  keeps the proposal confirmed, and the reject answers
  `:planning_proposal_not_pending` and broadcasts nothing (issue #350). A
  server that cannot be reached answers
  `:reject_unavailable` and rejects nothing; so does a reject the server did
  not apply.
  """
  @spec reject_pending_proposal(Ecto.UUID.t(), term()) :: {:ok, map()} | {:error, atom()}
  def reject_pending_proposal(account_id, proposal_id) do
    with {:ok, proposal_id} <- cast_id(proposal_id, :invalid_proposal_id),
         {:ok, _proposal} <- PlanningRepo.get_account_proposal(account_id, proposal_id),
         {:ok, proposal} <- reject_through_session_flow(account_id, proposal_id) do
      {:ok,
       %{
         proposal_id: proposal.id,
         generation_run_id: proposal.generation_run_id,
         status: "rejected"
       }}
    end
  end

  defp confirm_pending(account_id, proposal, session_id) do
    with {:ok, pid} <- generation_server(account_id),
         {:ok, summary} <- call_confirm(pid, proposal.id, session_id) do
      result = committed_result(proposal.id, session_id, summary.scheduled_meals_count)
      broadcast_committed(account_id, result)
      {:ok, result}
    else
      # Another confirm of the same proposal committed first.
      {:error, :already_confirmed} -> confirmed_result(account_id, proposal, session_id)
      # A reject of the same proposal was handled first (issue #287).
      {:error, :not_pending} -> {:error, :planning_proposal_not_pending}
      {:error, _reason} = error -> error
    end
  end

  # The result of a proposal confirmed before. A confirm writes one Scheduled
  # meal per slot of the proposal or nothing at all, so the slots are the meal
  # count it answered. The session named must be a committed one of the
  # Account.
  #
  # The topic hears `session_committed` again: the first confirm may have
  # committed after its HTTP call timed out, and then nobody told the other
  # devices of the Account. Hearing it twice changes nothing for a client.
  defp confirmed_result(account_id, proposal, session_id) do
    case PlanningRepo.get_account_session(account_id, session_id) do
      %{status: :committed} ->
        result = committed_result(proposal.id, session_id, slot_count(proposal))
        broadcast_committed(account_id, result)
        {:ok, result}

      _not_committed ->
        {:error, :missing_lock}
    end
  end

  defp broadcast_committed(account_id, result) do
    broadcast(
      account_id,
      "session_committed",
      Map.take(result, [:session_id, :proposal_id, :scheduled_meals_count, :shopping_rebuilt])
    )
  end

  # `proposal_json` holds atom keys until it is read back from the database.
  defp slot_count(%{proposal_json: json}) when is_map(json) do
    case Map.get(json, :slots) || Map.get(json, "slots") do
      slots when is_list(slots) -> length(slots)
      _none -> 0
    end
  end

  defp slot_count(_proposal), do: 0

  defp committed_result(proposal_id, session_id, meals_count) do
    %{
      proposal_id: proposal_id,
      session_id: session_id,
      status: "committed",
      scheduled_meals_count: meals_count,
      shopping_rebuilt: true
    }
  end

  # An exit of the call (the server died, or it took longer than the call
  # timeout) says nothing of whether the transaction committed, so it is not
  # reported as a failed confirm. A retry reads the outcome.
  defp call_confirm(pid, proposal_id, session_id) do
    Server.confirm(pid, proposal_id, session_id)
  catch
    :exit, _reason -> {:error, :confirm_unavailable}
  end

  # The server handles its messages one at a time, so a call returns once
  # whatever it was running (a confirm included) is done. Only then is the
  # proposal read and, still pending, rejected. A confirm that reaches the
  # server between that read and the reject is caught by the engine's own
  # pending guard, which answers `:not_pending` and writes nothing (#287).
  # With no server, the reject's write checks the proposal is still pending
  # (#350).
  defp reject_through_session_flow(account_id, proposal_id) do
    case generation_server(account_id) do
      {:ok, pid} ->
        reject_on_server(pid, account_id, proposal_id)

      {:error, :no_active_generation} ->
        with {:ok, proposal} <- fetch_pending(account_id, proposal_id),
             :ok <- reject_without_server(account_id, proposal) do
          {:ok, proposal}
        end
    end
  end

  defp reject_on_server(pid, account_id, proposal_id) do
    with :ok <- await_server(pid),
         {:ok, proposal} <- fetch_pending(account_id, proposal_id) do
      call_reject(pid, proposal)
    end
  end

  # The reply says what the server did. Anything but `:ok` rejected nothing,
  # and an exit says nothing of whether it did, so neither is reported as a
  # rejection.
  defp call_reject(pid, proposal) do
    case Server.reject(pid, proposal.id) do
      :ok -> {:ok, proposal}
      {:error, :not_pending} -> {:error, :planning_proposal_not_pending}
      _not_applied -> {:error, :reject_unavailable}
    end
  catch
    :exit, _reason -> {:error, :reject_unavailable}
  end

  defp fetch_pending(account_id, proposal_id) do
    with {:ok, proposal} <- PlanningRepo.get_account_proposal(account_id, proposal_id),
         :ok <- ensure_pending(proposal) do
      {:ok, proposal}
    end
  end

  defp await_server(pid) do
    _state = GenServer.call(pid, :get_status)
    :ok
  catch
    :exit, _reason -> {:error, :reject_unavailable}
  end

  # What the server does on `reject`, for a proposal no server is running for.
  # A server can start after the read above and confirm the proposal before
  # this write (issue #350), so the write itself checks the proposal is still
  # pending. One that is not answers `:planning_proposal_not_pending` and
  # nothing is written or broadcast.
  defp reject_without_server(account_id, proposal) do
    case PlanningRepo.reject_pending_proposal(proposal, proposal.generation_run) do
      {:ok, _rejected} ->
        broadcast(account_id, "proposal_rejected", %{proposal_id: proposal.id})

      {:error, :not_pending} ->
        {:error, :planning_proposal_not_pending}

      {:error, _changeset} = error ->
        error
    end
  end

  defp ensure_pending(%{status: :pending}), do: :ok
  defp ensure_pending(_proposal), do: {:error, :planning_proposal_not_pending}

  defp generation_server(account_id) do
    case Registry.lookup(MealPlannerApi.Generation.Generations, {:generation, account_id}) do
      [{pid, _}] -> {:ok, pid}
      [] -> {:error, :no_active_generation}
    end
  end

  defp cast_id(value, reason) when is_binary(value) do
    case Ecto.UUID.cast(value) do
      {:ok, uuid} -> {:ok, uuid}
      :error -> {:error, reason}
    end
  end

  defp cast_id(_value, reason), do: {:error, reason}

  defp broadcast(account_id, event, payload) do
    Phoenix.Channel.Server.broadcast!(
      MealPlannerApi.PubSub,
      "planning:#{account_id}",
      event,
      payload
    )
  end

  # -------------------------------------------------------------------------
  # Payload parsing
  # -------------------------------------------------------------------------

  defp parse_payload(payload, max_days) do
    with {:ok, date_from} <- parse_date(Map.get(payload, "date_from")),
         {:ok, date_to} <- parse_date(Map.get(payload, "date_to")),
         :ok <- validate_date_range(date_from, date_to, max_days) do
      {:ok,
       %{
         message: normalize_message(Map.get(payload, "message")),
         content_type: normalize_content_type(Map.get(payload, "content_type")),
         requested_recipe_ids: normalize_recipe_ids(Map.get(payload, "requested_recipe_ids", [])),
         date_from: date_from,
         date_to: date_to
       }}
    end
  end

  defp parse_date(nil), do: {:ok, Date.utc_today()}
  defp parse_date(value) when is_binary(value), do: Date.from_iso8601(value)
  defp parse_date(_), do: {:error, :invalid_date}

  # The dates come from the client and every day of the range becomes
  # scheduled meals, so the range is checked before anything is planned or
  # written. It holds `max_days` days at most, both ends counted:
  # `PlanningService.max_planning_days/0`, seven days on every plan, the same
  # limit `generate_weekly_plan/3` applies. A longer range is
  # `:date_range_too_long`; one that ends before it starts is
  # `:invalid_date_range`.
  defp validate_date_range(date_from, date_to, max_days) do
    days = Date.diff(date_to, date_from) + 1

    cond do
      days < 1 -> {:error, :invalid_date_range}
      days > max_days -> {:error, :date_range_too_long}
      true -> :ok
    end
  end

  defp normalize_message(nil), do: ""
  defp normalize_message(msg) when is_binary(msg), do: String.trim(msg)
  defp normalize_message(_), do: ""

  defp normalize_content_type("speech_transcript"), do: "speech_transcript"
  defp normalize_content_type(_), do: "text"

  defp normalize_recipe_ids(ids) when is_list(ids), do: Enum.filter(ids, &is_binary/1)
  defp normalize_recipe_ids(_), do: []

  # -------------------------------------------------------------------------
  # Plan → scheduled meals conversion
  # -------------------------------------------------------------------------

  defp scheduled_meals_from_plan([], _date_from, _date_to), do: {:ok, []}

  defp scheduled_meals_from_plan(plan, date_from, date_to) when is_list(plan) do
    dates = Enum.to_list(Date.range(date_from, date_to))

    meals =
      dates
      |> Enum.with_index()
      |> Enum.flat_map(fn {date, index} ->
        day_plan = Enum.at(plan, rem(index, length(plan)), %{})

        day_meals =
          day_plan
          |> Map.get("meals", [])
          |> Enum.concat(day_plan[:meals] || [])
          |> Enum.uniq()

        day_meals
        |> Enum.map(&scheduled_meal_entry(&1, date))
        |> Enum.reject(&is_nil/1)
      end)

    if meals == [], do: {:ok, []}, else: {:ok, meals}
  end

  defp scheduled_meal_entry(meal, date) do
    # Handle both string-keyed ("slot") and atom-keyed (:slot) maps
    slot = Map.get(meal, "slot") || Map.get(meal, :slot)
    recipe_id = Map.get(meal, "recipe_id") || Map.get(meal, :recipe_id)

    cond do
      not is_binary(slot) ->
        nil

      not is_binary(recipe_id) ->
        nil

      true ->
        %{
          date: Date.to_iso8601(date),
          slot: slot,
          recipe_id: recipe_id
        }
    end
  end

  # -------------------------------------------------------------------------
  # Proposal JSON construction
  # -------------------------------------------------------------------------

  defp build_proposal_json(scheduled_meals, plan, parsed) do
    # Build day plans from the plan for the weekly_plan response
    day_plans =
      plan
      |> Enum.with_index()
      |> Enum.map(fn {day_map, _} ->
        %{day: day_map["day"], meals: day_map["meals"] || []}
      end)

    weekly_plan = %{days: day_plans}

    %{
      summary:
        "Propuesta para #{Date.to_iso8601(parsed.date_from)} a #{Date.to_iso8601(parsed.date_to)}",
      date_from: Date.to_iso8601(parsed.date_from),
      date_to: Date.to_iso8601(parsed.date_to),
      user_message: parsed.message,
      scheduled_meals: scheduled_meals,
      weekly_plan: weekly_plan
    }
  end
end
