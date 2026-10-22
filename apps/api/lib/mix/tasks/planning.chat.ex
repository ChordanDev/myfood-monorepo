defmodule Mix.Tasks.Planning.Chat do
  @moduledoc """
  Chats with the planning agent in the terminal (issue #423): a real
  Planning session of a real Account, from AI-processing consent to a
  confirmed plan saved as Scheduled meals.

      mix planning.chat --account ACCOUNT_ID --user EMAIL [--from YYYY-MM-DD] [--days N] [--scripted]

    * `--account` — the Account to plan for
    * `--user` — the email of the Member who plans; they must have an active
      Membership in the Account
    * `--from` — the first day, today in the Account's timezone by default
    * `--days` — how many days, 7 by default (1 to 31)
    * `--scripted` — an offline scripted model and the deterministic
      optimizer double: no API key, no spend, no Python

  Without `--scripted` the session uses the configured model (Claude Haiku
  5.5 through `ANTHROPIC_API_KEY`, with the configured spend caps: it costs
  money) and the configured optimizer (`OPTIMIZER_PYTHON` with OR-Tools).
  The Account must be eligible (#397). Confirming writes real Scheduled
  meals; `/quit` cancels the session without saving.
  """

  use Mix.Task

  import Ecto.Query

  alias MealPlannerApi.AccountClock
  alias MealPlannerApi.Optimization.OptimizerMock
  alias MealPlannerApi.Persistence.Accounts.{AccountMembership, User}
  alias MealPlannerApi.PlanningAgent.Chat
  alias MealPlannerApi.PlanningAgent.Model.Scripted
  alias MealPlannerApi.Repo

  @shortdoc "Chats with the planning agent in the terminal (paid unless --scripted)"

  @usage "Usage: mix planning.chat --account ACCOUNT_ID --user EMAIL " <>
           "[--from YYYY-MM-DD] [--days N] [--scripted]"

  @switches [account: :string, user: :string, from: :string, days: :integer, scripted: :boolean]

  @impl Mix.Task
  def run(args) do
    Mix.Task.run("app.start")

    case run(args, []) do
      {:error, reason} -> Mix.raise("planning.chat: #{inspect(reason)}")
      _outcome -> :ok
    end
  end

  @doc """
  Runs the chat with `args` and returns its outcome. `chat_opts` go to
  `MealPlannerApi.PlanningAgent.Chat.run/3` (tests pass their own input,
  output and session options).
  """
  @spec run([String.t()], keyword()) :: term()
  def run(args, chat_opts) do
    with {:ok, opts} <- parse(args),
         {:ok, who} <- member(opts[:account], opts[:user]),
         {:ok, range} <- range(who.account_id, opts) do
      session = if opts[:scripted], do: scripted(), else: []
      chat_opts = Keyword.update(chat_opts, :session, session, &Keyword.merge(session, &1))
      Chat.run(who, range, chat_opts)
    end
  end

  defp parse(args) do
    case OptionParser.parse(args, strict: @switches) do
      {opts, [], []} ->
        if opts[:account] && opts[:user], do: {:ok, opts}, else: {:error, @usage}

      _invalid ->
        {:error, @usage}
    end
  end

  defp member(account_id, email) do
    with {:ok, account_id} <- Ecto.UUID.cast(account_id),
         %{} = who <-
           Repo.one(
             from(m in AccountMembership,
               join: u in User,
               on: u.id == m.user_id,
               where: m.account_id == ^account_id and u.email == ^email and m.status == :active,
               select: %{
                 account_id: m.account_id,
                 user_id: u.id,
                 membership_id: m.id,
                 owner?: m.role == :owner
               }
             )
           ) do
      {:ok, who}
    else
      _ -> {:error, :no_active_membership}
    end
  end

  defp range(account_id, opts) do
    with {:ok, from_date} <- from_date(account_id, opts[:from]) do
      {:ok, {from_date, Date.add(from_date, (opts[:days] || 7) - 1)}}
    end
  end

  defp from_date(account_id, nil), do: {:ok, AccountClock.today(account_id)}

  defp from_date(_account_id, iso) do
    case Date.from_iso8601(iso) do
      {:ok, date} -> {:ok, date}
      {:error, _} -> {:error, :invalid_from_date}
    end
  end

  # One plan, then fixed answers: enough to walk the path to a confirmation.
  defp scripted do
    replies =
      List.duplicate(
        {:text, "(scripted) I only plan once. Type /confirm to save the plan, or /quit."},
        20
      )

    [
      model:
        {Scripted,
         script:
           [
             {:tool_calls, [{"run_optimizer", %{}}]},
             {:tool_calls, [{"present_proposal", %{}}]},
             {:text, "(scripted) Here is a plan for your days. Type /confirm to save it."}
           ] ++ replies},
      optimizer: OptimizerMock
    ]
  end
end
