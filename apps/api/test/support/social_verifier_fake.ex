defmodule MealPlannerApi.Auth.SocialVerifierFake do
  @moduledoc """
  The provider in tests (`config/test.exs`): answers what the test put in
  the process dictionary with `answer/1`, and `:invalid_token` when it put
  nothing. The calls it got are kept, newest first, for `calls/0`.
  """
  @behaviour MealPlannerApi.Auth.SocialVerifier

  @doc "Makes the next verifications in this process answer `answer`."
  def answer(answer), do: Process.put({__MODULE__, :answer}, answer)

  @doc "The `{provider, id_token}` pairs verified in this process, newest first."
  def calls, do: Process.get({__MODULE__, :calls}, [])

  @impl true
  def verify(provider, id_token, _opts) do
    Process.put({__MODULE__, :calls}, [{provider, id_token} | calls()])

    case Process.get({__MODULE__, :answer}) do
      {:ok, _identity} = ok -> ok
      {:error, _reason} = error -> error
      nil -> {:error, :invalid_token}
    end
  end
end
