defmodule MealPlannerApi.Optimization.OptimizerPortRunnerTest do
  @moduledoc """
  Executable resolution in `OptimizerPortRunner.open_port/1`.

  The tests never depend on Python being installed: they spawn `cat -`, which
  is present on every machine that runs the suite. It copies stdin to stdout
  until the port closes, so the process is still alive when `open_port/1`
  checks the port (a program that exits at once is reported as
  `:spawn_failed`), and the echo proves which executable was spawned.
  """

  use ExUnit.Case, async: true

  import ExUnit.CaptureLog

  alias MealPlannerApi.Optimization.OptimizerPortRunner

  # Passed where the optimizer script path goes: `cat -` reads stdin.
  @stdin "-"

  describe "open_port/1" do
    test "resolves a bare executable name through PATH" do
      assert {:ok, port} =
               OptimizerPortRunner.open_port(python_executable: "cat", script_path: @stdin)

      assert_echoes(port)
    end

    test "keeps an absolute path to an executable" do
      absolute = System.find_executable("cat")
      assert Path.type(absolute) == :absolute

      assert {:ok, port} =
               OptimizerPortRunner.open_port(python_executable: absolute, script_path: @stdin)

      assert_echoes(port)
    end

    test "expands a relative path with a directory component against the working directory" do
      relative = Path.relative_to(System.find_executable("cat"), File.cwd!(), force: true)
      assert Path.type(relative) == :relative

      assert {:ok, port} =
               OptimizerPortRunner.open_port(python_executable: relative, script_path: @stdin)

      assert_echoes(port)
    end

    test "does not look up a relative path with a directory component on PATH" do
      # `cat` is on PATH, but `./cat` names a file in the working directory.
      log =
        capture_log(fn ->
          assert {:error, {:python_not_found, "./cat"}} =
                   OptimizerPortRunner.open_port(python_executable: "./cat", script_path: @stdin)
        end)

      assert log =~ ~s("./cat")
    end

    test "answers :python_not_found and logs how to fix it when a bare name is not on PATH" do
      name = "myfood-missing-python-#{System.unique_integer([:positive])}"

      log =
        capture_log(fn ->
          assert {:error, {:python_not_found, ^name}} =
                   OptimizerPortRunner.open_port(python_executable: name, script_path: @stdin)
        end)

      assert log =~ "[error]"
      assert log =~ name
      assert log =~ "Install Python 3"
      assert log =~ ":optimizer_python"
      assert log =~ "OPTIMIZER_PYTHON"
    end

    test "answers :python_not_found when an absolute path does not exist" do
      missing = Path.join(System.tmp_dir!(), "myfood-missing-python/bin/python3")
      refute File.exists?(missing)

      log =
        capture_log(fn ->
          assert {:error, {:python_not_found, ^missing}} =
                   OptimizerPortRunner.open_port(python_executable: missing, script_path: @stdin)
        end)

      assert log =~ missing
    end
  end

  # The test process owns the port, so it receives what `cat` writes back.
  # Closing the port closes stdin, which ends `cat`.
  defp assert_echoes(port) do
    Port.command(port, "ping\n")
    assert_receive {^port, {:data, "ping\n"}}, 2_000
    Port.close(port)
  end
end
