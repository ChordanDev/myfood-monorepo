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
  alias MealPlannerApi.Persistence.Calendar
  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Inventory.InventoryItem
  alias MealPlannerApi.Persistence.Planning
  alias MealPlannerApi.Persistence.Planning.{ContextSnapshot, CookingChatMessage, CookingSession}
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

  defp ask(f, session, message, now \\ @instant, client_message_id \\ nil) do
    CookingService.answer_question(
      f.actor,
      session.session_id,
      message,
      "text",
      now,
      client_message_id
    )
  end

  defp frozen_part(session),
    do: Repo.get!(CookingSession, session.session_id).context_snapshot["frozen"]

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
  defp ask_observing_prompt(f, session, message, now \\ @instant) do
    supervisor = start_supervised!(Task.Supervisor, id: make_ref())

    task =
      Task.Supervisor.async_nolink(supervisor, fn -> ask(f, session, message, now) end)

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

    test "a meal that is not cooked starts a fresh session after a completed one", f do
      meal = meal!(f, @utc_day)
      session = start!(f, meal)

      Repo.get!(CookingSession, session.session_id)
      |> CookingSession.changeset(%{status: :completed})
      |> Repo.update!()

      again = start!(f, meal)
      assert again.session_id != session.session_id
      assert again.status == "active"
    end

    test "an empty or oversized message is a validation error and stores nothing", f do
      session = start!(f, meal!(f, @utc_day))

      assert {:error, :validation_error} = ask(f, session, "   ")
      assert {:error, :validation_error} = ask(f, session, String.duplicate("a", 2001))
      assert stored_turns() == []
    end

    test "a message of exactly 2000 characters is accepted", f do
      session = start!(f, meal!(f, @utc_day))
      question = String.duplicate("a", 2000)

      assert {:ok, _} = ask(f, session, question)
      assert [%{role: :user, content: ^question}, %{role: :assistant}] = stored_turns()
    end
  end

  describe "a cooked meal" do
    test "start returns its finished session with the history", f do
      meal = meal!(f, @utc_day)
      session = start!(f, meal)
      assert {:ok, _} = ask(f, session, "Before cooking?")
      assert {:ok, _} = CookingService.finish_session(f.actor, session.session_id, @instant)

      reopened = start!(f, meal)
      assert reopened.session_id == session.session_id
      assert reopened.status == "completed"

      assert [%{role: "user", content: "Before cooking?"}, %{role: "assistant"}] =
               reopened.chat_messages

      assert Repo.aggregate(CookingSession, :count) == 1
      assert {:error, :cooking_already_finished} = ask(f, reopened, "After?")

      assert {:error, :cooking_already_finished} =
               CookingService.finish_session(f.actor, reopened.session_id, @instant)
    end

    test "start is still refused on another day", f do
      meal = meal!(f, @utc_day)
      session = start!(f, meal)
      assert {:ok, _} = CookingService.finish_session(f.actor, session.session_id, @instant)

      assert {:error, :cooking_chat_unavailable} =
               CookingService.start_session(f.actor, meal.id, DateTime.add(@instant, 86_400))
    end

    test "a meal set back to not cooked starts a fresh session that can finish", f do
      meal = meal!(f, @utc_day)
      session = start!(f, meal)
      assert {:ok, _} = ask(f, session, "First round?")
      assert {:ok, _} = CookingService.finish_session(f.actor, session.session_id, @instant)

      assert {:ok, _} = Calendar.set_is_cooked(f.account.id, meal.id, false)

      again = start!(f, meal)
      assert again.session_id != session.session_id
      assert again.status == "active"
      assert again.chat_messages == []
      assert {:ok, _} = CookingService.finish_session(f.actor, again.session_id, @instant)

      # Cooked again: the session that cooked it last is the one returned.
      assert start!(f, meal).session_id == again.session_id
    end
  end

  describe "idempotent ask" do
    setup do
      use_barrier_client!()
    end

    defp ask_behind_barrier(f, session, message, client_message_id) do
      supervisor = start_supervised!(Task.Supervisor, id: make_ref())

      Task.Supervisor.async_nolink(supervisor, fn ->
        ask(f, session, message, @instant, client_message_id)
      end)
    end

    test "a repeat of the same client message id returns the stored pair", f do
      session = start!(f, meal!(f, @utc_day))
      id = Ecto.UUID.generate()

      task = ask_behind_barrier(f, session, "Only once?", id)
      assert_receive {:cooking_ai, worker, "Only once?", _opts}
      send(worker, :answer)
      assert {:ok, first} = Task.await(task)

      # The provider is not asked again: the barrier would block this call.
      assert {:ok, repeat} = ask(f, session, "Only once?", @instant, id)
      refute_received {:cooking_ai, _, _, _}

      assert repeat == first
      assert [%{role: "user"}, %{role: "assistant"}] = repeat.turns
      assert Enum.map(stored_turns(), & &1.id) == Enum.map(first.turns, & &1.id)
      assert [%{client_message_id: ^id}, %{client_message_id: nil}] = stored_turns()
    end

    test "a malformed client message id is a validation error and stores nothing", f do
      session = start!(f, meal!(f, @utc_day))

      for bad <- ["not-a-uuid", "", String.duplicate("a", 16), 42] do
        assert {:error, :validation_error} = ask(f, session, "Hi", @instant, bad)
      end

      refute_received {:cooking_ai, _, _, _}
      assert stored_turns() == []
    end

    test "the same id on another session is a different question", f do
      id = Ecto.UUID.generate()

      for slot <- [:lunch, :dinner] do
        session = start!(f, meal!(f, @utc_day, slot))
        task = ask_behind_barrier(f, session, "Shared id?", id)
        assert_receive {:cooking_ai, worker, "Shared id?", _opts}
        send(worker, :answer)
        assert {:ok, _} = Task.await(task)
      end

      assert length(stored_turns()) == 4
    end

    test "two requests racing on one id store a single pair and both get it", f do
      session = start!(f, meal!(f, @utc_day))
      id = Ecto.UUID.generate()

      tasks = for _ <- 1..2, do: ask_behind_barrier(f, session, "Race?", id)

      # Both passed the lookup before either stored anything.
      workers =
        for _ <- tasks do
          assert_receive {:cooking_ai, worker, "Race?", _opts}
          worker
        end

      Enum.each(workers, &send(&1, :answer))

      assert [{:ok, winner}, {:ok, loser}] = Task.await_many(tasks)
      assert winner.turns == loser.turns
      assert Enum.map(stored_turns(), & &1.id) == Enum.map(winner.turns, & &1.id)
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
      assert first =~ "#{f.ingredient.name}: 0.75 g"
      refute first =~ "How hot?"

      second = ask_observing_prompt(f, session, "And then?")
      assert second =~ "How hot?"
      assert second =~ "Use the frozen instructions."
    end

    test "the prompt states quantities in units, not in thousandths", f do
      lot = lot!(f, f.ingredient)
      lot |> InventoryItem.changeset(%{quantity_milli: 500_000}) |> Repo.update!()
      session = start!(f, meal!(f, @utc_day))

      prompt = ask_observing_prompt(f, session, "How much?")
      # Inventory holds 500 g; the recipe asks for 0.2 g of the same ingredient.
      assert prompt =~ "#{f.ingredient.name}: 500 g"
      assert prompt =~ "#{f.ingredient.name}: 0.2 g"
      refute prompt =~ "500000"
    end

    test "the inventory is frozen on the first question, not when the session starts", f do
      lot = lot!(f, f.ingredient)
      session = start!(f, meal!(f, @utc_day))
      assert frozen_part(session) == nil

      # Changed after the screen opened the session, before anything was asked.
      lot |> InventoryItem.changeset(%{quantity_milli: 400}) |> Repo.update!()

      first = ask_observing_prompt(f, session, "What do I have?")
      assert first =~ "#{f.ingredient.name}: 0.4 g"
      assert first =~ "Inventario disponible al hacer la primera pregunta del dia:"
      refute first =~ "al empezar a cocinar"
      assert %{"captured_on" => "2026-10-08", "inventory" => [_]} = frozen_part(session)

      lot |> InventoryItem.changeset(%{quantity_milli: 10}) |> Repo.update!()

      {:ok, late} =
        Catalog.upsert_ingredient_by_name(%{
          name: "Late arrival #{Ecto.UUID.generate()}",
          category: :otros
        })

      lot!(f, late)

      second = ask_observing_prompt(f, session, "And now?")
      assert second =~ "#{f.ingredient.name}: 0.4 g"
      refute second =~ late.name
    end

    test "a meal moved to another day is frozen again on the first question there", f do
      lot = lot!(f, f.ingredient)
      meal = meal!(f, @utc_day)
      session = start!(f, meal)
      assert ask_observing_prompt(f, session, "Today?") =~ "#{f.ingredient.name}: 0.75 g"

      next_day = DateTime.add(@instant, 86_400)
      meal |> Planning.ScheduledMeal.changeset(%{date: Date.add(@utc_day, 1)}) |> Repo.update!()
      lot |> InventoryItem.changeset(%{quantity_milli: 300}) |> Repo.update!()

      moved = ask_observing_prompt(f, session, "Tomorrow?", next_day)
      assert moved =~ "#{f.ingredient.name}: 0.3 g"
      assert %{"captured_on" => "2026-10-09"} = frozen_part(session)

      lot |> InventoryItem.changeset(%{quantity_milli: 5}) |> Repo.update!()
      assert ask_observing_prompt(f, session, "Again?", next_day) =~ "#{f.ingredient.name}: 0.3 g"
    end

    test "the frozen snapshot survives step updates and stays out of the payloads", f do
      lot = lot!(f, f.ingredient)
      meal = meal!(f, @utc_day)
      session = start!(f, meal)
      refute Map.has_key?(session.snapshot, "frozen")

      assert ask_observing_prompt(f, session, "Frozen now?") =~ "#{f.ingredient.name}: 0.75 g"
      assert start!(f, meal).snapshot |> Map.has_key?("frozen") == false

      [%{id: step_id}] = session.recipe.steps

      assert {:ok, step} =
               CookingService.track_step(f.actor, session.session_id, step_id, :completed)

      refute Map.has_key?(step.snapshot, "frozen")

      assert {:ok, state} = CookingService.session_state(f.actor, session.session_id)
      refute Map.has_key?(state.snapshot, "frozen")
      assert state.snapshot["step_status"] == "completed"

      for row <- Repo.all(ContextSnapshot) do
        refute Map.has_key?(row.snapshot_data, "frozen")
      end

      lot |> InventoryItem.changeset(%{quantity_milli: 10}) |> Repo.update!()

      prompt = ask_observing_prompt(f, session, "Still frozen?")
      assert prompt =~ "#{f.ingredient.name}: 0.75 g"
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
