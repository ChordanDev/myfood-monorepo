defmodule MealPlannerApiWeb.AccountTimezoneController do
  @moduledoc """
  `PUT /api/account/timezone` (issue #62): the app keeps the Account's IANA
  timezone in sync with the device, so the Account's "today" follows the User
  when they travel.

  The body carries `timezone`, required. The Account is the one of
  `conn.assigns.current_membership`; any member may update it and the last
  write wins. A success answers `{ account: { id, timezone } }`.

  A timezone that is missing, blank, not a string or unknown to the time zone
  database answers `validation_error` naming `timezone`, and the stored value
  is left as it was. The zone check itself belongs to `Account.changeset/2`.
  """
  use MealPlannerApiWeb, :controller

  alias MealPlannerApi.Persistence.Accounts
  alias MealPlannerApiWeb.ApiError

  def update(conn, params) do
    account_id = conn.assigns.current_membership.account_id

    with {:ok, timezone} <- fetch_timezone(params),
         {:ok, account} <- Accounts.update_account_timezone(account_id, timezone) do
      json(conn, %{account: %{id: account.id, timezone: account.timezone}})
    else
      {:error, :account_not_found} -> conn |> ApiError.error(:account_not_found)
      {:error, _invalid} -> conn |> ApiError.validation_error("timezone")
    end
  end

  # A blank zone would clear the stored one and a value of the wrong JSON type
  # is no zone at all, so both are refused before the changeset sees them.
  defp fetch_timezone(%{"timezone" => timezone}) when is_binary(timezone) do
    case String.trim(timezone) do
      "" -> {:error, :blank}
      trimmed -> {:ok, trimmed}
    end
  end

  defp fetch_timezone(_params), do: {:error, :missing}
end
