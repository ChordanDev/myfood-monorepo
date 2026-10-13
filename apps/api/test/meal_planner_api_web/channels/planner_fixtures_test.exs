defmodule MealPlannerApiWeb.PlannerFixturesTest do
  @moduledoc """
  Records the frozen payloads of the Planner (issue #25) from real runs of
  `start_planning` and compares them with the JSON fixtures the mobile app
  reads (`apps/mobile/src/features/planner/fixtures`).

  Without `UPDATE_FIXTURES=1` the test fails when a committed fixture differs
  from the fresh payload. See `MealPlannerApiWeb.PlannerFixtures` and
  `apps/api/docs/CHANNELS.md` ("Planner fixtures").
  """
  use MealPlannerApiWeb.ChannelCase, async: false

  import MealPlannerApi.Generation.ServerTestFixtures,
    only: [insert_recipe: 2, stop_generation_server: 1]

  import MealPlannerApiWeb.ChannelHelpers, only: [issue_identity_and_token: 2]

  alias MealPlannerApi.Data.{AccountRepo, PlanningRepo, RecipeRepo}
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Persistence.Accounts.{AccountMembership, User}
  alias MealPlannerApi.Persistence.Planning.PlanningGenerationRun
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.{GenerationService, UserPreferencesService}
  alias MealPlannerApiWeb.{Endpoint, PlannerFixtures, PlanningChannel, UserSocket}

  @moduletag :capture_log

  @session_id "00000000-0000-4000-8000-000000000001"
  @run_id "00000000-0000-4000-8000-000000000002"
  @proposal_id "00000000-0000-4000-8000-000000000003"
  @recipe_ids [
    "00000000-0000-4000-8000-0000000000a1",
    "00000000-0000-4000-8000-0000000000a2",
    "00000000-0000-4000-8000-0000000000a3"
  ]

  setup do
    {:ok, user, account, token} = issue_identity_and_token("u_planner_fx", "acct_planner_fx")
    _ = persist_trial_window!(account)

    on_exit(fn ->
      for {pid, _value} <-
            Registry.lookup(MealPlannerApi.Generation.Generations, {:generation, account.id}) do
        DynamicSupervisor.terminate_child(MealPlannerApi.Generation.ServerSupervisor, pid)
      end
    end)

    %{user: user, account: account, token: token, socket: join_planning!(token, account)}
  end

  test "start_planning reply and the events of a run it starts", %{
    socket: socket,
    account: account
  } do
    ref =
      push(socket, "start_planning", %{
        "requestId" => "req_fixture_1",
        "rangeFrom" => in_days(0),
        "dayCount" => 2,
        "request" => "something light"
      })

    assert_reply(ref, :ok, reply)
    assert_push("session_started", session_started)
    assert_push("generation_started", generation_started)
    assert_push("generation_error", generation_error, 10_000)

    stable = %{reply["sessionId"] => @session_id, generation_started["runId"] => @run_id}

    PlannerFixtures.check!("startPlanningReply", reply, stable)
    PlannerFixtures.check!("sessionStarted", session_started, stable)
    PlannerFixtures.check!("generationStarted", generation_started, stable)
    PlannerFixtures.check!("generationError", generation_error, stable)

    stop_generation_server(account.id)
  end

  # The first fixture the client never receives: the Planning context the
  # engine reads from the persisted run (`input_context.constraints`).
  test "the Planning context of a User with every signal set", %{
    socket: socket,
    user: user,
    account: account
  } do
    favorite_ids = set_up_every_signal!(user, account)

    ref =
      push(socket, "start_planning", %{
        "rangeFrom" => in_days(0),
        "dayCount" => 2,
        "favoriteRecipeIds" => favorite_ids
      })

    assert_reply(ref, :ok, %{"sessionId" => _})
    assert_push("generation_started", %{"runId" => run_id})

    context =
      Repo.get!(PlanningGenerationRun, run_id).input_context["constraints"]["planning_context"]

    PlannerFixtures.check!("planningContext", context)

    stop_generation_server(account.id)
  end

  test "proposal_ready and planning_message", %{account: account} do
    [day_1, day_2] = [in_days(1), in_days(2)]
    [r1, r2, r3] = @recipe_ids

    proposal =
      GenerationService.build_proposal_json([
        resolved(day_2, :dinner, r3, "Lentil stew", 700, %{
          protein_g: 12.5,
          calories: 500,
          carbs_g: 60
        }),
        resolved(day_1, :lunch, r2, "Chicken rice", 1_250),
        resolved(day_1, :breakfast, r1, "Oatmeal", nil, %{
          protein_g: 30,
          calories: 500,
          carbs_g: nil
        })
      ])

    Endpoint.broadcast!("planning:#{account.id}", "proposal_ready", %{
      proposal_id: @proposal_id,
      run_id: @run_id,
      proposal: proposal
    })

    assert_push("proposal_ready", ready)
    assert_push("planning_message", message)

    stable = %{day_1 => "2030-01-01", day_2 => "2030-01-02"}

    PlannerFixtures.check!("proposalReady", ready, stable)
    PlannerFixtures.check!("planningMessage", message, stable)
  end

  test "planning_invalid_range error envelope", %{socket: socket} do
    ref = push(socket, "start_planning", %{"rangeFrom" => in_days(0), "dayCount" => 8})

    assert_receive %Phoenix.Socket.Reply{ref: ^ref, status: :error, payload: payload}
    PlannerFixtures.check!("planningInvalidRangeError", payload)
  end

  test "planning_range_locked error envelope names the owner", %{socket: socket, account: account} do
    {peer_user, peer_membership} = insert_peer(account, "Ana Peer")

    {:ok, _existing} =
      PlanningRepo.create_session(account.id, %{
        range_from: Date.add(Date.utc_today(), 1),
        range_to: Date.add(Date.utc_today(), 5),
        lock_owner_user_id: peer_user.id,
        lock_owner_membership_id: peer_membership.id,
        lease_expires_at: DateTime.add(DateTime.utc_now(), 120, :second)
      })

    ref = push(socket, "start_planning", %{"rangeFrom" => in_days(2), "dayCount" => 3})

    assert_receive %Phoenix.Socket.Reply{ref: ^ref, status: :error, payload: payload}
    assert payload["error"]["details"] == %{"ownerName" => "Ana Peer"}
    PlannerFixtures.check!("planningRangeLockedError", payload)
  end

  # Every onboarding signal, a 0-minute lunch included, and two favorites.
  # Returns the ids of the favorites in the order the fixture keeps them.
  defp set_up_every_signal!(user, account) do
    {:ok, _preferences} =
      UserPreferencesService.replace(user.id, %{
        diet: "vegetarian",
        hard_restrictions: ["gluten", "peanut"],
        soft_preferences: ["quick_meals"]
      })

    user
    |> User.profile_changeset(%{
      name: user.name,
      household_size: 3,
      cooking_skill: "intermediate"
    })
    |> Repo.update!()

    {:ok, _rows} =
      AccountRepo.replace_slot_cooking_times(user.id, %{
        breakfast: %{cooking_time_minutes: 15, hunger_level: :light},
        lunch: %{cooking_time_minutes: 0, hunger_level: :normal},
        dinner: %{cooking_time_minutes: 45, hunger_level: :strong}
      })

    for name <- ["Lentil stew", "Oatmeal"] do
      recipe = insert_recipe(name, account_id: account.id)

      {:ok, _favorite} =
        RecipeRepo.add_favorite(%{account_id: account.id, user_id: user.id}, recipe.id)

      recipe.id
    end
  end

  defp in_days(offset), do: Date.utc_today() |> Date.add(offset) |> Date.to_iso8601()

  defp join_planning!(token, account) do
    {:ok, socket} = connect(UserSocket, %{"token" => token})
    {:ok, _reply, socket} = subscribe_and_join(socket, PlanningChannel, "planning:#{account.id}")
    socket
  end

  defp persist_trial_window!(account) do
    started = DateTime.utc_now()

    {:ok, updated} =
      account
      |> Account.changeset(%{
        trial_started_at: started,
        trial_ends_at: DateTime.add(started, 7 * 86_400, :second)
      })
      |> Repo.update()

    updated
  end

  defp insert_peer(account, name) do
    peer_user =
      %User{}
      |> User.changeset(%{
        email: "peer-#{System.unique_integer([:positive])}@example.com",
        name: name,
        role: :member
      })
      |> Repo.insert!()

    {:ok, membership} =
      %AccountMembership{}
      |> AccountMembership.changeset(%{
        account_id: account.id,
        user_id: peer_user.id,
        role: :member,
        status: :active,
        joined_at: DateTime.utc_now()
      })
      |> Repo.insert()

    {peer_user, membership}
  end

  # `macros` carry a fractional value and a missing one in some meals: the real
  # producer sends decimals and `nil`.
  defp resolved(date, slot, recipe_id, name, price_cents, macros \\ nil) do
    %{
      date: date,
      slot: slot,
      recipe_id: recipe_id,
      recipe_name: name,
      price_cents: price_cents,
      macros: macros || %{protein_g: 30, calories: 500, carbs_g: 60}
    }
  end
end
