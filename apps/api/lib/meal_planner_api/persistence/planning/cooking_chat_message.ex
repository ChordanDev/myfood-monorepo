defmodule MealPlannerApi.Persistence.Planning.CookingChatMessage do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @type t :: %__MODULE__{}

  schema "cooking_chat_messages" do
    field(:role, Ecto.Enum, values: [:user, :assistant, :system])
    field(:content, :string)
    # The id the app gave the question; set on user turns only.
    field(:client_message_id, Ecto.UUID)

    belongs_to(:cooking_session, MealPlannerApi.Persistence.Planning.CookingSession)
    belongs_to(:user, MealPlannerApi.Persistence.Accounts.User)

    timestamps(type: :utc_datetime_usec)
  end

  # `inserted_at` may be given so the two turns of one question keep a strict order.
  def changeset(message, attrs) do
    message
    |> cast(attrs, [
      :cooking_session_id,
      :user_id,
      :role,
      :content,
      :client_message_id,
      :inserted_at
    ])
    |> validate_required([:cooking_session_id, :role, :content])
    |> unique_constraint([:cooking_session_id, :client_message_id],
      name: :cooking_chat_messages_session_client_message_index
    )
    |> foreign_key_constraint(:cooking_session_id)
    |> foreign_key_constraint(:user_id)
  end
end
