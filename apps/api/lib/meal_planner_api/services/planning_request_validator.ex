defmodule MealPlannerApi.Services.PlanningRequestValidator do
  @moduledoc """
  Validates account and participant authority before planning writes or
  optimization.

  The participants of a plan are the members whose dietary rules filter its
  recipe candidates. A request that names none plans for every active member
  of the Account (issue #311); an explicit `participant_ids` narrows the set
  and may name only active members.
  """

  alias MealPlannerApi.Persistence.Accounts.AccountMembershipQueries

  @spec validate_request(map(), Ecto.UUID.t(), Ecto.UUID.t()) ::
          {:ok, map(),
           %{account_id: Ecto.UUID.t(), actor_id: Ecto.UUID.t(), participant_ids: [Ecto.UUID.t()]}}
          | {:error, :not_a_member | :forbidden}
  def validate_request(constraints, account_id, actor_id) when is_map(constraints) do
    with {:ok, actor_id} <- Ecto.UUID.cast(actor_id),
         {:ok, requested} <- requested_participant_ids(constraints),
         :ok <- validate_actor(account_id, actor_id),
         participants = participants_or_default(requested, account_id),
         true <- Enum.all?(participants, &active_member?(&1, account_id)) do
      validated_constraints =
        constraints
        |> Map.delete(:participant_ids)
        |> Map.put("participant_ids", participants)

      {:ok, validated_constraints,
       %{account_id: account_id, actor_id: actor_id, participant_ids: participants}}
    else
      :error -> {:error, :forbidden}
      false -> {:error, :forbidden}
      {:error, _} -> {:error, :forbidden}
    end
  end

  def validate_request(_, _, _), do: {:error, :forbidden}

  @spec validate_actor(Ecto.UUID.t(), Ecto.UUID.t()) :: :ok | {:error, :not_a_member}
  def validate_actor(account_id, actor_id) do
    case AccountMembershipQueries.load_active_membership(actor_id, account_id) do
      %{status: :active} -> :ok
      nil -> {:error, :not_a_member}
    end
  end

  defp active_member?(user_id, account_id),
    do:
      match?(
        %{status: :active},
        AccountMembershipQueries.load_active_membership(user_id, account_id)
      )

  # `:all_active_members` when the request names no participants. A
  # `participant_ids` that is present stays the caller's choice, so an empty
  # or malformed one is refused rather than widened.
  defp requested_participant_ids(constraints) do
    case fetch_participant_ids(constraints) do
      {:ok, participants} -> cast_participant_ids(participants)
      :error -> {:ok, :all_active_members}
    end
  end

  defp fetch_participant_ids(constraints) do
    with :error <- Map.fetch(constraints, "participant_ids"),
         do: Map.fetch(constraints, :participant_ids)
  end

  defp participants_or_default(:all_active_members, account_id),
    do: AccountMembershipQueries.list_active_member_ids(account_id)

  defp participants_or_default(participants, _account_id), do: participants

  defp cast_participant_ids(participants) when is_list(participants) and participants != [] do
    participants
    |> Enum.reduce_while({:ok, []}, fn participant_id, {:ok, ids} ->
      case Ecto.UUID.cast(participant_id) do
        {:ok, id} -> {:cont, {:ok, [id | ids]}}
        :error -> {:halt, :error}
      end
    end)
    |> case do
      {:ok, ids} -> {:ok, ids |> Enum.reverse() |> Enum.uniq()}
      :error -> :error
    end
  end

  defp cast_participant_ids(_), do: :error
end
