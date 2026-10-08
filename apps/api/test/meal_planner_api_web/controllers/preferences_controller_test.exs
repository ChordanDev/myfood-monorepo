defmodule MealPlannerApiWeb.PreferencesControllerTest do
  use MealPlannerApiWeb.ConnCase, async: false

  import Ecto.Query, only: [from: 2]
  import MealPlannerApi.FactoryHelpers
  import MealPlannerApiWeb.ChannelHelpers, only: [with_enforcement_enabled!: 1]

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

    test "an Account whose Trial expired can still read, while a gated route refuses the token",
         %{conn: conn, user: user, membership: membership, token: token} do
      expire_trial!(membership.account_id)
      put_diet!(user, :pescatarian)

      with_enforcement_enabled!(fn ->
        body = conn |> get_preferences(token) |> json_response(200)

        assert body["diet"] == "pescatarian"
        assert_refused_by_capability_gate(token)
      end)
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

  describe "PUT /api/me/preferences" do
    setup do
      user = insert_user!("preferences_write@example.com")
      [membership] = user.memberships

      %{user: user, membership: membership, token: issue_access_v2_token(user, membership)}
    end

    test "a request without a bearer token is rejected with 401 unauthenticated", %{conn: conn} do
      conn =
        conn
        |> put_req_header("content-type", "application/json")
        |> put("/api/me/preferences", Jason.encode!(valid_body()))

      assert %{"error" => %{"code" => "unauthenticated", "message" => _}} =
               json_response(conn, 401)
    end

    test "the first save stores the Diet, the Hard restrictions and the Soft preferences", %{
      conn: conn,
      user: user,
      token: token
    } do
      saved =
        conn
        |> put_preferences(token, %{
          "diet" => "vegetarian",
          "hardRestrictions" => ["soy", "peanut"],
          "softPreferences" => ["no cilantro", "extra spicy"]
        })
        |> json_response(200)
        |> assert_camel_case_keys()

      assert saved == %{
               "diet" => "vegetarian",
               "hardRestrictions" => ["peanut", "soy"],
               "softPreferences" => ["no cilantro", "extra spicy"]
             }

      assert build_conn() |> get_preferences(token) |> json_response(200) == saved

      assert Repo.get_by!(UserDietaryProfile, user_id: user.id).diet_type == :vegetarian
      assert stored_codes(user) == ["peanut", "soy"]

      assert Repo.get_by!(UserPreference, user_id: user.id).soft_preferences ==
               ["no cilantro", "extra spicy"]
    end

    test "a second save replaces the Hard restrictions and the Soft preferences", %{
      conn: conn,
      user: user,
      token: token
    } do
      conn
      |> put_preferences(token, %{
        "diet" => "vegetarian",
        "hardRestrictions" => ["peanut", "soy", "gluten"],
        "softPreferences" => ["no cilantro", "extra spicy"]
      })
      |> json_response(200)

      saved =
        build_conn()
        |> put_preferences(token, %{
          "diet" => "vegan",
          "hardRestrictions" => ["gluten", "egg", "gluten"],
          "softPreferences" => [
            "  batch cooking  ",
            "",
            "   ",
            "extra spicy",
            "batch cooking",
            "extra spicy"
          ]
        })
        |> json_response(200)

      assert saved == %{
               "diet" => "vegan",
               "hardRestrictions" => ["gluten", "egg"],
               "softPreferences" => ["batch cooking", "extra spicy"]
             }

      assert build_conn() |> get_preferences(token) |> json_response(200) == saved

      assert Repo.get_by!(UserDietaryProfile, user_id: user.id).diet_type == :vegan
      assert stored_codes(user) == ["egg", "gluten"]

      assert Repo.get_by!(UserPreference, user_id: user.id).soft_preferences ==
               ["batch cooking", "extra spicy"]
    end

    test "an empty save clears everything that was stored", %{
      conn: conn,
      user: user,
      token: token
    } do
      put_diet!(user, :vegetarian)
      put_hard_restrictions!(user, ["dairy", "egg"])
      put_preference!(user, soft_preferences: ["quick dinners"])

      body = %{"diet" => nil, "hardRestrictions" => [], "softPreferences" => []}

      assert conn |> put_preferences(token, body) |> json_response(200) == body

      assert Repo.get_by!(UserDietaryProfile, user_id: user.id).diet_type == nil
      assert stored_codes(user) == []
      assert Repo.get_by!(UserPreference, user_id: user.id).soft_preferences == []
    end

    test "a null Diet with no dietary profile creates none", %{
      conn: conn,
      user: user,
      token: token
    } do
      body = %{"diet" => nil, "hardRestrictions" => ["egg"], "softPreferences" => []}

      assert conn |> put_preferences(token, body) |> json_response(200) == body

      assert Repo.get_by(UserDietaryProfile, user_id: user.id) == nil
    end

    test "a Diet saved on a new dietary profile leaves the macro goal empty", %{
      conn: conn,
      user: user,
      token: token
    } do
      conn |> put_preferences(token, valid_body()) |> json_response(200)

      profile = Repo.get_by!(UserDietaryProfile, user_id: user.id)

      assert profile.diet_type == :vegan
      assert profile.macro_goal == nil
    end

    test "saving or clearing the Diet leaves a stored macro goal as it was", %{
      conn: conn,
      user: user,
      token: token
    } do
      put_diet!(user, :omnivore, :high_protein)

      conn |> put_preferences(token, valid_body()) |> json_response(200)

      assert %{diet_type: :vegan, macro_goal: :high_protein} =
               Repo.get_by!(UserDietaryProfile, user_id: user.id)

      cleared = build_conn() |> put_preferences(token, %{valid_body() | "diet" => nil})

      assert json_response(cleared, 200)["diet"] == nil

      assert %{diet_type: nil, macro_goal: :high_protein} =
               Repo.get_by!(UserDietaryProfile, user_id: user.id)
    end

    test "a null Diet leaves a stored celiac Diet untouched", %{
      conn: conn,
      user: user,
      token: token
    } do
      put_diet!(user, :celiac)

      body = %{"diet" => nil, "hardRestrictions" => ["gluten"], "softPreferences" => ["no oats"]}

      assert conn |> put_preferences(token, body) |> json_response(200) == body

      assert Repo.get_by!(UserDietaryProfile, user_id: user.id).diet_type == :celiac
      assert stored_codes(user) == ["gluten"]
    end

    test "saving a Diet replaces a stored celiac Diet", %{conn: conn, user: user, token: token} do
      put_diet!(user, :celiac)

      assert %{"diet" => "vegan"} =
               conn |> put_preferences(token, valid_body()) |> json_response(200)

      assert Repo.get_by!(UserDietaryProfile, user_id: user.id).diet_type == :vegan
    end

    test "the protein target and the default exclusions are left as they were", %{
      conn: conn,
      user: user,
      token: token
    } do
      put_preference!(user,
        protein_g_per_meal: 40,
        default_exclusions: ["pork"],
        soft_preferences: ["quick dinners"]
      )

      conn |> put_preferences(token, valid_body()) |> json_response(200)

      assert %{
               protein_g_per_meal: 40,
               default_exclusions: ["pork"],
               soft_preferences: ["no cilantro"]
             } = Repo.get_by!(UserPreference, user_id: user.id)
    end

    test "another User's preferences are left as they were", %{conn: conn, token: token} do
      other = insert_user!("preferences_write_other@example.com")

      put_diet!(other, :pescatarian)
      put_hard_restrictions!(other, ["gluten", "egg"])
      put_preference!(other, soft_preferences: ["no mushrooms"])

      before = stored(other)

      conn
      |> put_preferences(token, %{
        "diet" => nil,
        "hardRestrictions" => [],
        "softPreferences" => []
      })
      |> json_response(200)

      assert stored(other) == before
    end

    test "an Account whose Trial expired can still write, while a gated route refuses the token",
         %{conn: conn, user: user, membership: membership, token: token} do
      expire_trial!(membership.account_id)

      with_enforcement_enabled!(fn ->
        body = conn |> put_preferences(token, valid_body()) |> json_response(200)

        assert body["diet"] == "vegan"
        assert_refused_by_capability_gate(token)
      end)

      assert Repo.get_by!(UserDietaryProfile, user_id: user.id).diet_type == :vegan
    end

    test "Soft preferences at the limits are accepted", %{conn: conn, token: token} do
      # 80 characters, not 80 bytes: each "ñ" takes two bytes.
      longest = String.duplicate("ñ", 80)
      twenty = Enum.map(1..20, &"preference #{&1}")

      at_length = conn |> put_preferences(token, %{valid_body() | "softPreferences" => [longest]})

      assert json_response(at_length, 200)["softPreferences"] == [longest]

      at_count =
        build_conn() |> put_preferences(token, %{valid_body() | "softPreferences" => twenty})

      assert json_response(at_count, 200)["softPreferences"] == twenty
    end

    test "the Soft preference limits apply after the entries are normalized", %{
      conn: conn,
      token: token
    } do
      twenty = Enum.map(1..20, &"preference #{&1}")
      padded = "  " <> String.duplicate("a", 80) <> "  "

      # 22 raw entries, 20 once the blank one and the duplicate are gone.
      over_count =
        conn
        |> put_preferences(token, %{
          valid_body()
          | "softPreferences" => twenty ++ ["   ", "preference 1"]
        })

      assert json_response(over_count, 200)["softPreferences"] == twenty

      over_length =
        build_conn() |> put_preferences(token, %{valid_body() | "softPreferences" => [padded]})

      assert json_response(over_length, 200)["softPreferences"] == [String.trim(padded)]
    end
  end

  describe "PUT /api/me/preferences with a body that is not valid" do
    setup do
      user = insert_user!("preferences_rejected@example.com")
      [membership] = user.memberships

      put_diet!(user, :omnivore, :high_protein)
      put_hard_restrictions!(user, ["dairy"])

      put_preference!(user,
        protein_g_per_meal: 40,
        default_exclusions: ["pork"],
        soft_preferences: ["quick dinners"]
      )

      %{user: user, token: issue_access_v2_token(user, membership)}
    end

    test "a missing or mistyped diet is a validation_error naming diet", context do
      assert_validation_error(context, Map.delete(valid_body(), "diet"), "diet")

      for diet <- [7, true, ["vegan"], %{"code" => "vegan"}] do
        assert_validation_error(context, %{valid_body() | "diet" => diet}, "diet")
      end
    end

    test "a Diet outside the mobile codes is an invalid_diet", context do
      for diet <- ["celiac", "keto", "Vegan", ""] do
        rejected_message(context, %{valid_body() | "diet" => diet}, "invalid_diet")
      end
    end

    test "missing or mistyped hardRestrictions are a validation_error naming hardRestrictions",
         context do
      missing = Map.delete(valid_body(), "hardRestrictions")

      assert_validation_error(context, missing, "hardRestrictions")

      for value <- [nil, "gluten", 7, %{"gluten" => true}, ["gluten", 7], [nil], ["sesame", 7]] do
        body = %{valid_body() | "hardRestrictions" => value}

        assert_validation_error(context, body, "hardRestrictions")
      end
    end

    test "a Hard restriction outside the catalog is an invalid_hard_restriction", context do
      for codes <- [["sesame"], ["gluten", "celiac"], ["Gluten"], [""]] do
        body = %{valid_body() | "hardRestrictions" => codes}

        rejected_message(context, body, "invalid_hard_restriction")
      end
    end

    test "missing or mistyped softPreferences are a validation_error naming softPreferences",
         context do
      missing = Map.delete(valid_body(), "softPreferences")

      assert_validation_error(context, missing, "softPreferences")

      for value <- [nil, "no cilantro", 7, %{"0" => "no cilantro"}, ["ok", 3], [nil], [["ok"]]] do
        body = %{valid_body() | "softPreferences" => value}

        assert_validation_error(context, body, "softPreferences")
      end
    end

    test "a Soft preference over 80 characters is a validation_error", context do
      body = %{valid_body() | "softPreferences" => ["fine", String.duplicate("a", 81)]}

      assert_validation_error(context, body, "softPreferences")
    end

    test "more than 20 Soft preferences are a validation_error", context do
      body = %{valid_body() | "softPreferences" => Enum.map(1..21, &"preference #{&1}")}

      assert_validation_error(context, body, "softPreferences")
    end

    # Postgres cannot store a NUL character in text, so the entry has to be
    # refused before the write instead of failing inside it.
    test "a Soft preference with a NUL character is a validation_error", context do
      body = %{valid_body() | "softPreferences" => ["fine", "a\u0000b"]}

      assert_validation_error(context, body, "softPreferences")
    end

    # The column holds 255 code points an entry, and one character can be
    # several: here 80 characters of four code points each.
    test "a Soft preference of 80 characters the column cannot hold is a validation_error",
         context do
      stacked = String.duplicate("é̂̃", 80)
      assert String.length(stacked) == 80

      body = %{valid_body() | "softPreferences" => ["fine", stacked]}

      assert_validation_error(context, body, "softPreferences")
    end

    test "a Soft preference of 80 characters with several code points each is accepted", %{
      conn: conn,
      token: token
    } do
      # 80 characters, 240 code points.
      stacked = String.duplicate("é̂", 80)
      body = %{valid_body() | "softPreferences" => [stacked]}

      response = conn |> put_preferences(token, body) |> json_response(200)

      assert response["softPreferences"] == [stacked]
    end

    test "the first offending field decides the answer: diet, then hardRestrictions", context do
      twenty_one = Enum.map(1..21, &"preference #{&1}")

      rejected_message(
        context,
        %{"diet" => "keto", "hardRestrictions" => ["sesame"], "softPreferences" => twenty_one},
        "invalid_diet"
      )

      assert_validation_error(
        context,
        %{"diet" => 7, "hardRestrictions" => ["sesame"], "softPreferences" => twenty_one},
        "diet"
      )

      rejected_message(
        context,
        %{"diet" => "vegan", "hardRestrictions" => ["sesame"], "softPreferences" => twenty_one},
        "invalid_hard_restriction"
      )

      assert_validation_error(
        context,
        %{"diet" => "vegan", "hardRestrictions" => "sesame", "softPreferences" => twenty_one},
        "hardRestrictions"
      )
    end

    test "a rejected first save creates no rows", %{conn: conn} do
      user = insert_user!("preferences_rejected_first@example.com")
      [membership] = user.memberships
      token = issue_access_v2_token(user, membership)

      body = %{valid_body() | "softPreferences" => [String.duplicate("a", 81)]}

      assert %{"error" => %{"code" => "validation_error"}} =
               conn |> put_preferences(token, body) |> json_response(422)

      assert stored(user) == %{dietary_profile: nil, hard_restrictions: [], preference: nil}
    end
  end

  describe "Hard restriction storage" do
    test "the database refuses a code outside the catalog" do
      user = insert_user!("preferences_constraint@example.com")

      assert_raise Ecto.ConstraintError, ~r/user_hard_restrictions_code_check/, fn ->
        Repo.insert!(%UserHardRestriction{user_id: user.id, code: "sesame"})
      end
    end
  end

  defp get_preferences(conn, token) do
    conn
    |> put_req_header("authorization", "Bearer " <> token)
    |> get("/api/me/preferences")
  end

  # Sends the body as the app does: a JSON document with camelCase keys.
  defp put_preferences(conn, token, body) do
    conn
    |> put_req_header("authorization", "Bearer " <> token)
    |> put_req_header("content-type", "application/json")
    |> put("/api/me/preferences", Jason.encode!(body))
  end

  defp valid_body do
    %{"diet" => "vegan", "hardRestrictions" => ["gluten"], "softPreferences" => ["no cilantro"]}
  end

  # Sends a body that has to be refused with `code` and returns the message
  # of the envelope. The stored rows must be the same afterwards.
  defp rejected_message(%{user: user, token: token}, body, code) do
    before = stored(user)

    response = build_conn() |> put_preferences(token, body) |> json_response(422)

    assert %{"error" => %{"code" => ^code, "message" => message} = error} = response
    assert Map.keys(response) == ["error"]
    assert Map.keys(error) == ["code", "message"]
    assert is_binary(message) and message != ""
    assert stored(user) == before

    message
  end

  defp assert_validation_error(context, body, field) do
    assert rejected_message(context, body, "validation_error") =~ field
  end

  # Negative control for the capability exemption: the same token on a route
  # behind `:enforce_capability`. Without it the exemption tests would also
  # pass with a fixture the gate lets through.
  defp assert_refused_by_capability_gate(token) do
    conn =
      build_conn()
      |> put_req_header("authorization", "Bearer " <> token)
      |> get("/api/inventory")

    assert %{"error" => %{"code" => "trial_expired", "message" => _}} = json_response(conn, 403)
  end

  # Every row a save can write for a User, to compare before and after.
  defp stored(user) do
    %{
      dietary_profile: Repo.get_by(UserDietaryProfile, user_id: user.id),
      hard_restrictions:
        Repo.all(from(r in UserHardRestriction, where: r.user_id == ^user.id, order_by: r.code)),
      preference: Repo.get_by(UserPreference, user_id: user.id)
    }
  end

  defp stored_codes(user), do: Enum.map(stored(user).hard_restrictions, & &1.code)

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
