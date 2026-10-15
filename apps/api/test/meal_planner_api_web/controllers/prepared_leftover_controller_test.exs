defmodule MealPlannerApiWeb.PreparedLeftoverControllerTest do
  use MealPlannerApiWeb.ConnCase, async: false

  import MealPlannerApi.IdentityFixtures

  alias MealPlannerApi.AccountClock
  alias MealPlannerApi.Persistence.Calendar
  alias MealPlannerApi.Persistence.Leftovers
  alias MealPlannerApi.Persistence.Leftovers.PreparedLeftover
  alias MealPlannerApi.Repo

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
            {%{"title" => "x", "portions" => 1, "notes" => String.duplicate("n", 501)}, "notes"},
            {%{"title" => "x", "portions" => 2_147_483_648}, "portions"}
          ] do
        body = conn |> post(@path, params) |> json_response(422)
        assert body["error"]["code"] == "validation_error"
        assert body["error"]["message"] =~ field
      end
    end

    test "accepts a title and notes at their length limits and portions at the cap",
         %{conn: conn} do
      params = %{
        "title" => String.duplicate("a", 255),
        "portions" => 1_000,
        "notes" => String.duplicate("n", 500)
      }

      assert %{"data" => %{"portions" => 1_000, "notes" => notes}} =
               conn |> post(@path, params) |> json_response(201)

      assert String.length(notes) == 500
    end

    test "stores a Scheduled meal of the Account as the source",
         %{conn: conn, account_id: account_id} do
      meal_id = scheduled_meal_id!(account_id)
      params = %{"title" => "Lentils", "portions" => 2, "scheduledMealId" => meal_id}

      data = conn |> post(@path, params) |> json_response(201) |> Map.fetch!("data")

      assert data["sourceMealId"] == meal_id
      assert [%{scheduled_meal_id: ^meal_id}] = Leftovers.list_open(account_id)
    end

    test "leaves the source empty when scheduledMealId is omitted or null", %{conn: conn} do
      for params <- [
            %{"title" => "Lentils", "portions" => 2},
            %{"title" => "Lentils", "portions" => 2, "scheduledMealId" => nil}
          ] do
        data = conn |> post(@path, params) |> json_response(201) |> Map.fetch!("data")
        assert is_nil(data["sourceMealId"])
      end
    end

    test "a malformed, unknown or other Account's scheduledMealId is not found", %{conn: conn} do
      %{account: other} = insert_identity!(plan: :family_4)

      for meal_id <- ["nope", "", Ecto.UUID.generate(), scheduled_meal_id!(other.id)] do
        params = %{"title" => "Lentils", "portions" => 2, "scheduledMealId" => meal_id}

        assert %{"error" => %{"code" => "scheduled_meal_not_found"}} =
                 conn |> post(@path, params) |> json_response(404)
      end

      assert Repo.aggregate(PreparedLeftover, :count) == 0
    end

    test "rejects a scheduledMealId that is not a string", %{conn: conn, account_id: account_id} do
      meal_id = scheduled_meal_id!(account_id)

      for value <- [7, true, %{"id" => meal_id}, [meal_id]] do
        params = %{"title" => "Lentils", "portions" => 2, "scheduledMealId" => value}

        body = conn |> post(@path, params) |> json_response(422)
        assert body["error"]["code"] == "validation_error"
        assert body["error"]["message"] =~ "scheduledMealId"
      end

      assert Repo.aggregate(PreparedLeftover, :count) == 0
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

    test "answers at most 200 leftovers", %{conn: conn, account_id: account_id} do
      now = DateTime.utc_now()

      rows =
        for n <- 1..201 do
          %{
            id: Ecto.UUID.generate(),
            account_id: account_id,
            title: "Leftover #{n}",
            portions: 1,
            stored_at: now,
            consume_by_date: ~D[2030-01-01],
            inserted_at: now,
            updated_at: now
          }
        end

      {201, _} = Repo.insert_all(PreparedLeftover, rows)

      assert conn |> get(@path) |> json_response(200) |> Map.fetch!("data") |> length() == 200
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

    test "consume with a repeated actionId eats one portion and answers the same",
         %{conn: conn, account_id: account_id} do
      {:ok, leftover} = Leftovers.create(account_id, %{title: "Rice", portions: 3})
      url = "#{@path}/#{leftover.id}/consume"
      action_id = Ecto.UUID.generate()

      first = conn |> post(url, %{"actionId" => action_id}) |> json_response(200)
      retry = conn |> post(url, %{"actionId" => action_id}) |> json_response(200)

      assert first["data"]["portions"] == 2
      assert retry == first
      assert [%{portions: 2}] = Leftovers.list_open(account_id)

      other = conn |> post(url, %{"actionId" => Ecto.UUID.generate()}) |> json_response(200)
      assert other["data"]["portions"] == 1
    end

    test "consume that fails stores nothing under its actionId",
         %{conn: conn, account_id: account_id} do
      action_id = Ecto.UUID.generate()
      missing = "#{@path}/#{Ecto.UUID.generate()}/consume"

      assert conn |> post(missing, %{"actionId" => action_id}) |> json_response(404)

      {:ok, leftover} = Leftovers.create(account_id, %{title: "Rice", portions: 2})
      url = "#{@path}/#{leftover.id}/consume"

      # The same key on a different leftover was never claimed, so it runs.
      data = conn |> post(url, %{"actionId" => action_id}) |> json_response(200)
      assert data["data"]["portions"] == 1
    end

    test "consume rejects an actionId that is not a non-empty string up to 128 bytes",
         %{conn: conn, account_id: account_id} do
      {:ok, leftover} = Leftovers.create(account_id, %{title: "Rice", portions: 2})
      url = "#{@path}/#{leftover.id}/consume"

      for value <- ["", String.duplicate("a", 129), 7, %{"id" => "x"}] do
        body = conn |> post(url, %{"actionId" => value}) |> json_response(422)
        assert body["error"]["code"] == "validation_error"
        assert body["error"]["message"] =~ "actionId"
      end

      assert [%{portions: 2}] = Leftovers.list_open(account_id)
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

  defp scheduled_meal_id!(account_id) do
    {:ok, meal} =
      Calendar.upsert_scheduled_meal(account_id, %{date: ~D[2030-01-05], slot: :dinner})

    meal.id
  end
end
