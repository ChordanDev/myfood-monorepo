defmodule MealPlannerApi.Generation.Supervisor do
  @moduledoc """
  Supervisor of the generation servers and of the registry that finds them.

  It is a plain `Supervisor` with two children:

    * `MealPlannerApi.Generation.Generations`, the `Registry` where each
      `MealPlannerApi.Generation.Server` registers under
      `{:generation, account_id}`, so `Server.start_generation/4` finds the
      server of an account that already has one.
    * `MealPlannerApi.Generation.ServerSupervisor`, the `DynamicSupervisor`
      the generation servers are started under, one per account.

  A generation server is started on `ServerSupervisor`, never on this module:
  this module is not a `DynamicSupervisor` and refuses the child spec.
  """

  use Supervisor

  @spec start_link(any()) :: Supervisor.on_start()
  def start_link(opts \\ []) do
    Supervisor.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    children = [
      {Registry, keys: :unique, name: MealPlannerApi.Generation.Generations},
      {DynamicSupervisor,
       strategy: :one_for_one, max_seconds: 5, name: MealPlannerApi.Generation.ServerSupervisor}
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end
end
