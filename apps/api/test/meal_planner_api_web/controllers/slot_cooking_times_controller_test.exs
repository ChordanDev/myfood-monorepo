defmodule MealPlannerApiWeb.SlotCookingTimesControllerTest do
  @moduledoc """
  `GET` and `PUT /api/me/slot-cooking-times` (issue #19) as the mobile app
  calls them: JSON bodies with camelCase keys in both directions and the
  `ApiError` envelope for every refusal.
  """
  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.FactoryHelpers

  import MealPlannerApiWeb.ChannelHelpers,
    only: [persist_trial_window!: 2, with_enforcement_enabled!: 1]

  alias MealPlannerApi.Repo
  alias MealPlannerApiWeb.MobileFixtures

  @path "/api/me/slot-cooking-times"

  # The frozen bodies the mobile Slot cooking times code is tested against:
  # a saved set and the refusal a User with none gets. The tests below keep
  # them from drifting away from the route.
  @fixture "preferences/fixtures/slotCookingTimes.json"
  @not_found_fixture "preferences/fixtures/slotCookingTimesNotFound.json"

  @times %{
    "breakfast" => %{"cookingTimeMinutes" => 10, "hungerLevel" => "light"},
    "lunch" => %{"cookingTimeMinutes" => 45, "hungerLevel" => "normal"},
    "dinner" => %{"cookingTimeMinutes" => 30, "hungerLevel" => "strong"}
  }

  @snake_times %{
    "breakfast" => %{"cooking_time_minutes" => 10, "hunger_level" => "light"},
    "lunch" => %{"cooking_time_minutes" => 45, "hunger_level" => "normal"},
    "dinner" => %{"cooking_time_minutes" => 30, "hunger_level" => "strong"}
  }

  setup do
    %{user: user, token: token, membership: membership} = signed_in_user()
    %{user: user, token: token, account: membership.account}
  end

  describe "GET /api/me/slot-cooking-times" do
    test "answers 404 slot_cooking_times_not_found until a set is saved", %{token: token} do
      assert %{"error" => %{"code" => "slot_cooking_times_not_found", "message" => message}} =
               token |> get_times() |> json_response(404)

      assert is_binary(message) and message != ""
    end

    test "returns the saved set, each slot with camelCase keys", %{token: token} do
      assert token |> put_times(@times) |> json_response(200) == @times
      assert token |> get_times() |> json_response(200) == @times
    end

    test "the 404 is the frozen mobile error fixture", %{token: token} do
      fixture = MobileFixtures.read!(@not_found_fixture)

      assert Map.keys(fixture) == ["error"]
      assert token |> get_times() |> json_response(404) == fixture
    end

    test "PUT and GET answer the frozen mobile payload fixture, key for key", %{token: token} do
      fixture = MobileFixtures.read!(@fixture)

      assert fixture |> Map.keys() |> Enum.sort() == ["breakfast", "dinner", "lunch"]

      saved = token |> put_times(fixture) |> json_response(200)
      read = token |> get_times() |> json_response(200)

      assert MobileFixtures.key_shape(saved) == MobileFixtures.key_shape(fixture)
      assert saved == fixture
      assert read == fixture
    end

    test "never shows one User the times of another", %{token: token} do
      other = signed_in_user()
      theirs = put_in(@times, ["dinner", "cookingTimeMinutes"], 90)

      assert other.token |> put_times(theirs) |> json_response(200) == theirs

      assert %{"error" => %{"code" => "slot_cooking_times_not_found"}} =
               token |> get_times() |> json_response(404)

      assert token |> put_times(@times) |> json_response(200) == @times
      assert other.token |> get_times() |> json_response(200) == theirs
    end

    test "requires authentication", %{conn: conn} do
      assert %{"error" => %{"code" => "unauthenticated"}} =
               conn |> get(@path) |> json_response(401)
    end
  end

  describe "PUT /api/me/slot-cooking-times" do
    test "replaces the previous set", %{token: token} do
      replacement = %{
        "breakfast" => %{"cookingTimeMinutes" => 5, "hungerLevel" => "strong"},
        "lunch" => %{"cookingTimeMinutes" => 20, "hungerLevel" => "light"},
        "dinner" => %{"cookingTimeMinutes" => 60, "hungerLevel" => "normal"}
      }

      assert token |> put_times(@times) |> json_response(200) == @times
      assert token |> put_times(replacement) |> json_response(200) == replacement
      assert token |> get_times() |> json_response(200) == replacement
    end

    test "accepts 0 and 240 minutes", %{token: token} do
      times =
        @times
        |> put_in(["breakfast", "cookingTimeMinutes"], 0)
        |> put_in(["dinner", "cookingTimeMinutes"], 240)

      assert token |> put_times(times) |> json_response(200) == times
    end

    test "requires authentication", %{conn: conn} do
      assert %{"error" => %{"code" => "unauthenticated"}} =
               conn |> put(@path, @times) |> json_response(401)
    end

    test "refuses a body with a slot missing and names it", %{token: token} do
      for slot <- ["breakfast", "lunch", "dinner"] do
        assert {slot, validation_error(token, Map.delete(@times, slot))} ==
                 {slot, "The field #{slot} is not valid."}
      end

      assert validation_error(token, %{}) == "The field breakfast is not valid."
    end

    test "refuses a body that is not a JSON object and names no field", %{token: token} do
      for body <- [[], [@times], 30, "breakfast", true, nil] do
        assert {body, validation_error(token, body)} == {body, "The request is not valid."}
      end
    end

    test "refuses a body that no parser read", %{token: token} do
      conn =
        build_conn()
        |> authorize(token)
        |> put_req_header("content-type", "text/plain")
        |> put(@path, "hello")

      assert %{"error" => %{"code" => "validation_error", "message" => message}} =
               json_response(conn, 422)

      assert message == "The request is not valid."
    end

    test "treats _json as any other key that is not a slot", %{token: token} do
      assert validation_error(token, Map.put(@times, "_json", [])) ==
               "The field _json is not valid."
    end

    test "refuses a slot that is not an object", %{token: token} do
      for value <- [nil, 30, "normal", [10, "light"]] do
        assert validation_error(token, Map.put(@times, "lunch", value)) ==
                 "The field lunch is not valid."
      end
    end

    test "refuses snack, and any other key that is not one of the three slots", %{token: token} do
      assert validation_error(token, Map.put(@times, "snack", @times["lunch"])) ==
               "The field snack is not valid."

      assert validation_error(token, Map.put(@times, "midnightSnack", @times["lunch"])) ==
               "The field midnightSnack is not valid."
    end

    test "refuses minutes that are missing, not an integer or outside 0 to 240", %{token: token} do
      for minutes <- [-1, 241, 30.0, 30.5, "30", true, nil] do
        times = put_in(@times, ["lunch", "cookingTimeMinutes"], minutes)

        assert {minutes, validation_error(token, times)} ==
                 {minutes, "The field lunch.cookingTimeMinutes is not valid."}
      end

      missing = Map.update!(@times, "lunch", &Map.delete(&1, "cookingTimeMinutes"))

      assert validation_error(token, missing) ==
               "The field lunch.cookingTimeMinutes is not valid."
    end

    test "refuses a Hunger level that is missing or not a string", %{token: token} do
      for hunger_level <- [nil, 2, true, ["light"]] do
        times = put_in(@times, ["dinner", "hungerLevel"], hunger_level)

        assert {hunger_level, validation_error(token, times)} ==
                 {hunger_level, "The field dinner.hungerLevel is not valid."}
      end

      missing = Map.update!(@times, "dinner", &Map.delete(&1, "hungerLevel"))

      assert validation_error(token, missing) == "The field dinner.hungerLevel is not valid."
    end

    test "refuses a Hunger level outside the catalog with invalid_hunger_level", %{token: token} do
      for hunger_level <- ["ravenous", "LIGHT", ""] do
        times = put_in(@times, ["breakfast", "hungerLevel"], hunger_level)

        assert %{"error" => %{"code" => "invalid_hunger_level", "message" => message}} =
                 token |> put_times(times) |> json_response(422)

        assert is_binary(message) and message != ""
      end
    end

    test "reports the first slot at fault, and its minutes before its Hunger level", %{
      token: token
    } do
      both_in_one_slot =
        Map.put(@times, "lunch", %{"cookingTimeMinutes" => 999, "hungerLevel" => "ravenous"})

      assert validation_error(token, both_in_one_slot) ==
               "The field lunch.cookingTimeMinutes is not valid."

      hunger_level_first =
        @times
        |> put_in(["breakfast", "hungerLevel"], "ravenous")
        |> put_in(["dinner", "cookingTimeMinutes"], 999)

      assert %{"error" => %{"code" => "invalid_hunger_level"}} =
               token |> put_times(hunger_level_first) |> json_response(422)
    end

    test "keeps the previous set when the new one is refused", %{token: token} do
      assert token |> put_times(@times) |> json_response(200) == @times

      refused = put_in(@times, ["dinner", "cookingTimeMinutes"], 241)

      assert token |> put_times(refused) |> json_response(422)
      assert token |> put_times(Map.put(@times, "snack", @times["lunch"])) |> json_response(422)
      assert token |> get_times() |> json_response(200) == @times
    end
  end

  describe "a User deleted between authentication and the write" do
    # Authentication loads the User, so a deleted one is answered 401 before
    # the action runs. The action is called directly with the User it was
    # handed, as when the delete lands in between.
    @tag :capture_log
    test "answers 500 and logs the changeset errors", %{user: user} do
      Repo.delete!(user)

      conn =
        build_conn()
        |> Map.put(:body_params, @snake_times)
        |> Guardian.Plug.put_current_resource(user)

      log =
        ExUnit.CaptureLog.capture_log([level: :error], fn ->
          conn = MealPlannerApiWeb.SlotCookingTimesController.update(conn, %{})
          send(self(), {:conn, conn})
        end)

      assert_received {:conn, conn}
      assert %{"error" => %{"code" => "unknown_error"}} = json_response(conn, 500)
      assert log =~ "[error]"
      assert log =~ "Slot cooking times write failed for user #{user.id}"
      assert log =~ ~s(user_id: {"does not exist")
    end
  end

  describe "an Account whose trial expired" do
    test "still reads and replaces its User's times", %{token: token, account: account} do
      persist_trial_window!(account, :expired)

      with_enforcement_enabled!(fn ->
        # The same request is refused on a route behind the capability guard.
        assert %{"error" => %{"code" => "trial_expired"}} =
                 build_conn()
                 |> authorize(token)
                 |> get("/api/planning/weekly")
                 |> json_response(403)

        assert %{"error" => %{"code" => "slot_cooking_times_not_found"}} =
                 token |> get_times() |> json_response(404)

        assert token |> put_times(@times) |> json_response(200) == @times
        assert token |> get_times() |> json_response(200) == @times
      end)
    end
  end

  # ---- helpers ---------------------------------------------------------------

  defp signed_in_user do
    user =
      user_with_memberships(%{email: "slot-times-#{Ecto.UUID.generate()}@example.com"}, [
        {%{plan: :individual, name: "Slot Times"}, :owner}
      ])

    [membership] = user.memberships
    %{user: user, membership: membership, token: issue_access_v2_token(user, membership)}
  end

  defp get_times(token), do: build_conn() |> authorize(token) |> get(@path)

  # Sent as a JSON document, so numbers, booleans and nulls reach the
  # controller as the JSON parser reads them.
  defp put_times(token, body) do
    build_conn()
    |> authorize(token)
    |> put_req_header("content-type", "application/json")
    |> put(@path, Jason.encode!(body))
  end

  defp authorize(conn, token), do: put_req_header(conn, "authorization", "Bearer " <> token)

  # The message of the 422 `validation_error` envelope `body` is refused with.
  defp validation_error(token, body) do
    assert %{"error" => %{"code" => "validation_error", "message" => message}} =
             token |> put_times(body) |> json_response(422)

    message
  end
end
