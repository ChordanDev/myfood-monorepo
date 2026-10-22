defmodule MealPlannerApi.PlanningAgent.SessionToolsTest do
  @moduledoc """
  The four tools of the agent through a session (issue #423): recipe search
  and the optimizer never see a recipe the Participants' restrictions
  forbid, a plan is shown only when code validates it, and the Proposal
  carries its cost against the session budget.
  """

  use ExUnit.Case, async: false

  import MealPlannerApi.PlanningAgentFixtures

  alias MealPlannerApi.PlanningAgent.{FakeOptimizer, Session}
  alias MealPlannerApi.PlanningAgent.Model.Scripted

  setup do
    sandbox_sessions!()
    on_exit(&FakeOptimizer.reset!/0)
    owner = household!()
    consent!(owner.user)
    %{owner: owner}
  end

  defp start(who, script, opts \\ []) do
    {:ok, %{session_id: id, pid: pid}} =
      Session.start(
        session_attrs(who, Keyword.get(opts, :range)),
        model: {Scripted, script: script, notify: self()},
        optimizer: FakeOptimizer,
        subscriber: self()
      )

    {id, pid}
  end

  # The tool results the model got back, from the last scripted request.
  defp tool_results(request) do
    for %{role: :tool_result, name: name, content: content} <- request.messages,
        do: {name, content}
  end

  # A script that calls `calls` one by one, then ends with text, and sends
  # the request after the last call to the test.
  defp script(calls) do
    test = self()

    Enum.map(calls, &{:tool_calls, [&1]}) ++
      [
        fn request ->
          send(test, {:after_tools, request})
          {:text, "Here is your plan."}
        end
      ]
  end

  describe "search_recipes" do
    test "leaves out recipes the Participants' restrictions forbid", %{owner: owner} do
      member = member!(owner.account)
      vegetarian = member!(owner.account)
      diet!(vegetarian.user, :vegetarian)
      hard_restrictions!(member.user, ["peanut"])

      peanut = ingredient!("Peanut", ["peanut"])
      beef = ingredient!("Beef", ["meat"])
      unreviewed = ingredient!("Mystery", nil)
      shrimp = ingredient!("Shrimp", [])
      exclude!(member.user, shrimp, :allergy)
      onion = ingredient!("Onion", [])
      exclude!(member.user, onion, :dislike)

      recipe!(owner.account, "Soup peanut", ["lunch"], [peanut])
      recipe!(owner.account, "Soup beef", ["lunch"], [beef])
      recipe!(owner.account, "Soup mystery", ["lunch"], [unreviewed])
      recipe!(owner.account, "Soup shrimp", ["lunch"], [shrimp])
      recipe!(owner.account, "Soup onion", ["lunch"], [onion])
      recipe!(owner.account, "Soup tomato", ["lunch"])
      recipe!(nil, "Soup catalog", ["lunch"])
      recipe!(household!().account, "Soup of another Account", ["lunch"])

      {_id, pid} = start(owner, script([{"search_recipes", %{"query" => "soup"}}]))
      :ok = Session.send_message(pid, "Something with soup")

      assert_receive {:after_tools, request}
      assert [{"search_recipes", %{"recipes" => recipes}}] = tool_results(request)

      # A dislike is a preference: disclosed, never enforced.
      assert recipes |> Enum.map(& &1["name"]) |> Enum.sort() ==
               ["Soup catalog", "Soup onion", "Soup tomato"]

      assert request.instructions =~ "Disliked ingredients"
      assert request.instructions =~ onion.name
      assert request.instructions =~ "animal_product" == false
      assert request.instructions =~ "fish, meat, peanut"
    end

    test "an unreviewed Ingredient is allowed only when nothing is forbidden", %{owner: owner} do
      unreviewed = ingredient!("Mystery", nil)
      recipe!(owner.account, "Soup mystery", ["lunch"], [unreviewed])

      {_id, pid} = start(owner, script([{"search_recipes", %{"query" => "soup"}}]))
      :ok = Session.send_message(pid, "Soup?")

      assert_receive {:after_tools, request}

      assert [{"search_recipes", %{"recipes" => [%{"name" => "Soup mystery"}]}}] =
               tool_results(request)
    end
  end

  describe "run_optimizer and present_proposal" do
    test "plans breakfast, lunch and dinner of every day from restriction-safe candidates", %{
      owner: owner
    } do
      recipes = recipes_for_every_slot!(owner.account)
      celiac = member!(owner.account)
      diet!(celiac.user, :celiac)
      gluten = ingredient!("Flour", ["gluten"])
      recipe!(owner.account, "AAA bread", ["breakfast", "lunch", "dinner"], [gluten])

      FakeOptimizer.notify!(self())
      {id, pid} = start(owner, script([{"run_optimizer", %{}}, {"present_proposal", %{}}]))
      :ok = Session.send_message(pid, "Plan my days")

      assert_receive {:optimizer_payload, payload}
      assert payload["slots"] == ~w(breakfast lunch dinner)
      assert length(payload["days"]) == 2

      for {_slot, candidates} <- payload["candidates_by_slot"],
          do: refute(Enum.any?(candidates, &(&1["label"] == "AAA bread")))

      assert_receive {:planning_agent_event, ^id,
                      %{"type" => "proposal", "status" => "valid", "meals" => meals} = proposal}

      assert length(meals) == 6

      assert meals |> Enum.map(& &1["slot"]) |> Enum.uniq() |> Enum.sort() ==
               ~w(breakfast dinner lunch)

      assert Enum.all?(meals, &(&1["recipe_id"] == recipes[&1["slot"]].id))
      assert proposal["deviations"] == []
      assert %{"budget_cents" => _, "estimated_cost_cents" => _} = proposal["budget"]

      assert_receive {:after_tools, request}

      assert [
               {"run_optimizer", %{"status" => "ok"}},
               {"present_proposal", %{"status" => "valid"}}
             ] =
               request
               |> tool_results()
               |> Enum.map(fn {n, c} -> {n, Map.take(c, ["status"])} end)
    end

    test "a plan with a forbidden recipe is never shown; its violations go back", %{
      owner: owner
    } do
      recipes = recipes_for_every_slot!(owner.account)
      allergic = member!(owner.account)
      shrimp = ingredient!("Shrimp", [])
      exclude!(allergic.user, shrimp)
      forbidden = recipe!(owner.account, "Shrimp toast", ["lunch"], [shrimp])

      FakeOptimizer.answer!(fn payload ->
        result = FakeOptimizer.first_candidates(payload)

        meals =
          Enum.map(result["meals"], fn
            %{"slot" => "lunch"} = meal -> %{meal | "recipe_id" => forbidden.id}
            meal -> meal
          end)

        {:ok, %{result | "meals" => meals}}
      end)

      {id, pid} = start(owner, script([{"run_optimizer", %{}}, {"present_proposal", %{}}]))
      :ok = Session.send_message(pid, "Plan")

      assert_receive {:after_tools, request}

      assert [_, {"present_proposal", %{"status" => "invalid", "violations" => violations}}] =
               tool_results(request)

      assert Enum.all?(
               violations,
               &(&1["type"] == "restriction_conflict" and &1["slot"] == "lunch")
             )

      refute_received {:planning_agent_event, ^id, %{"type" => "proposal"}}
      _ = recipes
    end

    test "coverage: a plan that misses a slot or plans outside the range is invalid", %{
      owner: owner
    } do
      recipes_for_every_slot!(owner.account)

      FakeOptimizer.answer!(fn payload ->
        result = FakeOptimizer.first_candidates(payload)
        [_dropped | meals] = result["meals"]
        {:ok, %{result | "meals" => meals}}
      end)

      {_id, pid} = start(owner, script([{"run_optimizer", %{}}, {"present_proposal", %{}}]))
      :ok = Session.send_message(pid, "Plan")

      assert_receive {:after_tools, request}

      assert [_, {"present_proposal", %{"status" => "invalid", "violations" => [violation]}}] =
               tool_results(request)

      assert violation["type"] == "missing_meal"
    end

    test "an optimizer failure is a typed error to the agent and the Member, never a plan", %{
      owner: owner
    } do
      recipes_for_every_slot!(owner.account)
      FakeOptimizer.answer!({:error, :optimizer_unavailable})

      {id, pid} = start(owner, script([{"run_optimizer", %{}}, {"present_proposal", %{}}]))
      :ok = Session.send_message(pid, "Plan")

      assert_receive {:planning_agent_event, ^id,
                      %{"type" => "optimizer_failed", "reason" => "optimizer_unavailable"}}

      assert_receive {:after_tools, request}

      assert [
               {"run_optimizer", %{"error" => "optimizer_failed"}},
               {"present_proposal", %{"error" => "no_plan_to_present"}}
             ] = tool_results(request)
    end

    test "a slot without candidates is reported, not planned", %{owner: owner} do
      recipe!(owner.account, "Lunch only", ["lunch", "dinner"])

      {_id, pid} = start(owner, script([{"run_optimizer", %{}}]))
      :ok = Session.send_message(pid, "Plan")

      assert_receive {:after_tools, request}

      assert [{"run_optimizer", %{"error" => "no_candidates", "slot" => "breakfast"}}] =
               tool_results(request)
    end

    test "an Account named in the arguments is ignored: the session's is used", %{owner: owner} do
      other = household!()
      recipe!(other.account, "Soup elsewhere", ["lunch"])
      recipe!(owner.account, "Soup at home", ["lunch"])

      {_id, pid} =
        start(
          owner,
          script([{"search_recipes", %{"query" => "soup", "account_id" => other.account.id}}])
        )

      :ok = Session.send_message(pid, "Soup")

      assert_receive {:after_tools, request}

      assert [{"search_recipes", %{"recipes" => [%{"name" => "Soup at home"}]}}] =
               tool_results(request)
    end
  end

  describe "ask_human" do
    test "asks one question and ends the turn; later calls of the batch are skipped", %{
      owner: owner
    } do
      test = self()

      script = [
        {:tool_calls, [{"ask_human", %{"question" => "Any guests?"}}, {"run_optimizer", %{}}]},
        fn request ->
          send(test, {:next_turn, request})
          {:text, "ok"}
        end
      ]

      {id, pid} = start(owner, script)
      :ok = Session.send_message(pid, "Plan")

      assert_receive {:planning_agent_event, ^id,
                      %{"type" => "question", "text" => "Any guests?"}}

      assert_receive {:planning_agent_event, ^id, %{"type" => "turn_completed"}}

      :ok = Session.send_message(pid, "No guests")
      assert_receive {:next_turn, request}

      assert [
               {"ask_human", %{"status" => "asked"}},
               {"run_optimizer", %{"error" => "skipped_after_question"}}
             ] = tool_results(request)
    end
  end

  describe "budget (S9)" do
    test "the session budget is the weekly Budget x days / 7, the tier default when unset", %{
      owner: owner
    } do
      recipes_for_every_slot!(owner.account)
      today = MealPlannerApi.AccountClock.today(owner.account.id)
      FakeOptimizer.notify!(self())

      {id, pid} =
        start(owner, script([{"run_optimizer", %{}}, {"present_proposal", %{}}]),
          range: {today, Date.add(today, 2)}
        )

      :ok = Session.send_message(pid, "Plan")

      # 45_000 (the tier default) x 3 / 7, rounded.
      assert_receive {:optimizer_payload, %{"constraints" => %{"weekly_budget_cents" => 19_286}}}

      assert_receive {:planning_agent_event, ^id,
                      %{"type" => "proposal", "budget" => %{"budget_cents" => 19_286}}}
    end

    test "uses the Account's Budget when set", %{owner: _owner} do
      owner = household!(budget_cents: 70_000)
      consent!(owner.user)
      recipes_for_every_slot!(owner.account)
      FakeOptimizer.notify!(self())

      {_id, pid} = start(owner, script([{"run_optimizer", %{}}]))
      :ok = Session.send_message(pid, "Plan")

      # 70_000 x 2 / 7.
      assert_receive {:optimizer_payload, %{"constraints" => %{"weekly_budget_cents" => 20_000}}}
    end

    test "never falls under the owner's minimum", %{owner: owner} do
      previous = Application.get_env(:meal_planner_api, :min_weekly_budget_per_person_cents)
      Application.put_env(:meal_planner_api, :min_weekly_budget_per_person_cents, 70_000)

      on_exit(fn ->
        Application.put_env(:meal_planner_api, :min_weekly_budget_per_person_cents, previous)
      end)

      recipes_for_every_slot!(owner.account)
      FakeOptimizer.notify!(self())

      {_id, pid} = start(owner, script([{"run_optimizer", %{}}]))
      :ok = Session.send_message(pid, "Plan")

      assert_receive {:optimizer_payload, %{"constraints" => %{"weekly_budget_cents" => 20_000}}}
    end
  end
end
