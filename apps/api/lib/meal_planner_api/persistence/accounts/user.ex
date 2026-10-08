defmodule MealPlannerApi.Persistence.Accounts.User do
  @moduledoc """
  User schema — Phase A nullable account_id.

  Per `design.md` §2.3 (decision 5.1) `users.account_id` is relaxed to
  nullable for the dual-write window so that `access_v2` JWT holders can
  carry `current_user.account_id == nil` while `current_membership` carries
  the real tenancy. The schema mirrors the migration: `account_id` is no
  longer in the required list, and a `has_many :memberships` association
  is added (tenancy now flows through `AccountMembership` rows — see
  `account_membership.ex`).
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @type t :: %__MODULE__{}

  @cooking_skills ~w(beginner intermediate advanced)

  schema "users" do
    field(:email, :string)
    field(:name, :string)
    field(:role, Ecto.Enum, values: [:owner, :member])
    field(:password_hash, :string)
    field(:avatar_url, :string)
    # Set when the user finishes onboarding; nil means not completed.
    field(:onboarding_completed_at, :utc_datetime_usec)
    # Onboarding profile; nil until the user saves one.
    field(:household_size, :integer)
    field(:cooking_skill, :string)

    belongs_to(:account, MealPlannerApi.Persistence.Accounts.Account)
    has_many(:memberships, MealPlannerApi.Persistence.Accounts.AccountMembership)
    has_one(:dietary_profile, MealPlannerApi.Persistence.Accounts.UserDietaryProfile)
    has_many(:excluded_ingredients, MealPlannerApi.Persistence.Accounts.UserExcludedIngredient)
    has_one(:revenuecat_customer, MealPlannerApi.Persistence.Accounts.RevenuecatCustomer)
    has_many(:favorite_recipes, MealPlannerApi.Persistence.Catalog.FavoriteRecipe)

    timestamps(type: :utc_datetime_usec)
  end

  @doc """
  Casts and validates a user changeset. Required fields: email, name,
  role. `account_id` is OPTIONAL during the dual-write window — see the
  module doc and `design.md` §2.3.
  """
  def changeset(user, attrs) do
    user
    |> cast(attrs, [:account_id, :email, :name, :role, :password_hash, :avatar_url])
    |> validate_required([:email, :name, :role])
    |> unique_constraint(:email)
    |> foreign_key_constraint(:account_id)
  end

  @doc """
  The Cooking skill catalog, as stored and as sent on the wire.
  """
  @spec cooking_skills() :: [String.t()]
  def cooking_skills, do: @cooking_skills

  @doc """
  Casts and validates the Onboarding profile: `name`, `household_size` and
  `cooking_skill`, all three required. The name is trimmed and holds 1 to
  64 characters, the Household size is 1 to 20 and the Cooking skill is one
  of `cooking_skills/0`. No other field is cast, so a profile write never
  touches `onboarding_completed_at`.
  """
  @spec profile_changeset(t(), map()) :: Ecto.Changeset.t()
  def profile_changeset(user, attrs) do
    user
    |> cast(attrs, [:name, :household_size, :cooking_skill])
    |> update_change(:name, &trim/1)
    |> validate_required([:name, :household_size, :cooking_skill])
    |> validate_length(:name, max: 64)
    |> validate_number(:household_size, greater_than_or_equal_to: 1, less_than_or_equal_to: 20)
    |> validate_inclusion(:cooking_skill, @cooking_skills)
  end

  # A blank name over a stored one is cast to a nil change.
  defp trim(nil), do: nil
  defp trim(name), do: String.trim(name)
end
