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

  @path "/api/me/slot-cooking-times"

  @times %{
    "breakfast" => %{"cookingTimeMinutes" => 10, "hungerLevel" => "light"},
    "lunch" => %{"cookingTimeMinutes" => 45, "hungerLevel" => "normal"},
    "dinner" => %{"cookingTimeMinutes" => 30, "hungerLevel" => "strong"}
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
                 {slot, "#{slot} is required."}
      end

      assert validation_error(token, %{}) == "breakfast is required."
    end

    test "refuses a body that is not a JSON object", %{token: token} do
      for body <- [[], [@times], 30, "breakfast", true, nil] do
        assert {body, validation_error(token, body)} ==
                 {body, "The request body must be an object."}
      end
    end

    test "treats _json as any other key that is not a slot", %{token: token} do
      assert validation_error(token, Map.put(@times, "_json", [])) ==
               "_json is not an accepted slot."
    end

    test "refuses a slot that is not an object", %{token: token} do
      for value <- [nil, 30, "normal", [10, "light"]] do
        assert validation_error(token, Map.put(@times, "lunch", value)) ==
                 "lunch must be an object."
      end
    end

    test "refuses snack, and any other key that is not one of the three slots", %{token: token} do
      assert validation_error(token, Map.put(@times, "snack", @times["lunch"])) ==
               "snack is not an accepted slot."

      assert validation_error(token, Map.put(@times, "midnightSnack", @times["lunch"])) ==
               "midnightSnack is not an accepted slot."
    end

    test "refuses minutes that are missing, not an integer or outside 0 to 240", %{token: token} do
      for minutes <- [-1, 241, 30.0, 30.5, "30", true, nil] do
        times = put_in(@times, ["lunch", "cookingTimeMinutes"], minutes)

        assert {minutes, validation_error(token, times)} ==
                 {minutes, "lunch.cookingTimeMinutes must be an integer between 0 and 240."}
      end

      missing = Map.update!(@times, "lunch", &Map.delete(&1, "cookingTimeMinutes"))

      assert validation_error(token, missing) ==
               "lunch.cookingTimeMinutes must be an integer between 0 and 240."
    end

    test "refuses a Hunger level that is missing or not a string", %{token: token} do
      for hunger_level <- [nil, 2, true, ["light"]] do
        times = put_in(@times, ["dinner", "hungerLevel"], hunger_level)

        assert {hunger_level, validation_error(token, times)} ==
                 {hunger_level, "dinner.hungerLevel must be a string."}
      end

      missing = Map.update!(@times, "dinner", &Map.delete(&1, "hungerLevel"))

      assert validation_error(token, missing) == "dinner.hungerLevel must be a string."
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
               "lunch.cookingTimeMinutes must be an integer between 0 and 240."

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
