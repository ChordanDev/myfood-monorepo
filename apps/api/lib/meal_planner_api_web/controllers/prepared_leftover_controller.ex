defmodule MealPlannerApiWeb.PreparedLeftoverController do
  @moduledoc """
  Prepared leftovers (issue #45): cooked portions kept apart from Inventory.
  Tenancy comes from `conn.assigns.current_membership.account_id`.

  Eating a portion takes an optional client `actionId` (issue #162): a retry
  with the same one on the same leftover within 24 hours answers what the first
  one did and eats nothing more.
  """

  use MealPlannerApiWeb, :controller

  alias MealPlannerApi.Persistence.Idempotency
  alias MealPlannerApi.Persistence.Leftovers
  alias MealPlannerApiWeb.ApiError

  @consume_endpoint "leftovers.consume"
  @max_action_id_length 128

  def index(conn, _params) do
    leftovers = conn |> account_id() |> Leftovers.list_open()
    json(conn, %{data: Enum.map(leftovers, &render_leftover/1)})
  end

  def create(conn, params) do
    case parse_create(params) do
      {:ok, attrs} ->
        case Leftovers.create(account_id(conn), attrs) do
          {:ok, leftover} ->
            conn |> put_status(201) |> json(%{data: render_leftover(leftover)})

          {:error, :scheduled_meal_not_found} ->
            conn |> ApiError.error(:scheduled_meal_not_found)

          {:error, %Ecto.Changeset{} = changeset} ->
            ApiError.validation_error(conn, wire_field(changeset))
        end

      {:error, field} ->
        ApiError.validation_error(conn, field)
    end
  end

  def consume(conn, %{"id" => id} = params) do
    with {:ok, action_id} <- parse_action_id(params["action_id"]),
         {:ok, leftover_id} <- Ecto.UUID.cast(id) do
      account_id = account_id(conn)

      # The key belongs to one leftover, so reusing an actionId on another one
      # eats from it. The stored answer is the rendered one, so a replay renders
      # nothing again.
      result =
        Idempotency.run(account_id, "#{@consume_endpoint}:#{leftover_id}", action_id, fn ->
          account_id |> Leftovers.consume(leftover_id) |> rendered()
        end)

      respond(conn, result)
    else
      {:error, field} -> ApiError.validation_error(conn, field)
      # A malformed id names no leftover, and must not reach the stored key.
      :error -> respond(conn, {:error, :not_found})
    end
  end

  def discard(conn, %{"id" => id}),
    do: respond(conn, conn |> account_id() |> Leftovers.discard(id) |> rendered())

  defp rendered({:ok, leftover}), do: {:ok, render_leftover(leftover)}
  defp rendered(error), do: error

  defp respond(conn, {:ok, data}), do: json(conn, %{data: data})

  defp respond(conn, {:error, :not_found}),
    do: conn |> ApiError.error(:prepared_leftover_not_found)

  defp respond(conn, {:error, %Ecto.Changeset{}}), do: ApiError.server_fault(conn)

  defp parse_create(params) do
    with {:ok, title} <- parse_title(params["title"]),
         {:ok, portions} <- parse_portions(params["portions"]),
         {:ok, consume_by} <- parse_consume_by(params["consume_by_date"]),
         {:ok, notes} <- parse_notes(params["notes"]),
         {:ok, meal_id} <- parse_scheduled_meal_id(params["scheduled_meal_id"]) do
      attrs =
        %{title: title, portions: portions, notes: notes, scheduled_meal_id: meal_id}
        |> put_consume_by(consume_by)

      {:ok, attrs}
    end
  end

  # Left out when the client sends none, so the persistence boundary defaults it.
  defp put_consume_by(attrs, nil), do: attrs
  defp put_consume_by(attrs, consume_by), do: Map.put(attrs, :consume_by_date, consume_by)

  defp parse_title(title) when is_binary(title) do
    if String.trim(title) == "", do: {:error, "title"}, else: {:ok, title}
  end

  defp parse_title(_), do: {:error, "title"}

  defp parse_portions(portions) when is_integer(portions) and portions > 0, do: {:ok, portions}
  defp parse_portions(_), do: {:error, "portions"}

  defp parse_consume_by(nil), do: {:ok, nil}

  defp parse_consume_by(value) when is_binary(value) do
    case Date.from_iso8601(value) do
      {:ok, date} -> {:ok, date}
      {:error, _} -> {:error, "consumeByDate"}
    end
  end

  defp parse_consume_by(_), do: {:error, "consumeByDate"}

  defp parse_notes(nil), do: {:ok, nil}
  defp parse_notes(notes) when is_binary(notes), do: {:ok, notes}
  defp parse_notes(_), do: {:error, "notes"}

  # Only the type is checked here: whether the id is a Scheduled meal of the
  # Account is the persistence boundary's answer.
  defp parse_scheduled_meal_id(nil), do: {:ok, nil}
  defp parse_scheduled_meal_id(meal_id) when is_binary(meal_id), do: {:ok, meal_id}
  defp parse_scheduled_meal_id(_), do: {:error, "scheduledMealId"}

  defp parse_action_id(nil), do: {:ok, nil}

  defp parse_action_id(action_id)
       when is_binary(action_id) and action_id != "" and
              byte_size(action_id) <= @max_action_id_length,
       do: {:ok, action_id}

  defp parse_action_id(_), do: {:error, "actionId"}

  defp wire_field(%Ecto.Changeset{errors: [{field, _} | _]}) do
    case field do
      :consume_by_date -> "consumeByDate"
      other -> Atom.to_string(other)
    end
  end

  defp account_id(conn), do: conn.assigns.current_membership.account_id

  defp render_leftover(leftover) do
    %{
      id: leftover.id,
      sourceMealId: leftover.scheduled_meal_id,
      title: leftover.title,
      portions: leftover.portions,
      storedAt: leftover.stored_at,
      consumeByDate: Date.to_iso8601(leftover.consume_by_date),
      notes: leftover.notes,
      consumedAt: leftover.consumed_at,
      discardedAt: leftover.discarded_at
    }
  end
end
