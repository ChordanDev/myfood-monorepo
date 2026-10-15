defmodule MealPlannerApi.AccountClock do
  @moduledoc """
  "Today" for an Account (issue #39, decision X2).

  An Account's day is the calendar day in its stored IANA timezone
  (`accounts.timezone`), and the UTC day while none is stored. It is
  computed on the server: the client never sends its local date.

  The instant is a parameter that defaults to `DateTime.utc_now/0`, the
  same way `MealPlannerApi.AccountAccess.eligible?/2` takes `now`, so a
  test passes the instant it needs instead of depending on the wall
  clock.

  ## Purity

  `today/2` is pure over an already-loaded Account struct. Given an
  Account id it reads the stored timezone, for callers that only hold
  the id.
  """

  import Ecto.Query, only: [from: 2]

  alias MealPlannerApi.Persistence.Accounts.Account
  alias MealPlannerApi.Repo

  @doc """
  Returns the current date for an Account: the date of `now` in the
  Account's stored timezone.

  This is the single place that answers "what day is it for this
  Account". Anything that compares a date against today on behalf of an
  Account calls it, never `Date.utc_today/0`.

  The first argument is an Account struct or an Account id. `now` is the
  instant to evaluate and defaults to the current time.

  The result is the UTC date of `now` when the Account has no stored
  timezone (`nil` or blank), when the stored zone is unknown to the
  configured time zone database, and when there is no such Account. It
  never raises because of the stored value.

  ## Examples

      AccountClock.today(%Account{timezone: "Pacific/Auckland"}, ~U[2026-10-08 23:30:00Z])
      # => ~D[2026-10-09]

      AccountClock.today(%Account{timezone: nil}, ~U[2026-10-08 23:30:00Z])
      # => ~D[2026-10-08]
  """
  @spec today(Account.t() | Ecto.UUID.t() | nil, DateTime.t()) :: Date.t()
  def today(account_or_id, now \\ DateTime.utc_now())

  def today(%Account{timezone: timezone}, %DateTime{} = now), do: date_in(timezone, now)

  def today(account_id, %DateTime{} = now) when is_binary(account_id) do
    account_id |> stored_timezone() |> date_in(now)
  end

  def today(nil, %DateTime{} = now), do: date_in(nil, now)

  @doc """
  The Account's today at `now` as UTC instants: its first instant and the
  first instant of the next day, so a stored timestamp `t` is on that day when
  `start <= t < next`.

  The zone is the one `today/2` uses. A midnight that falls in a daylight
  saving gap starts at the first instant after it, and an ambiguous one at
  its earlier instant.
  """
  @spec day_bounds(Ecto.UUID.t(), DateTime.t()) :: {DateTime.t(), DateTime.t()}
  def day_bounds(account_id, %DateTime{} = now \\ DateTime.utc_now())
      when is_binary(account_id) do
    zone = account_id |> stored_timezone() |> usable_zone(now)
    today = date_in(zone, now)

    {midnight(today, zone), midnight(Date.add(today, 1), zone)}
  end

  defp usable_zone(timezone, now) when is_binary(timezone) do
    case DateTime.shift_zone(now, timezone) do
      {:ok, _local} -> timezone
      {:error, _reason} -> "Etc/UTC"
    end
  end

  defp usable_zone(_timezone, _now), do: "Etc/UTC"

  defp midnight(date, zone) do
    case DateTime.new(date, ~T[00:00:00], zone) do
      {:ok, instant} -> DateTime.shift_zone!(instant, "Etc/UTC")
      {:ambiguous, earlier, _later} -> DateTime.shift_zone!(earlier, "Etc/UTC")
      {:gap, _before, just_after} -> DateTime.shift_zone!(just_after, "Etc/UTC")
    end
  end

  defp stored_timezone(account_id) do
    case Ecto.UUID.cast(account_id) do
      {:ok, uuid} -> Repo.one(from(a in Account, where: a.id == ^uuid, select: a.timezone))
      :error -> nil
    end
  end

  defp date_in(timezone, now) when is_binary(timezone) do
    case DateTime.shift_zone(now, timezone) do
      {:ok, local} -> DateTime.to_date(local)
      {:error, _reason} -> utc_date(now)
    end
  end

  defp date_in(_timezone, now), do: utc_date(now)

  defp utc_date(now), do: now |> DateTime.shift_zone!("Etc/UTC") |> DateTime.to_date()
end
