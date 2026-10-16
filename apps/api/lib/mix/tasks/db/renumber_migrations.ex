defmodule Mix.Tasks.Db.RenumberMigrations do
  @moduledoc """
  Rewrites the `schema_migrations` rows of the eleven migrations renumbered
  in issue #315.

  Those migrations had 15-digit versions, which Ecto sorts after every
  14-digit one, so a new migration could sort before the table it alters.
  They were renamed to 14-digit versions that keep the order a fresh database
  applies. A database that already applied them still records the old
  versions, and `mix ecto.migrate` would try to run them again. Run this task
  once on such a database, before `mix ecto.migrate`:

      mix db.renumber_migrations

  The rewrite runs in one transaction. It is idempotent: on a database without
  the old versions (a fresh one, or one already rewritten) it changes nothing.
  """

  use Mix.Task

  @shortdoc "Rewrites the 15-digit migration versions to their 14-digit ones"

  # Old 15-digit version => new 14-digit version, in applied order.
  @renumbering [
    {202_603_311_900_000, 20_261_015_130_000},
    {202_603_312_000_000, 20_261_015_130_001},
    {202_603_312_000_001, 20_261_015_130_002},
    {202_603_312_000_002, 20_261_015_130_003},
    {202_603_312_000_003, 20_261_015_130_004},
    {202_606_070_000_000, 20_261_015_130_005},
    {202_610_081_300_000, 20_261_015_130_006},
    {202_610_101_200_000, 20_261_015_130_007},
    {202_610_142_300_000, 20_261_015_130_008},
    {202_610_150_000_000, 20_261_015_130_009},
    {202_610_150_000_100, 20_261_015_130_010}
  ]

  @impl true
  def run(_args) do
    Mix.Task.run("app.config")

    {:ok, rewritten, _apps} =
      Ecto.Migrator.with_repo(MealPlannerApi.Repo, fn repo -> renumber!(repo) end)

    Mix.shell().info("Rewrote #{rewritten} migration version(s) in schema_migrations.")
  end

  @doc "Old version => new version for every renumbered migration, in applied order."
  @spec renumbering() :: [{pos_integer(), pos_integer()}]
  def renumbering, do: @renumbering

  @doc """
  Rewrites every old version recorded in the repo's migration table to its new
  one, in one transaction. Returns how many rows it rewrote.
  """
  @spec renumber!(Ecto.Repo.t()) :: non_neg_integer()
  def renumber!(repo) do
    source = repo.config()[:migration_source] || "schema_migrations"

    {:ok, rewritten} =
      repo.transaction(fn ->
        if table_exists?(repo, source), do: rewrite_all!(repo, source), else: 0
      end)

    rewritten
  end

  defp rewrite_all!(repo, source) do
    Enum.reduce(@renumbering, 0, fn {old, new}, count ->
      count + rewrite!(repo, source, old, new)
    end)
  end

  defp table_exists?(repo, source) do
    %{rows: [[regclass]]} = repo.query!("SELECT to_regclass($1)::text", [source])
    regclass != nil
  end

  # When the new version is already recorded, the old row is only a leftover:
  # drop it instead of colliding with the primary key.
  defp rewrite!(repo, source, old, new) do
    %{num_rows: updated} =
      repo.query!(
        """
        UPDATE "#{source}" SET version = $2
        WHERE version = $1
          AND NOT EXISTS (SELECT 1 FROM "#{source}" WHERE version = $2)
        """,
        [old, new]
      )

    %{num_rows: deleted} =
      repo.query!(~s(DELETE FROM "#{source}" WHERE version = $1), [old])

    updated + deleted
  end
end
