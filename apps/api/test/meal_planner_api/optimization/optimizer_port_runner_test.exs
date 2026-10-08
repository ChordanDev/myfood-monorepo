defmodule MealPlannerApi.Optimization.OptimizerPortRunnerTest do
  @moduledoc """
  Executable resolution in `OptimizerPortRunner.open_port/1`.

  The tests never depend on Python being installed: they spawn `cat -`, which
  is present on every machine that runs the suite. It copies stdin to stdout
  until the port closes, so the process is still alive when `open_port/1`
  checks the port (a program that exits at once is reported as
  `:spawn_failed`), and the echo proves which executable was spawned.

  Paths that must exist, or must not, live in the test's own `:tmp_dir`,
  which ExUnit empties before the test and creates under the working
  directory, so nothing depends on what else that directory holds.
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

    @tag :tmp_dir
    test "expands a relative path with a directory component against the working directory",
         %{tmp_dir: tmp_dir} do
      # The name is on no PATH entry, so an echo can only come from this file.
      relative = Path.relative_to_cwd(write_echo_script!(tmp_dir, "fake-python"))
      assert Path.type(relative) == :relative

      assert {:ok, port} =
               OptimizerPortRunner.open_port(python_executable: relative, script_path: @stdin)

      assert_echoes(port)
    end

    @tag :tmp_dir
    test "does not look up a relative path with a directory component on PATH",
         %{tmp_dir: tmp_dir} do
      # `cat` is on PATH, but this names a file in the empty tmp directory.
      absent = "./" <> Path.relative_to_cwd(Path.join(tmp_dir, "cat"))

      log =
        capture_log(fn ->
          assert {:error, {:python_not_found, ^absent}} =
                   OptimizerPortRunner.open_port(python_executable: absent, script_path: @stdin)
        end)

      assert log =~ inspect(absent)
    end

    test "answers :python_not_found and logs how to fix it when a bare name is not on PATH" do
      name = "myfood-missing-python-#{System.unique_integer([:positive])}"

      log =
        capture_log(fn ->
          assert {:error, {:python_not_found, ^name}} =
                   OptimizerPortRunner.open_port(python_executable: name, script_path: @stdin)
        end)

      assert log =~ "[error]"
      assert log =~ "not found or not executable"
      assert log =~ name
      assert log =~ ":optimizer_python"
    end

    @tag :tmp_dir
    test "answers :python_not_found when an absolute path does not exist", %{tmp_dir: tmp_dir} do
      missing = Path.join(tmp_dir, "python3")
      assert Path.type(missing) == :absolute

      log =
        capture_log(fn ->
          assert {:error, {:python_not_found, ^missing}} =
                   OptimizerPortRunner.open_port(python_executable: missing, script_path: @stdin)
        end)

      assert log =~ missing
    end

    @tag :tmp_dir
    test "answers :python_not_found when the path is a file that is not executable",
         %{tmp_dir: tmp_dir} do
      not_executable = Path.join(tmp_dir, "python3")
      File.write!(not_executable, "#!/bin/sh\n")
      File.chmod!(not_executable, 0o644)

      log =
        capture_log(fn ->
          assert {:error, {:python_not_found, ^not_executable}} =
                   OptimizerPortRunner.open_port(
                     python_executable: not_executable,
                     script_path: @stdin
                   )
        end)

      assert log =~ "not found or not executable"
      assert log =~ not_executable
    end
  end

  # An executable under a name of the test's own that behaves like `cat`.
  # A script rather than a symlink to `cat`: a multi-call binary picks its
  # behavior from the name it is invoked by.
  defp write_echo_script!(dir, name) do
    path = Path.join(dir, name)
    File.write!(path, "#!/bin/sh\nexec cat \"$@\"\n")
    File.chmod!(path, 0o755)
    path
  end

  # The test process owns the port, so it receives what `cat` writes back.
  # Closing the port closes stdin, which ends `cat`.
  defp assert_echoes(port) do
    Port.command(port, "ping\n")
    assert_receive {^port, {:data, "ping\n"}}, 2_000
    Port.close(port)
  end
end
