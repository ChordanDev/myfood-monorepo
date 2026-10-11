defmodule MealPlannerApiWeb.PreparedLeftoverController do
  @moduledoc """
  Prepared leftovers (issue #45): cooked portions kept apart from Inventory.
  Tenancy comes from `conn.assigns.current_membership.account_id`.
  """

  use MealPlannerApiWeb, :controller

  alias MealPlannerApi.Persistence.Leftovers
  alias MealPlannerApiWeb.ApiError

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

  def consume(conn, %{"id" => id}), do: respond(conn, Leftovers.consume(account_id(conn), id))
  def discard(conn, %{"id" => id}), do: respond(conn, Leftovers.discard(account_id(conn), id))

  defp respond(conn, {:ok, leftover}), do: json(conn, %{data: render_leftover(leftover)})

  defp respond(conn, {:error, :not_found}),
    do: conn |> ApiError.error(:prepared_leftover_not_found)

  defp respond(conn, {:error, %Ecto.Changeset{}}), do: ApiError.server_fault(conn)

  defp parse_create(params) do
    with {:ok, title} <- parse_title(params["title"]),
         {:ok, portions} <- parse_portions(params["portions"]),
         {:ok, consume_by} <- parse_consume_by(params["consume_by_date"]),
         {:ok, notes} <- parse_notes(params["notes"]),
         {:ok, meal_id} <- parse_scheduled_meal_id(params["scheduled_meal_id"]) do
      attrs = %{title: title, portions: portions, notes: notes, scheduled_meal_id: meal_id}
      {:ok, if(consume_by, do: Map.put(attrs, :consume_by_date, consume_by), else: attrs)}
    end
  end

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
