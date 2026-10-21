defmodule Mix.Tasks.PriceSync.RunTest do
  use ExUnit.Case, async: true

  alias Mix.Tasks.PriceSync.Run

  describe "mix price_sync.run" do
    test "task module is defined" do
      assert is_atom(Run)
    end

    test "has run/1 function (Mix.Task callback)" do
      assert is_function(&Run.run/1, 1)
    end

    # The task reads the Repo, so Mix has to start the app before it runs.
    test "starts the app before it runs" do
      assert "app.start" in Mix.Task.requirements(Run)
    end
  end
end
