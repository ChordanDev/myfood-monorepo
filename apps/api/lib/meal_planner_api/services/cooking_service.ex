defmodule MealPlannerApi.Services.CookingService do
  @moduledoc """
  Runtime cooking orchestration with contextual AI assistant.

  Coordinates:
  - Session lifecycle (start, state, finish)
  - Step tracking with snapshot persistence
  - Cooking chat: AI answers built from the frozen Context snapshot and the
    session's prior turns, with both turns of every answered question stored
  - Inventory deduction on session completion

  Stateless service — all DB via PlanningRepo and InventoryRepo.
  """

  alias MealPlannerApi.AccountClock
  alias MealPlannerApi.AI
  alias MealPlannerApi.Data.{InventoryRepo, PlanningRepo}
  alias MealPlannerApi.Inventory.LotFreshness
  alias MealPlannerApi.Persistence.Planning
  alias MealPlannerApi.Persistence.Planning.CookingChatMessage
  alias MealPlannerApi.Persistence.Shopping
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.{RecipeAccess, RecipeVersions}

  @type step_status :: :started | :paused | :completed | :error

  # Key of the frozen recipe-and-inventory state inside
  # `cooking_sessions.context_snapshot`. The first question of the Account's
  # day writes it and it is never serialized: the step state around it is what
  # clients read.
  @frozen_key "frozen"

  @max_question_length 2000
  # Questions an Account may ask the model per day (`AccountClock`).
  @daily_question_limit 100
  # How long a question stored before the model call keeps its place in the
  # day while it waits for its answer. Longer than any model call, so only a
  # question whose request died before its answer gives its place up.
  @reservation_seconds 120

  # First key of the two-key advisory lock form for the Account chat lock;
  # `DeviceSessions` and `EmailCodeLogin` take that form under their own keys.
  @chat_lock_namespace 0x4348_4154
  # Prior turns replayed to the model, newest last.
  @prompt_history_turns 20

  # -------------------------------------------------------------------------
  # Session lifecycle
  # -------------------------------------------------------------------------

  @doc """
  Starts a Cooking session for a Scheduled meal of the Account.

  A meal is eligible only on the Account's today (`AccountClock`), judged at
  `now`, so moving a meal to today makes it eligible. Any other day is
  `{:error, :cooking_chat_unavailable}`.

  A meal that is not cooked has one active session: starting it again returns
  that session, with its chat history, instead of creating another, and a meal
  with no active session gets a new one.

  A cooked meal never gets an active session. It returns the finished session
  that cooked it, so its conversation can still be read. A meal marked cooked
  outside a session has none: it is `{:error, :cooking_already_finished}` and
  no session is created.
  """
  @spec start_session(map(), binary(), DateTime.t()) :: {:ok, map()} | {:error, term()}
  def start_session(current_user, scheduled_meal_id, now \\ DateTime.utc_now())
      when is_binary(scheduled_meal_id) do
    with {:ok, ids} <- RecipeAccess.authorize(current_user),
         {:ok, meal_id} <- cast_id(scheduled_meal_id, :scheduled_meal_not_found),
         meal when not is_nil(meal) <-
           PlanningRepo.get_scheduled_meal_for_account(ids.account_id, meal_id),
         :ok <- planned_meal(meal, ids.account_id),
         :ok <- meal_is_today(meal, ids.account_id, now),
         {:ok, session} <- find_or_create_session(ids, meal) do
      snapshot = PlanningRepo.latest_context_snapshot(session.id)
      # Preload scheduled_meal on session for serialization
      session = PlanningRepo.get_cooking_session_for_account(ids.account_id, session.id)
      {:ok, serialize_session_payload(session, snapshot)}
    else
      nil -> {:error, :scheduled_meal_not_found}
      {:error, %Ecto.Changeset{}} -> {:error, :validation_error}
      {:error, _} = error -> error
    end
  end

  @spec session_state(map(), binary()) :: {:ok, map()} | {:error, term()}
  def session_state(current_user, session_id) when is_binary(session_id) do
    with {:ok, ids} <- RecipeAccess.authorize(current_user),
         {:ok, session_id} <- cast_id(session_id, :session_not_found),
         session when not is_nil(session) <-
           PlanningRepo.get_cooking_session_for_account(ids.account_id, session_id),
         :ok <- planned_meal(session.scheduled_meal, ids.account_id) do
      snapshot = PlanningRepo.latest_context_snapshot(session.id)
      {:ok, serialize_session_payload(session, snapshot)}
    else
      nil -> {:error, :session_not_found}
      {:error, _} = error -> error
    end
  end

  @doc """
  Finishes a Cooking session atomically: the meal is marked cooked, the
  recipe's Ingredients are consumed from Inventory oldest lot first (clamped at
  zero), and the meal's open Shopping items are removed.

  Returns the meal, one mutation per lot touched and one shortage per
  Ingredient the stock could not cover. A session that already finished, or a
  meal that is already cooked, is `{:error, :cooking_already_finished}` and
  changes nothing. Lot usability uses the Account's today at `now`.
  """
  @spec finish_session(map(), binary(), DateTime.t()) :: {:ok, map()} | {:error, term()}
  def finish_session(current_user, session_id, now \\ DateTime.utc_now())
      when is_binary(session_id) do
    with {:ok, ids} <- RecipeAccess.authorize(current_user),
         {:ok, session_id} <- cast_id(session_id, :session_not_found) do
      persist_finish(ids, session_id, AccountClock.today(ids.account_id, now))
    end
  end

  # -------------------------------------------------------------------------
  # Step tracking
  # -------------------------------------------------------------------------

  @spec track_step(map(), binary(), binary(), step_status(), map()) ::
          {:ok, map()} | {:error, term()}
  def track_step(current_user, session_id, recipe_step_id, status, extra \\ %{})
      when is_binary(session_id) and is_binary(recipe_step_id) and
             status in [:started, :paused, :completed, :error] do
    with {:ok, ids} <- RecipeAccess.authorize(current_user),
         {:ok, session_id} <- cast_id(session_id, :session_not_found),
         session when not is_nil(session) <-
           PlanningRepo.get_cooking_session_for_account(ids.account_id, session_id),
         :ok <- active_session(session),
         true <- belongs_to_recipe?(session, recipe_step_id),
         {:ok, event} <-
           PlanningRepo.add_step_event(%{
             cooking_session_id: session.id,
             recipe_step_id: recipe_step_id,
             event_type: status,
             event_at: DateTime.utc_now()
           }),
         snapshot_data <- build_snapshot_data(session, recipe_step_id, status, extra),
         {:ok, snapshot} <-
           PlanningRepo.add_context_snapshot(%{
             cooking_session_id: session.id,
             snapshot_data: snapshot_data,
             captured_at: DateTime.utc_now()
           }) do
      {:ok,
       %{
         session_id: session.id,
         recipe_step_id: recipe_step_id,
         status: Atom.to_string(event.event_type),
         snapshot: snapshot.snapshot_data
       }}
    else
      nil -> {:error, :session_not_found}
      false -> {:error, :recipe_step_not_found}
      {:error, %Ecto.Changeset{}} -> {:error, :validation_error}
      {:error, _} = error -> error
    end
  end

  # -------------------------------------------------------------------------
  # Chat / AI answers
  # -------------------------------------------------------------------------

  @doc """
  Answers a Cooking chat question and stores both turns.

  `client_message_id` is the UUID the client gave the question; a malformed
  one is `:validation_error`. A repeat of an id the session already stored is
  answered first, before any gate: with the same question it returns the
  stored pair, even after the session finished or the meal left today, and
  with another question it is `:cooking_message_id_conflict`. The provider is
  not called and nothing is written.

  Refusals of a new question, in order: an unknown session is
  `:session_not_found`, a finished one `:cooking_already_finished`, a meal
  that is not on the Account's today at `now` `:cooking_chat_unavailable`, and
  an Account that already stored #{@daily_question_limit} questions that day
  `:cooking_chat_limit_reached`. The limit is counted again under a lock of
  the Account, where the question is stored as unanswered before the
  provider is called, so questions asked together are refused
  `:cooking_chat_limit_reached` before any provider call once the day is
  full. A resend of an id whose question is still being answered is
  `:cooking_message_id_conflict`. No lock is held during the provider call.

  The answer is built from the frozen Context snapshot and the prior answered
  turns. It is stored and the question marked answered; when the session
  finished meanwhile, the question is deleted and nothing is stored.

  When the provider fails, the question is deleted, so it does not count
  towards the limit, and the canned fallback is answered without being
  stored: a resend of the same id asks the provider again. Its turns carry
  fresh ids that no session read returns. A question whose request died
  before its answer stops counting #{@reservation_seconds} seconds after it
  was asked.

  The Context snapshot is frozen by the first question of the Account's day
  and reused by the later ones.
  """
  @spec answer_question(map(), binary(), binary(), String.t(), DateTime.t(), term()) ::
          {:ok, map()} | {:error, term()}
  def answer_question(
        current_user,
        session_id,
        message,
        content_type \\ "text",
        now \\ DateTime.utc_now(),
        client_message_id \\ nil
      )
      when is_binary(session_id) and is_binary(message) and is_binary(content_type) do
    with {:ok, ids} <- RecipeAccess.authorize(current_user),
         {:ok, question} <- chat_question(message),
         {:ok, message_id} <- cast_client_message_id(client_message_id),
         {:ok, session} <- account_session(ids, session_id) do
      case stored_pair(session.id, message_id) do
        nil -> ask_new(current_user, ids, session, {question, message_id}, content_type, now)
        turns -> replay(session.id, turns, question)
      end
    end
  end

  defp ask_new(current_user, ids, session, question, content_type, now) do
    with :ok <- chat_available(session, now),
         :ok <- within_daily_limit(ids.account_id, now),
         {:ok, frozen} <- freeze_context(ids, session, now),
         {:ok, reservation} <- reserve_question(ids, session.id, question, now) do
      case reservation do
        {:reserved, reserved} ->
          ask_reserved(current_user, ids, session, reserved, frozen, content_type, now)

        {:replay, turns} ->
          {:ok, answer_payload(session.id, turns)}
      end
    end
  end

  # Runs with no lock held: the stored question already holds its place in
  # the day. A question that gets no stored answer is deleted.
  defp ask_reserved(current_user, ids, session, reserved, frozen, content_type, now) do
    case build_contextual_answer(session.id, frozen, reserved.content, content_type) do
      {:ok, answer} ->
        with {:error, _reason} = error <-
               store_answer(current_user, ids, session, reserved, answer, now) do
          PlanningRepo.delete_pending_chat_question(reserved.id)
          error
        end

      {:fallback, answer} ->
        PlanningRepo.delete_pending_chat_question(reserved.id)
        {:ok, fallback_payload(session.id, reserved, answer)}
    end
  end

  defp store_answer(current_user, ids, session, reserved, answer, now) do
    with {:ok, _ids} <- RecipeAccess.authorize(current_user),
         {:ok, _session} <- chat_session(ids, session.id, now),
         {:ok, turns} <- persist_answer(ids, session.id, reserved, answer) do
      {:ok, answer_payload(session.id, turns)}
    end
  end

  defp replay(session_id, turns, question) do
    if same_question?(turns, question),
      do: {:ok, answer_payload(session_id, turns)},
      else: {:error, :cooking_message_id_conflict}
  end

  defp same_question?([stored_question, _answer], question),
    do: stored_question.content == question

  # Counts the questions the Account asked on its day at `now`: the answered
  # ones and the ones still being answered. The count before the Context is
  # frozen spares that work on a full day; the one inside
  # `reserve_question/4` holds the Account chat lock and is the one that binds.
  defp within_daily_limit(account_id, now) do
    {from, to} = AccountClock.day_bounds(account_id, now)
    # Stored questions carry the wall clock, not `now`.
    pending_since = DateTime.add(DateTime.utc_now(), -@reservation_seconds, :second)

    if PlanningRepo.count_chat_questions(account_id, from, to, pending_since) <
         @daily_question_limit,
       do: :ok,
       else: {:error, :cooking_chat_limit_reached}
  end

  # The fallback is not stored: these turns only carry it back to the client.
  defp fallback_payload(session_id, reserved, answer) do
    asked_at = DateTime.utc_now()

    turns = [
      %CookingChatMessage{
        id: Ecto.UUID.generate(),
        role: :user,
        content: reserved.content,
        client_message_id: reserved.client_message_id,
        inserted_at: asked_at
      },
      %CookingChatMessage{
        id: Ecto.UUID.generate(),
        role: :assistant,
        content: answer,
        inserted_at: DateTime.add(asked_at, 1, :microsecond)
      }
    ]

    answer_payload(session_id, turns)
  end

  defp answer_payload(session_id, [_question, answer] = turns) do
    %{
      session_id: session_id,
      message: answer.content,
      content_type: "text",
      step_context:
        session_id |> PlanningRepo.latest_context_snapshot() |> snapshot_step_context(),
      turns: Enum.map(turns, &serialize_turn/1)
    }
  end

  defp cast_client_message_id(nil), do: {:ok, nil}

  # Only the canonical text form: `Ecto.UUID.cast/1` also takes 16 raw bytes.
  defp cast_client_message_id(<<_::binary-size(36)>> = id) do
    case Ecto.UUID.cast(id) do
      {:ok, uuid} -> {:ok, uuid}
      :error -> {:error, :validation_error}
    end
  end

  defp cast_client_message_id(_other), do: {:error, :validation_error}

  defp stored_pair(_session_id, nil), do: nil

  defp stored_pair(session_id, message_id),
    do: PlanningRepo.chat_pair_for_client_message(session_id, message_id)

  defp chat_question(message) do
    question = String.trim(message)

    if question == "" or String.length(question) > @max_question_length,
      do: {:error, :validation_error},
      else: {:ok, question}
  end

  defp chat_session(ids, session_id, now) do
    with {:ok, session} <- account_session(ids, session_id),
         :ok <- chat_available(session, now),
         do: {:ok, session}
  end

  defp account_session(ids, session_id) do
    with {:ok, session_id} <- cast_id(session_id, :session_not_found),
         session when not is_nil(session) <-
           PlanningRepo.get_cooking_session_for_account(ids.account_id, session_id) do
      {:ok, session}
    else
      nil -> {:error, :session_not_found}
      {:error, _} = error -> error
    end
  end

  defp chat_available(%{status: :completed}, _now), do: {:error, :cooking_already_finished}

  defp chat_available(%{status: :active} = session, now) do
    with :ok <- planned_meal(session.scheduled_meal, session.account_id),
         do: meal_is_today(session.scheduled_meal, session.account_id, now)
  end

  # Stores the question unanswered before the provider is called. The session
  # lock orders this write against a concurrent finish, and orders two
  # requests carrying the same client message id: the second one finds the
  # answered pair of the first and stores nothing, it is refused when its
  # question differs, and it is refused while the first is still being
  # answered. A new question is counted under the Account chat lock, so two
  # questions asked at once in different sessions cannot both take the last
  # place of the day. Both locks end with the transaction, before the call.
  defp reserve_question(ids, session_id, {question, message_id}, now) do
    Repo.transaction(fn ->
      session = lock_active_session!(ids, session_id)

      case stored_pair(session.id, message_id) do
        nil ->
          free_client_message_id!(session.id, message_id)
          lock_account_chat!(ids.account_id)
          within_daily_limit!(ids.account_id, now)

          {:reserved, insert_turn!(question_turn(question, message_id, ids.user_id), session.id)}

        turns ->
          {:replay, stored_pair_of!(turns, question)}
      end
    end)
  end

  # Call only inside a transaction: a question still being answered under
  # the id rolls back. One whose request died before its answer gives the id
  # up.
  defp free_client_message_id!(_session_id, nil), do: :ok

  defp free_client_message_id!(session_id, message_id) do
    pending_since = DateTime.add(DateTime.utc_now(), -@reservation_seconds, :second)

    case PlanningRepo.pending_chat_question_for_client_message(session_id, message_id) do
      nil ->
        :ok

      pending ->
        if DateTime.after?(pending.inserted_at, pending_since),
          do: Repo.rollback(:cooking_message_id_conflict),
          else: PlanningRepo.delete_pending_chat_question(pending.id)
    end
  end

  # Stores the answer and marks its question answered, under the session lock
  # so a finished session never gains turns. The answer is stamped right after
  # the question's answer time, so the pair stays together in the history.
  defp persist_answer(ids, session_id, reserved, answer) do
    Repo.transaction(fn ->
      session = lock_active_session!(ids, session_id)
      answered_at = DateTime.utc_now()

      # 0: the question gave its id up to a resend after its place expired.
      if PlanningRepo.answer_chat_question(reserved.id, answered_at) == 0,
        do: Repo.rollback(:cooking_message_id_conflict)

      answer_turn = %{
        role: :assistant,
        content: answer,
        inserted_at: DateTime.add(answered_at, 1, :microsecond)
      }

      [%{reserved | answered_at: answered_at}, insert_turn!(answer_turn, session.id)]
    end)
  end

  # Makes the Account's new questions take turns at being counted and stored,
  # until the transaction ends. Taken after the session row lock, and no path
  # takes them in the other order, so two questions cannot deadlock.
  defp lock_account_chat!(account_id) do
    Repo.query!("SELECT pg_advisory_xact_lock($1, $2)", [
      @chat_lock_namespace,
      :erlang.phash2(account_id)
    ])
  end

  # Call only inside a transaction: a full day rolls back.
  defp within_daily_limit!(account_id, now) do
    with {:error, reason} <- within_daily_limit(account_id, now),
         do: Repo.rollback(reason)
  end

  # Call only inside a transaction: another question under the id rolls back.
  defp stored_pair_of!(turns, question) do
    if same_question?(turns, question),
      do: turns,
      else: Repo.rollback(:cooking_message_id_conflict)
  end

  # A question as it is stored before its answer: no `answered_at` yet.
  defp question_turn(question, message_id, user_id) do
    %{
      role: :user,
      content: question,
      user_id: user_id,
      client_message_id: message_id,
      inserted_at: DateTime.utc_now()
    }
  end

  # Call only inside a transaction: a missing or a finished session rolls back.
  defp lock_active_session!(ids, session_id) do
    session =
      PlanningRepo.lock_cooking_session_for_account(ids.account_id, session_id) ||
        Repo.rollback(:session_not_found)

    case session.status do
      :active -> session
      :completed -> Repo.rollback(:cooking_already_finished)
    end
  end

  # Freezes the Context snapshot on the first question of the Account's day
  # and returns it. The session lock makes concurrent first questions agree on
  # one capture; a part captured on another day, or a session that has none,
  # is replaced.
  defp freeze_context(ids, session, now) do
    today = AccountClock.today(ids.account_id, now)
    captured_on = Date.to_iso8601(today)

    Repo.transaction(fn ->
      locked = lock_active_session!(ids, session.id)

      case (locked.context_snapshot || %{})[@frozen_key] do
        %{"captured_on" => ^captured_on} = frozen -> frozen
        _stale_or_missing -> store_frozen!(locked, frozen_context(ids, session, today, now))
      end
    end)
  end

  defp store_frozen!(session, frozen) do
    snapshot = Map.put(session.context_snapshot || %{}, @frozen_key, frozen)

    case PlanningRepo.update_cooking_session(session, %{context_snapshot: snapshot}) do
      {:ok, _session} -> frozen
      {:error, _changeset} -> Repo.rollback(:validation_error)
    end
  end

  defp insert_turn!(turn, session_id) do
    case PlanningRepo.add_chat_message(Map.put(turn, :cooking_session_id, session_id)) do
      {:ok, stored} -> stored
      {:error, _changeset} -> Repo.rollback(:validation_error)
    end
  end

  defp active_session(%{status: :active} = session),
    do: planned_meal(session.scheduled_meal, session.account_id)

  defp active_session(_), do: {:error, :cooking_session_not_active}

  defp planned_meal(
         %{account_id: account_id, recipe_version_id: version_id, recipe_snapshot: snapshot},
         account_id
       )
       when is_binary(version_id) and is_map(snapshot),
       do: :ok

  defp planned_meal(_, _), do: {:error, :scheduled_meal_not_found}

  defp meal_is_today(%{date: date}, account_id, now) do
    if Date.compare(date, AccountClock.today(account_id, now)) == :eq,
      do: :ok,
      else: {:error, :cooking_chat_unavailable}
  end

  # A malformed id cannot name a record, so it reads as the record's absence.
  defp cast_id(id, not_found) do
    case Ecto.UUID.cast(id) do
      {:ok, uuid} -> {:ok, uuid}
      :error -> {:error, not_found}
    end
  end

  # -------------------------------------------------------------------------
  # Private helpers
  # -------------------------------------------------------------------------

  # The meal row lock serializes concurrent starts of one meal, so the lookup
  # and the insert cannot interleave into two active sessions. A finish marks
  # the meal cooked under the same lock, so `is_cooked` is read here as the
  # finish left it.
  defp find_or_create_session(ids, meal) do
    Repo.transaction(fn ->
      locked =
        PlanningRepo.lock_cooking_meal_for_account(ids.account_id, meal.id) ||
          Repo.rollback(:scheduled_meal_not_found)

      with nil <- current_session(ids, locked),
           {:ok, session} <- create_session(ids, meal) do
        session
      else
        {:error, reason} -> Repo.rollback(reason)
        session -> session
      end
    end)
  end

  # A cooked meal keeps the session that cooked it and never gets an active
  # one. One marked cooked outside a session (calendar) has none to return: a
  # new session could not finish, and an active one left from before is not
  # handed out.
  defp current_session(ids, %{is_cooked: true, id: meal_id}) do
    PlanningRepo.completed_cooking_session_for_meal(ids.account_id, meal_id) ||
      {:error, :cooking_already_finished}
  end

  # A meal that is not cooked keeps its active session. One set back to not
  # cooked has none and starts over.
  defp current_session(ids, %{id: meal_id}),
    do: PlanningRepo.active_cooking_session_for_meal(ids.account_id, meal_id)

  defp create_session(ids, meal) do
    recipe = RecipeVersions.recipe_for_meal(meal)

    first_step_id =
      recipe &&
        recipe.recipe_steps
        |> Enum.sort_by(& &1.step_number)
        |> List.first()
        |> case do
          nil -> nil
          step -> step.id
        end

    initial_snapshot = %{
      "current_step_id" => first_step_id,
      "step_status" => "started",
      "timers" => %{},
      "view" => "recipe"
    }

    result =
      Planning.create_cooking_session(%{
        account_id: ids.account_id,
        scheduled_meal_id: meal.id,
        status: :active,
        started_at: DateTime.utc_now(),
        context_snapshot: initial_snapshot
      })

    case result do
      {:ok, session} ->
        # Capture the initial context snapshot
        {:ok, _snapshot} =
          PlanningRepo.add_context_snapshot(%{
            cooking_session_id: session.id,
            snapshot_data: initial_snapshot,
            captured_at: DateTime.utc_now()
          })

        # Record the first step event if a step exists
        if first_step_id do
          {:ok, _event} =
            PlanningRepo.add_step_event(%{
              cooking_session_id: session.id,
              recipe_step_id: first_step_id,
              event_type: :started,
              event_at: DateTime.utc_now()
            })
        end

        {:ok, session}

      {:error, _} = error ->
        error
    end
  end

  # The Context snapshot: the recipe as planned and the usable stock on the
  # Account's today, captured once per day. The chat answers from this, never
  # from live reads, so later Inventory changes do not rewrite earlier advice.
  defp frozen_context(ids, session, today, now) do
    recipe = RecipeVersions.recipe_for_meal(session.scheduled_meal)

    %{
      "captured_at" => DateTime.to_iso8601(now),
      "captured_on" => Date.to_iso8601(today),
      "recipe" => %{
        "name" => recipe && recipe.name,
        "ingredients" =>
          for item <- (recipe && recipe.recipe_ingredients) || [] do
            %{
              "name" => item.ingredient && item.ingredient.name,
              "quantity_milli" => item.quantity_milli,
              "unit" => Atom.to_string(item.unit)
            }
          end,
        "steps" =>
          for step <- Enum.sort_by((recipe && recipe.recipe_steps) || [], & &1.step_number) do
            %{
              "id" => step.id,
              "step_number" => step.step_number,
              "instructions" => step.instructions
            }
          end
      },
      "inventory" => frozen_inventory(ids.account_id, today)
    }
  end

  # One line per ingredient and unit, summing its usable lots.
  defp frozen_inventory(account_id, today) do
    account_id
    |> InventoryRepo.list_inventory_with_ingredient()
    |> Enum.filter(&(&1.quantity_milli > 0 and LotFreshness.usable?(&1, today)))
    |> Enum.group_by(&{&1.ingredient && &1.ingredient.name, &1.unit}, & &1.quantity_milli)
    |> Enum.sort()
    |> Enum.map(fn {{name, unit}, quantities} ->
      %{"name" => name, "quantity_milli" => Enum.sum(quantities), "unit" => Atom.to_string(unit)}
    end)
  end

  defp persist_finish(ids, session_id, today) do
    Repo.transaction(fn ->
      session =
        PlanningRepo.lock_cooking_session_for_account(ids.account_id, session_id) ||
          Repo.rollback(:session_not_found)

      if session.status == :completed, do: Repo.rollback(:cooking_already_finished)

      meal =
        PlanningRepo.lock_cooking_meal_for_account(ids.account_id, session.scheduled_meal_id) ||
          Repo.rollback(:scheduled_meal_not_found)

      case planned_meal(meal, ids.account_id) do
        :ok -> :ok
        {:error, reason} -> Repo.rollback(reason)
      end

      # The meal can have been marked cooked outside a session (calendar).
      if meal.is_cooked, do: Repo.rollback(:cooking_already_finished)

      # Lock order: Cooking session, then Scheduled meal, Shopping rows and
      # the Inventory key, the order of the lock order in the moduledoc of
      # `MealPlannerApi.Cart`.
      Shopping.delete_open_items_for_meal(ids.account_id, meal.id)
      {mutations, shortages} = deduct_ingredients(ids, session, meal, today)

      with {:ok, cooked} <- PlanningRepo.update_scheduled_meal(meal, %{is_cooked: true}),
           {:ok, _completed} <-
             PlanningRepo.update_cooking_session(session, %{
               status: :completed,
               completed_at: DateTime.utc_now()
             }) do
        %{
          scheduled_meal: serialize_finished_meal(cooked, meal),
          inventory_mutations: mutations,
          shortages: shortages
        }
      else
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
  end

  # A cooked meal is never skipped, so the flag is fixed to false.
  defp serialize_finished_meal(cooked, locked) do
    recipe = RecipeVersions.recipe_for_meal(locked)

    %{
      id: cooked.id,
      date: Date.to_iso8601(cooked.date),
      slot: Atom.to_string(cooked.slot),
      is_cooked: cooked.is_cooked,
      is_skipped: false,
      recipe_id: cooked.recipe_id,
      recipe_version_id: cooked.recipe_version_id,
      selected_quantity: cooked.selected_quantity,
      recipe_name: recipe && recipe.name
    }
  end

  defp deduct_ingredients(ids, session, meal, today) do
    recipe = RecipeVersions.recipe_for_meal(meal)
    ingredients = (recipe && recipe.recipe_ingredients) || []

    # All cooking transactions acquire ingredient locks in the same order.
    # Nested inventory transactions share this transaction, including their audit writes.
    {mutations, shortages} =
      ingredients
      |> Enum.sort_by(&{&1.ingredient_id, &1.unit})
      |> Enum.reduce({[], []}, fn ingredient, {mutations, shortages} ->
        requested = ingredient.quantity_milli

        case InventoryRepo.apply_delta(%{
               account_id: ids.account_id,
               ingredient_id: ingredient.ingredient_id,
               unit: ingredient.unit,
               source_kind: :planned,
               delta: -requested,
               today: today,
               source_user_id: ids.user_id,
               source_cooking_session_id: session.id,
               trigger_type: :cooking,
               operation: :subtract,
               metadata: %{scheduled_meal_id: session.scheduled_meal_id}
             }) do
          {:ok, result} ->
            applied = -result.delta
            lot_mutations = Enum.map(result.item_states, &serialize_mutation(&1, ingredient))

            {[lot_mutations | mutations],
             maybe_shortage(shortages, ingredient, requested, applied)}

          {:error, _reason} ->
            Repo.rollback(:inventory_mutation_failed)
        end
      end)

    {mutations |> Enum.reverse() |> List.flatten(), Enum.reverse(shortages)}
  end

  defp serialize_mutation(state, ingredient) do
    %{
      inventory_item_id: state.item.id,
      ingredient_id: ingredient.ingredient_id,
      ingredient_name: ingredient.ingredient && ingredient.ingredient.name,
      unit: Atom.to_string(ingredient.unit),
      quantity_before_milli: state.before_qty,
      quantity_delta_milli: state.delta,
      quantity_after_milli: state.after_qty
    }
  end

  defp maybe_shortage(shortages, _ingredient, requested, applied) when applied >= requested,
    do: shortages

  defp maybe_shortage(shortages, ingredient, requested, applied) do
    [
      %{
        ingredient_id: ingredient.ingredient_id,
        ingredient_name: ingredient.ingredient && ingredient.ingredient.name,
        unit: Atom.to_string(ingredient.unit),
        requested_milli: requested,
        missing_milli: requested - applied
      }
      | shortages
    ]
  end

  defp belongs_to_recipe?(session, recipe_step_id) do
    recipe = RecipeVersions.recipe_for_meal(session.scheduled_meal)
    recipe && Enum.any?(recipe.recipe_steps, &(&1.id == recipe_step_id))
  end

  defp build_snapshot_data(session, recipe_step_id, status, extra) do
    session.context_snapshot
    |> step_state()
    |> Map.merge(%{
      "current_step_id" => recipe_step_id,
      "step_status" => Atom.to_string(status),
      "updated_at" => DateTime.utc_now() |> DateTime.to_iso8601()
    })
    |> maybe_put("timers", extra["timers"])
    |> maybe_put("view", extra["view"])
  end

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

  defp build_contextual_answer(session_id, frozen, question, content_type) do
    snapshot = PlanningRepo.latest_context_snapshot(session_id)
    recipe = frozen["recipe"] || %{}
    step = Enum.find(recipe["steps"] || [], &(&1["id"] == snapshot_step_context(snapshot)))

    step_text =
      if step,
        do: "Paso actual #{step["step_number"]}: #{step["instructions"]}.",
        else: "No tengo paso activo, te guio con la receta completa."

    system_prompt =
      build_system_prompt(frozen, step_text, prior_turns_text(session_id), content_type)

    case AI.generate_text(question, system_prompt: system_prompt) do
      {:ok, text} ->
        {:ok, text}

      {:error, _reason} ->
        {:fallback, fallback_answer(question, content_type, recipe["name"], step_text)}
    end
  end

  defp build_system_prompt(frozen, step_text, history_text, content_type) do
    voice_mode = if content_type == "speech_transcript", do: "si", else: "no"
    recipe = frozen["recipe"] || %{}
    recipe_name = recipe["name"] || "receta sin nombre"

    """
    Eres el asistente culinario de MyFood.
    El usuario esta cocinando la receta: #{recipe_name}.
    Modo voz: #{voice_mode}.
    #{step_text}

    Ingredientes de la receta:
    #{quantity_lines(recipe["ingredients"], "Sin ingredientes disponibles")}

    Pasos oficiales de la receta:
    #{prompt_steps_text(recipe["steps"])}

    Inventario disponible al hacer la primera pregunta del dia:
    #{quantity_lines(frozen["inventory"], "Sin inventario registrado")}

    Conversacion previa:
    #{history_text}

    Responde basandote estrictamente en esta receta y este inventario.
    Da una respuesta breve, accionable y segura para cocina.
    Si falta informacion, dilo sin inventar.
    """
  end

  defp prompt_steps_text(steps) when steps in [nil, []], do: "Sin pasos disponibles"

  defp prompt_steps_text(steps),
    do: Enum.map_join(steps, "\n", &"#{&1["step_number"]}. #{&1["instructions"]}")

  defp quantity_lines(items, empty_text) when items in [nil, []], do: empty_text

  defp quantity_lines(items, _empty_text) do
    Enum.map_join(items, "\n", fn item ->
      "- #{item["name"] || "ingrediente"}: #{units_text(item["quantity_milli"])} #{item["unit"]}"
    end)
  end

  # Quantities are stored in thousandths of the unit; the model reads whole units.
  defp units_text(milli) when is_integer(milli) and milli >= 0 do
    case {div(milli, 1000), rem(milli, 1000)} do
      {whole, 0} ->
        Integer.to_string(whole)

      {whole, thousandths} ->
        fraction =
          thousandths
          |> Integer.to_string()
          |> String.pad_leading(3, "0")
          |> String.trim_trailing("0")

        "#{whole}.#{fraction}"
    end
  end

  defp units_text(other), do: to_string(other)

  defp prior_turns_text(session_id) do
    case session_id |> PlanningRepo.list_chat_messages() |> Enum.take(-@prompt_history_turns) do
      [] ->
        "Sin mensajes previos"

      turns ->
        Enum.map_join(turns, "\n", &"#{speaker(&1.role)}: #{&1.content}")
    end
  end

  defp speaker(:user), do: "Usuario"
  defp speaker(_role), do: "Asistente"

  defp fallback_answer(question, content_type, recipe_name, step_text) do
    prefix = if content_type == "speech_transcript", do: "Entendido por voz", else: "Entendido"
    name = recipe_name || "una receta"

    "#{prefix}. Estas cocinando #{name}. #{step_text} #{brief_guidance(question)}"
  end

  defp brief_guidance(question) do
    lowered = String.downcase(question)

    cond do
      String.contains?(lowered, "salsa") ->
        "Manten fuego bajo a medio y agrega liquido de a poco para que no se pegue."

      String.contains?(lowered, "sal") ->
        "Agrega sal gradualmente, mezcla y prueba antes de corregir otra vez."

      String.contains?(lowered, "quemado") or String.contains?(lowered, "pegado") ->
        "Retira lo que puedas, raspá el fondo y agregá liquido. Revolvé constantemente."

      true ->
        "Segui el paso actual y ajustá de a una variable: fuego, liquido o tiempo."
    end
  end

  defp snapshot_step_context(nil), do: nil

  defp snapshot_step_context(snapshot) do
    (snapshot.snapshot_data && snapshot.snapshot_data["current_step_id"]) || nil
  end

  # -------------------------------------------------------------------------
  # Serialization
  # -------------------------------------------------------------------------

  defp serialize_session_payload(session, latest_snapshot) do
    scheduled_meal = loaded_scheduled_meal(session)
    recipe = loaded_recipe(scheduled_meal)

    %{
      session_id: session.id,
      scheduled_meal_id: session.scheduled_meal_id,
      recipe_version_id: scheduled_meal && scheduled_meal.recipe_version_id,
      selected_quantity: scheduled_meal && scheduled_meal.selected_quantity,
      status: Atom.to_string(session.status),
      slot: serialize_slot(scheduled_meal),
      recipe: serialize_recipe(recipe),
      snapshot:
        step_state((latest_snapshot && latest_snapshot.snapshot_data) || session.context_snapshot),
      chat_messages:
        session.id |> PlanningRepo.list_chat_messages() |> Enum.map(&serialize_turn/1)
    }
  end

  # The step state clients read; the frozen Context snapshot stays server-side.
  defp step_state(snapshot), do: Map.delete(snapshot || %{}, @frozen_key)

  # A user turn also carries the id the client gave its question, `nil` when
  # it was asked without one.
  defp serialize_turn(%{role: :user} = turn),
    do: turn |> serialize_turn_fields() |> Map.put(:client_message_id, turn.client_message_id)

  defp serialize_turn(turn), do: serialize_turn_fields(turn)

  defp serialize_turn_fields(turn) do
    %{
      id: turn.id,
      role: Atom.to_string(turn.role),
      content: turn.content,
      inserted_at: turn.inserted_at
    }
  end

  defp loaded_scheduled_meal(session) do
    case session.scheduled_meal do
      %Ecto.Association.NotLoaded{} -> nil
      sm -> sm
    end
  end

  defp loaded_recipe(scheduled_meal) do
    scheduled_meal &&
      case RecipeVersions.recipe_for_meal(scheduled_meal) do
        %Ecto.Association.NotLoaded{} -> nil
        r -> r
      end
  end

  defp serialize_slot(scheduled_meal) do
    (scheduled_meal &&
       case scheduled_meal.slot do
         nil -> "unknown"
         atom when is_atom(atom) -> Atom.to_string(atom)
         string when is_binary(string) -> string
         _ -> "unknown"
       end) || "unknown"
  end

  defp serialize_recipe(recipe) do
    if recipe do
      %{
        id: recipe.id,
        name: recipe.name,
        steps: serialize_steps(recipe.recipe_steps),
        ingredients: serialize_ingredients(recipe.recipe_ingredients)
      }
    else
      %{id: nil, name: nil, steps: [], ingredients: []}
    end
  end

  defp serialize_steps(nil), do: []
  defp serialize_steps(%Ecto.Association.NotLoaded{}), do: []

  defp serialize_steps(steps) do
    steps
    |> Enum.sort_by(& &1.step_number)
    |> Enum.map(fn step ->
      %{
        id: step.id,
        step_number: step.step_number,
        instructions: step.instructions,
        duration_minutes: step.duration_minutes
      }
    end)
  end

  defp serialize_ingredients(nil), do: []
  defp serialize_ingredients(%Ecto.Association.NotLoaded{}), do: []

  defp serialize_ingredients(ingredients) do
    Enum.map(ingredients, fn item ->
      %{
        ingredient_id: item.ingredient_id,
        name: item.ingredient && item.ingredient.name,
        quantity_milli: item.quantity_milli,
        unit: Atom.to_string(item.unit)
      }
    end)
  end
end
