defmodule MealPlannerApi.PlanningAgent.Tools do
  @moduledoc """
  Agent-callable tool catalog of the planning agent (issue #423, ported from
  myfood@d9b965a). No tool writes Account data.

    * `search_recipes` — structured search; recipes the Participants'
      restrictions forbid are excluded by code
    * `run_optimizer` — the optimizer (`MealPlannerApi.Optimization.OptimizerPort`)
      over restriction-safe candidates; failures are typed errors, never a
      fallback plan
    * `present_proposal` — always validates the latest optimizer plan; only a
      valid plan is shown to the Member, otherwise the violations go back.
      A shown Proposal carries its estimated cost against the session budget
      (`MealPlannerApi.PlanningAgent.Proposal`)
    * `ask_human` — one question; ends the turn

  Recipe search and solver calls run within
  `MealPlannerApi.PlanningAgent.CallBounds`: their own deadline and retry
  budget, clipped by the turn's global deadline.

  Every call runs with the session's tool context. The Account always comes
  from that context: tool schemas carry no Account and any Account named in
  model arguments is ignored. Unknown tools are rejected by code.
  """

  alias MealPlannerApi.PlanningAgent.{
    CallBounds,
    HouseholdContext,
    Proposal,
    ProposalValidator,
    RecipeCosts,
    RecipeSearch
  }

  @type context :: %{
          required(:account_id) => Ecto.UUID.t(),
          required(:range) => {Date.t(), Date.t()},
          required(:slots) => [String.t()],
          required(:household) => map(),
          required(:workspace) => map(),
          optional(atom()) => term()
        }

  @type control :: :continue | :end_turn

  @optimizer_candidates_per_slot 50

  @doc "Tool definitions offered to the model."
  @spec definitions() :: [MealPlannerApi.PlanningAgent.Model.tool()]
  def definitions do
    [
      %{
        name: "search_recipes",
        description:
          "Search recipes by text over name and ingredients, optionally filtered by meal slot " <>
            "and ingredient. Recipes that break the household's restrictions are already excluded.",
        parameters: %{
          "type" => "object",
          "properties" => %{
            "query" => %{"type" => "string", "description" => "Text to match"},
            "slot" => %{
              "type" => "string",
              "enum" => ["breakfast", "lunch", "dinner"],
              "description" => "Meal slot"
            },
            "ingredient" => %{"type" => "string", "description" => "Ingredient name to require"},
            "limit" => %{"type" => "integer", "minimum" => 1, "maximum" => 50}
          },
          "additionalProperties" => false
        }
      },
      %{
        name: "run_optimizer",
        description:
          "Build a plan for every day and slot of the Planning Range with the optimizer. " <>
            "Optionally exclude recipes. Returns the plan or a typed error.",
        parameters: %{
          "type" => "object",
          "properties" => %{
            "exclude_recipe_ids" => %{"type" => "array", "items" => %{"type" => "string"}}
          },
          "additionalProperties" => false
        }
      },
      %{
        name: "present_proposal",
        description:
          "Validate the latest optimizer plan and, only if valid, show it to the household " <>
            "with its estimated cost against the budget. Returns the status or the violations to fix.",
        parameters: %{"type" => "object", "properties" => %{}, "additionalProperties" => false}
      },
      %{
        name: "ask_human",
        description: "Ask the household one question. Ends your turn.",
        parameters: %{
          "type" => "object",
          "properties" => %{"question" => %{"type" => "string"}},
          "required" => ["question"],
          "additionalProperties" => false
        }
      }
    ]
  end

  @doc """
  Executes one tool call. Returns the tool result content (with its
  `"outcome"`), the possibly updated workspace, and whether the turn
  continues.
  """
  @spec execute(String.t(), map(), context()) :: {map(), map(), control()}
  def execute(name, args, ctx) do
    {content, workspace, control} = run(name, args, ctx)
    {Map.put_new(content, "outcome", outcome(content)), workspace, control}
  end

  @doc """
  The outcome kind of a tool result: `complete`, `failure`, or `unknown`
  (the call was cut by its deadline, so absence of a result proves nothing).
  """
  @spec outcome(map()) :: String.t()
  def outcome(%{"outcome" => outcome}), do: outcome
  def outcome(%{"error" => "search_timeout"}), do: "unknown"
  def outcome(%{"error" => "optimizer_failed", "reason" => "optimizer_timeout"}), do: "unknown"
  def outcome(%{"error" => _}), do: "failure"
  # A proposal the validator rejected is a failed attempt, not evidence.
  def outcome(%{"status" => "invalid"}), do: "failure"
  def outcome(_content), do: "complete"

  defp run("search_recipes", args, ctx) do
    emit(ctx, %{"type" => "progress", "step" => "searching_recipes"})

    filters = %{
      query: string_arg(args, "query"),
      slot: string_arg(args, "slot"),
      ingredient: string_arg(args, "ingredient"),
      limit: integer_arg(args, "limit")
    }

    case search(ctx, reject_nil(filters)) do
      {:ok, recipes} ->
        {%{"recipes" => Enum.map(recipes, &recipe_data/1)}, ctx.workspace, :continue}

      {:error, reason} ->
        {%{"error" => Atom.to_string(reason)}, ctx.workspace, :continue}
    end
  end

  defp run("run_optimizer", args, ctx) do
    emit(ctx, %{"type" => "progress", "step" => "running_optimizer"})

    exclude =
      args |> Map.get("exclude_recipe_ids", []) |> List.wrap() |> Enum.filter(&is_binary/1)

    with {:ok, candidates_by_slot} <- candidates(ctx, exclude),
         {:ok, solution} <- solve(ctx, payload(ctx, candidates_by_slot)) do
      names =
        candidates_by_slot
        |> Map.values()
        |> List.flatten()
        |> Map.new(&{&1["recipe_id"], &1["label"]})

      result =
        Map.merge(
          %{"status" => "ok", "meals" => Enum.map(solution.meals, &meal_data(&1, names))},
          solution.extra
        )

      {result, %{ctx.workspace | draft: solution.meals}, :continue}
    else
      # Every failed run discards the earlier draft so present_proposal cannot
      # show a plan the agent just asked to change.
      {:error, :no_candidates, slot} ->
        {%{"error" => "no_candidates", "slot" => slot}, %{ctx.workspace | draft: nil}, :continue}

      {:error, reason} when is_atom(reason) ->
        {%{"error" => Atom.to_string(reason)}, %{ctx.workspace | draft: nil}, :continue}

      {:error, reason, details} ->
        reason = reason_string(reason)
        emit(ctx, %{"type" => "optimizer_failed", "reason" => reason})

        {%{"error" => "optimizer_failed", "reason" => reason, "details" => details},
         %{ctx.workspace | draft: nil}, :continue}
    end
  end

  defp run("present_proposal", _args, %{workspace: %{draft: nil}} = ctx),
    do: {%{"error" => "no_plan_to_present"}, ctx.workspace, :continue}

  defp run("present_proposal", _args, ctx) do
    emit(ctx, %{"type" => "progress", "step" => "validating_proposal"})

    case ProposalValidator.validate(ctx.workspace.draft, ctx) do
      {:valid, meals} ->
        proposal = Proposal.build(meals, ctx)
        emit(ctx, proposal)

        result = %{
          "status" => proposal["status"],
          "proposal_id" => proposal["proposal_id"],
          "budget" => proposal["budget"],
          "deviations" => proposal["deviations"]
        }

        {result, %{ctx.workspace | proposal: proposal}, :continue}

      {:invalid, violations} ->
        {%{"status" => "invalid", "violations" => violations}, ctx.workspace, :continue}
    end
  end

  defp run("ask_human", args, ctx) do
    case string_arg(args, "question") do
      nil ->
        {%{"error" => "question_required"}, ctx.workspace, :continue}

      question ->
        emit(ctx, %{"type" => "question", "text" => question})
        {%{"status" => "asked"}, ctx.workspace, :end_turn}
    end
  end

  defp run(_name, _arguments, ctx),
    do: {%{"error" => "unknown_tool"}, ctx.workspace, :continue}

  # ---------------------------------------------------------------------------
  # Optimizer
  # ---------------------------------------------------------------------------

  defp candidates(ctx, exclude) do
    Enum.reduce_while(ctx.slots, {:ok, %{}}, fn slot, {:ok, acc} ->
      filters = %{slot: slot, exclude_recipe_ids: exclude, limit: @optimizer_candidates_per_slot}

      case search(ctx, filters) do
        {:ok, []} -> {:halt, {:error, :no_candidates, slot}}
        {:ok, recipes} -> {:cont, {:ok, Map.put(acc, slot, recipes)}}
        {:error, _reason} = error -> {:halt, error}
      end
    end)
    |> with_costs()
  end

  # Candidate costs are the recipes' estimated costs, the same ones the
  # proposal validator compares with the budget.
  defp with_costs({:ok, recipes_by_slot}) do
    costs =
      recipes_by_slot |> Map.values() |> List.flatten() |> Enum.map(& &1.id) |> RecipeCosts.load()

    {:ok,
     Map.new(recipes_by_slot, fn {slot, recipes} ->
       {slot, Enum.map(recipes, &candidate(&1, costs))}
     end)}
  end

  defp with_costs(error), do: error

  # The nutrition goal enters the optimizer with its own slice (#433); no
  # macro bounds are sent, so only coverage, restrictions, variety and the
  # budget decide the plan.
  defp candidate(recipe, costs) do
    %{
      "recipe_id" => recipe.id,
      "label" => recipe.name,
      "estimated_cost_cents" => Map.get(costs, recipe.id) || 0,
      "calories_per_serving" => recipe.calories_per_serving || 0,
      "protein_g_per_serving" => recipe.protein_g_per_serving || 0,
      "carbs_g_per_serving" => recipe.carbs_g_per_serving || 0,
      "fat_g_per_serving" => recipe.fat_g_per_serving || 0,
      "inventory_hit_count" => 0
    }
  end

  defp payload(ctx, candidates_by_slot) do
    {from_date, to_date} = ctx.range

    %{
      "days" => from_date |> Date.range(to_date) |> Enum.map(&Date.to_iso8601/1),
      "slots" => ctx.slots,
      # The optimizer's budget is the budget of the whole range.
      "constraints" => %{
        "weekly_budget_cents" => HouseholdContext.range_budget_cents(ctx.household, ctx.range)
      },
      "candidates_by_slot" => candidates_by_slot
    }
  end

  defp solve(ctx, payload) do
    optimizer = optimizer(ctx)

    attempt = fn state, _call ->
      case optimizer.select_weekly_menu(payload) do
        {:ok, result} -> {:ok, result, state}
        {:error, reason} -> {:error, reason, state}
      end
    end

    case CallBounds.run(Map.get(ctx, :bounds), :solver, nil, attempt) do
      {:ok, %{"meals" => meals} = result, _state} when is_list(meals) ->
        with {:ok, parsed} <- parse_meals(meals) do
          {:ok, %{meals: parsed, extra: Map.take(result, ["deviations", "optimality"])}}
        end

      {:ok, _other, _state} ->
        {:error, :invalid_optimizer_response, %{}}

      {:error, {reason, details}, _state} when reason in [:infeasible, :inconclusive] ->
        {:error, reason, details}

      {:error, reason, _state} when reason in [:timeout, :deadline_exceeded] ->
        {:error, :optimizer_timeout, %{}}

      {:error, reason, _state} ->
        {:error, reason, %{}}
    end
  end

  defp optimizer(%{optimizer: module}) when is_atom(module) and module != nil, do: module

  defp optimizer(_ctx),
    do:
      Application.get_env(
        :meal_planner_api,
        :planning_optimizer_client,
        MealPlannerApi.Optimization.OptimizerServer
      )

  defp parse_meals(meals) do
    Enum.reduce_while(meals, {:ok, []}, fn
      %{"day" => day, "slot" => slot, "recipe_id" => recipe_id}, {:ok, acc}
      when is_binary(day) and is_binary(slot) and is_binary(recipe_id) ->
        case Date.from_iso8601(day) do
          {:ok, date} -> {:cont, {:ok, [%{date: date, slot: slot, recipe_id: recipe_id} | acc]}}
          _ -> {:halt, {:error, :invalid_optimizer_response, %{}}}
        end

      _meal, _acc ->
        {:halt, {:error, :invalid_optimizer_response, %{}}}
    end)
    |> case do
      {:ok, parsed} -> {:ok, Enum.reverse(parsed)}
      error -> error
    end
  end

  # Recipe search is a read tool: bounded and retried on transient failure.
  defp search(ctx, filters) do
    {module, opts} = Map.get(ctx, :recipe_search) || {RecipeSearch, []}

    attempt = fn state, _call ->
      case search_with(module, opts, ctx.household, filters) do
        {:ok, recipes} -> {:ok, recipes, state}
        {:error, reason} -> {:error, reason, state}
      end
    end

    case CallBounds.run(Map.get(ctx, :bounds), :read, nil, attempt) do
      {:ok, recipes, _state} ->
        {:ok, recipes}

      {:error, reason, _state} when reason in [:timeout, :deadline_exceeded] ->
        {:error, :search_timeout}

      {:error, _reason, _state} ->
        {:error, :search_failed}
    end
  end

  defp search_with(RecipeSearch, _opts, household, filters),
    do: RecipeSearch.search(household, filters)

  defp search_with(module, opts, household, filters), do: module.search(household, filters, opts)

  # ---------------------------------------------------------------------------
  # Helpers
  # ---------------------------------------------------------------------------

  defp recipe_data(recipe) do
    %{
      "recipe_id" => recipe.id,
      "name" => recipe.name,
      "slots" => recipe.slots,
      "ingredients" => recipe.ingredients,
      "calories_per_serving" => recipe.calories_per_serving
    }
  end

  defp meal_data(meal, names) do
    %{
      "date" => Date.to_iso8601(meal.date),
      "slot" => meal.slot,
      "recipe_id" => meal.recipe_id,
      "name" => Map.get(names, meal.recipe_id)
    }
  end

  defp string_arg(args, key) do
    case Map.get(args, key) do
      value when is_binary(value) ->
        if String.trim(value) == "", do: nil, else: value

      _ ->
        nil
    end
  end

  defp integer_arg(args, key) do
    case Map.get(args, key) do
      value when is_integer(value) -> value
      _ -> nil
    end
  end

  defp reject_nil(map), do: map |> Enum.reject(fn {_, v} -> is_nil(v) end) |> Map.new()

  defp emit(%{emit: emit}, event) when is_function(emit, 1), do: emit.(event)
  defp emit(_ctx, _event), do: :ok

  defp reason_string(reason) when is_atom(reason), do: Atom.to_string(reason)
  defp reason_string(_reason), do: "optimizer_error"
end
