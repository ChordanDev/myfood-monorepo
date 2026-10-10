defmodule MealPlannerApiWeb.ChannelCase do
  @moduledoc """
  Test case for channel tests that require pubsub and DB sandbox.
  """

  use ExUnit.CaseTemplate

  alias Ecto.Adapters.SQL.Sandbox

  using do
    quote do
      import Phoenix.ChannelTest
      import MealPlannerApiWeb.ChannelHelpers
      @endpoint MealPlannerApiWeb.Endpoint
    end
  end

  setup tags do
    :ok = Sandbox.checkout(MealPlannerApi.Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()

    unless tags[:async] do
      Sandbox.mode(MealPlannerApi.Repo, {:shared, self()})
    end

    :ok
  end
end
