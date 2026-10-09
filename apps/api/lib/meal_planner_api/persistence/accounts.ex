defmodule MealPlannerApi.Persistence.Accounts do
  @moduledoc "Persistence helpers for accounts, users, dietary settings and RevenueCat state."

  import Ecto.Query, warn: false

  alias MealPlannerApi.Repo
  alias MealPlannerApi.Subscriptions

  alias MealPlannerApi.Persistence.Accounts.{
    Account,
    AccountMembership,
    RevenuecatCustomer,
    RevenuecatEntitlement,
    RevenuecatSubscriptionSnapshot,
    RevenuecatWebhookEvent,
    User,
    UserDietaryProfile,
    UserExcludedIngredient,
    UserSlotCookingTime
  }

  def create_account(attrs) do
    attrs =
      attrs
      |> ensure_map()
      |> maybe_put_default_subscription_plan_id()

    %Account{} |> Account.changeset(attrs) |> Repo.insert()
  end

  def get_account(id), do: Repo.get(Account, id)

  def get_account!(id), do: Repo.get!(Account, id)

  def get_account_with_users!(id),
    do: Account |> Repo.get!(id) |> Repo.preload(memberships: :user)

  def create_user(attrs), do: %User{} |> User.changeset(attrs) |> Repo.insert()

  def get_user(id), do: Repo.get(User, id)

  def get_user!(id), do: Repo.get!(User, id)

  @doc """
  Stores the Onboarding profile (`name`, `household_size`, `cooking_skill`)
  on the User with `user_id`. The User is read by id here because the
  authenticated resource is a decorated struct, not the stored row. The
  rules are the ones of `User.profile_changeset/2`; nothing is stored when
  it rejects `attrs`.
  """
  @spec update_user_profile(Ecto.UUID.t(), map()) ::
          {:ok, User.t()} | {:error, :user_not_found | Ecto.Changeset.t()}
  def update_user_profile(user_id, attrs) do
    case Repo.get(User, user_id) do
      %User{} = user -> user |> User.profile_changeset(attrs) |> Repo.update()
      nil -> {:error, :user_not_found}
    end
  end

  def upsert_user_dietary_profile(user_id, attrs) do
    attrs = Map.put(attrs, :user_id, user_id)

    case Repo.get_by(UserDietaryProfile, user_id: user_id) do
      nil -> %UserDietaryProfile{} |> UserDietaryProfile.changeset(attrs) |> Repo.insert()
      profile -> profile |> UserDietaryProfile.changeset(attrs) |> Repo.update()
    end
  end

  @doc "The Slot cooking times a User has saved: no rows, or one per slot."
  def list_user_slot_cooking_times(user_id) do
    from(t in UserSlotCookingTime, where: t.user_id == ^user_id) |> Repo.all()
  end

  @doc """
  Replaces the Slot cooking times of a User with `times`, a map from each
  slot to its `cooking_time_minutes` and `hunger_level`.

  Every slot is written or none is: a slot that is missing or not valid
  rolls the whole set back and returns its changeset. Keys other than the
  three slots are ignored, so a saved set is always exactly three rows.

  `times` is keyed by slot atom, and each slot map is atom-keyed too, as
  `%{lunch: %{cooking_time_minutes: 45, hunger_level: :normal}}` (the Hunger
  level may be an atom or a string). A string-keyed `times` finds no slot, so
  the changeset of the first slot is returned, with an error for each missing
  field; a string-keyed slot map raises inside `cast`, which refuses to mix
  its keys with the atoms added here. The controller never passes either.

  It runs in a transaction and joins the one already open, if any. A refused
  set rolls that outer transaction back too: this function returns
  `{:error, changeset}`, but the outer transaction is already marked as
  rolling back. Its next query raises `DBConnection.ConnectionError`, which
  propagates out of `Repo.transaction/1` unless the caller rescues it. When
  the outer function returns normally, `Repo.transaction/1` returns
  `{:error, :rollback}`; when it calls `Repo.rollback/1` itself, it returns
  that value instead.
  """
  def replace_user_slot_cooking_times(user_id, times) when is_map(times) do
    Repo.transaction(fn ->
      Enum.map(UserSlotCookingTime.slots(), fn slot ->
        attrs = times |> Map.get(slot, %{}) |> Map.merge(%{user_id: user_id, slot: slot})

        case upsert_user_slot_cooking_time(attrs) do
          {:ok, slot_cooking_time} -> slot_cooking_time
          {:error, changeset} -> Repo.rollback(changeset)
        end
      end)
    end)
  end

  # `returning: true` reads the row back, so a replaced row keeps the id and
  # `inserted_at` it already had instead of the ones generated for the insert.
  defp upsert_user_slot_cooking_time(attrs) do
    %UserSlotCookingTime{}
    |> UserSlotCookingTime.changeset(attrs)
    |> Repo.insert(
      on_conflict: {:replace, [:cooking_time_minutes, :hunger_level, :updated_at]},
      conflict_target: [:user_id, :slot],
      returning: true
    )
  end

  def add_user_excluded_ingredient(user_id, ingredient_id, reason) do
    attrs = %{user_id: user_id, ingredient_id: ingredient_id, reason: reason}

    %UserExcludedIngredient{}
    |> UserExcludedIngredient.changeset(attrs)
    |> Repo.insert(
      on_conflict: {:replace, [:reason, :updated_at]},
      conflict_target: [:user_id, :ingredient_id]
    )
  end

  def list_user_excluded_ingredient_ids(user_ids) when is_list(user_ids) do
    from(e in UserExcludedIngredient, where: e.user_id in ^user_ids, select: e.ingredient_id)
    |> Repo.all()
    |> MapSet.new()
  end

  def list_active_member_ids(account_id) do
    from(m in AccountMembership,
      where: m.account_id == ^account_id and m.status == :active,
      select: m.user_id
    )
    |> Repo.all()
  end

  def list_user_excluded_ingredients(user_id) do
    from(e in UserExcludedIngredient, where: e.user_id == ^user_id)
    |> Repo.all()
  end

  def upsert_revenuecat_customer(attrs) do
    %RevenuecatCustomer{}
    |> RevenuecatCustomer.changeset(attrs)
    |> Repo.insert(
      on_conflict: {:replace, [:account_id, :user_id, :updated_at]},
      conflict_target: [:rc_app_user_id]
    )
  end

  def get_revenuecat_customer_by_app_user_id(rc_app_user_id) when is_binary(rc_app_user_id) do
    from(c in RevenuecatCustomer,
      where: c.rc_app_user_id == ^rc_app_user_id,
      limit: 1
    )
    |> Repo.one()
  end

  @doc """
  Returns the `RevenuecatCustomer` (and its `rc_app_user_id`) for the
  given Account. Added in PR 3 — HTTP capability and recovery — so the
  `GET /billing/revenuecat/status` endpoint can return the
  server-issued `app_user_id` for the Account's current membership
  (`design.md` §"Interfaces / Contracts").
  """
  def get_revenuecat_customer_by_account_id(account_id) when is_binary(account_id) do
    from(c in RevenuecatCustomer,
      where: c.account_id == ^account_id,
      limit: 1
    )
    |> Repo.one()
  end

  def upsert_revenuecat_entitlement(attrs) do
    # Normalize status → is_active for backwards compatibility
    attrs =
      cond do
        Map.has_key?(attrs, :is_active) -> attrs
        Map.has_key?(attrs, "is_active") -> attrs
        Map.get(attrs, "status") == "active" -> Map.put(attrs, :is_active, true)
        Map.get(attrs, "status") == "inactive" -> Map.put(attrs, :is_active, false)
        true -> attrs
      end

    %RevenuecatEntitlement{}
    |> RevenuecatEntitlement.changeset(attrs)
    |> Repo.insert(
      on_conflict: {:replace_all_except, [:id, :inserted_at]},
      conflict_target: [:account_id, :entitlement_id]
    )
  end

  def list_active_revenuecat_entitlements_for_account(account_id, now \\ DateTime.utc_now()) do
    from(e in RevenuecatEntitlement,
      where: e.account_id == ^account_id and e.is_active == true,
      where:
        is_nil(e.expiration_date) or e.expiration_date > ^now or
          (not is_nil(e.grace_period_expires_date) and e.grace_period_expires_date > ^now),
      order_by: [desc: e.updated_at]
    )
    |> Repo.all()
  end

  def create_revenuecat_webhook_event(attrs) do
    %RevenuecatWebhookEvent{}
    |> RevenuecatWebhookEvent.changeset(attrs)
    |> Repo.insert()
  end

  def update_revenuecat_webhook_event(event, attrs) do
    event
    |> RevenuecatWebhookEvent.changeset(attrs)
    |> Repo.update()
  end

  def create_revenuecat_subscription_snapshot(attrs) do
    %RevenuecatSubscriptionSnapshot{}
    |> RevenuecatSubscriptionSnapshot.changeset(attrs)
    |> Repo.insert()
  end

  defp maybe_put_default_subscription_plan_id(attrs) do
    if Map.has_key?(attrs, :subscription_plan_id) do
      attrs
    else
      plan = Map.get(attrs, :plan, :individual)

      case Subscriptions.ensure_default_plan_id(plan) do
        {:ok, plan_id} -> Map.put(attrs, :subscription_plan_id, plan_id)
        {:error, _} -> attrs
      end
    end
  end

  defp ensure_map(attrs) when is_map(attrs), do: attrs
end
