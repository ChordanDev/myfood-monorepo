defmodule MealPlannerApi.Persistence.Shopping.ShoppingItem do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "shopping_items" do
    field(:planned_date, :date)
    field(:quantity_milli, :integer)
    field(:unit, Ecto.Enum, values: [:g, :ml, :unit])

    field(:status, Ecto.Enum,
      values: [:pending, :in_cart, :removed, :pending_delivery, :checked_out, :archived],
      default: :pending
    )

    # `:planned_meal` rows are derived from a Scheduled meal. `:manual` rows
    # are added by hand: they have a `name` and no meal, date or Ingredient
    # required (the Ingredient is optional).
    field(:source, Ecto.Enum, values: [:planned_meal, :manual], default: :planned_meal)
    field(:name, :string)

    field(:estimated_price_cents, :integer)
    field(:reservation_token, Ecto.UUID)

    belongs_to(:account, MealPlannerApi.Persistence.Accounts.Account)
    belongs_to(:scheduled_meal, MealPlannerApi.Persistence.Planning.ScheduledMeal)
    belongs_to(:ingredient, MealPlannerApi.Persistence.Catalog.Ingredient)

    belongs_to(:assigned_supermarket, MealPlannerApi.Persistence.Shopping.Supermarket,
      foreign_key: :assigned_supermarket_id
    )

    belongs_to(:checkout_session, MealPlannerApi.Persistence.Shopping.CheckoutSession,
      foreign_key: :checkout_session_id,
      type: :binary_id
    )

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(item, attrs) do
    item
    |> cast(attrs, [
      :account_id,
      :scheduled_meal_id,
      :planned_date,
      :ingredient_id,
      :quantity_milli,
      :unit,
      :assigned_supermarket_id,
      :checkout_session_id,
      :status,
      :source,
      :name,
      :estimated_price_cents,
      :reservation_token
    ])
    |> validate_required([:account_id, :quantity_milli, :unit, :status, :source])
    |> validate_source_fields()
    |> validate_number(:quantity_milli, greater_than: 0)
    |> validate_number(:estimated_price_cents, greater_than_or_equal_to: 0)
    |> foreign_key_constraint(:account_id)
    |> foreign_key_constraint(:scheduled_meal_id)
    |> foreign_key_constraint(:ingredient_id)
    |> foreign_key_constraint(:assigned_supermarket_id)
    # At most one open Shopping item (`:pending` or `:in_cart`) per Account,
    # Scheduled meal, planned date, Ingredient and unit. Closed items are not
    # constrained, so the error only shows up when a second open one is stored.
    |> unique_constraint(:ingredient_id,
      name: :shopping_items_open_planned_key_index,
      message: "already has an open shopping item for this scheduled meal, date and unit"
    )
  end

  @max_name_length 200

  @doc """
  Changeset of an item added by hand: a `name`, an optional Ingredient, a
  quantity and a unit. It is always `:manual`, `:pending` and for no
  Scheduled meal, whatever `attrs` carry.
  """
  def manual_changeset(item, attrs) do
    item
    |> cast(attrs, [:account_id, :name, :ingredient_id, :quantity_milli, :unit])
    |> put_change(:source, :manual)
    |> put_change(:status, :pending)
    |> put_change(:scheduled_meal_id, nil)
    |> put_change(:planned_date, nil)
    |> changeset(%{})
  end

  # A planned row belongs to a Scheduled meal, a date and an Ingredient; a
  # manual row needs a name.
  defp validate_source_fields(changeset) do
    case get_field(changeset, :source) do
      :manual ->
        changeset
        |> update_change(:name, &String.trim/1)
        |> validate_required([:name])
        |> validate_length(:name, max: @max_name_length)

      _planned ->
        validate_required(changeset, [:scheduled_meal_id, :planned_date, :ingredient_id])
    end
  end
end
