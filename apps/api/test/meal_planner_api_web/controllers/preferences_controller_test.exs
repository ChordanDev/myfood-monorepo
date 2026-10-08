defmodule MealPlannerApiWeb.PreferencesControllerTest do
  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.FactoryHelpers

  alias MealPlannerApi.Persistence.Accounts

  alias MealPlannerApi.Persistence.Accounts.{
    Account,
    UserDietaryProfile,
    UserHardRestriction,
    UserPreference
  }

  alias MealPlannerApi.Repo

  describe "GET /api/me/preferences" do
    setup do
      user = insert_user!("preferences_read@example.com")
      [membership] = user.memberships

      %{user: user, membership: membership, token: issue_access_v2_token(user, membership)}
    end

    test "a request without a bearer token is rejected with 401 unauthenticated", %{conn: conn} do
      conn = get(conn, "/api/me/preferences")

      assert %{"error" => %{"code" => "unauthenticated", "message" => _}} =
               json_response(conn, 401)
    end

    test "a User with nothing stored gets an empty form, not a 404", %{conn: conn, token: token} do
      assert conn |> get_preferences(token) |> json_response(200) == %{
               "diet" => nil,
               "hardRestrictions" => [],
               "softPreferences" => []
             }
    end

    test "returns the stored Diet, Hard restrictions and Soft preferences", %{
      conn: conn,
      user: user,
      token: token
    } do
      put_diet!(user, :vegetarian)
      put_hard_restrictions!(user, ["soy", "tree_nut", "peanut"])
      put_preference!(user, soft_preferences: ["no cilantro", "extra spicy", "batch cooking"])

      body = conn |> get_preferences(token) |> json_response(200) |> assert_camel_case_keys()

      assert body == %{
               "diet" => "vegetarian",
               "hardRestrictions" => ["peanut", "tree_nut", "soy"],
               "softPreferences" => ["no cilantro", "extra spicy", "batch cooking"]
             }
    end

    test "Hard restrictions come back in catalog order whatever the insertion order", %{
      conn: conn,
      user: user,
      token: token
    } do
      put_hard_restrictions!(user, [
        "soy",
        "egg",
        "dairy",
        "gluten",
        "shellfish",
        "tree_nut",
        "peanut"
      ])

      body = conn |> get_preferences(token) |> json_response(200)

      assert body["hardRestrictions"] ==
               ["peanut", "tree_nut", "shellfish", "gluten", "dairy", "egg", "soy"]
    end

    test "a stored celiac Diet reads as no Diet and stays stored", %{
      conn: conn,
      user: user,
      token: token
    } do
      put_diet!(user, :celiac)

      body = conn |> get_preferences(token) |> json_response(200)

      assert body["diet"] == nil
      assert Repo.get_by!(UserDietaryProfile, user_id: user.id).diet_type == :celiac
    end

    test "another User's preferences are not returned", %{conn: conn, user: user, token: token} do
      other = insert_user!("preferences_read_other@example.com")

      put_diet!(other, :vegan)
      put_hard_restrictions!(other, ["gluten", "egg"])
      put_preference!(other, soft_preferences: ["no mushrooms"])

      put_hard_restrictions!(user, ["dairy"])

      assert conn |> get_preferences(token) |> json_response(200) == %{
               "diet" => nil,
               "hardRestrictions" => ["dairy"],
               "softPreferences" => []
             }
    end

    test "an Account whose Trial expired can still read", %{
      conn: conn,
      user: user,
      membership: membership,
      token: token
    } do
      expire_trial!(membership.account_id)
      put_diet!(user, :pescatarian)

      body = conn |> get_preferences(token) |> json_response(200)

      assert body["diet"] == "pescatarian"
    end

    test "the macro goal, the protein target and the default exclusions are left out", %{
      conn: conn,
      user: user,
      token: token
    } do
      put_diet!(user, :omnivore, :high_protein)

      put_preference!(user,
        protein_g_per_meal: 40,
        default_exclusions: ["pork"],
        soft_preferences: ["quick dinners"]
      )

      body = conn |> get_preferences(token) |> json_response(200)

      assert Map.keys(body) == ["diet", "hardRestrictions", "softPreferences"]
      assert body["softPreferences"] == ["quick dinners"]
    end
  end

  defp get_preferences(conn, token) do
    conn
    |> put_req_header("authorization", "Bearer " <> token)
    |> get("/api/me/preferences")
  end

  defp insert_user!(email) do
    user_with_memberships(%{email: email}, [
      {%{plan: :individual, name: "Preferences " <> email}, :owner}
    ])
  end

  defp put_diet!(user, diet_type, macro_goal \\ :balanced) do
    {:ok, profile} =
      Accounts.upsert_user_dietary_profile(user.id, %{
        diet_type: diet_type,
        macro_goal: macro_goal
      })

    profile
  end

  defp put_hard_restrictions!(user, codes) do
    Enum.each(codes, fn code ->
      %UserHardRestriction{}
      |> UserHardRestriction.changeset(%{user_id: user.id, code: code})
      |> Repo.insert!()
    end)
  end

  defp put_preference!(user, fields) do
    Repo.insert!(struct!(%UserPreference{user_id: user.id}, fields))
  end

  # Persists a 7-day trial window that ended a day ago.
  defp expire_trial!(account_id) do
    ends_at = DateTime.add(DateTime.utc_now(), -86_400, :second)

    Account
    |> Repo.get!(account_id)
    |> Account.changeset(%{
      trial_started_at: DateTime.add(ends_at, -7 * 86_400, :second),
      trial_ends_at: ends_at
    })
    |> Repo.update!()
  end
end
