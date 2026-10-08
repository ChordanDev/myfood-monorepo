defmodule MealPlannerApi.Services.AccountService do
  @moduledoc """
  Account and user management orchestration.

  Phase A — Tenancy Refactor (PR 1). The legacy `account.users`
  association was removed when the canonical tenancy was moved onto
  `account.memberships`. This module now treats the membership roster
  as the source of truth: every consumer that previously walked
  `account.users` walks `account.memberships` and pulls the user record
  off each membership.
  """

  alias MealPlannerApi.Data.AccountRepo
  alias MealPlannerApi.Persistence.Accounts.UserSlotCookingTime
  alias MealPlannerApi.Persistence.Identity

  @spec context(map()) :: {:ok, map()} | {:error, term()}
  def context(user) do
    case Identity.ensure_persistent_identity(user) do
      {:ok, identity} ->
        case AccountRepo.get_account_with_users!(identity.account_id) do
          account when not is_nil(account) ->
            {:ok,
             %{
               account: serialize_account(account),
               subscription: serialize_subscription(identity),
               active_users: active_users_from_memberships(account)
             }}

          nil ->
            {:error, :account_not_found}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  @spec update_dietary_profile(map(), map()) :: {:ok, map()} | {:error, term()}
  def update_dietary_profile(user, attrs) do
    case Identity.ensure_persistent_identity(user) do
      {:ok, identity} ->
        profile_attrs = %{
          diet_type: Map.get(attrs, "diet_type", Map.get(attrs, :diet_type)),
          macro_goal: Map.get(attrs, "macro_goal", Map.get(attrs, :macro_goal))
        }

        case AccountRepo.upsert_dietary_profile(identity.user_id, profile_attrs) do
          {:ok, profile} -> {:ok, serialize_dietary_profile(profile)}
          {:error, reason} -> {:error, reason}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  @spec dietary_profile(map()) :: {:ok, map() | nil} | {:error, term()}
  def dietary_profile(user) do
    case Identity.ensure_persistent_identity(user) do
      {:ok, identity} ->
        case AccountRepo.get_dietary_profile(identity.user_id) do
          nil -> {:ok, nil}
          profile -> {:ok, serialize_dietary_profile(profile)}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc """
  The Slot cooking times of a User, keyed by slot. A User who has not saved
  the three slots has none: an incomplete set is not served.
  """
  @spec slot_cooking_times(Ecto.UUID.t()) ::
          {:ok, map()} | {:error, :slot_cooking_times_not_found}
  def slot_cooking_times(user_id) do
    slot_cooking_times = AccountRepo.list_slot_cooking_times(user_id)

    if length(slot_cooking_times) == length(UserSlotCookingTime.slots()) do
      {:ok, serialize_slot_cooking_times(slot_cooking_times)}
    else
      {:error, :slot_cooking_times_not_found}
    end
  end

  @doc """
  Replaces the Slot cooking times of a User and returns the stored set.
  `times` maps each slot to its `cooking_time_minutes` and `hunger_level`.
  """
  @spec replace_slot_cooking_times(Ecto.UUID.t(), map()) ::
          {:ok, map()} | {:error, Ecto.Changeset.t()}
  def replace_slot_cooking_times(user_id, times) do
    case AccountRepo.replace_slot_cooking_times(user_id, times) do
      {:ok, slot_cooking_times} -> {:ok, serialize_slot_cooking_times(slot_cooking_times)}
      {:error, reason} -> {:error, reason}
    end
  end

  @spec add_excluded_ingredient(map(), Ecto.UUID.t(), String.t()) ::
          {:ok, map()} | {:error, term()}
  def add_excluded_ingredient(user, ingredient_id, reason) do
    case Identity.ensure_persistent_identity(user) do
      {:ok, identity} ->
        case AccountRepo.add_excluded_ingredient(identity.user_id, ingredient_id, reason) do
          {:ok, excluded} -> {:ok, serialize_exclusion(excluded)}
          {:error, reason} -> {:error, reason}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  @spec remove_excluded_ingredient(map(), Ecto.UUID.t()) :: :ok | {:error, term()}
  def remove_excluded_ingredient(user, ingredient_id) do
    case Identity.ensure_persistent_identity(user) do
      {:ok, identity} ->
        AccountRepo.remove_excluded_ingredient(identity.user_id, ingredient_id)
        :ok

      {:error, reason} ->
        {:error, reason}
    end
  end

  @spec list_excluded_ingredients(map()) :: {:ok, [map()]} | {:error, term()}
  def list_excluded_ingredients(user) do
    case Identity.ensure_persistent_identity(user) do
      {:ok, identity} ->
        ingredients = AccountRepo.list_excluded_ingredients(identity.user_id)
        {:ok, Enum.map(ingredients, &serialize_exclusion/1)}

      {:error, reason} ->
        {:error, reason}
    end
  end

  # -------------------------------------------------------------------------
  # Helpers
  # -------------------------------------------------------------------------

  defp serialize_account(a) do
    plan = Map.get(a, :plan, :individual)
    plan_string = plan |> to_string()

    %{
      id: a.id,
      name: a.name,
      plan: plan_string,
      account_type: legacy_account_type_for_plan(plan_string),
      subscription_tier: Atom.to_string(Map.get(a, :subscription_tier) || :free),
      default_budget_cents: a.default_budget_cents,
      created_at: iso_datetime(a.inserted_at)
    }
  end

  defp legacy_account_type_for_plan("individual"), do: "individual"
  defp legacy_account_type_for_plan(_), do: "group"

  defp active_users_from_memberships(account) do
    account.memberships
    |> Enum.filter(&(&1.status == :active))
    |> Enum.map(fn membership -> membership.user end)
    |> Enum.reject(&is_nil/1)
    |> Enum.map(&serialize_user/1)
  end

  defp serialize_user(u) do
    %{
      id: u.id,
      name: u.name,
      email: u.email,
      is_owner: false
    }
  end

  defp serialize_subscription(identity) do
    %{
      user_id: identity.user_id,
      account_id: identity.account_id,
      plan: Map.get(identity, :plan, "individual"),
      account_type: Map.get(identity, :account_type, "individual"),
      subscription_tier: Map.get(identity, :subscription_tier, :free)
    }
  end

  defp serialize_dietary_profile(p) do
    %{
      id: p.id,
      user_id: p.user_id,
      diet_type: enum_string(p.diet_type),
      macro_goal: enum_string(p.macro_goal)
    }
  end

  # A dietary profile saved through `PUT /api/me/preferences` can hold no
  # Diet and no macro goal; `Atom.to_string/1` would render those as "nil".
  defp enum_string(nil), do: nil
  defp enum_string(value), do: Atom.to_string(value)

  defp serialize_slot_cooking_times(slot_cooking_times) do
    Map.new(slot_cooking_times, fn t ->
      {t.slot,
       %{
         cooking_time_minutes: t.cooking_time_minutes,
         hunger_level: Atom.to_string(t.hunger_level)
       }}
    end)
  end

  defp serialize_exclusion(exclusion) do
    %{
      ingredient_id: exclusion.ingredient_id,
      reason: Atom.to_string(exclusion.reason)
    }
  end

  defp iso_datetime(nil), do: nil
  defp iso_datetime(%DateTime{} = dt), do: DateTime.to_iso8601(dt)
  defp iso_datetime(%Date{} = d), do: Date.to_iso8601(d)
end
