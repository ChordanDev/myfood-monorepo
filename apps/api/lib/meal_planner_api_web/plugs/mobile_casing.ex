defmodule MealPlannerApiWeb.Plugs.MobileCasing do
  @moduledoc """
  Casing boundary of the mobile contract (issue #11): the app speaks
  camelCase, the API reads and renders snake_case, and this plug translates
  the keys in both directions with `MealPlannerApiWeb.Casing`.

  It is opt-in: only the routes piped through the router's `:mobile_casing`
  pipeline are affected. Every other route keeps the casing it has.

  ## Request

  `conn.params`, `conn.body_params` and `conn.query_params` are rewritten with
  `Casing.snake_keys/1` before the controller runs, so a controller keeps
  reading `"recipe_id"` whether the client sent `recipeId` or `recipe_id`.
  When one source sends a param in both casings, the snake_case one is kept.
  Between sources the usual precedence holds whatever the casing: a path param
  wins over the body, and the body over the query string.

  Path params are named by the router and are left as they are. The query
  string is fetched if it was not yet; a body no parser has read stays
  unfetched.

  ## Response

  A `Plug.Conn.register_before_send/2` hook decodes a JSON body, rewrites its
  keys with `Casing.camelize_keys/1` and encodes it again. Only keys change:
  status, headers and values are kept, so a flat `%{error: "some_reason"}`
  body keeps its reason and an `ApiError` envelope keeps its code.

  Everything else is sent as it is: a body that is not JSON, an empty body, a
  body that cannot be decoded, and chunked and file responses, whose body
  never passes through the conn.

  The hook is registered when the plug runs, so the plug has to come before
  any plug that can halt with a response (`:auth`, `:enforce_capability`) for
  that response to be rewritten too.
  """

  @behaviour Plug

  import Plug.Conn

  alias MealPlannerApiWeb.Casing

  @impl true
  def init(opts), do: opts

  @impl true
  def call(conn, _opts) do
    conn
    |> fetch_query_params()
    |> snake_request_params()
    |> register_before_send(&camelize_response_body/1)
  end

  # `Casing.snake_keys/1` returns a struct untouched, which covers a
  # `%Plug.Conn.Unfetched{}` body as well as a `%Plug.Upload{}` value.
  defp snake_request_params(conn) do
    query_params = Casing.snake_keys(conn.query_params)
    body_params = Casing.snake_keys(conn.body_params)

    %{
      conn
      | params: merge_params(conn, query_params, body_params),
        body_params: body_params,
        query_params: query_params
    }
  end

  # `conn.params` arrives already merged, so two sources that spell one param
  # differently are still two keys in it. Rewriting that map alone would let
  # the snake_case spelling win whichever source sent it. The sources are
  # merged again after the rewrite, in the order Plug and the router use:
  # query string, then body, then path params.
  defp merge_params(conn, query_params, body_params) do
    conn.params
    |> Casing.snake_keys()
    |> Map.merge(query_params)
    |> Map.merge(fetched(body_params))
    |> Map.merge(conn.path_params)
  end

  defp fetched(%Plug.Conn.Unfetched{}), do: %{}
  defp fetched(params), do: params

  # State `:set` means a whole body is about to be sent with `send_resp/3`.
  # Chunked and file responses reach the hook in another state, without a
  # body on the conn.
  defp camelize_response_body(%Plug.Conn{state: :set, resp_body: body} = conn)
       when body not in [nil, "", []] do
    with true <- json_response?(conn),
         {:ok, decoded} <- Jason.decode(body) do
      camelized = decoded |> Casing.camelize_keys() |> Jason.encode_to_iodata!()

      # A content-length set upstream would describe the old body; without
      # the header the web server computes it from the new one.
      conn |> delete_resp_header("content-length") |> resp(conn.status, camelized)
    else
      _not_json_or_undecodable -> conn
    end
  end

  defp camelize_response_body(conn), do: conn

  defp json_response?(conn) do
    with [content_type | _] <- get_resp_header(conn, "content-type"),
         {:ok, "application", subtype, _params} <- Plug.Conn.Utils.media_type(content_type) do
      subtype == "json" or String.ends_with?(subtype, "+json")
    else
      _missing_or_invalid -> false
    end
  end
end
