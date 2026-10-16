defmodule Mix.Tasks.Db.RenumberMigrationsTest do
  @moduledoc """
  `mix db.renumber_migrations` (issue #315) on a database that recorded the
  old 15-digit migration versions.

  Each test records the versions it needs inside the sandbox, so it does not
  depend on whether the test database was migrated before or after the rename.
  """
  use ExUnit.Case, async: false

  import Ecto.Query, only: [from: 2]

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Repo
  alias Mix.Tasks.Db.RenumberMigrations

  @renumbering RenumberMigrations.renumbering()
  @old_versions Enum.map(@renumbering, &elem(&1, 0))
  @new_versions Enum.map(@renumbering, &elem(&1, 1))

  setup do
    :ok = Sandbox.checkout(Repo)
    Mix.shell(Mix.Shell.Process)
    on_exit(fn -> Mix.shell(Mix.Shell.IO) end)
  end

  test "a database with the old versions recorded has none of the eleven pending after the task" do
    record_versions!(@old_versions)
    assert pending(@new_versions) == @new_versions

    RenumberMigrations.run([])

    assert_received {:mix_shell, :info, ["Rewrote 11 migration version(s) in schema_migrations."]}
    assert pending(@new_versions) == []
    assert recorded(@old_versions) == []
    assert recorded(@new_versions) == @new_versions
  end

  test "a second run changes nothing" do
    record_versions!(@old_versions)
    assert RenumberMigrations.renumber!(Repo) == 11
    after_first_run = all_recorded()

    RenumberMigrations.run([])

    assert_received {:mix_shell, :info, ["Rewrote 0 migration version(s) in schema_migrations."]}
    assert all_recorded() == after_first_run
  end

  test "a database without the old versions is left unchanged" do
    record_versions!(@new_versions)
    before = all_recorded()

    assert RenumberMigrations.renumber!(Repo) == 0
    assert all_recorded() == before
  end

  test "an old version recorded next to its new one is dropped" do
    [{old, new} | _] = @renumbering
    record_versions!([old | @new_versions])

    assert RenumberMigrations.renumber!(Repo) == 1
    assert recorded([old, new]) == [new]
  end

  # Leaves exactly `versions` recorded among the old and new versions of the
  # renumbering; every other row of schema_migrations stays as it is.
  defp record_versions!(versions) do
    Repo.delete_all(
      from(m in "schema_migrations", where: m.version in ^(@old_versions ++ @new_versions))
    )

    now = NaiveDateTime.utc_now()

    Repo.insert_all(
      "schema_migrations",
      Enum.map(versions, &%{version: &1, inserted_at: now})
    )
  end

  # The versions among `versions` that `mix ecto.migrations` lists as down.
  defp pending(versions) do
    for {:down, version, _name} <- Ecto.Migrator.migrations(Repo),
        version in versions,
        do: version
  end

  defp recorded(versions) do
    Repo.all(
      from(m in "schema_migrations",
        where: m.version in ^versions,
        order_by: m.version,
        select: m.version
      )
    )
  end

  defp all_recorded do
    Repo.all(from(m in "schema_migrations", order_by: m.version, select: m.version))
  end
end
