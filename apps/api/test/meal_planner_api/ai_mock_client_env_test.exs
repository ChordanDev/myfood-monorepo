defmodule MealPlannerApi.AIMockClientEnvTest do
  @moduledoc """
  The environments where `MealPlannerApi.AI` lets `MockClient` answer: `test`
  and `e2e`, whose `config/runtime.exs` accepts `AI_CLIENT=mock` (issue
  #376). Every other environment refuses it, a release (`:prod`) included.
  """
  use ExUnit.Case, async: true

  alias MealPlannerApi.AI

  test "MockClient answers in test and e2e" do
    assert AI.mock_client_allowed?(:test)
    assert AI.mock_client_allowed?(:e2e)
  end

  test "MockClient is refused in dev and prod" do
    refute AI.mock_client_allowed?(:dev)
    refute AI.mock_client_allowed?(:prod)
  end

  test "MockClient answers through the facade in test" do
    assert {:ok, "Mock AI says: 'hola'" <> _rest} = AI.generate_text("hola")
  end
end
