defmodule MealPlannerApiWeb.ProfileControllerTest do
  @moduledoc """
  `PUT /api/me/profile` through the router (issue #17): the Onboarding
  profile edit, its validation order and its error codes. Request bodies are
  sent as JSON text, so a value keeps the JSON type the client wrote.
  """
  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.FactoryHelpers

  import MealPlannerApiWeb.ChannelHelpers,
    only: [persist_trial_window!: 2, with_enforcement_enabled!: 1]

  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Repo
  alias MealPlannerApiWeb.ProfileController

  @path "/api/me/profile"
  @email "profile_edit@example.com"
  @profile %{
    "displayName" => "Ana María",
    "householdSize" => 4,
    "cookingSkill" => "intermediate"
  }

  setup do
    user =
      user_with_memberships(%{email: @email, name: "Stored Name"}, [
        {%{plan: :individual, name: "Profile Edit"}, :owner}
      ])

    [membership] = user.memberships
    %{user: user, membership: membership, token: issue_access_v2_token(user, membership)}
  end

  describe "PUT /api/me/profile" do
    test "stores the three fields and returns the user object", %{
      conn: conn,
      user: user,
      token: token
    } do
      assert conn |> put_profile(token, @profile) |> json_response(200) == %{
               "user" => %{
                 "id" => user.id,
                 "email" => @email,
                 "displayName" => "Ana María",
                 "householdSize" => 4,
                 "cookingSkill" => "intermediate"
               }
             }

      assert %User{name: "Ana María", household_size: 4, cooking_skill: "intermediate"} =
               Repo.get!(User, user.id)
    end

    test "stores and returns the name trimmed", %{conn: conn, user: user, token: token} do
      body =
        conn
        |> put_profile(token, %{@profile | "displayName" => "  Ana María \n"})
        |> json_response(200)

      assert body["user"]["displayName"] == "Ana María"
      assert Repo.get!(User, user.id).name == "Ana María"
    end

    test "GET /api/me returns the stored profile afterwards", %{conn: conn, token: token} do
      %{"user" => saved} = conn |> put_profile(token, @profile) |> json_response(200)

      me =
        conn
        |> put_req_header("authorization", "Bearer " <> token)
        |> get("/api/me")
        |> json_response(200)

      assert me["user"] == saved

      assert %{
               "displayName" => "Ana María",
               "householdSize" => 4,
               "cookingSkill" => "intermediate"
             } =
               me["user"]
    end

    test "accepts a name of 64 characters and rejects one of 65", %{conn: conn, token: token} do
      name = String.duplicate("ñ", 64)

      accepted = put_profile(conn, token, %{@profile | "displayName" => name})
      assert json_response(accepted, 200)["user"]["displayName"] == name

      rejected = put_profile(conn, token, %{@profile | "displayName" => name <> "ñ"})
      assert_validation_error(rejected, "displayName")
    end

    test "accepts a Household size of 1 and of 20", %{conn: conn, token: token} do
      for size <- [1, 20] do
        body =
          conn |> put_profile(token, %{@profile | "householdSize" => size}) |> json_response(200)

        assert body["user"]["householdSize"] == size
      end
    end

    test "accepts every Cooking skill of the catalog", %{conn: conn, token: token} do
      for skill <- User.cooking_skills() do
        body =
          conn |> put_profile(token, %{@profile | "cookingSkill" => skill}) |> json_response(200)

        assert body["user"]["cookingSkill"] == skill
      end
    end

    test "reads nothing but the three profile fields from the body", %{
      conn: conn,
      user: user,
      token: token
    } do
      body =
        Map.merge(@profile, %{
          "id" => Ecto.UUID.generate(),
          "email" => "other@example.com",
          "onboardingCompletedAt" => "2026-01-01T00:00:00Z"
        })

      assert conn |> put_profile(token, body) |> json_response(200)

      assert %User{id: id, email: @email, onboarding_completed_at: nil} = Repo.get!(User, user.id)
      assert id == user.id
    end
  end

  describe "PUT /api/me/profile — rejected fields" do
    test "displayName missing, null, not a string, blank or too long is a validation_error", %{
      conn: conn,
      token: token
    } do
      assert_validation_error(
        put_profile(conn, token, Map.delete(@profile, "displayName")),
        "displayName"
      )

      for name <- [nil, 12, ["Ana"], "", "   ", String.duplicate("a", 65)] do
        conn = put_profile(conn, token, %{@profile | "displayName" => name})

        assert_validation_error(conn, "displayName")
      end
    end

    test "householdSize missing, null, not a JSON integer or out of range is a validation_error",
         %{conn: conn, token: token} do
      assert_validation_error(
        put_profile(conn, token, Map.delete(@profile, "householdSize")),
        "householdSize"
      )

      for size <- [nil, "4", 4.5, 4.0, true, 0, 21, -1] do
        conn = put_profile(conn, token, %{@profile | "householdSize" => size})

        assert_validation_error(conn, "householdSize")
      end
    end

    test "cookingSkill missing, null or not a string is a validation_error", %{
      conn: conn,
      token: token
    } do
      assert_validation_error(
        put_profile(conn, token, Map.delete(@profile, "cookingSkill")),
        "cookingSkill"
      )

      for skill <- [nil, 3, ["beginner"]] do
        conn = put_profile(conn, token, %{@profile | "cookingSkill" => skill})

        assert_validation_error(conn, "cookingSkill")
      end
    end

    test "a cookingSkill string outside the catalog is invalid_cooking_skill", %{
      conn: conn,
      token: token
    } do
      for skill <- ["expert", "Intermediate", ""] do
        conn = put_profile(conn, token, %{@profile | "cookingSkill" => skill})

        assert %{"error" => %{"code" => "invalid_cooking_skill", "message" => message}} =
                 json_response(conn, 422)

        assert is_binary(message) and message != ""
      end
    end

    test "the first offending field decides the answer", %{conn: conn, token: token} do
      unknown_skill = %{@profile | "cookingSkill" => "expert"}

      assert_validation_error(
        put_profile(conn, token, %{unknown_skill | "displayName" => "   "}),
        "displayName"
      )

      # A name the changeset rejects still comes before a size the JSON type
      # check rejects.
      assert_validation_error(
        put_profile(conn, token, %{
          @profile
          | "displayName" => String.duplicate("a", 65),
            "householdSize" => "4"
        }),
        "displayName"
      )

      assert_validation_error(
        put_profile(conn, token, %{unknown_skill | "householdSize" => 21}),
        "householdSize"
      )

      assert %{"error" => %{"code" => "invalid_cooking_skill"}} =
               conn |> put_profile(token, unknown_skill) |> json_response(422)
    end

    test "an empty body is a validation_error on the first field", %{conn: conn, token: token} do
      assert_validation_error(put_profile(conn, token, %{}), "displayName")
    end

    test "a rejected request leaves the stored row untouched", %{
      conn: conn,
      user: user,
      token: token
    } do
      assert conn |> put_profile(token, @profile) |> json_response(200)
      stored = Repo.get!(User, user.id)

      rejected = [
        %{@profile | "displayName" => "   "},
        %{@profile | "displayName" => "Otro", "householdSize" => "6"},
        %{@profile | "displayName" => "Otro", "householdSize" => 21},
        %{@profile | "displayName" => "Otro", "householdSize" => 6, "cookingSkill" => "expert"},
        %{"displayName" => "Otro", "householdSize" => 6}
      ]

      for body <- rejected do
        assert conn |> put_profile(token, body) |> json_response(422)
        assert Repo.get!(User, user.id) == stored
      end
    end
  end

  describe "PUT /api/me/profile — onboarding completion" do
    test "leaves it null for a User who has not finished Onboarding", %{
      conn: conn,
      user: user,
      token: token
    } do
      assert conn |> put_profile(token, @profile) |> json_response(200)

      assert Repo.get!(User, user.id).onboarding_completed_at == nil
    end

    test "leaves the stored timestamp identical for a User who has", %{
      conn: conn,
      user: user,
      token: token
    } do
      %User{onboarding_completed_at: completed_at} =
        user
        |> Ecto.Changeset.change(onboarding_completed_at: ~U[2026-03-04 05:06:07.123456Z])
        |> Repo.update!()

      assert conn |> put_profile(token, @profile) |> json_response(200)

      assert %User{onboarding_completed_at: ^completed_at, household_size: 4} =
               Repo.get!(User, user.id)
    end
  end

  describe "PUT /api/me/profile — access" do
    test "an expired Account still writes with capability enforcement enabled", %{
      conn: conn,
      user: user,
      membership: membership,
      token: token
    } do
      Account |> Repo.get!(membership.account_id) |> persist_trial_window!(:expired)
      authed = put_req_header(conn, "authorization", "Bearer " <> token)

      with_enforcement_enabled!(fn ->
        # The Account is expired and the guard is live on the gated routes.
        assert %{"error" => %{"code" => "trial_expired"}} =
                 authed |> get("/api/planning/weekly") |> json_response(403)

        assert %{"user" => %{"householdSize" => 4}} =
                 conn |> put_profile(token, @profile) |> json_response(200)
      end)

      assert Repo.get!(User, user.id).household_size == 4
    end

    test "an unauthenticated request gets the 401 envelope", %{conn: conn, user: user} do
      conn =
        conn
        |> put_req_header("content-type", "application/json")
        |> put(@path, Jason.encode!(@profile))

      assert %{"error" => %{"code" => "unauthenticated", "message" => message}} =
               json_response(conn, 401)

      assert is_binary(message)
      assert Repo.get!(User, user.id).household_size == nil
    end

    test "a User deleted after authentication answers like GET /api/me without an account", %{
      conn: conn
    } do
      conn =
        conn
        |> Guardian.Plug.put_current_resource(%User{id: Ecto.UUID.generate()})
        |> ProfileController.update(%{
          "display_name" => "Ana",
          "household_size" => 4,
          "cooking_skill" => "advanced"
        })

      assert %{"error" => %{"code" => "account_not_found"}} = json_response(conn, 401)
    end
  end

  defp put_profile(conn, token, body) do
    conn
    |> put_req_header("authorization", "Bearer " <> token)
    |> put_req_header("content-type", "application/json")
    |> put(@path, Jason.encode!(body))
  end

  # The envelope with nothing next to `code` and `message`, and a message
  # that names `field` in its wire spelling and no other profile field.
  defp assert_validation_error(conn, field) do
    assert %{"error" => error} = json_response(conn, 422)
    assert %{"code" => "validation_error", "message" => message} = error
    assert map_size(error) == 2
    assert message =~ field

    for other <- ~w(displayName householdSize cookingSkill) -- [field] do
      refute message =~ other
    end
  end
end
