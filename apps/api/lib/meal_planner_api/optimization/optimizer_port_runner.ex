defmodule MealPlannerApi.Optimization.OptimizerPortRunner do
  @moduledoc """
  Spawns the Python optimizer subprocess via Port.

  Production uses `{:spawn_executable, python}` + `args: [script_path]`,
  which avoids shell interpolation entirely. `:spawn_executable` does not
  search `PATH`, so the configured executable is resolved to a path first
  (see `open_port/1`); when that path is missing or is not an executable file
  the runner answers `{:error, {:python_not_found, name}}` instead of
  raising. Tests inject a custom runner through
  `:meal_planner_api, :optimizer_port_runner` to drive the GenServer
  lifecycle without spawning a real Python process.
  """

  require Logger

  @doc """
  Opens a Port to the configured Python executable running `optimizador.py`.

  ## Options

    * `:python_executable` — overrides `:optimizer_python` app config
    * `:script_path` — overrides `:optimizer_script_path` app config

  The executable is resolved before spawning:

    * a bare name (`"python3"`) is looked up on `PATH`
    * a relative path with a directory component (`"venv/bin/python"`) is
      expanded against the working directory
    * an absolute path is kept

  Returns `{:ok, port}` on success, `{:error, {:python_not_found, name}}`
  (`name` being the configured value) when the resolved path is missing or
  is not an executable file, or `{:error, :spawn_failed}` if Erlang could
  not start the subprocess.
  """
  @spec open_port(keyword()) ::
          {:ok, port()} | {:error, :spawn_failed | {:python_not_found, String.t()}}
  def open_port(opts \\ []) do
    python_executable = Keyword.get(opts, :python_executable, default_python())
    script_path = Keyword.get(opts, :script_path, default_script_path())

    case resolve_executable(python_executable) do
      nil ->
        Logger.error(
          "Optimizer Python executable not found or not executable: " <>
            "#{inspect(python_executable)}. Install Python 3, or point the " <>
            ":optimizer_python application setting at an executable " <>
            "(config/dev.exs reads it from the OPTIMIZER_PYTHON environment variable)."
        )

        {:error, {:python_not_found, python_executable}}

      executable ->
        spawn_port(executable, script_path)
    end
  end

  @doc """
  Returns the configured Python executable (defaults to `"python3"`).
  """
  @spec default_python() :: String.t()
  def default_python do
    Application.get_env(:meal_planner_api, :optimizer_python, "python3")
  end

  @doc """
  Returns the absolute path to `optimizador.py`, defaulting to
  `optimizer/optimizador.py` under the application root (`apps/api`).
  """
  @spec default_script_path() :: String.t()
  def default_script_path do
    Application.get_env(
      :meal_planner_api,
      :optimizer_script_path,
      Path.expand("../../../optimizer/optimizador.py", __DIR__)
    )
  end

  defp spawn_port(executable, script_path) do
    port =
      Port.open(
        {:spawn_executable, executable},
        [
          :binary,
          :exit_status,
          :use_stdio,
          :stderr_to_stdout,
          args: [script_path]
        ]
      )

    case Port.info(port, :name) do
      {:name, name} when is_list(name) and name != [] -> {:ok, port}
      _ -> {:error, :spawn_failed}
    end
  end

  # Only a bare name goes through the `PATH` lookup. A name with a directory
  # component is expanded first: `System.find_executable/1` would otherwise
  # join a relative path to every `PATH` entry, and `"bin/python3"` must mean
  # the file under the working directory, as it did for `:spawn_executable`.
  defp resolve_executable(name) do
    case Path.split(name) do
      [_bare] -> System.find_executable(name)
      _ -> name |> Path.expand() |> System.find_executable()
    end
  end
end
