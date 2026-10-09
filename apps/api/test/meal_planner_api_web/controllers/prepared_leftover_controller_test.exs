defmodule MealPlannerApiWeb.PreparedLeftoverControllerTest do
  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.IdentityFixtures

  alias MealPlannerApi.AccountClock
  alias MealPlannerApi.Persistence.Leftovers

  @path "/api/leftovers/prepared"

  setup %{conn: conn} do
    %{token: token, account: %{id: account_id}} = insert_identity_with_token!(plan: :family_4)
    %{conn: put_req_header(conn, "authorization", "Bearer " <> token), account_id: account_id}
  end

  test "requires authentication", %{conn: conn} do
    conn = conn |> delete_req_header("authorization") |> get(@path)
    assert conn.status == 401
  end

  describe "POST /api/leftovers/prepared" do
    test "stores a leftover with the default consume-by date and camelCase keys",
         %{conn: conn, account_id: account_id} do
      before = AccountClock.today(account_id)
      body = conn |> post(@path, %{"title" => "Lentils", "portions" => 4}) |> json_response(201)
      after_ = AccountClock.today(account_id)

      assert %{"data" => data} = body

      assert Map.keys(data) |> Enum.sort() ==
               ~w(consumeByDate consumedAt discardedAt id notes portions sourceMealId storedAt title)

      assert data["title"] == "Lentils"
      assert data["portions"] == 4

      assert data["consumeByDate"] in [
               Date.to_iso8601(Date.add(before, 3)),
               Date.to_iso8601(Date.add(after_, 3))
             ]

      assert is_binary(data["storedAt"])
      assert is_nil(data["consumedAt"]) and is_nil(data["discardedAt"]) and is_nil(data["notes"])
    end

    test "accepts camelCase and an explicit consume-by date and notes", %{conn: conn} do
      data =
        conn
        |> post(@path, %{
          "title" => "Soup",
          "portions" => 2,
          "consumeByDate" => "2026-12-24",
          "notes" => "freezer"
        })
        |> json_response(201)
        |> Map.fetch!("data")

      assert data["consumeByDate"] == "2026-12-24"
      assert data["notes"] == "freezer"
    end

    test "rejects invalid input naming the wire field", %{conn: conn} do
      for {params, field} <- [
            {%{"portions" => 1}, "title"},
            {%{"title" => " ", "portions" => 1}, "title"},
            {%{"title" => "x"}, "portions"},
            {%{"title" => "x", "portions" => 0}, "portions"},
            {%{"title" => "x", "portions" => "2"}, "portions"},
            {%{"title" => "x", "portions" => 1, "consumeByDate" => "tomorrow"}, "consumeByDate"},
            {%{"title" => String.duplicate("a", 256), "portions" => 1}, "title"},
            {%{"title" => "x", "portions" => 1_001}, "portions"},
            {%{"title" => "x", "portions" => 2_147_483_648}, "portions"}
          ] do
        body = conn |> post(@path, params) |> json_response(422)
        assert body["error"]["code"] == "validation_error"
        assert body["error"]["message"] =~ field
      end
    end

    test "accepts a title at the length limit and portions at the cap", %{conn: conn} do
      params = %{"title" => String.duplicate("a", 255), "portions" => 1_000}

      assert %{"data" => %{"portions" => 1_000}} =
               conn |> post(@path, params) |> json_response(201)
    end
  end

  describe "GET /api/leftovers/prepared" do
    test "lists open leftovers soonest first and hides closed ones", %{
      conn: conn,
      account_id: account_id
    } do
      {:ok, late} =
        Leftovers.create(account_id, %{
          title: "late",
          portions: 1,
          consume_by_date: ~D[2030-01-10]
        })

      {:ok, soon} =
        Leftovers.create(account_id, %{
          title: "soon",
          portions: 1,
          consume_by_date: ~D[2030-01-02]
        })

      {:ok, gone} =
        Leftovers.create(account_id, %{
          title: "gone",
          portions: 1,
          consume_by_date: ~D[2030-01-01]
        })

      {:ok, _} = Leftovers.discard(account_id, gone.id)

      ids = conn |> get(@path) |> json_response(200) |> Map.fetch!("data") |> Enum.map(& &1["id"])

      assert ids == [soon.id, late.id]
    end
  end

  describe "consume and discard" do
    test "consume decrements, then closes at zero", %{conn: conn, account_id: account_id} do
      {:ok, leftover} = Leftovers.create(account_id, %{title: "Rice", portions: 2})
      url = "#{@path}/#{leftover.id}/consume"

      data = conn |> post(url) |> json_response(200) |> Map.fetch!("data")
      assert data["portions"] == 1 and is_nil(data["consumedAt"])

      data = conn |> post(url) |> json_response(200) |> Map.fetch!("data")
      assert data["portions"] == 0 and is_binary(data["consumedAt"])

      assert conn |> get(@path) |> json_response(200) |> Map.fetch!("data") == []

      assert conn |> post(url) |> json_response(404) |> get_in(["error", "code"]) ==
               "prepared_leftover_not_found"
    end

    test "discard closes the leftover", %{conn: conn, account_id: account_id} do
      {:ok, leftover} = Leftovers.create(account_id, %{title: "Rice", portions: 2})
      url = "#{@path}/#{leftover.id}/discard"

      data = conn |> post(url) |> json_response(200) |> Map.fetch!("data")
      assert is_binary(data["discardedAt"])

      assert conn |> get(@path) |> json_response(200) |> Map.fetch!("data") == []

      assert conn |> post(url) |> json_response(404) |> get_in(["error", "code"]) ==
               "prepared_leftover_not_found"
    end

    test "an unknown or malformed id is not found", %{conn: conn} do
      for id <- [Ecto.UUID.generate(), "nope"], action <- ["consume", "discard"] do
        body = conn |> post("#{@path}/#{id}/#{action}") |> json_response(404)
        assert body["error"]["code"] == "prepared_leftover_not_found"
      end
    end
  end
end
