defmodule NukeApiWeb.HealthController do
  use NukeApiWeb, :controller

  @doc """
  Basic health check endpoint to verify API availability.
  """
  def index(conn, _params) do
    # Get application version from mix.exs
    {:ok, version} = :application.get_key(:nuke_api, :vsn)
    version = List.to_string(version)

    # Return status information
    json(conn, %{
      status: "ok",
      service: "nuke_api",
      version: version,
      environment: Mix.env(),
      timestamp: DateTime.utc_now()
    })
  end
end
