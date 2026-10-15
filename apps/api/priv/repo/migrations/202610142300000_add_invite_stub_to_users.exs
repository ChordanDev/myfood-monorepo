defmodule MealPlannerApi.Repo.Migrations.AddInviteStubToUsers do
  @moduledoc """
  Marks the stub Users an invite creates for an email nobody has signed in
  with. `POST /api/invites/:token/accept` with only a `name` and no Bearer
  token may claim such a stub, and only once; any other User has to accept
  with their own Bearer token, so an invite token can no longer be turned
  into a session for an existing User.

  New columns default to `false`, so every existing User needs a Bearer token
  to accept. The backfill marks the Users that are still unclaimed stubs: no
  legacy `account_id`, no finished onboarding, at least one pending invite
  and no `:active` or `:suspended` Membership.

  The version has 15 digits so it sorts after every other migration: Ecto
  orders versions as integers and the folder already holds 15-digit versions.
  """
  use Ecto.Migration

  def up do
    alter table(:users) do
      add :invite_stub, :boolean, null: false, default: false
    end

    flush()

    execute("""
    UPDATE users u
    SET invite_stub = true
    WHERE u.account_id IS NULL
      AND u.onboarding_completed_at IS NULL
      AND EXISTS (
        SELECT 1 FROM account_memberships m
        WHERE m.user_id = u.id AND m.status = 'invited'
      )
      AND NOT EXISTS (
        SELECT 1 FROM account_memberships m
        WHERE m.user_id = u.id AND m.status IN ('active', 'suspended')
      )
    """)
  end

  def down do
    alter table(:users) do
      remove :invite_stub
    end
  end
end
