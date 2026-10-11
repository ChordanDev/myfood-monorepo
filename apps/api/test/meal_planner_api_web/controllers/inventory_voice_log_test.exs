defmodule MealPlannerApiWeb.InventoryVoiceLogTest do
  # Not async: the setup changes a Logger level for the whole node, and the
  # capture holds every line logged while a request runs.
  use MealPlannerApiWeb.ConnCase, async: false

  import ExUnit.CaptureLog
  import MealPlannerApi.IdentityFixtures

  alias MealPlannerApi.Persistence.Catalog
  alias MealPlannerApi.Persistence.Inventory

  # Keeps the lines the setup lets through off the console.
  @moduletag :capture_log

  # The ingredient name is catalog data and travels in the `intent` too; the
  # words around it exist only in what was spoken.
  @transcript "anoche a escondidas me comí la mitad del queso voz registro"

  setup do
    # `config/test.exs` keeps the Logger at `:warning` and Phoenix logs the
    # request parameters at `:debug`. This lets the lines of the Phoenix
    # request logger through, and no other module's; without it the capture
    # would hold no parameters and the test would prove nothing.
    Logger.put_module_level(Phoenix.Logger, :debug)
    on_exit(fn -> Logger.delete_module_level(Phoenix.Logger) end)

    %{token: token, user: user, account: account} = insert_identity_with_token!(plan: :family_4)

    {:ok, ingredient} =
      Catalog.upsert_ingredient_by_name(%{
        name: "Queso Voz Registro",
        category: :no_perecederos
      })

    {:ok, _seed} =
      Inventory.apply_delta_and_log(%{
        account_id: account.id,
        ingredient_id: ingredient.id,
        unit: :g,
        source_kind: :planned,
        delta: 400_000,
        source_user_id: user.id,
        trigger_type: :purchase,
        operation: :add
      })

    {:ok, token: token}
  end

  test "the request log of a voice preview does not print the transcript", %{token: token} do
    {conn, log} =
      with_log(fn ->
        post_json(token, "/api/inventory/voice/preview", %{"transcript" => @transcript})
      end)

    assert %{"data" => %{"intent" => %{"quantityMilli" => 200_000}}} = json_response(conn, 200)
    assert_transcript_filtered(log)
  end

  test "the request log of a voice apply does not print the transcript", %{token: token} do
    intent =
      token
      |> post_json("/api/inventory/voice/preview", %{"transcript" => @transcript})
      |> json_response(200)
      |> get_in(["data", "intent"])

    {conn, log} =
      with_log(fn ->
        post_json(token, "/api/inventory/voice/apply", %{
          "transcript" => @transcript,
          "intent" => intent
        })
      end)

    assert %{"data" => %{"quantityDeltaMilli" => -200_000}} = json_response(conn, 200)
    assert_transcript_filtered(log)
  end

  # The parameters line is in the capture, with the transcript masked, and the
  # spoken text is nowhere in it.
  defp assert_transcript_filtered(log) do
    assert log =~ "Parameters: %{"
    assert log =~ ~s("transcript" => "[FILTERED]")
    refute log =~ @transcript
    refute log =~ "escondidas"
    refute log =~ "comí"
  end

  defp post_json(token, path, params) do
    build_conn()
    |> put_req_header("authorization", "Bearer " <> token)
    |> post(path, params)
  end
end
