defmodule MealPlannerApi.MigrationVersionsTest do
  @moduledoc """
  Every migration carries the 14-digit `YYYYMMDDHHMMSS` version that
  `mix ecto.gen.migration` produces (issue #315). Ecto orders versions as
  integers, so a longer version sorts after every 14-digit migration whatever
  its date, and a migration added later could sort before the table it alters.
  """
  use ExUnit.Case, async: true

  alias Mix.Tasks.Db.RenumberMigrations

  @migrations_dir Path.expand("../../priv/repo/migrations", __DIR__)

  test "every migration file has a 14-digit version" do
    offending =
      @migrations_dir
      |> File.ls!()
      |> Enum.reject(&Regex.match?(~r/\A\d{14}_\w+\.exs\z/, &1))

    assert offending == [],
           "migrations without a 14-digit version: #{inspect(offending)}. " <>
             "Generate migrations with `mix ecto.gen.migration`."
  end

  test "the renumbered migrations keep their applied order" do
    {old_versions, new_versions} = Enum.unzip(RenumberMigrations.renumbering())
    file_versions = file_versions()

    assert old_versions == Enum.sort(old_versions)
    assert new_versions == Enum.sort(new_versions)
    assert Enum.all?(new_versions, &(&1 in file_versions))
    refute Enum.any?(old_versions, &(&1 in file_versions))
  end

  defp file_versions do
    for file <- File.ls!(@migrations_dir),
        [version] <- [Regex.run(~r/\A\d+/, file)],
        do: String.to_integer(version)
  end
end
