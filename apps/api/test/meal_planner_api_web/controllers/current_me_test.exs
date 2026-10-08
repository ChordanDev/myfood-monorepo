defmodule MealPlannerApiWeb.CurrentMeTest do
  use ExUnit.Case, async: false

  import MealPlannerApi.FactoryHelpers

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Accounts.RevenuecatEntitlement
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Repo
  alias MealPlannerApiWeb.CurrentMe

  @now ~U[2026-06-10 12:00:00.000000Z]
  @trial_started_at ~U[2026-06-07 00:00:00.000000Z]
  @trial_ends_at ~U[2026-06-14 00:00:00.000000Z]
  @past_trial_started_at ~U[2026-05-01 00:00:00.000000Z]
  @past_trial_ends_at ~U[2026-05-08 00:00:00.000000Z]

  @account_types [
    individual: "individual",
    trial: "individual",
    family_4: "family",
    family_6: "family_plus"
  ]

  # Access state => {account attrs, expected trialEndsAt, subscriptionStatus, access}
  @access_states [
    trial:
      {%{trial_started_at: @trial_started_at, trial_ends_at: @trial_ends_at},
       "2026-06-14T00:00:00.000000Z", "none", %{canUseApp: true, reason: nil}},
    active:
      {%{
         trial_started_at: @past_trial_started_at,
         trial_ends_at: @past_trial_ends_at,
         revenuecat_entitlements: [
           %RevenuecatEntitlement{
             is_active: true,
             expiration_date: ~U[2026-07-01 00:00:00.000000Z]
           }
         ]
       }, "2026-05-08T00:00:00.000000Z", "active", %{canUseApp: true, reason: nil}},
    expired:
      {%{trial_started_at: @past_trial_started_at, trial_ends_at: @past_trial_ends_at},
       "2026-05-08T00:00:00.000000Z", "none", %{canUseApp: false, reason: "trial_expired"}}
  ]

  describe "build/4 — plan and access matrix" do
    for {plan, type} <- @account_types,
        {state, {attrs, trial_ends_at, subscription_status, access}} <- @access_states do
      test "plan #{plan} with #{state} access" do
        account = account(Map.put(unquote(Macro.escape(attrs)), :plan, unquote(plan)))

        assert CurrentMe.build(user(), account, membership(), @now).account == %{
                 id: account.id,
                 type: unquote(type),
                 trialEndsAt: unquote(trial_ends_at),
                 subscriptionStatus: unquote(subscription_status),
                 access: unquote(Macro.escape(access))
               }
      end
    end

    test "an account that never had a trial has a null trialEndsAt" do
      me = CurrentMe.build(user(), account(%{plan: :individual}), membership(), @now)

      assert me.account.trialEndsAt == nil
      assert me.account.access == %{canUseApp: false, reason: "trial_expired"}
    end
  end

  describe "build/4 — user, membership and onboarding" do
    test "returns the whole mobile shape" do
      user = user()
      account = account(%{trial_started_at: @trial_started_at, trial_ends_at: @trial_ends_at})

      assert CurrentMe.build(user, account, membership(), @now) == %{
               user: %{
                 id: user.id,
                 email: "ana@example.com",
                 displayName: "Ana",
                 householdSize: nil,
                 cookingSkill: nil
               },
               account: %{
                 id: account.id,
                 type: "individual",
                 trialEndsAt: "2026-06-14T00:00:00.000000Z",
                 subscriptionStatus: "none",
                 access: %{canUseApp: true, reason: nil}
               },
               membership: %{role: "owner"},
               onboarding: %{isComplete: false}
             }
    end

    test "encodes to the JSON field names the mobile client reads" do
      json =
        user()
        |> CurrentMe.build(account(%{}), membership(), @now)
        |> Jason.encode!()
        |> Jason.decode!()

      assert json |> Map.keys() |> Enum.sort() == ["account", "membership", "onboarding", "user"]

      assert json["user"] |> Map.keys() |> Enum.sort() ==
               ["cookingSkill", "displayName", "email", "householdSize", "id"]

      assert json["account"] |> Map.keys() |> Enum.sort() ==
               ["access", "id", "subscriptionStatus", "trialEndsAt", "type"]

      assert json["account"]["access"] == %{"canUseApp" => false, "reason" => "trial_expired"}
      assert json["membership"] == %{"role" => "owner"}
      assert json["onboarding"] == %{"isComplete" => false}
    end

    test "profile fields are null until the User saves a profile" do
      me = CurrentMe.build(user(), account(%{}), membership(), @now)

      assert me.user.householdSize == nil
      assert me.user.cookingSkill == nil
    end

    test "serializes the stored Household size and Cooking skill" do
      user = %{user() | household_size: 4, cooking_skill: "intermediate"}
      me = CurrentMe.build(user, account(%{}), membership(), @now)

      assert me.user.householdSize == 4
      assert me.user.cookingSkill == "intermediate"
    end

    test "membership role is rendered as a string" do
      me = CurrentMe.build(user(), account(%{}), membership(:member), @now)

      assert me.membership == %{role: "member"}
    end

    test "onboarding is incomplete while onboarding_completed_at is nil" do
      me = CurrentMe.build(user(), account(%{}), membership(), @now)

      assert me.onboarding == %{isComplete: false}
    end

    test "onboarding is complete once onboarding_completed_at is set" do
      user = %{user() | onboarding_completed_at: ~U[2026-06-09 08:00:00.000000Z]}
      me = CurrentMe.build(user, account(%{}), membership(), @now)

      assert me.onboarding == %{isComplete: true}
    end
  end

  describe "user_json/1" do
    test "is the user object of the payload" do
      user = %{user() | household_size: 2, cooking_skill: "advanced"}

      assert CurrentMe.user_json(user) == %{
               id: user.id,
               email: "ana@example.com",
               displayName: "Ana",
               householdSize: 2,
               cookingSkill: "advanced"
             }

      assert CurrentMe.user_json(user) ==
               CurrentMe.build(user, account(%{}), membership(), @now).user
    end
  end

  describe "load/3" do
    setup do
      :ok = Sandbox.checkout(Repo)
      :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()

      user =
        user_with_memberships(%{email: "current_me_load@example.com", name: "Loaded"}, [
          {%{plan: :family_6, name: "Current Me Load"}, :owner}
        ])

      [membership] = user.memberships
      %{user: user, membership: membership}
    end

    test "loads the membership's account and builds the map", %{
      user: user,
      membership: membership
    } do
      Account
      |> Repo.get!(membership.account_id)
      |> Account.changeset(%{trial_started_at: @trial_started_at, trial_ends_at: @trial_ends_at})
      |> Repo.update!()

      assert CurrentMe.load(user, membership, @now) ==
               {:ok,
                %{
                  user: %{
                    id: user.id,
                    email: "current_me_load@example.com",
                    displayName: "Loaded",
                    householdSize: nil,
                    cookingSkill: nil
                  },
                  account: %{
                    id: membership.account_id,
                    type: "family_plus",
                    trialEndsAt: "2026-06-14T00:00:00.000000Z",
                    subscriptionStatus: "none",
                    access: %{canUseApp: true, reason: nil}
                  },
                  membership: %{role: "owner"},
                  onboarding: %{isComplete: false}
                }}
    end

    test "serializes the profile the User saved", %{user: user, membership: membership} do
      user =
        user
        |> User.profile_changeset(%{name: "Ana", household_size: 3, cooking_skill: "beginner"})
        |> Repo.update!()

      assert {:ok, %{user: profile}} = CurrentMe.load(Repo.get!(User, user.id), membership, @now)

      assert profile == %{
               id: user.id,
               email: "current_me_load@example.com",
               displayName: "Ana",
               householdSize: 3,
               cookingSkill: "beginner"
             }
    end

    test "reads persisted entitlements for the access decision", %{
      user: user,
      membership: membership
    } do
      %RevenuecatEntitlement{}
      |> RevenuecatEntitlement.changeset(%{
        account_id: membership.account_id,
        rc_app_user_id: "rc_app_current_me",
        entitlement_id: "pro",
        is_active: true,
        raw_payload: %{}
      })
      |> Repo.insert!()

      assert {:ok, %{account: account}} = CurrentMe.load(user, membership, @now)
      assert account.subscriptionStatus == "active"
      assert account.access == %{canUseApp: true, reason: nil}
    end

    test "returns account_not_found when the membership's account is gone", %{user: user} do
      membership = %AccountMembership{account_id: Ecto.UUID.generate(), role: :owner}

      assert CurrentMe.load(user, membership, @now) == {:error, :account_not_found}
    end
  end

  defp user do
    %User{id: Ecto.UUID.generate(), email: "ana@example.com", name: "Ana"}
  end

  defp account(attrs) do
    struct!(
      %Account{id: Ecto.UUID.generate(), plan: :individual, revenuecat_entitlements: []},
      attrs
    )
  end

  defp membership(role \\ :owner), do: %AccountMembership{role: role}
end
