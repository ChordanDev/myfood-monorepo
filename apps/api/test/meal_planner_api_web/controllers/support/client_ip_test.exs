defmodule MealPlannerApiWeb.ClientIpTest do
  @moduledoc """
  `MealPlannerApiWeb.ClientIp.resolve/1`: which address a request is
  rate limited under. The header it may read is configuration
  (`:client_ip_header`), so each test sets the one it needs.
  """
  use ExUnit.Case, async: false

  import Plug.Conn, only: [put_req_header: 3]
  import Plug.Test, only: [conn: 2]

  alias MealPlannerApiWeb.ClientIp

  @header "x-test-proxy-client-ip"

  setup do
    previous = Application.get_env(:meal_planner_api, :client_ip_header)
    Application.put_env(:meal_planner_api, :client_ip_header, @header)

    on_exit(fn ->
      if previous do
        Application.put_env(:meal_planner_api, :client_ip_header, previous)
      else
        Application.delete_env(:meal_planner_api, :client_ip_header)
      end
    end)

    :ok
  end

  describe "without a configured header value" do
    test "renders an IPv4 socket address" do
      assert ClientIp.resolve(request({198, 51, 100, 7})) == "198.51.100.7"
    end

    test "renders an IPv6 socket address" do
      assert ClientIp.resolve(request({0x2001, 0xDB8, 0, 0, 0, 0, 0, 1})) == "2001:db8::1"
    end

    test "never reads x-forwarded-for" do
      conn = {198, 51, 100, 7} |> request() |> put_req_header("x-forwarded-for", "203.0.113.5")

      assert ClientIp.resolve(conn) == "198.51.100.7"
    end

    test "ignores the header when none is configured" do
      Application.delete_env(:meal_planner_api, :client_ip_header)
      conn = {198, 51, 100, 7} |> request() |> put_req_header(@header, "203.0.113.5")

      assert ClientIp.resolve(conn) == "198.51.100.7"
    end

    test "answers nil for a socket address that is not an IP" do
      assert ClientIp.resolve(request(nil)) == nil
      assert ClientIp.resolve(request({:local, "/tmp/api.sock"})) == nil
      assert ClientIp.resolve(request({1, 2, 3})) == nil
      assert ClientIp.resolve(request({1, 2, 3, 256})) == nil
    end
  end

  describe "with the configured header" do
    test "prefers the header over the socket address" do
      conn = {198, 51, 100, 7} |> request() |> put_req_header(@header, " 203.0.113.5 ")

      assert ClientIp.resolve(conn) == "203.0.113.5"
    end

    test "accepts an IPv6 value and renders it in one canonical form" do
      conn = request({198, 51, 100, 7})

      for value <- ["2001:db8::1", "2001:0DB8:0:0:0:0:0:1"] do
        assert conn |> put_req_header(@header, value) |> ClientIp.resolve() == "2001:db8::1"
      end
    end

    test "falls back to the socket address when the value is not an IP address" do
      conn = request({198, 51, 100, 7})

      for value <- ["", "not-an-ip", "203.0.113", "203.0.113.5, 198.51.100.9", "999.1.1.1"] do
        assert conn |> put_req_header(@header, value) |> ClientIp.resolve() == "198.51.100.7"
      end
    end

    test "falls back to the socket address when the value is oversized" do
      conn =
        {198, 51, 100, 7} |> request() |> put_req_header(@header, String.duplicate("1", 4_096))

      assert ClientIp.resolve(conn) == "198.51.100.7"
    end
  end

  defp request(remote_ip), do: %{conn(:post, "/") | remote_ip: remote_ip}
end
