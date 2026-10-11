defmodule MealPlannerApi.Services.CookingChatTest do
  @moduledoc """
  Cooking chat for today's meal (issue #36): turn persistence, recovery through
  the session read, availability gates and the frozen Context snapshot. "Today"
  is the Account's day (`AccountClock`), so every test passes its instant.
  """
  use MealPlannerApiWeb.ConnCase, async: false

  import Ecto.Query
  import MealPlannerApi.IdentityFixtures

  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Inventory.InventoryItem
  alias MealPlannerApi.Persistence.Planning
  alias MealPlannerApi.Persistence.Planning.{CookingChatMessage, CookingSession}
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.CookingService

  # 23:30 UTC on the 8th is already the 9th in Auckland (UTC+13 in October).
  @instant ~U[2026-10-08 23:30:00Z]
  @utc_day ~D[2026-10-08]
  @auckland_day ~D[2026-10-09]

  setup do
    %{user: user, account: account} = insert_identity!(plan: :family_4)
    account = MealPlannerApiWeb.ChannelHelpers.persist_trial_window!(account, :eligible)

    {:ok, recipe} =
      Catalog.create_recipe(%{
        account_id: account.id,
        created_by_user_id: user.id,
        name: "Chat stew",
        source: :user_created,
        servings: 2,
        suitable_for_slots: [:dinner]
      })

    {:ok, _step} =
      Catalog.add_recipe_step(%{
        recipe_id: recipe.id,
        step_number: 1,
        instructions: "Brown the onions"
      })

    {:ok, ingredient} =
      Catalog.upsert_ingredient_by_name(%{
        name: "Chat onion #{Ecto.UUID.generate()}",
        category: :verduras
      })

    {:ok, _} =
      Catalog.add_recipe_ingredient(%{
        recipe_id: recipe.id,
        ingredient_id: ingredient.id,
        quantity_milli: 200,
        unit: :g
      })

    {:ok,
     user: user,
     account: account,
     recipe: recipe,
     ingredient: ingredient,
     actor: %{id: user.id, account_id: account.id, plan: :family_4}}
  end

  defp set_timezone!(account, timezone) do
    account |> Account.changeset(%{timezone: timezone}) |> Repo.update!()
  end

  defp meal!(f, date, slot \\ :dinner) do
    {:ok, meal} =
      Planning.schedule_meal(%{
        account_id: f.account.id,
        date: date,
        slot: slot,
        recipe_id: f.recipe.id
      })

    meal
  end

  defp lot!(f, ingredient, attrs \\ %{}) do
    %InventoryItem{}
    |> InventoryItem.changeset(
      Map.merge(
        %{
          account_id: f.account.id,
          ingredient_id: ingredient.id,
          quantity_milli: 750,
          unit: :g,
          source_kind: :planned,
          last_mutation_at: DateTime.utc_now(),
          expired_at: ~U[2026-10-20 12:00:00Z]
        },
        attrs
      )
    )
    |> Repo.insert!()
  end

  defp start!(f, meal, now \\ @instant) do
    {:ok, session} = CookingService.start_session(f.actor, meal.id, now)
    session
  end

  defp ask(f, session, message, now \\ @instant),
    do: CookingService.answer_question(f.actor, session.session_id, message, "text", now)

  defp stored_turns do
    Repo.all(from(m in CookingChatMessage, order_by: [asc: m.inserted_at]))
  end

  defp use_barrier_client! do
    previous = Application.get_env(:meal_planner_api, :ai_client)
    Application.put_env(:meal_planner_api, :ai_client, MealPlannerApi.CookingBarrierClient)
    Application.put_env(:meal_planner_api, :cooking_test_owner, self())

    on_exit(fn ->
      Application.put_env(:meal_planner_api, :ai_client, previous)
      Application.delete_env(:meal_planner_api, :cooking_test_owner)
    end)
  end

  # Asks through the barrier client and returns the system prompt it received.
  defp ask_observing_prompt(f, session, message) do
    supervisor = start_supervised!(Task.Supervisor, id: make_ref())

    task =
      Task.Supervisor.async_nolink(supervisor, fn -> ask(f, session, message) end)

    assert_receive {:cooking_ai, worker, ^message, opts}
    send(worker, :answer)
    assert {:ok, _} = Task.await(task)
    opts[:system_prompt]
  end

  describe "persistence and recovery" do
    test "ask persists the user turn then the assistant turn", f do
      session = start!(f, meal!(f, @utc_day))

      assert {:ok, reply} = ask(f, session, "How hot?")
      assert reply.session_id == session.session_id
      assert reply.content_type == "text"
      assert is_binary(reply.message)

      assert [user_turn, assistant_turn] = stored_turns()
      assert {user_turn.role, user_turn.content} == {:user, "How hot?"}
      assert user_turn.user_id == f.user.id
      assert {assistant_turn.role, assistant_turn.content} == {:assistant, reply.message}
      assert DateTime.compare(user_turn.inserted_at, assistant_turn.inserted_at) == :lt

      assert [%{role: "user"}, %{role: "assistant"}] = reply.turns
      assert Enum.map(reply.turns, & &1.id) == [user_turn.id, assistant_turn.id]
    end

    test "the session read returns the full history, oldest first", f do
      session = start!(f, meal!(f, @utc_day))

      assert {:ok, %{chat_messages: []}} =
               CookingService.session_state(f.actor, session.session_id)

      for question <- ["First?", "Second?", "Third?"] do
        assert {:ok, _} = ask(f, session, question)
      end

      assert {:ok, %{chat_messages: history}} =
               CookingService.session_state(f.actor, session.session_id)

      assert Enum.map(history, & &1.role) == ~w(user assistant user assistant user assistant)

      assert history |> Enum.filter(&(&1.role == "user")) |> Enum.map(& &1.content) ==
               ["First?", "Second?", "Third?"]

      for item <- history do
        assert Map.keys(item) |> Enum.sort() == [:content, :id, :inserted_at, :role]
        assert %DateTime{} = item.inserted_at
      end

      assert history == Enum.sort_by(history, & &1.inserted_at, DateTime)
    end

    test "starting the same meal again returns the same session with its history", f do
      meal = meal!(f, @utc_day)
      session = start!(f, meal)
      assert {:ok, _} = ask(f, session, "Still there?")

      again = start!(f, meal)
      assert again.session_id == session.session_id

      assert [%{role: "user", content: "Still there?"}, %{role: "assistant"}] =
               again.chat_messages

      assert Repo.aggregate(CookingSession, :count) == 1
    end

    test "a finished session is not reused by a new start", f do
      meal = meal!(f, @utc_day)
      session = start!(f, meal)

      Repo.get!(CookingSession, session.session_id)
      |> CookingSession.changeset(%{status: :completed})
      |> Repo.update!()

      assert start!(f, meal).session_id != session.session_id
    end

    test "an empty or oversized message is a validation error and stores nothing", f do
      session = start!(f, meal!(f, @utc_day))

      assert {:error, :validation_error} = ask(f, session, "   ")
      assert {:error, :validation_error} = ask(f, session, String.duplicate("a", 2001))
      assert stored_turns() == []
    end
  end

  describe "availability" do
    test "a meal that is no longer on the Account's today is cooking_chat_unavailable", f do
      session = start!(f, meal!(f, @utc_day))

      assert {:error, :cooking_chat_unavailable} =
               ask(f, session, "Tomorrow?", DateTime.add(@instant, 86_400))

      assert stored_turns() == []
    end

    test "today follows the Account's timezone, not UTC", f do
      set_timezone!(f.account, "Pacific/Auckland")
      session = start!(f, meal!(f, @auckland_day))

      # Same UTC day (the 8th), but still the 8th in Auckland: not the meal's day.
      assert {:error, :cooking_chat_unavailable} =
               ask(f, session, "Early?", ~U[2026-10-08 10:00:00Z])

      assert stored_turns() == []
      assert {:ok, _} = ask(f, session, "Now?", @instant)
    end

    test "a finished session is cooking_already_finished, even on another day", f do
      session = start!(f, meal!(f, @utc_day))
      assert {:ok, _} = CookingService.finish_session(f.actor, session.session_id, @instant)

      assert {:error, :cooking_already_finished} = ask(f, session, "Done?")

      assert {:error, :cooking_already_finished} =
               ask(f, session, "Done?", DateTime.add(@instant, 86_400))

      assert stored_turns() == []
    end

    test "an unknown or malformed session id is session_not_found", f do
      assert {:error, :session_not_found} = ask(f, %{session_id: Ecto.UUID.generate()}, "Hi")
      assert {:error, :session_not_found} = ask(f, %{session_id: "not-a-uuid"}, "Hi")
    end

    test "another Account can neither read nor ask", f do
      session = start!(f, meal!(f, @utc_day))
      assert {:ok, _} = ask(f, session, "Mine?")

      %{user: other_user, account: other} = insert_identity!(plan: :family_4)
      other = MealPlannerApiWeb.ChannelHelpers.persist_trial_window!(other, :eligible)
      stranger = %{f | actor: %{id: other_user.id, account_id: other.id, plan: :family_4}}

      assert {:error, :session_not_found} =
               CookingService.session_state(stranger.actor, session.session_id)

      assert {:error, :session_not_found} = ask(stranger, session, "Yours?")
      assert length(stored_turns()) == 2
    end
  end

  describe "Context snapshot" do
    setup do
      use_barrier_client!()
    end

    test "the prompt carries the frozen recipe, inventory and prior turns", f do
      lot!(f, f.ingredient)
      session = start!(f, meal!(f, @utc_day))

      first = ask_observing_prompt(f, session, "How hot?")
      assert first =~ "Chat stew"
      assert first =~ "Brown the onions"
      assert first =~ "#{f.ingredient.name}: 750 g"
      refute first =~ "How hot?"

      second = ask_observing_prompt(f, session, "And then?")
      assert second =~ "How hot?"
      assert second =~ "Use the frozen instructions."
    end

    test "inventory changed after the start does not change the prompt", f do
      lot = lot!(f, f.ingredient)
      session = start!(f, meal!(f, @utc_day))

      lot |> InventoryItem.changeset(%{quantity_milli: 10}) |> Repo.update!()

      {:ok, late} =
        Catalog.upsert_ingredient_by_name(%{
          name: "Late arrival #{Ecto.UUID.generate()}",
          category: :otros
        })

      lot!(f, late)

      prompt = ask_observing_prompt(f, session, "What do I have?")
      assert prompt =~ "#{f.ingredient.name}: 750 g"
      refute prompt =~ late.name
    end

    test "the frozen snapshot survives step updates and stays out of the payloads", f do
      lot!(f, f.ingredient)
      meal = meal!(f, @utc_day)
      session = start!(f, meal)
      refute Map.has_key?(session.snapshot, "frozen")

      [%{id: step_id}] = session.recipe.steps

      assert {:ok, step} =
               CookingService.track_step(f.actor, session.session_id, step_id, :completed)

      refute Map.has_key?(step.snapshot, "frozen")

      assert {:ok, state} = CookingService.session_state(f.actor, session.session_id)
      refute Map.has_key?(state.snapshot, "frozen")
      assert state.snapshot["step_status"] == "completed"

      prompt = ask_observing_prompt(f, session, "Still frozen?")
      assert prompt =~ "#{f.ingredient.name}: 750 g"
      assert prompt =~ "Paso actual 1: Brown the onions."
    end

    test "an answer that arrives after the session finished is not stored", f do
      session = start!(f, meal!(f, @utc_day))
      supervisor = start_supervised!(Task.Supervisor)

      task =
        Task.Supervisor.async_nolink(supervisor, fn -> ask(f, session, "Too late?") end)

      assert_receive {:cooking_ai, worker, "Too late?", _opts}
      assert {:ok, _} = CookingService.finish_session(f.actor, session.session_id, @instant)
      send(worker, :answer)

      assert {:error, :cooking_already_finished} = Task.await(task)
      assert stored_turns() == []
    end
  end

  test "the canned fallback is stored as the assistant turn when the AI fails", f do
    previous = Application.get_env(:meal_planner_api, :ai_client)
    Application.put_env(:meal_planner_api, :ai_client, nil)
    on_exit(fn -> Application.put_env(:meal_planner_api, :ai_client, previous) end)

    session = start!(f, meal!(f, @utc_day))
    assert {:ok, reply} = ask(f, session, "Le falta sal?")
    assert reply.message =~ "Agrega sal gradualmente"
    assert [%{role: :user}, %{role: :assistant, content: content}] = stored_turns()
    assert content == reply.message
  end
end
