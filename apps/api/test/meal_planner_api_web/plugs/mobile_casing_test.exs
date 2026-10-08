defmodule MealPlannerApiWeb.Plugs.MobileCasingTest do
  @moduledoc """
  Unit coverage for `MealPlannerApiWeb.Plugs.MobileCasing` (issue #11): the
  request params a controller reads are snake_case whatever casing the client
  sent, and a JSON response leaves with camelCase keys.
  """
  use ExUnit.Case, async: true

  import Plug.Conn
  import Plug.Test

  alias MealPlannerApiWeb.ApiError
  alias MealPlannerApiWeb.Plugs.MobileCasing

  describe "request params" do
    test "rewrites camelCase body, query and merged params to snake_case" do
      conn =
        :post
        |> json_conn("/api/planning/confirm?dateFrom=2026-10-05&selectedSlot=lunch", %{
          "sessionId" => "abc",
          "meals" => [%{"recipeId" => 1, "slotNames" => [[%{"slotName" => "lunch"}]]}]
        })
        |> MobileCasing.call(MobileCasing.init([]))

      body = %{
        "session_id" => "abc",
        "meals" => [%{"recipe_id" => 1, "slot_names" => [[%{"slot_name" => "lunch"}]]}]
      }

      query = %{"date_from" => "2026-10-05", "selected_slot" => "lunch"}

      assert conn.body_params == body
      assert conn.query_params == query
      assert conn.params == Map.merge(query, body)
    end

    test "keeps the path params merged into the params" do
      conn =
        :post
        |> json_conn("/api/cooking/sessions/7/step", %{"recipeStepId" => 3})
        |> Map.update!(:params, &Map.put(&1, "session_id", "7"))
        |> Map.put(:path_params, %{"session_id" => "7"})
        |> MobileCasing.call(MobileCasing.init([]))

      assert conn.params == %{"session_id" => "7", "recipe_step_id" => 3}
      assert conn.path_params == %{"session_id" => "7"}
    end

    test "leaves snake_case params as they are" do
      conn =
        json_conn(:post, "/api/shopping-items/mark-cart?start_date=2026-10-05", %{
          "item_ids" => [1, 2],
          "in_cart" => true
        })

      cased = MobileCasing.call(conn, MobileCasing.init([]))

      assert cased.body_params == conn.body_params
      assert cased.query_params == conn.query_params
      assert cased.params == conn.params
    end

    test "prefers the snake_case key when a param arrives in both casings" do
      conn =
        :post
        |> json_conn("/api/cooking/start", %{"scheduledMealId" => 1, "scheduled_meal_id" => 2})
        |> MobileCasing.call(MobileCasing.init([]))

      assert conn.params == %{"scheduled_meal_id" => 2}
    end

    test "keeps the body over the query string when they spell one param differently" do
      conn =
        :post
        |> json_conn("/api/cooking/start?scheduled_meal_id=1", %{"scheduledMealId" => 2})
        |> MobileCasing.call(MobileCasing.init([]))

      assert conn.query_params == %{"scheduled_meal_id" => "1"}
      assert conn.body_params == %{"scheduled_meal_id" => 2}
      assert conn.params == %{"scheduled_meal_id" => 2}
    end

    test "keeps a path param over the body and the query string" do
      conn =
        :post
        |> json_conn("/api/cooking/sessions/7/step?sessionId=9", %{"sessionId" => "8"})
        |> Map.update!(:params, &Map.put(&1, "session_id", "7"))
        |> Map.put(:path_params, %{"session_id" => "7"})
        |> MobileCasing.call(MobileCasing.init([]))

      assert conn.params == %{"session_id" => "7"}
    end

    test "fetches the query string and leaves an unfetched body alone" do
      conn = conn(:get, "/api/calendar?startDate=2026-10-05")

      assert %Plug.Conn.Unfetched{} = conn.query_params
      assert %Plug.Conn.Unfetched{} = conn.body_params

      conn = MobileCasing.call(conn, MobileCasing.init([]))

      assert conn.query_params == %{"start_date" => "2026-10-05"}
      assert conn.params == %{"start_date" => "2026-10-05"}
      assert %Plug.Conn.Unfetched{aspect: :body_params} = conn.body_params
    end
  end

  describe "JSON responses" do
    test "leave with camelCase keys, nested maps and lists included" do
      payload = %{
        data: %{
          start_date: "2026-10-05",
          days: [
            %{day_state: "planned", meals: [%{meal_id: 1, macros: %{calories_per_serving: 4}}]}
          ],
          by_category: %{"no_perecederos" => [%{ingredient_id: 7}]},
          line_groups: [[%{quantity_milli: 500}]]
        }
      }

      conn = cased_conn() |> put_resp_content_type("application/json") |> send_json(200, payload)

      assert Jason.decode!(conn.resp_body) == %{
               "data" => %{
                 "startDate" => "2026-10-05",
                 "days" => [
                   %{
                     "dayState" => "planned",
                     "meals" => [%{"mealId" => 1, "macros" => %{"caloriesPerServing" => 4}}]
                   }
                 ],
                 "byCategory" => %{"no_perecederos" => [%{"ingredientId" => 7}]},
                 "lineGroups" => [[%{"quantityMilli" => 500}]]
               }
             }
    end

    test "are rewritten when the controller renders with Phoenix.Controller.json/2" do
      conn = Phoenix.Controller.json(cased_conn(), %{data: [%{recipe_id: 1}, %{recipe_id: 2}]})

      assert Jason.decode!(conn.resp_body) == %{
               "data" => [%{"recipeId" => 1}, %{"recipeId" => 2}]
             }
    end

    test "keep their status and headers" do
      conn =
        cased_conn()
        |> put_resp_content_type("application/json")
        |> put_resp_header("retry-after", "42")
        |> send_json(201, %{scheduled_meals_count: 2})

      assert conn.status == 201
      assert conn.state == :sent
      assert get_resp_header(conn, "retry-after") == ["42"]
      assert get_resp_header(conn, "content-type") == ["application/json; charset=utf-8"]
      assert Jason.decode!(conn.resp_body) == %{"scheduledMealsCount" => 2}
    end

    test "drop a content-length that described the body before the rewrite" do
      body = Jason.encode!(%{scheduled_meals_count: 2})

      conn =
        cased_conn()
        |> put_resp_content_type("application/json")
        |> put_resp_header("content-length", Integer.to_string(byte_size(body)))
        |> send_resp(200, body)

      assert get_resp_header(conn, "content-length") == []
      assert conn.resp_body == ~s({"scheduledMealsCount":2})
    end

    test "never change a value, a flat error reason included" do
      payload = %{error: "invalid_date_format", status: "in_cart", source_kind: "user_created"}

      conn = cased_conn() |> put_resp_content_type("application/json") |> send_json(422, payload)

      assert Jason.decode!(conn.resp_body) == %{
               "error" => "invalid_date_format",
               "status" => "in_cart",
               "sourceKind" => "user_created"
             }
    end

    test "are recognised by a +json content type" do
      conn =
        cased_conn()
        |> put_resp_content_type("application/problem+json")
        |> send_json(200, %{recipe_id: 1})

      assert Jason.decode!(conn.resp_body) == %{"recipeId" => 1}
    end

    test "carry the error envelope of a plug that halts later in the pipeline" do
      conn = cased_conn() |> ApiError.error(:trial_expired)

      assert conn.halted
      assert conn.status == 403

      assert %{"error" => %{"code" => "trial_expired", "message" => message} = error} =
               Jason.decode!(conn.resp_body)

      assert is_binary(message)
      assert Map.keys(error) == ["code", "message"]
    end
  end

  describe "responses passed through untouched" do
    test "a body that is not JSON" do
      body = ~s({"recipe_id":1})

      conn = cased_conn() |> put_resp_content_type("text/plain") |> send_resp(200, body)

      assert conn.resp_body == body
    end

    test "a body without a content type" do
      body = ~s({"recipe_id":1})

      assert send_resp(cased_conn(), 200, body).resp_body == body
    end

    test "an empty body" do
      conn = cased_conn() |> put_resp_content_type("application/json") |> send_resp(204, "")

      assert conn.status == 204
      assert conn.resp_body == ""
    end

    test "a JSON body that cannot be decoded" do
      body = ~s({"recipe_id":)

      conn = cased_conn() |> put_resp_content_type("application/json") |> send_resp(200, body)

      assert conn.status == 200
      assert conn.resp_body == body
    end

    test "a chunked response" do
      body = ~s({"recipe_id":1})

      conn = cased_conn() |> put_resp_content_type("application/json") |> send_chunked(200)
      {:ok, conn} = chunk(conn, body)

      assert conn.resp_body == body
    end

    @tag :tmp_dir
    test "a file response", %{tmp_dir: tmp_dir} do
      body = ~s({"recipe_id":1})
      path = Path.join(tmp_dir, "export.json")
      File.write!(path, body)

      conn = cased_conn() |> put_resp_content_type("application/json") |> send_file(200, path)

      assert conn.resp_body == body
    end
  end

  defp cased_conn, do: :get |> conn("/api/calendar") |> MobileCasing.call(MobileCasing.init([]))

  defp send_json(conn, status, payload), do: send_resp(conn, status, Jason.encode!(payload))

  # A request as the endpoint hands it to the router: JSON body and query
  # string already parsed by `Plug.Parsers`.
  defp json_conn(method, path, body) do
    method
    |> conn(path, Jason.encode!(body))
    |> put_req_header("content-type", "application/json")
    |> Plug.Parsers.call(Plug.Parsers.init(parsers: [:json], json_decoder: Jason))
  end
end
