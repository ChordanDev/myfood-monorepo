defmodule MealPlannerApi.Auth.JwksCacheTest do
  @moduledoc """
  `MealPlannerApi.Auth.JwksCache` against a stand-in key set served through
  Req's `:plug` option. Each test runs its own server and its own URL, so
  nothing carries over between tests.
  """
  use ExUnit.Case, async: true

  alias MealPlannerApi.Auth.JwksCache

  @keys [%{"kid" => "key-1", "kty" => "RSA"}]

  setup do
    server = :"jwks_cache_#{System.unique_integer([:positive])}"
    start_supervised!({JwksCache, name: server})
    %{server: server, url: "http://keys.test/#{System.unique_integer([:positive])}/certs"}
  end

  test "concurrent misses share one fetch and all get its keys", %{server: server, url: url} do
    plug = counting_plug(fn conn -> slow_json(conn, %{"keys" => @keys}) end)

    results = concurrently(20, fn -> JwksCache.keys(url, "key-1", opts(server, plug)) end)

    assert results == List.duplicate({:ok, @keys}, 20)
    assert fetches() == 1
  end

  test "a failed fetch answers every waiter and caches nothing", %{server: server, url: url} do
    plug = counting_plug(fn conn -> slow_send(conn, 503) end)

    results = concurrently(10, fn -> JwksCache.keys(url, "key-1", opts(server, plug)) end)

    assert results == List.duplicate({:error, :provider_unavailable}, 10)
    assert fetches() == 1

    ok = counting_plug(fn conn -> Req.Test.json(conn, %{"keys" => @keys}) end)
    assert JwksCache.keys(url, "key-1", opts(server, ok)) == {:ok, @keys}
  end

  test "a 4xx or a body without keys is the provider's", %{server: server, url: url} do
    for plug <- [
          fn conn -> Plug.Conn.send_resp(conn, 404, "") end,
          fn conn -> Req.Test.json(conn, %{"keys" => "none"}) end,
          fn conn -> Plug.Conn.send_resp(conn, 200, "not json") end
        ] do
      assert JwksCache.keys(url, "key-1", opts(server, plug)) == {:error, :provider_unavailable}
    end
  end

  test "a fetch that raises answers :provider_unavailable and the server keeps serving", %{
    server: server,
    url: url
  } do
    pid = Process.whereis(server)
    raising = fn _conn -> raise "Finch was unable to provide a connection" end

    assert JwksCache.keys(url, "key-1", opts(server, raising)) == {:error, :provider_unavailable}
    assert Process.whereis(server) == pid

    ok = fn conn -> Req.Test.json(conn, %{"keys" => @keys}) end
    assert JwksCache.keys(url, "key-1", opts(server, ok)) == {:ok, @keys}
  end

  test "a cached key set is read without asking the server", %{server: server, url: url} do
    ok = counting_plug(fn conn -> Req.Test.json(conn, %{"keys" => @keys}) end)
    assert {:ok, @keys} = JwksCache.keys(url, "key-1", opts(server, ok))

    stop_supervised!(JwksCache)

    assert JwksCache.keys(url, "key-1", opts(server, ok)) == {:ok, @keys}
    assert fetches() == 1
  end

  # ---- helpers ---------------------------------------------------------------

  defp opts(server, plug, overrides \\ []) do
    Keyword.merge([jwks_cache: server, req_options: [plug: plug]], overrides)
  end

  defp concurrently(count, fun) do
    1..count
    |> Task.async_stream(fn _ -> fun.() end, max_concurrency: count)
    |> Enum.map(fn {:ok, result} -> result end)
  end

  # Slow enough that every concurrent caller arrives while the first fetch
  # is still running.
  defp slow_json(conn, body) do
    Process.sleep(100)
    Req.Test.json(conn, body)
  end

  defp slow_send(conn, status) do
    Process.sleep(100)
    Plug.Conn.send_resp(conn, status, "")
  end

  defp counting_plug(respond) do
    test = self()

    fn conn ->
      send(test, :jwks_fetched)
      respond.(conn)
    end
  end

  defp fetches(count \\ 0) do
    receive do
      :jwks_fetched -> fetches(count + 1)
    after
      0 -> count
    end
  end
end
