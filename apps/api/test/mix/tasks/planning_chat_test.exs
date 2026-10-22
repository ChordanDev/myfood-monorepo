defmodule Mix.Tasks.Planning.ChatTest do
  @moduledoc """
  `mix planning.chat` (issue #423): the whole path from the terminal, against
  a real Account, from consent to Scheduled meals saved.
  """

  use ExUnit.Case, async: false

  import Ecto.Query
  import MealPlannerApi.PlanningAgentFixtures

  alias MealPlannerApi.Persistence.Planning.{PlanningConsent, PlanningSession, ScheduledMeal}
  alias MealPlannerApi.PlanningAgent.FakeOptimizer
  alias MealPlannerApi.Repo
  alias Mix.Tasks.Planning.Chat

  setup do
    sandbox_sessions!()
    owner = household!()
    recipes_for_every_slot!(owner.account)
    %{owner: owner}
  end

  # Feeds `lines` as the input and collects the output in the test process.
  defp chat(args, lines) do
    {:ok, input} = Agent.start_link(fn -> lines end)
    test = self()

    read = fn _prompt ->
      Agent.get_and_update(input, fn
        [line | rest] when is_function(line, 0) -> {line.() <> "\n", rest}
        [line | rest] -> {line <> "\n", rest}
        [] -> {:eof, []}
      end)
    end

    outcome =
      Chat.run(args,
        input: read,
        output: &send(test, {:line, &1}),
        session: [optimizer: FakeOptimizer]
      )

    {outcome, collect([])}
  end

  defp collect(lines) do
    receive do
      {:line, line} -> collect([line | lines])
    after
      0 -> lines |> Enum.reverse() |> Enum.join("\n")
    end
  end

  defp args(owner, extra \\ []),
    do: ["--account", owner.account.id, "--user", owner.user.email, "--scripted"] ++ extra

  test "a Member gives consent, gets a plan and confirms it into Scheduled meals", %{
    owner: owner
  } do
    {outcome, output} = chat(args(owner, ["--days", "3"]), ["y", "Plan my week", "/confirm"])

    assert {:confirmed, %{meals_count: 9}} = outcome
    assert output =~ "PLACEHOLDER, pending legal review"
    assert output =~ "--- proposal"
    assert output =~ "breakfast:"
    assert output =~ "agent> (scripted) Here is a plan"
    assert output =~ "[confirmed] 9 meals saved as Scheduled meals."

    assert Repo.aggregate(
             from(m in ScheduledMeal, where: m.account_id == ^owner.account.id),
             :count
           ) ==
             9

    assert Repo.exists?(from(c in PlanningConsent, where: c.user_id == ^owner.user.id))
    assert [%PlanningSession{status: :committed, agent: true}] = Repo.all(PlanningSession)
  end

  test "a meal scheduled meanwhile refuses /confirm and the chat goes on", %{owner: owner} do
    consent!(owner.user)
    today = MealPlannerApi.AccountClock.today(owner.account.id)
    recipe = recipe!(owner.account, "Added meanwhile", ["lunch"])

    lines = [
      "Plan",
      fn -> scheduled_meal!(owner.account, recipe, today, :lunch) && "/confirm" end,
      "/quit"
    ]

    {outcome, output} = chat(args(owner), lines)

    assert outcome == :quit

    assert output =~
             "[confirm refused] meals were scheduled meanwhile on #{today} lunch"

    assert Repo.aggregate(ScheduledMeal, :count) == 1
  end

  test "a User who already consented is not asked again", %{owner: owner} do
    consent!(owner.user)

    {outcome, output} = chat(args(owner), ["Plan", "/confirm"])

    assert {:confirmed, %{meals_count: 21}} = outcome
    refute output =~ "Do you agree?"
  end

  test "declining consent leaves without planning and frees the range", %{owner: owner} do
    {outcome, output} = chat(args(owner), ["n"])

    assert outcome == :quit
    assert output =~ "Without consent the agent cannot plan."
    assert [%PlanningSession{status: :cancelled}] = Repo.all(PlanningSession)
    refute Repo.exists?(ScheduledMeal)
  end

  test "/quit cancels the session without saving", %{owner: owner} do
    consent!(owner.user)

    {outcome, _output} = chat(args(owner), ["Plan", "/quit"])

    assert outcome == :quit
    assert [%PlanningSession{status: :cancelled}] = Repo.all(PlanningSession)
    refute Repo.exists?(ScheduledMeal)
  end

  test "/confirm before any proposal says so and goes on", %{owner: owner} do
    consent!(owner.user)

    {outcome, output} = chat(args(owner), ["/confirm", "/help", "/quit"])

    assert outcome == :quit
    assert output =~ "[confirm] there is no proposal to confirm yet"
    assert output =~ "Commands: /confirm"
  end

  test "a range that is not 1 to 31 days, or someone who is not a member, is refused", %{
    owner: owner
  } do
    assert {{:error, :invalid_range}, _} = chat(args(owner, ["--days", "32"]), [])

    stranger = household!()

    assert {:error, :no_active_membership} =
             Chat.run(["--account", owner.account.id, "--user", stranger.user.email], [])

    assert {:error, "Usage: " <> _} = Chat.run(["--account", owner.account.id], [])
  end

  test "an Account that is not eligible cannot plan" do
    expired = household!(eligible: false)

    assert {{:error, :subscription_required}, output} = chat(args(expired), [])
    assert output =~ "[error] the session did not start"
  end
end
