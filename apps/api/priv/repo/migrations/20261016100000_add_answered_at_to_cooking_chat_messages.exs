defmodule MealPlannerApi.Repo.Migrations.AddAnsweredAtToCookingChatMessages do
  @moduledoc """
  Cooking chat reservations (issue #322): a question is stored before the
  model is called, with `answered_at` NULL, and is marked answered when its
  answer is stored, so the daily limit counts it while the model runs.

  Every question stored before this migration was stored together with its
  answer, so the backfill marks each user turn that has a later assistant
  turn in its session as answered when it was asked. Rolling back deletes the
  questions still waiting for an answer, which the old schema cannot tell
  from answered ones.
  """
  use Ecto.Migration

  def up do
    alter table(:cooking_chat_messages) do
      add :answered_at, :utc_datetime_usec
    end

    flush()

    execute(backfill_sql())
  end

  def down do
    execute("DELETE FROM cooking_chat_messages WHERE role = 'user' AND answered_at IS NULL")

    alter table(:cooking_chat_messages) do
      remove :answered_at
    end
  end

  @doc false
  def backfill_sql do
    """
    UPDATE cooking_chat_messages AS question
    SET answered_at = question.inserted_at
    WHERE question.role = 'user'
      AND question.answered_at IS NULL
      AND EXISTS (
        SELECT 1 FROM cooking_chat_messages AS answer
        WHERE answer.cooking_session_id = question.cooking_session_id
          AND answer.role = 'assistant'
          AND answer.inserted_at > question.inserted_at
      )
    """
  end
end
