defmodule MealPlannerApi.PlanningAgent.Consent do
  @moduledoc """
  AI-processing consent before a User's data is first sent to the external
  AI provider (issue #423). It is asked once per User, the first time they
  plan, and stored: a User who consented is not asked again, in any Account.
  Recording it is a human-only action; the agent can never grant it.

  The consent text is a placeholder until its legal review (Argentina, Ley
  25.326, health data). The reviewed text gets a new `text_version/0`.

  Ported from myfood@d9b965a, where consent was stored per Account and User.
  """

  import Ecto.Query

  alias MealPlannerApi.Persistence.Planning.PlanningConsent
  alias MealPlannerApi.Repo

  @text_version "placeholder-2026-10-22"

  @text "PLACEHOLDER, pending legal review. To plan your meals, MyFood sends " <>
          "your household's eating preferences, dietary restrictions and allergies " <>
          "to an external AI provider (Anthropic). Do you agree?"

  @doc "The consent text the User is asked to agree to."
  @spec text() :: String.t()
  def text, do: @text

  @doc "The version of `text/0`, stored with every consent."
  @spec text_version() :: String.t()
  def text_version, do: @text_version

  @doc "Whether the User has consented to AI processing."
  @spec granted?(Ecto.UUID.t()) :: boolean()
  def granted?(user_id),
    do: Repo.exists?(from(c in PlanningConsent, where: c.user_id == ^user_id))

  @doc "Records the User's consent to the current text. Idempotent."
  @spec record(Ecto.UUID.t()) :: :ok | {:error, Ecto.Changeset.t()}
  def record(user_id) do
    %PlanningConsent{}
    |> PlanningConsent.changeset(%{
      user_id: user_id,
      granted_at: DateTime.utc_now(),
      text_version: @text_version
    })
    |> Repo.insert(on_conflict: :nothing, conflict_target: [:user_id])
    |> case do
      {:ok, _} -> :ok
      {:error, changeset} -> {:error, changeset}
    end
  end
end
