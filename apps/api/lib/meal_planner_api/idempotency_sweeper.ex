defmodule MealPlannerApi.IdempotencySweeper do
  @moduledoc "Prunes expired idempotency keys without requiring a client request."
  use GenServer

  def start_link(opts \\ []),
    do: GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))

  @impl true
  def init(opts) do
    interval = Keyword.get(opts, :interval, 60 * 60 * 1000)
    Process.send_after(self(), :tick, interval)
    {:ok, interval}
  end

  @impl true
  def handle_info(:tick, interval) do
    MealPlannerApi.Persistence.Idempotency.prune_expired()
    Process.send_after(self(), :tick, interval)
    {:noreply, interval}
  end
end
