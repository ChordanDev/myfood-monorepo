defmodule MealPlannerApiWeb.DietaryProfileControllerTest do
  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.FactoryHelpers

  alias MealPlannerApi.Persistence.Accounts.UserDietaryProfile
  alias MealPlannerApi.Persistence.Catalog.Ingredient
  alias MealPlannerApi.Repo

  describe "self-only dietary profile and exclusions" do
    test "an account owner can manage only their own profile and exclusions", %{conn: conn} do
      owner =
        user_with_memberships(%{email: "dietary-owner@example.com"}, [
          {%{plan: :family_4, name: "Dietary Family"}, :owner}
        ])

      [owner_membership] = owner.memberships

      member =
        user_with_memberships(%{email: "dietary-member@example.com"}, [])

      MealPlannerApi.Persistence.Accounts.AccountMembership.changeset(
        %MealPlannerApi.Persistence.Accounts.AccountMembership{},
        %{
          account_id: owner_membership.account_id,
          user_id: member.id,
          role: :member,
          status: :active,
          joined_at: DateTime.utc_now()
        }
      )
      |> Repo.insert!()

      ingredient =
        %Ingredient{}
        |> Ingredient.changeset(%{name: "Dietary Test Ingredient", category: :otros})
        |> Repo.insert!()

      token = issue_access_v2_token(owner, owner_membership)

      profile_conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> put("/api/account/dietary-profile", %{
          "user_id" => member.id,
          "diet_type" => "vegan",
          "macro_goal" => "high_protein"
        })

      profile = json_response(profile_conn, 200)["data"]
      assert profile["user_id"] == owner.id
      assert profile["diet_type"] == "vegan"
      assert profile["macro_goal"] == "high_protein"
      assert Repo.get_by(UserDietaryProfile, user_id: member.id) == nil

      show_conn =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/account/dietary-profile")

      assert json_response(show_conn, 200)["data"] == profile

      exclusion_conn =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> token)
        |> post("/api/account/excluded-ingredients", %{
          "ingredient_id" => ingredient.id,
          "reason" => "allergy"
        })

      exclusion = json_response(exclusion_conn, 201)["data"]
      assert exclusion == %{"ingredient_id" => ingredient.id, "reason" => "allergy"}

      list_conn =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/account/excluded-ingredients")

      assert json_response(list_conn, 200)["data"] == [exclusion]

      delete_conn =
        build_conn()
        |> put_req_header("authorization", "Bearer " <> token)
        |> delete("/api/account/excluded-ingredients/#{ingredient.id}")

      assert response(delete_conn, 204) == ""
    end
  end

  # `PUT /api/me/preferences` (issue #18) can leave a dietary profile without
  # a Diet, and creates one without a macro goal.
  describe "a dietary profile the mobile app wrote" do
    setup do
      user =
        user_with_memberships(%{email: "dietary-mobile@example.com"}, [
          {%{plan: :individual, name: "Dietary Mobile"}, :owner}
        ])

      [membership] = user.memberships

      %{user: user, token: issue_access_v2_token(user, membership)}
    end

    test "reads a missing Diet and a missing macro goal as null", %{
      conn: conn,
      user: user,
      token: token
    } do
      Repo.insert!(%UserDietaryProfile{user_id: user.id})

      conn =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/account/dietary-profile")

      assert %{"user_id" => user_id, "diet_type" => nil, "macro_goal" => nil} =
               json_response(conn, 200)["data"]

      assert user_id == user.id
    end

    test "the legacy write still requires a Diet and a macro goal", %{
      conn: conn,
      user: user,
      token: token
    } do
      for attrs <- [%{"diet_type" => "vegan"}, %{"macro_goal" => "balanced"}] do
        conn =
          conn
          |> put_req_header("authorization", "Bearer " <> token)
          |> put("/api/account/dietary-profile", attrs)

        assert json_response(conn, 422) == %{"error" => "invalid_dietary_profile"}
      end

      assert Repo.get_by(UserDietaryProfile, user_id: user.id) == nil
    end
  end
end
