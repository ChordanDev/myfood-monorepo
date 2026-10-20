defmodule MealPlannerApi.Repo.Migrations.CreateSocialIdentities do
  @moduledoc """
  Social identities (issue #106): which User a provider account signs in
  as.

    * `user_id` — cascades: an identity goes with its User.
    * `provider` — `"google"` or `"apple"`.
    * `subject` — the provider's stable id for the person (the ID token's
      `sub`). Apple sends the email only on the first sign-in, so a later
      sign-in is matched by this column, not by email.

  The unique index on `(provider, subject)` holds one User per provider
  account when two first sign-ins race. The `user_id` index keeps the
  cascade from scanning the table.
  """
  use Ecto.Migration

  def change do
    create table(:social_identities, primary_key: false) do
      add(:id, :binary_id, primary_key: true)
      add(:user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false)
      add(:provider, :string, null: false)
      add(:subject, :string, null: false)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:social_identities, [:provider, :subject]))
    create(index(:social_identities, [:user_id]))
  end
end
