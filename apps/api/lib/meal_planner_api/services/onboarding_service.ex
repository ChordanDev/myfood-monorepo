defmodule MealPlannerApi.Services.OnboardingService do
  @moduledoc """
  Completing the Onboarding (issue #20): the profile, the preferences, the
  Slot cooking times and the Account timezone of a User saved in one
  database transaction, with `onboarding_completed_at` stamped only while it
  is nil.

  The groups are validated beforehand with the pure functions of this module
  and of `UserPreferencesService`; `complete/3` then writes them all or, on
  any failure, none of them.
  """

  alias Ecto.Multi
  alias MealPlannerApi.Data.AccountRepo
  alias MealPlannerApi.Persistence.Accounts.{Account, User}
  alias MealPlannerApi.Repo
  alias MealPlannerApi.Services.{AccountService, UserPreferencesService}

  @type attrs :: %{
          profile: map(),
          timezone: String.t(),
          preferences: UserPreferencesService.preferences(),
          slot_cooking_times: map()
        }

  @type completion :: %{
          user: User.t(),
          preferences: UserPreferencesService.preferences(),
          slot_cooking_times: map()
        }

  @doc """
  Checks the profile attributes (`name`, `household_size`, `cooking_skill`)
  against the rules of `User.profile_changeset/2`, without touching the
  database.
  """
  @spec validate_profile(map()) :: :ok | {:error, Ecto.Changeset.t()}
  def validate_profile(attrs), do: check(User.profile_changeset(%User{}, attrs))

  @doc """
  Checks that `timezone` is a zone the time zone database knows, without
  touching the database.
  """
  @spec validate_timezone(term()) :: :ok | {:error, Ecto.Changeset.t()}
  def validate_timezone(timezone),
    do: check(Account.timezone_changeset(%Account{}, %{timezone: timezone}))

  @doc """
  Saves every group of `attrs` for the User and sets the timezone of the
  Account in one transaction, in this order: profile and completion stamp,
  timezone, preferences, Slot cooking times. The User row is locked first, so
  two completions of one User run one after the other.

  Returns the stored User, preferences and Slot cooking times. A failing step
  rolls back the earlier ones and returns its reason.
  """
  @spec complete(Ecto.UUID.t(), Ecto.UUID.t(), attrs()) :: {:ok, completion()} | {:error, term()}
  def complete(user_id, account_id, attrs) do
    Multi.new()
    |> Multi.run(:locked_user, fn _repo, _changes -> lock_user(user_id) end)
    |> Multi.run(:user, fn repo, %{locked_user: user} ->
      user
      |> User.completion_changeset(attrs.profile, DateTime.utc_now())
      |> repo.update()
    end)
    |> Multi.run(:account, fn repo, _changes -> put_timezone(repo, account_id, attrs.timezone) end)
    |> UserPreferencesService.append_replace(user_id, attrs.preferences)
    |> Multi.run(:slot_cooking_times, fn _repo, _changes ->
      AccountRepo.replace_slot_cooking_times(user_id, attrs.slot_cooking_times)
    end)
    |> Repo.transaction()
    |> case do
      {:ok, changes} ->
        {:ok, slot_cooking_times} = AccountService.slot_cooking_times(user_id)

        {:ok,
         %{
           user: changes.user,
           preferences: changes.preferences,
           slot_cooking_times: slot_cooking_times
         }}

      {:error, _step, reason, _changes} ->
        {:error, reason}
    end
  end

  defp lock_user(user_id) do
    case AccountRepo.lock_user(user_id) do
      %User{} = user -> {:ok, user}
      nil -> {:error, :user_not_found}
    end
  end

  defp put_timezone(repo, account_id, timezone) do
    case repo.get(Account, account_id) do
      %Account{} = account ->
        account |> Account.timezone_changeset(%{timezone: timezone}) |> repo.update()

      nil ->
        {:error, :account_not_found}
    end
  end

  defp check(%Ecto.Changeset{valid?: true}), do: :ok
  defp check(%Ecto.Changeset{} = changeset), do: {:error, changeset}
end
