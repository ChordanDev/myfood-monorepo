defmodule MealPlannerApiWeb.ParameterFilterTest do
  @moduledoc """
  Request parameters that `config/config.exs` keeps out of the logs
  (`:filter_parameters`). Phoenix matches them case-sensitively, so the
  camelCase keys of the mobile contract need their own entry.
  """
  use ExUnit.Case, async: true

  test "the mobile contract's camelCase tokens are filtered" do
    params = %{
      "idToken" => "provider-id-token",
      "refreshToken" => "refresh-token",
      "accessToken" => "access-token",
      "token" => "invite-token",
      "provider" => "google"
    }

    assert Phoenix.Logger.filter_values(params) == %{
             "idToken" => "[FILTERED]",
             "refreshToken" => "[FILTERED]",
             "accessToken" => "[FILTERED]",
             "token" => "[FILTERED]",
             "provider" => "google"
           }
  end
end
