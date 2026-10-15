defmodule MealPlannerApi.Persistence.Accounts.UserTest do
  @moduledoc """
  Schema-level tests for `User` after the Phase A nullable-account_id
  change (PR 1 task 1.7).

  Coverage:

    * `User.changeset(%{}, %{email: "x@y", account_id: nil})` is valid
      (RED before the migration relaxed the FK — design §2.3 decision
      5.1)
    * the new `has_many :memberships` association preloads without error
    * the changeset still validates `email` and `name` as required
    * `profile_changeset/2` validates the Onboarding profile fields and
      casts nothing else
  """
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Persistence.Accounts.AccountMembership
  alias MealPlannerApi.Persistence.Accounts.User
  alias MealPlannerApi.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()
  end

  describe "changeset/2 with nullable account_id" do
    test "valid when account_id is nil (dual-write fallback for access_v2)" do
      attrs = %{
        email: "noacct_#{Ecto.UUID.generate()}@example.com",
        name: "No-Account User",
        role: :member,
        account_id: nil
      }

      changeset = User.changeset(%User{}, attrs)
      assert changeset.valid?, "expected valid, got: #{inspect(changeset.errors)}"
    end

    test "valid when account_id is set" do
      attrs = %{
        email: "withacct_#{Ecto.UUID.generate()}@example.com",
        name: "With-Account User",
        role: :owner,
        account_id: Ecto.UUID.generate()
      }

      changeset = User.changeset(%User{}, attrs)
      assert changeset.valid?
    end

    test "invalid when email is missing" do
      attrs = %{
        name: "Missing-Email User",
        role: :owner,
        account_id: Ecto.UUID.generate()
      }

      changeset = User.changeset(%User{}, attrs)
      refute changeset.valid?
      assert %{email: ["can't be blank"]} = errors_on(changeset)
    end

    test "invalid when role is missing" do
      attrs = %{
        email: "norole_#{Ecto.UUID.generate()}@example.com",
        name: "No-Role User",
        account_id: Ecto.UUID.generate()
      }

      changeset = User.changeset(%User{}, attrs)
      refute changeset.valid?
      assert %{role: ["can't be blank"]} = errors_on(changeset)
    end
  end

  describe "has_many :memberships" do
    test "preloads :memberships without error after insertion" do
      account = insert_account_with_plan!("User-Test Memberships", "family_4")

      {:ok, user} =
        %User{}
        |> User.changeset(%{
          email: "ms_#{Ecto.UUID.generate()}@example.com",
          name: "Membership Owner",
          role: :owner,
          account_id: account.id
        })
        |> Repo.insert()

      {:ok, _membership} =
        %AccountMembership{}
        |> AccountMembership.changeset(%{
          account_id: account.id,
          user_id: user.id,
          role: :owner,
          status: :active,
          joined_at: DateTime.utc_now()
        })
        |> Repo.insert()

      user = Repo.preload(user, :memberships)
      assert is_list(user.memberships)
      assert Enum.any?(user.memberships, &(&1.status == :active and &1.role == :owner))
    end
  end

  describe "cooking_skills/0" do
    test "lists the Cooking skill catalog" do
      assert User.cooking_skills() == ["beginner", "intermediate", "advanced"]
    end
  end

  describe "profile_changeset/2" do
    test "valid with a name, a Household size and a Cooking skill" do
      changeset = profile_changeset(%{})

      assert changeset.valid?, "expected valid, got: #{inspect(changeset.errors)}"

      assert changeset.changes == %{
               name: "Ana",
               household_size: 4,
               cooking_skill: "intermediate"
             }
    end

    test "trims surrounding whitespace from the name" do
      changeset = profile_changeset(%{name: "  Ana María \n"})

      assert changeset.valid?
      assert Ecto.Changeset.get_change(changeset, :name) == "Ana María"
    end

    test "invalid when the name is blank or whitespace-only" do
      for name <- ["", "   ", "\n\t "] do
        changeset = profile_changeset(%{name: name})

        refute changeset.valid?, "expected #{inspect(name)} to be invalid"
        assert %{name: ["can't be blank"]} = errors_on(changeset)
      end
    end

    test "invalid when a blank name replaces a stored one" do
      changeset = User.profile_changeset(%User{name: "Stored"}, profile_attrs(%{name: "   "}))

      refute changeset.valid?
      assert %{name: ["can't be blank"]} = errors_on(changeset)
    end

    test "accepts a name of 64 characters, counted after trimming and not in bytes" do
      name = String.duplicate("ñ", 64)

      assert profile_changeset(%{name: name}).valid?
      assert profile_changeset(%{name: "  " <> name <> "  "}).valid?
    end

    test "invalid when the name is 65 characters" do
      changeset = profile_changeset(%{name: String.duplicate("a", 65)})

      refute changeset.valid?
      assert %{name: ["should be at most 64 character(s)"]} = errors_on(changeset)
    end

    test "counts the 64 characters in graphemes, not in codepoints" do
      # "n" and a combining tilde: one grapheme of two codepoints.
      name = String.duplicate("ñ", 64)

      assert String.length(name) == 64
      assert length(String.codepoints(name)) == 128
      assert profile_changeset(%{name: name}).valid?
    end

    test "accepts a name of 64 characters that fills the 255 codepoints of the column" do
      name = String.duplicate("á̂̃", 63) <> "á̂"

      assert String.length(name) == 64
      assert length(String.codepoints(name)) == 255
      assert profile_changeset(%{name: name}).valid?
    end

    test "invalid when a name of 64 characters takes 256 codepoints" do
      name = String.duplicate("á̂̃", 64)

      assert String.length(name) == 64
      assert length(String.codepoints(name)) == 256

      changeset = profile_changeset(%{name: name})

      refute changeset.valid?
      assert %{name: ["should be at most 255 character(s)"]} = errors_on(changeset)
    end

    test "invalid when a name of 64 joined emoji is longer than the column" do
      # A family emoji: one grapheme of seven codepoints.
      name = String.duplicate("\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}", 64)

      assert String.length(name) == 64

      changeset = profile_changeset(%{name: name})

      refute changeset.valid?
      assert %{name: ["should be at most 255 character(s)"]} = errors_on(changeset)
    end

    test "invalid when the name contains a NUL character" do
      for name <- ["Ana\0María", "\0Ana", "Ana\0", "\0"] do
        changeset = profile_changeset(%{name: name})

        refute changeset.valid?, "expected #{inspect(name)} to be invalid"
        assert %{name: ["must not contain a NUL character"]} = errors_on(changeset)
      end
    end

    test "accepts a Household size of 1 and of 20" do
      assert profile_changeset(%{household_size: 1}).valid?
      assert profile_changeset(%{household_size: 20}).valid?
    end

    test "invalid when the Household size is 0" do
      changeset = profile_changeset(%{household_size: 0})

      refute changeset.valid?
      assert %{household_size: ["must be greater than or equal to 1"]} = errors_on(changeset)
    end

    test "invalid when the Household size is 21" do
      changeset = profile_changeset(%{household_size: 21})

      refute changeset.valid?
      assert %{household_size: ["must be less than or equal to 20"]} = errors_on(changeset)
    end

    test "accepts every Cooking skill of the catalog" do
      for cooking_skill <- User.cooking_skills() do
        assert profile_changeset(%{cooking_skill: cooking_skill}).valid?
      end
    end

    test "invalid when the Cooking skill is outside the catalog" do
      changeset = profile_changeset(%{cooking_skill: "expert"})

      refute changeset.valid?
      assert %{cooking_skill: ["is invalid"]} = errors_on(changeset)
    end

    test "invalid when any of the three fields is missing" do
      for field <- [:name, :household_size, :cooking_skill] do
        changeset = User.profile_changeset(%User{}, Map.delete(profile_attrs(), field))

        refute changeset.valid?, "expected a missing #{field} to be invalid"
        assert errors_on(changeset) == %{field => ["can't be blank"]}
      end
    end

    test "leaves onboarding_completed_at and every other field untouched" do
      completed_at = ~U[2026-06-09 08:00:00.000000Z]
      user = %User{email: "ana@example.com", role: :member, onboarding_completed_at: completed_at}

      attrs =
        profile_attrs(%{
          onboarding_completed_at: ~U[2027-01-01 00:00:00.000000Z],
          email: "other@example.com",
          role: :owner
        })

      changeset = User.profile_changeset(user, attrs)

      assert changeset.valid?

      assert changeset.changes |> Map.keys() |> Enum.sort() ==
               [:cooking_skill, :household_size, :name]

      assert Ecto.Changeset.apply_changes(changeset).onboarding_completed_at == completed_at
    end
  end

  # ---- helpers ---------------------------------------------------------------

  defp profile_changeset(overrides), do: User.profile_changeset(%User{}, profile_attrs(overrides))

  defp profile_attrs(overrides \\ %{}) do
    Map.merge(%{name: "Ana", household_size: 4, cooking_skill: "intermediate"}, overrides)
  end

  defp insert_account_with_plan!(name, plan_name) do
    plan = Repo.get_by!(MealPlannerApi.Subscriptions.Plan, name: plan_name)

    {:ok, account} =
      %Account{}
      |> Account.changeset(%{
        name: name,
        plan: String.to_atom(plan_name),
        default_budget_cents: 0,
        subscription_plan_id: plan.id
      })
      |> Repo.insert()

    account
  end

  defp errors_on(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end

  describe "changeset/2 email constraints" do
    test "maps the lower(email) index to an :email error, like the exact-email index" do
      changeset = User.changeset(%User{}, %{email: "a@example.com", name: "A", role: :member})

      names =
        for %{field: :email, type: :unique, constraint: name} <- changeset.constraints, do: name

      assert "users_email_index" in names
      assert "users_lower_email_index" in names
    end
  end
end
