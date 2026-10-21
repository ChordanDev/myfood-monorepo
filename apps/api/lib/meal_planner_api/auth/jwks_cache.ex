defmodule MealPlannerApi.Auth.JwksCache do
  @moduledoc """
  The published key sets (JWKS) social sign-in verifies ID tokens against,
  cached per URL and shared by every provider (issue #404).

  A key set is used for an hour after it was fetched. A token naming a key
  the cached set lacks fetches it again, but at most once a minute, so
  forged tokens cannot make every request call the provider.

  Reads come straight from `:persistent_term`. Only a missing or stale
  entry reaches this server, which runs one fetch per URL at a time: every
  request that finds the entry stale while that fetch runs waits for its
  answer, and a request that arrives after a newer copy landed gets that
  copy without a fetch. A fetch runs in its own process with the HTTP
  options of the request that started it, so a crash there answers
  `:provider_unavailable` and never takes the server down.

  A key set never depends on the token, so any failure to read one, a 4xx
  included, is `:provider_unavailable`.
  """

  use GenServer

  require Logger

  @default_ttl_seconds 3_600
  @default_min_refresh_seconds 60

  # A fetch waits at most 5s for a pooled connection, 5s to connect and
  # `@default_request_timeout` for the whole response, and follows no
  # redirect. The call outlasts that, so a waiter always hears the fetch's
  # own answer.
  @default_request_timeout 15_000
  @call_timeout 30_000

  @type key :: map()

  @doc """
  Starts the server. `:request_timeout` (default
  #{@default_request_timeout} ms) bounds how long one fetch waits for the
  whole response; it must stay well under the 30s callers wait.
  """
  def start_link(opts \\ []) do
    request_timeout = Keyword.get(opts, :request_timeout, @default_request_timeout)
    name = Keyword.get(opts, :name, __MODULE__)
    GenServer.start_link(__MODULE__, request_timeout, name: name)
  end

  @doc """
  The keys published at `url`, for a token naming `kid`.

  Options:

    * `:jwks_ttl_seconds` (default #{@default_ttl_seconds}) — how long a
      fetched key set is used.
    * `:jwks_min_refresh_seconds` (default #{@default_min_refresh_seconds})
      — how soon a token naming a key the set lacks may fetch it again.
    * `:req_options` — extra options for `Req`, such as a `:plug` in tests.
    * `:jwks_cache` — the server to ask (default `#{inspect(__MODULE__)}`).
  """
  @spec keys(String.t(), String.t(), keyword()) ::
          {:ok, [key()]} | {:error, :provider_unavailable}
  def keys(url, kid, opts \\ []) do
    case :persistent_term.get({__MODULE__, url}, nil) do
      %{keys: keys, version: version} = entry ->
        if usable?(entry, kid, opts), do: {:ok, keys}, else: refresh(url, version, opts)

      nil ->
        refresh(url, nil, opts)
    end
  end

  # The cached set while it is younger than the TTL, unless the token names
  # a key it lacks and the last fetch is older than the refresh interval:
  # the provider may have rotated a key in.
  defp usable?(%{keys: keys, fetched_at: fetched_at}, kid, opts) do
    age = System.monotonic_time(:second) - fetched_at
    fresh? = age < option(opts, :jwks_ttl_seconds, @default_ttl_seconds)

    known? =
      Enum.any?(keys, &match?(%{"kid" => ^kid}, &1)) or
        age < option(opts, :jwks_min_refresh_seconds, @default_min_refresh_seconds)

    fresh? and known?
  end

  # `seen` is the version of the entry the caller found stale, so the
  # server can tell whether a newer copy landed since.
  defp refresh(url, seen, opts) do
    server = Keyword.get(opts, :jwks_cache, __MODULE__)
    request = {:refresh, url, seen, Keyword.get(opts, :req_options, [])}

    GenServer.call(server, request, @call_timeout)
  catch
    :exit, _reason -> {:error, :provider_unavailable}
  end

  # ---- server ------------------------------------------------------------------

  @impl true
  def init(request_timeout) do
    {:ok, %{fetches: %{}, urls: %{}, request_timeout: request_timeout}}
  end

  @impl true
  def handle_call({:refresh, url, seen, req_options}, from, state) do
    cached = :persistent_term.get({__MODULE__, url}, nil)

    cond do
      Map.has_key?(state.urls, url) ->
        tag = state.urls[url]
        {:noreply, update_in(state.fetches[tag].waiters, &[from | &1])}

      cached != nil and cached.version != seen ->
        {:reply, {:ok, cached.keys}, state}

      true ->
        server = self()
        tag = make_ref()
        request_timeout = state.request_timeout

        {_pid, monitor} =
          spawn_monitor(fn ->
            send(server, {:jwks_fetched, tag, fetch(url, request_timeout, req_options)})
          end)

        fetch = %{url: url, waiters: [from], monitor: monitor}

        {:noreply,
         %{
           state
           | fetches: Map.put(state.fetches, tag, fetch),
             urls: Map.put(state.urls, url, tag)
         }}
    end
  end

  # The fetch process sends its answer before it exits, so the monitor is
  # only heard from when it died without one.
  @impl true
  def handle_info({:jwks_fetched, tag, result}, state) do
    Process.demonitor(state.fetches[tag].monitor, [:flush])
    {:noreply, finish(state, tag, result)}
  end

  def handle_info({:DOWN, monitor, :process, _pid, _reason}, state) do
    {tag, _fetch} = Enum.find(state.fetches, fn {_tag, fetch} -> fetch.monitor == monitor end)
    {:noreply, finish(state, tag, {:error, :provider_unavailable})}
  end

  defp finish(state, tag, result) do
    {%{url: url, waiters: waiters}, fetches} = Map.pop(state.fetches, tag)

    with {:ok, keys} <- result do
      :persistent_term.put({__MODULE__, url}, %{
        keys: keys,
        fetched_at: System.monotonic_time(:second),
        version: System.unique_integer([:monotonic])
      })
    end

    Enum.each(waiters, &GenServer.reply(&1, result))
    %{state | fetches: fetches, urls: Map.delete(state.urls, url)}
  end

  # `pool_timeout` stays top-level: Req deprecates it in favour of
  # `finch: [pool_timeout: ...]`, but refuses `:finch` next to
  # `:connect_options`.
  defp fetch(url, request_timeout, req_options) do
    options =
      Keyword.merge(
        [
          receive_timeout: 10_000,
          request_timeout: request_timeout,
          redirect: false,
          pool_timeout: 5_000,
          connect_options: [timeout: 5_000],
          retry: false
        ],
        req_options
      )

    case Req.get(url, options) do
      {:ok, %Req.Response{status: status, body: %{"keys" => keys}}}
      when status in 200..299 and is_list(keys) ->
        {:ok, keys}

      {:ok, %Req.Response{status: status}} ->
        fetch_failed(url, "status #{status} or a body without keys")

      {:error, exception} ->
        fetch_failed(url, Exception.message(exception))
    end
  rescue
    # Finch raises when its connection pool is exhausted; that is the
    # provider being unreachable too.
    exception -> fetch_failed(url, Exception.message(exception))
  end

  defp fetch_failed(url, reason) do
    Logger.warning("JWKS fetch from #{url} failed: #{reason}")
    {:error, :provider_unavailable}
  end

  defp option(opts, key, default) do
    Keyword.get_lazy(opts, key, fn -> Application.get_env(:meal_planner_api, key, default) end)
  end
end
