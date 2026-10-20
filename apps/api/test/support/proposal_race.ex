defmodule MealPlannerApi.ProposalRace do
  @moduledoc """
  Forces a race on a Planning proposal (issue #350).

  Once `process` has read the proposal `reads` times, the proposal row is
  set to `status` before that process runs its next query. The process then
  holds a proposal it read as `pending` while the row says otherwise, as when
  another writer commits between its read and its write.

  The change is made from a Repo telemetry handler, which runs in the
  process that ran the query, against the real database.
  """

  import Ecto.Query

  alias MealPlannerApi.Persistence.Planning.PlanningProposal
  alias MealPlannerApi.Repo

  @event [:meal_planner_api, :repo, :query]

  @spec change_status_after_read(Ecto.UUID.t(), atom(), keyword()) :: :ok
  def change_status_after_read(proposal_id, status, opts) do
    handler_id = {__MODULE__, proposal_id}

    config = %{
      handler_id: handler_id,
      proposal_id: proposal_id,
      status: status,
      process: Keyword.fetch!(opts, :process),
      reads: Keyword.fetch!(opts, :reads),
      counter: :counters.new(1, [])
    }

    :ok = :telemetry.attach(handler_id, @event, &__MODULE__.handle_query/4, config)
    ExUnit.Callbacks.on_exit(fn -> :telemetry.detach(handler_id) end)
  end

  @doc false
  def handle_query(_event, _measurements, %{source: "planning_proposals", query: query}, config) do
    if self() == config.process and String.starts_with?(query, "SELECT") do
      :counters.add(config.counter, 1, 1)

      if :counters.get(config.counter, 1) == config.reads do
        :telemetry.detach(config.handler_id)

        {1, _} =
          from(p in PlanningProposal, where: p.id == ^config.proposal_id)
          |> Repo.update_all(set: [status: config.status])
      end
    end

    :ok
  end

  def handle_query(_event, _measurements, _metadata, _config), do: :ok
end
