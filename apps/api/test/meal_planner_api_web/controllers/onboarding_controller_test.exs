defmodule MealPlannerApiWeb.OnboardingControllerTest do
  @moduledoc """
  `POST /api/onboarding/complete` (issue #20): profile, preferences, Slot
  cooking times and Account timezone saved together or not at all, with the
  completion stamp set once.
  """
  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.FactoryHelpers

  import MealPlannerApiWeb.ChannelHelpers,
    only: [persist_trial_window!: 2, with_enforcement_enabled!: 1]

  alias MealPlannerApi.Persistence.Accounts
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.{OnboardingService, UserPreferencesService}

  @path "/api/onboarding/complete"

  @body %{
    "profile" => %{
      "displayName" => "Ana María",
      "householdSize" => 4,
      "cookingSkill" => "intermediate"
    },
    "preferences" => %{
      "diet" => "vegetarian",
      "hardRestrictions" => ["gluten"],
      "softPreferences" => ["spicy food"]
    },
    "slotCookingTimes" => %{
      "breakfast" => %{"cookingTimeMinutes" => 10, "hungerLevel" => "light"},
      "lunch" => %{"cookingTimeMinutes" => 45, "hungerLevel" => "normal"},
      "dinner" => %{"cookingTimeMinutes" => 30, "hungerLevel" => "strong"}
    },
    "timezone" => "America/Argentina/Buenos_Aires"
  }

  setup do
    user =
      user_with_memberships(
        %{email: "onboarding-#{Ecto.UUID.generate()}@example.com", name: "Stored Name"},
        [{%{plan: :individual, name: "Onboarding"}, :owner}]
      )

    [membership] = user.memberships

    %{
      user: user,
      account: membership.account,
      token: issue_access_v2_token(user, membership)
    }
  end

  describe "POST /api/onboarding/complete" do
    test "saves every group and answers user, preferences and slotCookingTimes", %{
      user: user,
      account: account,
      token: token
    } do
      body = token |> complete(@body) |> json_response(200)

      stored = Repo.get!(User, user.id)

      assert body == %{
               "user" => %{
                 "id" => user.id,
                 "displayName" => "Ana María",
                 "householdSize" => 4,
                 "cookingSkill" => "intermediate",
                 "onboardingCompletedAt" => DateTime.to_iso8601(stored.onboarding_completed_at)
               },
               "preferences" => %{
                 "diet" => "vegetarian",
                 "hardRestrictions" => ["gluten"],
                 "softPreferences" => ["spicy food"]
               },
               "slotCookingTimes" => @body["slotCookingTimes"]
             }

      assert %User{name: "Ana María", household_size: 4, cooking_skill: "intermediate"} = stored
      assert stored.onboarding_completed_at
      assert Repo.get!(Account, account.id).timezone == "America/Argentina/Buenos_Aires"

      assert UserPreferencesService.get(user.id) == %{
               diet: "vegetarian",
               hard_restrictions: ["gluten"],
               soft_preferences: ["spicy food"]
             }

      assert length(Accounts.list_user_slot_cooking_times(user.id)) == 3
    end

    test "a second call replaces the data and keeps the original timestamp", %{
      user: user,
      account: account,
      token: token
    } do
      first = token |> complete(@body) |> json_response(200)
      stamp = first["user"]["onboardingCompletedAt"]
      assert is_binary(stamp)

      replacement = %{
        "profile" => %{
          "displayName" => "Ana",
          "householdSize" => 2,
          "cookingSkill" => "advanced"
        },
        "preferences" => %{"diet" => "vegan", "hardRestrictions" => [], "softPreferences" => []},
        "slotCookingTimes" => %{
          "breakfast" => %{"cookingTimeMinutes" => 5, "hungerLevel" => "strong"},
          "lunch" => %{"cookingTimeMinutes" => 20, "hungerLevel" => "light"},
          "dinner" => %{"cookingTimeMinutes" => 60, "hungerLevel" => "normal"}
        },
        "timezone" => "Europe/Madrid"
      }

      second = token |> complete(replacement) |> json_response(200)

      assert second["user"] == %{
               "id" => user.id,
               "displayName" => "Ana",
               "householdSize" => 2,
               "cookingSkill" => "advanced",
               "onboardingCompletedAt" => stamp
             }

      assert second["preferences"] == replacement["preferences"]
      assert second["slotCookingTimes"] == replacement["slotCookingTimes"]
      assert Repo.get!(Account, account.id).timezone == "Europe/Madrid"
      assert length(Accounts.list_user_slot_cooking_times(user.id)) == 3
    end

    test "GET /api/me reports onboarding.isComplete afterwards", %{token: token} do
      assert %{"onboarding" => %{"isComplete" => false}} = token |> me() |> json_response(200)

      token |> complete(@body) |> json_response(200)

      assert %{"onboarding" => %{"isComplete" => true}} = token |> me() |> json_response(200)
    end

    test "requires authentication", %{conn: conn} do
      assert %{"error" => %{"code" => "unauthenticated"}} =
               conn
               |> put_req_header("content-type", "application/json")
               |> post(@path, Jason.encode!(@body))
               |> json_response(401)
    end
  end

  describe "a body with an invalid field" do
    test "in the profile answers 422 and persists nothing", %{token: token} = ctx do
      body = put_in(@body, ["profile", "householdSize"], 0)

      assert %{"error" => %{"code" => "validation_error", "message" => message}} =
               token |> complete(body) |> json_response(422)

      assert message =~ "householdSize"
      assert_nothing_persisted(ctx)
    end

    test "with an unknown cooking skill answers invalid_cooking_skill", %{token: token} = ctx do
      body = put_in(@body, ["profile", "cookingSkill"], "wizard")

      assert %{"error" => %{"code" => "invalid_cooking_skill"}} =
               token |> complete(body) |> json_response(422)

      assert_nothing_persisted(ctx)
    end

    test "in the preferences answers 422 and persists nothing", %{token: token} = ctx do
      body = put_in(@body, ["preferences", "diet"], "carnivore")

      assert %{"error" => %{"code" => "invalid_diet"}} =
               token |> complete(body) |> json_response(422)

      body = put_in(@body, ["preferences", "softPreferences"], "not a list")

      assert %{"error" => %{"code" => "validation_error", "message" => message}} =
               token |> complete(body) |> json_response(422)

      assert message =~ "softPreferences"
      assert_nothing_persisted(ctx)
    end

    test "in the slot cooking times answers 422 and persists nothing", %{token: token} = ctx do
      body = put_in(@body, ["slotCookingTimes", "lunch", "cookingTimeMinutes"], 241)

      assert %{"error" => %{"code" => "validation_error", "message" => message}} =
               token |> complete(body) |> json_response(422)

      assert message =~ "lunch.cookingTimeMinutes"

      body = put_in(@body, ["slotCookingTimes", "dinner", "hungerLevel"], "starving")

      assert %{"error" => %{"code" => "invalid_hunger_level"}} =
               token |> complete(body) |> json_response(422)

      assert_nothing_persisted(ctx)
    end

    test "with an unknown timezone answers 422 and persists nothing", %{token: token} = ctx do
      body = Map.put(@body, "timezone", "Mars/Olympus_Mons")

      assert %{"error" => %{"code" => "validation_error", "message" => message}} =
               token |> complete(body) |> json_response(422)

      assert message =~ "timezone"
      assert_nothing_persisted(ctx)
    end

    test "with a missing or mistyped timezone answers 422", %{token: token} = ctx do
      assert %{"error" => %{"code" => "validation_error"}} =
               token |> complete(Map.delete(@body, "timezone")) |> json_response(422)

      assert %{"error" => %{"code" => "validation_error"}} =
               token |> complete(Map.put(@body, "timezone", 3)) |> json_response(422)

      assert_nothing_persisted(ctx)
    end

    test "the first invalid group in profile, preferences, slots order decides", %{token: token} do
      body =
        @body
        |> put_in(["profile", "householdSize"], 0)
        |> put_in(["preferences", "diet"], "carnivore")

      assert %{"error" => %{"message" => message}} = token |> complete(body) |> json_response(422)
      assert message =~ "householdSize"

      body = put_in(@body, ["preferences", "diet"], "carnivore")

      assert %{"error" => %{"code" => "invalid_diet"}} =
               token |> complete(body) |> json_response(422)
    end

    test "a missing group answers 422", %{token: token} = ctx do
      for group <- ["profile", "preferences", "slotCookingTimes"] do
        assert %{"error" => %{"code" => "validation_error"}} =
                 token |> complete(Map.delete(@body, group)) |> json_response(422)
      end

      assert_nothing_persisted(ctx)
    end
  end

  describe "OnboardingService.complete/3" do
    test "rolls back every earlier step when a late one fails", %{
      user: user,
      account: account
    } do
      # Slot times that were never validated: the last step refuses them
      # after the profile, timezone and preferences were already written.
      attrs = %{
        profile: %{name: "Ana", household_size: 3, cooking_skill: "beginner"},
        timezone: "Europe/Madrid",
        preferences: %{diet: "vegan", hard_restrictions: ["gluten"], soft_preferences: ["x"]},
        slot_cooking_times: %{
          breakfast: %{cooking_time_minutes: 10, hunger_level: "light"},
          lunch: %{cooking_time_minutes: 10, hunger_level: "light"},
          dinner: %{cooking_time_minutes: 10, hunger_level: "bogus"}
        }
      }

      assert {:error, _reason} = OnboardingService.complete(user.id, account.id, attrs)

      assert_nothing_persisted(%{user: user, account: account})
    end
  end

  describe "an Account whose trial expired" do
    test "still completes onboarding", %{token: token, account: account} do
      persist_trial_window!(account, :expired)

      with_enforcement_enabled!(fn ->
        assert %{"error" => %{"code" => "trial_expired"}} =
                 build_conn()
                 |> put_req_header("authorization", "Bearer " <> token)
                 |> get("/api/planning/weekly")
                 |> json_response(403)

        assert %{"user" => %{"onboardingCompletedAt" => stamp}} =
                 token |> complete(@body) |> json_response(200)

        assert is_binary(stamp)
      end)
    end
  end

  # ---- helpers ---------------------------------------------------------------

  defp complete(token, body) do
    build_conn()
    |> put_req_header("authorization", "Bearer " <> token)
    |> put_req_header("content-type", "application/json")
    |> post(@path, Jason.encode!(body))
  end

  defp me(token) do
    build_conn()
    |> put_req_header("authorization", "Bearer " <> token)
    |> get("/api/me")
  end

  # The User, the Account and every stored group are as they were before.
  defp assert_nothing_persisted(%{user: user, account: account}) do
    stored = Repo.get!(User, user.id)
    assert stored.name == "Stored Name"
    assert stored.household_size == user.household_size
    assert stored.cooking_skill == user.cooking_skill
    assert stored.onboarding_completed_at == nil
    assert Repo.get!(Account, account.id).timezone == account.timezone

    assert UserPreferencesService.get(user.id) == %{
             diet: nil,
             hard_restrictions: [],
             soft_preferences: []
           }

    assert Accounts.list_user_slot_cooking_times(user.id) == []
  end
end
