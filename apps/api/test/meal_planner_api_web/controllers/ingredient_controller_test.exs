defmodule MealPlannerApiWeb.IngredientControllerTest do
  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.IdentityFixtures

  alias MealPlannerApi.Persistence.Catalog

  # Issue #116 — `GET /api/ingredients?query=`: the catalogue the inventory
  # add sheet picks an Ingredient from.
  describe "GET /api/ingredients" do
    setup do
      %{token: token} = insert_identity_with_token!(plan: :family_4)
      %{token: token}
    end

    test "matches the name case-insensitively and answers only id and name", %{token: token} do
      milk = ingredient("Qzleche Entera")
      _other = ingredient("Qzarroz Largo")

      body = token |> search("QZLECHE") |> json_response(200)

      assert body == %{"data" => [%{"id" => milk.id, "name" => "Qzleche Entera"}]}
    end

    test "matches inside the name, with the names that start with the query first",
         %{token: token} do
      inside = ingredient("Polvo de Qzcacao")
      start_b = ingredient("Qzcacao Puro")
      start_a = ingredient("Qzcacao Amargo")

      body = token |> search("qzcacao") |> json_response(200)

      assert Enum.map(body["data"], & &1["id"]) == [start_a.id, start_b.id, inside.id]
    end

    test "answers at most 20 Ingredients", %{token: token} do
      for n <- 1..25, do: ingredient("Qzlimite #{String.pad_leading("#{n}", 2, "0")}")

      body = token |> search("qzlimite") |> json_response(200)

      assert length(body["data"]) == 20
      assert hd(body["data"])["name"] == "Qzlimite 01"
    end

    test "reads % and _ in the query as themselves", %{token: token} do
      percent = ingredient("Qzpct 100% Cacao")
      _plain = ingredient("Qzpct 1000 Cacao")

      assert %{"data" => [%{"id" => id}]} = token |> search("100%") |> json_response(200)
      assert id == percent.id

      assert %{"data" => []} = token |> search("qzpct_") |> json_response(200)
    end

    test "trims the query and finds nothing for a name the catalogue lacks", %{token: token} do
      milk = ingredient("Qztrim Leche")

      assert %{"data" => [%{"id" => id}]} = token |> search("  qztrim  ") |> json_response(200)
      assert id == milk.id
      assert %{"data" => []} = token |> search("qzinexistente") |> json_response(200)
    end

    test "a missing, blank or longer than 100 characters query is validation_error",
         %{token: token} do
      for path <- [
            "/api/ingredients",
            "/api/ingredients?query=",
            "/api/ingredients?query=%20%20",
            "/api/ingredients?query=" <> String.duplicate("a", 101)
          ] do
        conn =
          build_conn()
          |> put_req_header("authorization", "Bearer " <> token)
          |> get(path)

        assert %{"error" => %{"code" => "validation_error", "message" => message}} =
                 json_response(conn, 422)

        assert message =~ "query"
      end
    end

    test "answers 401 without a bearer token", %{conn: conn} do
      conn = get(conn, "/api/ingredients?query=leche")

      assert %{"error" => %{"code" => _code}} = json_response(conn, 401)
    end
  end

  defp search(token, query) do
    build_conn()
    |> put_req_header("authorization", "Bearer " <> token)
    |> get("/api/ingredients", %{"query" => query})
  end

  defp ingredient(name) do
    {:ok, ingredient} =
      Catalog.upsert_ingredient_by_name(%{
        name: name,
        category: :no_perecederos,
        calories_per_100: 130,
        protein_g_per_100: Decimal.new("2.7"),
        carbs_g_per_100: Decimal.new("28.0"),
        fat_g_per_100: Decimal.new("0.3")
      })

    ingredient
  end
end
