defmodule MealPlannerApi.AccountsTest do
  use ExUnit.Case, async: false

  import MealPlannerApi.IdentityFixtures

  alias Ecto.Adapters.SQL.Sandbox
  alias MealPlannerApi.Accounts
  alias MealPlannerApi.Accounts.Account
  alias MealPlannerApi.Auth.Guardian
  alias MealPlannerApi.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = MealPlannerApi.SubscriptionPlanFixtures.ensure_plans!()
  end

  test "individual account only allows one linked user" do
    %{user: user, account: account} = insert_identity!(plan: :individual)

    account = %Account{
      id: account.id,
      type: :individual,
      owner_id: user.id,
      linked_user_ids: []
    }

    # Phase A: link_user/2 was the legacy single-account seat cap. With the
    # AccountMembership join (PR 2) the seat cap is enforced by
    # AccountsMembership.seat_usage/1 + enforce_seat_cap/2 instead. The
    # legacy link_user helper still exists for the public-facing DTO and
    # is exercised here against the pre-Phase-A shape.
    assert {:ok, updated} = Accounts.link_user(account, Ecto.UUID.generate())
    assert {:error, :individual_limit_reached} = Accounts.link_user(updated, Ecto.UUID.generate())
  end

  test "claims include subscription tier" do
    %{user: user, account: account} = insert_identity!()

    user = Map.put(user, :subscription_tier, :premium)
    account = Map.put(account, :subscription_tier, :premium)

    claims = Accounts.claims_for(user, account)

    assert claims["subscription_tier"] == "premium"
  end

  # ----------------------------------------------------------------------
  # PR 2b post-review fix pass — item 1: claims_for/2 must not hardcode typ
  # ----------------------------------------------------------------------
  #
  # Guardian's `set_type/3` only applies the `token_type:` option passed to
  # `encode_and_sign/3` when the claims map does NOT already carry a
  # non-nil "typ" key. `Accounts.claims_for/2` used to hardcode
  # `"typ" => "access"`, which meant every `token_type: "refresh"` call
  # site silently minted a refresh token whose `typ` claim read
  # `"access"` — letting a refresh token pass `VerifyTokenType`'s
  # `access` / `access_v2` allowlist anywhere in the API.

  describe "claims_for/2 does not hardcode typ (Guardian's token_type: option controls it)" do
    test "token_type: refresh yields a token whose typ claim is refresh, not access" do
      %{user: user, account: account} = insert_identity!()

      claims = Accounts.claims_for(user, account)
      refute Map.has_key?(claims, "typ"), "claims_for/2 must not set typ — Guardian sets it"

      {:ok, token, _claims} = Guardian.encode_and_sign(user, claims, token_type: "refresh")
      {:ok, decoded} = Guardian.decode_and_verify(token, %{}, token_type: "refresh")

      assert decoded["typ"] == "refresh"
    end

    test "token_type: access still yields typ access" do
      %{user: user, account: account} = insert_identity!()

      claims = Accounts.claims_for(user, account)

      {:ok, token, _claims} = Guardian.encode_and_sign(user, claims, token_type: "access")
      {:ok, decoded} = Guardian.decode_and_verify(token)

      assert decoded["typ"] == "access"
    end
  end
end
