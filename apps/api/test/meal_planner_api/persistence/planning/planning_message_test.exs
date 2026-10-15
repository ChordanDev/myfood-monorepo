defmodule MealPlannerApi.Persistence.Planning.PlanningMessageTest do
  use ExUnit.Case, async: true

  alias MealPlannerApi.Persistence.Planning.PlanningMessage

  # Issue #146 — `session_resumed` pushes the recent messages on every join,
  # so the content of a message is bounded.
  defp changeset(content) do
    PlanningMessage.changeset(%PlanningMessage{}, %{
      account_id: Ecto.UUID.generate(),
      session_id: Ecto.UUID.generate(),
      role: :user,
      content: content
    })
  end

  test "accepts content at the limit" do
    assert changeset(String.duplicate("a", PlanningMessage.max_content_chars())).valid?
  end

  test "refuses content over the limit" do
    changeset = changeset(String.duplicate("a", PlanningMessage.max_content_chars() + 1))

    refute changeset.valid?

    assert {_message, [count: 2000, validation: :length, kind: :max, type: :string]} =
             changeset.errors[:content]
  end

  test "counts characters, not bytes" do
    assert changeset(String.duplicate("ñ", PlanningMessage.max_content_chars())).valid?
  end
end
