defmodule NukeApiWeb.DebugController do
  @moduledoc """
  Consolidated debug and testing endpoints.

  This controller replaces multiple redundant test controllers:
  - TestController (removed - was disabled)
  - SimpleTestController (merged here)
  - SimpleScraperController (removed - unused)

  All debug/testing functionality is now centralized here.
  """
  use NukeApiWeb, :controller

  @doc """
  Basic health check endpoint.
  Replaces both /ping and /test endpoints.
  """
  def ping(conn, _params) do
    json(conn, %{
      status: "ok",
      message: "Backend is working",
      timestamp: DateTime.utc_now(),
      service: "nuke_api",
      version: Application.spec(:nuke_api, :vsn) |> to_string()
    })
  end

  @doc """
  Health check alias for /test endpoint compatibility.
  """
  def test(conn, params), do: ping(conn, params)

  @doc """
  Mock scraper endpoint for testing scraping functionality.
  Returns test data to verify scraping pipeline without hitting external services.
  """
  def scrape_test(conn, %{"url" => url}) do
    json(conn, %{
      success: true,
      data: %{
        make: "Test",
        model: "Vehicle",
        year: "2024",
        source: "debug_endpoint",
        vin: "1HGBH41JXMN109186",
        color: "Red",
        mileage: "50000"
      },
      message: "Mock scraper working, URL received: #{url}",
      timestamp: DateTime.utc_now()
    })
  end

  def scrape_test(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(%{
      success: false,
      error: "URL parameter required",
      example: "/api/scrape-test?url=https://example.com"
    })
  end

  @doc """
  Disabled scrape listing endpoint.
  This replaces TestController.scrape_listing which was intentionally disabled.
  """
  def scrape_listing(conn, _params) do
    conn
    |> put_status(:not_implemented)
    |> json(%{
      success: false,
      message: "Mock scraping disabled. Use real scraping endpoint or scrape-test for debugging.",
      available_endpoints: [
        "POST /api/scrape-test - Mock scraper for testing",
        "GET /api/ping - Health check",
        "GET /api/test - Health check alias"
      ]
    })
  end

  @doc """
  Debug information about the API.
  """
  def info(conn, _params) do
    json(conn, %{
      service: "nuke_api",
      version: Application.spec(:nuke_api, :vsn) |> to_string(),
      elixir_version: System.version(),
      environment: Application.get_env(:nuke_api, :environment, :dev),
      uptime: :erlang.statistics(:wall_clock) |> elem(0),
      available_endpoints: [
        "GET /api/ping - Health check",
        "GET /api/test - Health check alias",
        "GET /api/info - This endpoint",
        "POST /api/scrape-test - Mock scraper",
        "POST /api/scrape-listing - Disabled scraper"
      ]
    })
  end
end