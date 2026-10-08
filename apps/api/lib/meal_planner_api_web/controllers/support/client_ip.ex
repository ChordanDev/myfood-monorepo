defmodule MealPlannerApiWeb.ClientIp do
  @moduledoc """
  The client address a request is rate limited under.

  The address comes from the request header named by
  `config :meal_planner_api, :client_ip_header` when one is configured
  and the request carries a usable value in it, and from the socket
  address (`conn.remote_ip`) otherwise. `x-forwarded-for` is never read:
  the client writes it, so it would let every request pick its own
  rate-limit bucket.

  Only configure a header that the proxy in front of the app sets itself
  on every request, overwriting whatever the client sent.
  """

  alias Plug.Conn

  # The longest textual IPv6 address, an IPv4-mapped one, is 45 bytes.
  @max_address_bytes 45

  @doc """
  Resolves the client address of `conn` as a string, IPv4 or IPv6 in the
  canonical form `:inet.ntoa/1` renders, or `nil` when neither the
  configured header nor the socket address holds an IP address.
  """
  @spec resolve(Conn.t()) :: String.t() | nil
  def resolve(%Conn{} = conn) do
    from_header(conn) || from_address(conn.remote_ip)
  end

  defp from_header(conn) do
    with header when is_binary(header) <-
           Application.get_env(:meal_planner_api, :client_ip_header),
         [value | _] <- Conn.get_req_header(conn, header) do
      value |> String.trim() |> parse()
    else
      _ -> nil
    end
  end

  # Strict parsing: the lenient `:inet.parse_address/1` also takes short
  # forms such as "1.2.3", which would give one client several buckets.
  defp parse(value) when byte_size(value) <= @max_address_bytes do
    case value |> String.to_charlist() |> :inet.parse_strict_address() do
      {:ok, address} -> from_address(address)
      {:error, _reason} -> nil
    end
  end

  defp parse(_value), do: nil

  defp from_address(address) when is_tuple(address) do
    case :inet.ntoa(address) do
      {:error, _reason} -> nil
      rendered -> List.to_string(rendered)
    end
  end

  defp from_address(_address), do: nil
end
