defmodule MealPlannerApi.PlanningAgent.Chat do
  @moduledoc """
  The terminal chat of the planning agent (issue #423, ported from
  myfood@d9b965a), behind `mix planning.chat`: a real Planning session
  (`MealPlannerApi.PlanningAgent.Session`) of a real Account and Member,
  from consent to confirmed Scheduled meals.

  Everything it prints is read from the session's events and the
  code-built Proposal (status, estimated cost, budget check), never from
  the model's own words.

  Commands: `/confirm` confirms the Proposal on display, `/stop` halts the
  agent, `/quit` cancels the session and leaves, `/help` lists them. Any
  other line is a message to the agent.
  """

  alias MealPlannerApi.PlanningAgent.{Consent, Session}

  @turn_end ~w(turn_completed limit_reached agent_unavailable stopped)
  @session_end ~w(session_ended session_cancelled)
  @turn_timeout_ms 10 * 60 * 1000

  @help """
  Commands: /confirm (save the proposal on display), /stop (halt the agent),
  /quit (cancel the session and leave), /help. Anything else is a message.
  """

  @doc """
  Runs a chat for `who` (`%{account_id, user_id, membership_id, owner?}`)
  over `range`. Returns `{:confirmed, summary}`, `:quit`, `:ended` or
  `{:error, reason}` when the session does not start.

  Options: `:input` (a 1-arity prompt function returning a line or `:eof`,
  default `IO.gets/1`), `:output` (a 1-arity line printer, default
  `IO.puts/1`) and `:session` (options for `Session.start/2`).
  """
  @spec run(map(), {Date.t(), Date.t()}, keyword()) ::
          {:confirmed, map()} | :quit | :ended | {:error, term()}
  def run(who, range, opts \\ []) do
    io = %{
      input: Keyword.get(opts, :input, &IO.gets/1),
      output: Keyword.get(opts, :output, &IO.puts/1)
    }

    attrs = Map.merge(Map.take(who, [:account_id, :user_id, :membership_id]), %{range: range})
    session_opts = Keyword.put(Keyword.get(opts, :session, []), :subscriber, self())

    case Session.start(attrs, session_opts) do
      {:ok, session} ->
        say(
          io,
          "Planning #{Date.to_iso8601(elem(range, 0))} to #{Date.to_iso8601(elem(range, 1))}."
        )

        say(io, @help)
        chat = %{who: who, io: io, pid: session.pid, id: session.session_id, proposal: nil}
        if session.consent_required, do: ask_consent(chat), else: loop(chat)

      {:error, reason} ->
        say(io, "[error] the session did not start: #{inspect(reason)}")
        {:error, reason}
    end
  end

  defp ask_consent(chat) do
    say(chat.io, Consent.text())

    case read(chat, "Do you agree? [y/N] ") do
      answer when answer in ["y", "Y", "yes"] ->
        :ok = Session.record_consent(chat.pid, chat.who.user_id)
        loop(chat)

      _no ->
        say(chat.io, "Without consent the agent cannot plan. Leaving.")
        quit(chat)
    end
  end

  defp loop(chat) do
    case read(chat, "you> ") do
      :eof -> quit(chat)
      "" -> loop(chat)
      "/quit" -> quit(chat)
      "/help" -> help(chat)
      "/stop" -> stop(chat)
      "/confirm" -> confirm(chat)
      text -> message(chat, text)
    end
  end

  defp help(chat) do
    say(chat.io, @help)
    loop(chat)
  end

  defp message(chat, text) do
    case Session.send_message(chat.pid, text) do
      :ok ->
        follow(chat)

      {:error, reason} ->
        say(chat.io, "[refused] #{reason}")
        loop(chat)
    end
  end

  defp stop(chat) do
    :ok = Session.stop(chat.pid, chat.who.membership_id)
    loop(chat)
  end

  defp confirm(%{proposal: nil} = chat) do
    say(chat.io, "[confirm] there is no proposal to confirm yet")
    loop(chat)
  end

  defp confirm(chat) do
    case Session.confirm(chat.who.account_id, chat.who.membership_id, chat.proposal) do
      {:ok, summary} ->
        drain(chat)
        say(chat.io, "[confirmed] #{summary.meals_count} meals saved as Scheduled meals.")
        {:confirmed, summary}

      {:error, reason} ->
        # A refused confirmation may show a new or withdrawn Proposal.
        chat = drain(chat)
        say(chat.io, "[confirm refused] #{refusal(reason)}")
        loop(chat)
    end
  end

  defp refusal({:slot_occupied, occupied}) do
    slots = Enum.map_join(occupied, ", ", fn {date, slot} -> "#{date} #{slot}" end)
    "meals were scheduled meanwhile on #{slots}; ask the agent for a new plan"
  end

  defp refusal(reason), do: to_string(reason)

  defp quit(chat) do
    if Process.alive?(chat.pid) do
      _ =
        Session.cancel(chat.pid, %{membership_id: chat.who.membership_id, owner?: chat.who.owner?})
    end

    :quit
  end

  # Prints the session's events until the turn ends.
  defp follow(chat) do
    receive do
      {:planning_agent_event, id, event} when id == chat.id ->
        chat = show(chat, event)

        cond do
          event["type"] in @session_end -> :ended
          event["type"] in @turn_end -> loop(chat)
          true -> follow(chat)
        end
    after
      @turn_timeout_ms ->
        say(chat.io, "[timeout] no answer from the agent")
        loop(chat)
    end
  end

  # Prints the events already received, without waiting.
  defp drain(chat) do
    receive do
      {:planning_agent_event, id, event} when id == chat.id -> chat |> show(event) |> drain()
    after
      0 -> chat
    end
  end

  defp show(chat, event) do
    Enum.each(render(event), &say(chat.io, &1))

    case event do
      %{"type" => "proposal", "proposal_id" => id} -> %{chat | proposal: id}
      %{"type" => "proposal_invalidated"} -> %{chat | proposal: nil}
      _event -> chat
    end
  end

  @doc "The lines printed for one session event; `[]` when it shows nothing."
  @spec render(map()) :: [String.t()]
  def render(%{"type" => "assistant_message", "text" => text}), do: ["agent> " <> text]
  def render(%{"type" => "question", "text" => text}), do: ["agent? " <> text]
  def render(%{"type" => "proposal"} = proposal), do: proposal(proposal)

  def render(%{"type" => "optimizer_failed", "reason" => reason}),
    do: ["[optimizer] failed: #{reason}"]

  def render(%{"type" => "limit_reached", "limit" => limit}),
    do: ["[limit] #{limit} reached: send a new message to go on"]

  def render(%{"type" => "agent_unavailable", "reason" => reason}),
    do: ["[unavailable] the agent stopped: #{reason}"]

  def render(%{"type" => "proposal_invalidated"}),
    do: ["[invalidated] the proposal is no longer valid; ask the agent for a new one"]

  def render(%{"type" => "stopped"}), do: ["[stopped] the agent halted; the session goes on"]
  def render(%{"type" => "session_ended"}), do: ["[session] ended"]
  def render(%{"type" => "session_cancelled"}), do: ["[session] cancelled"]
  def render(_event), do: []

  defp proposal(proposal) do
    days =
      proposal["meals"]
      |> Enum.group_by(& &1["date"])
      |> Enum.sort()
      |> Enum.map(fn {date, meals} ->
        "  #{date} " <>
          Enum.map_join(Enum.sort_by(meals, &slot_order(&1["slot"])), " | ", fn meal ->
            "#{meal["slot"]}: #{meal["name"]}"
          end)
      end)

    budget = proposal["budget"]

    ["--- proposal #{String.slice(proposal["proposal_id"], 0, 8)} (#{proposal["status"]}) ---"] ++
      days ++
      [
        "  estimated cost: #{money(budget["estimated_cost_cents"])} of a budget of " <>
          "#{money(budget["budget_cents"])}, #{budget_check(budget)}",
        "---"
      ]
  end

  defp budget_check(%{"within_budget" => true}), do: "within budget"
  defp budget_check(%{"within_budget" => false}), do: "over budget (needs approval)"
  defp budget_check(_budget), do: "budget fit unknown (costs missing)"

  defp money(cents) when is_integer(cents),
    do: "ARS " <> :erlang.float_to_binary(cents / 100, decimals: 2)

  defp slot_order(slot), do: Enum.find_index(Session.slots(), &(&1 == slot))

  defp read(chat, prompt) do
    case chat.io.input.(prompt) do
      line when is_binary(line) -> String.trim(line)
      _eof -> :eof
    end
  end

  defp say(io, line), do: io.output.(line)
end
