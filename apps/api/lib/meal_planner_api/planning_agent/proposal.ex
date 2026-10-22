defmodule MealPlannerApi.PlanningAgent.Proposal do
  @moduledoc """
  Builds the Proposal shown to the Member from validated meals (issue #423,
  ported from myfood@d9b965a): its meals, the estimated cost against the
  session budget, its Deviations and its code-owned status.
  `present_proposal` builds it before showing a plan, and confirmation
  rebuilds it from current data to revalidate the exact Proposal the Member
  saw.

  The session budget is the Account's weekly Budget prorated to the range
  (`MealPlannerApi.PlanningAgent.HouseholdContext.range_budget_cents/2`); there
  is never "no budget". An estimated cost over it is a budget Deviation, and
  a Proposal with a Deviation `requires_approval` (#421, owner decision 8).
  Approving a Deviation arrives with #430; until then such a Proposal cannot
  be confirmed. A recipe without an estimated cost makes the total a lower
  bound: overspend is still certain, but fitting the budget is unknown.

  Every Proposal has its own identity (`proposal_id`); a recalculated
  Proposal is a new one and needs its own confirmation.
  """

  alias MealPlannerApi.PlanningAgent.HouseholdContext

  @type t :: map()

  # Fields that make up what the Member saw; the identity is not one of them.
  @content_fields ~w(status meals budget deviations)

  @doc """
  Builds a Proposal for `meals` (validated, each with `:date`, `:slot`,
  `:recipe_id`, `:name` and `:estimated_cost_cents`) in the session context
  `ctx`.
  """
  @spec build([map()], map()) :: t()
  def build(meals, ctx) do
    budget_cents = HouseholdContext.range_budget_cents(ctx.household, ctx.range)
    known = for %{estimated_cost_cents: cents} when is_integer(cents) <- meals, do: cents
    total = Enum.sum(known)
    complete? = length(known) == length(meals)
    deviations = budget_deviations(total, budget_cents)

    %{
      "type" => "proposal",
      "proposal_id" => Ecto.UUID.generate(),
      "status" => if(deviations == [], do: "valid", else: "requires_approval"),
      "meals" =>
        Enum.map(meals, fn meal ->
          %{
            "date" => Date.to_iso8601(meal.date),
            "slot" => meal.slot,
            "recipe_id" => meal.recipe_id,
            "name" => meal.name,
            "estimated_cost_cents" => meal.estimated_cost_cents
          }
        end),
      "budget" => %{
        "budget_cents" => budget_cents,
        "estimated_cost_cents" => total,
        "within_budget" =>
          cond do
            total > budget_cents -> false
            complete? -> true
            true -> nil
          end,
        "uncertain" => not complete?
      },
      "deviations" => deviations
    }
  end

  @doc "The meals of a Proposal, as validator input."
  @spec meals(t()) :: [%{date: Date.t(), slot: String.t(), recipe_id: String.t()}]
  def meals(%{"meals" => meals}) do
    Enum.map(meals, fn meal ->
      %{date: Date.from_iso8601!(meal["date"]), slot: meal["slot"], recipe_id: meal["recipe_id"]}
    end)
  end

  @doc "Whether two Proposals show the Member the same content, whatever their identity."
  @spec same_content?(t(), t()) :: boolean()
  def same_content?(a, b), do: Map.take(a, @content_fields) == Map.take(b, @content_fields)

  defp budget_deviations(total, budget_cents) when total > budget_cents do
    [
      %{
        "type" => "budget",
        "budget_cents" => budget_cents,
        "estimated_cost_cents" => total,
        "difference_cents" => total - budget_cents
      }
    ]
  end

  defp budget_deviations(_total, _budget_cents), do: []
end
