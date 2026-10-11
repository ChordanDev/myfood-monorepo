defmodule MealPlannerApi.Repo.Migrations.AddClientMessageIdToCookingChatMessages do
  @moduledoc """
  Idempotent Cooking chat questions (issue #36): the id the app generates for
  a question is stored on its user turn, at most once per Cooking session, so
  a resend after a lost answer finds the stored pair instead of a second one.

  The version has 15 digits so it sorts after every other migration: Ecto
  orders versions as integers and the folder already holds 15-digit versions.
  """
  use Ecto.Migration

  def change do
    alter table(:cooking_chat_messages) do
      add :client_message_id, :binary_id
    end

    create unique_index(:cooking_chat_messages, [:cooking_session_id, :client_message_id],
             name: :cooking_chat_messages_session_client_message_index,
             where: "client_message_id IS NOT NULL"
           )
  end
end
