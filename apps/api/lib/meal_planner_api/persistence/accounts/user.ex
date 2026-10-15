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

  # `name` is `varchar(255)`. The limit is counted in codepoints, which is
  # how the column counts its characters.
  @max_name_codepoints 255

  schema "users" do
    field(:email, :string)
    field(:name, :string)
    field(:role, Ecto.Enum, values: [:owner, :member])
    field(:avatar_url, :string)
    # Set when the user finishes onboarding; nil means not completed.
    field(:onboarding_completed_at, :utc_datetime_usec)
    # Onboarding profile; nil until the user saves one.
    field(:household_size, :integer)
    field(:cooking_skill, :string)
    # True while the User is the stub an invite created for an email nobody
    # has signed in with. Only such a User can be claimed by an invite accept
    # without a Bearer token, and claiming it clears the flag. No changeset
    # casts it.
    field(:invite_stub, :boolean, default: false)

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
    |> cast(attrs, [:account_id, :email, :name, :role, :avatar_url])
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
  `cooking_skill`, all three required. The Household size is 1 to 20 and
  the Cooking skill is one of `cooking_skills/0`. No other field is cast,
  so a profile write never touches `onboarding_completed_at`.

  The name is trimmed and holds 1 to 64 characters, counted in graphemes.
  A grapheme can take several codepoints, so the name is also held to the
  255 codepoints the column stores, and it carries no NUL character, which
  Postgres does not store. Every one of these is an error on `name`.
  """
  @spec profile_changeset(t(), map()) :: Ecto.Changeset.t()
  def profile_changeset(user, attrs) do
    user
    |> cast(attrs, [:name, :household_size, :cooking_skill])
    |> update_change(:name, &trim/1)
    |> validate_required([:name, :household_size, :cooking_skill])
    |> validate_length(:name, max: 64)
    |> validate_length(:name, max: @max_name_codepoints, count: :codepoints)
    |> validate_change(:name, &reject_nul/2)
    |> validate_number(:household_size, greater_than_or_equal_to: 1, less_than_or_equal_to: 20)
    |> validate_inclusion(:cooking_skill, @cooking_skills)
  end

  @doc """
  The Onboarding profile of `profile_changeset/2` plus the completion stamp:
  `onboarding_completed_at` becomes `now` only while it is nil, so a later
  completion keeps the first timestamp.
  """
  @spec completion_changeset(t(), map(), DateTime.t()) :: Ecto.Changeset.t()
  def completion_changeset(%__MODULE__{} = user, attrs, %DateTime{} = now) do
    changeset = profile_changeset(user, attrs)

    if is_nil(user.onboarding_completed_at) do
      put_change(changeset, :onboarding_completed_at, now)
    else
      changeset
    end
  end

  # A blank name over a stored one is cast to a nil change.
  defp trim(nil), do: nil
  defp trim(name), do: String.trim(name)

  # Postgres rejects a NUL character in a text value.
  defp reject_nul(field, value) do
    if String.contains?(value, <<0>>), do: [{field, "must not contain a NUL character"}], else: []
  end
end
