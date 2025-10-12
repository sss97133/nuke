defmodule NukeApi.Pricing.MarketClient do
  @moduledoc """
  Market Data Client - Aggregates pricing from multiple external sources.

  This module orchestrates calls to various automotive pricing APIs
  to build comprehensive market intelligence for vehicle valuation.
  """

  require Logger
  alias NukeApi.Pricing.MarketData
  alias NukeApi.Repo

  @doc """
  Fetch comprehensive market data for a vehicle from all available sources.
  """
  def fetch_market_data(vehicle) do
    sources = [
      &fetch_vehicle_databases_data/1,
      &fetch_marketcheck_data/1,
      &fetch_vinaudit_data/1,
      &fetch_nada_data/1,
      &fetch_blackbook_data/1
    ]

    # Execute all API calls in parallel
    results = sources
    |> Task.async_stream(&(&1.(vehicle)), timeout: 10_000, on_timeout: :kill_task)
    |> Enum.map(fn
      {:ok, result} -> result
      {:exit, :timeout} -> {:error, :timeout}
      {:exit, reason} -> {:error, reason}
    end)
    |> Enum.filter(fn
      {:ok, _data} -> true
      _ -> false
    end)
    |> Enum.map(fn {:ok, data} -> data end)

    # Store all market data in database
    Enum.each(results, &store_market_data(&1, vehicle.id))

    # Calculate weighted average from all sources
    weighted_value = calculate_weighted_average(results)

    {:ok, %{
      base_market_value: weighted_value,
      sources: results,
      confidence_score: calculate_market_confidence(results)
    }}
  end

  @doc """
  Fetch data from Vehicle Databases API.

  Vehicle Databases provides 80M+ records with comprehensive coverage
  including auction history and condition adjustments.
  """
  def fetch_vehicle_databases_data(vehicle) do
    with {:ok, api_key} <- get_api_key(:vehicle_databases),
         {:ok, response} <- make_vehicle_databases_request(vehicle, api_key) do

      market_data = %{
        source: "vehicle_databases",
        data_type: "valuation",
        price_value: parse_price(response, "market_value"),
        price_range_low: parse_price(response, "low_value"),
        price_range_high: parse_price(response, "high_value"),
        confidence_score: parse_confidence(response),
        raw_data: response,
        location: "national",
        mileage_at_time: vehicle.mileage
      }

      {:ok, market_data}
    else
      {:error, reason} ->
        Logger.warning("Vehicle Databases API failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Fetch data from Marketcheck API.

  Marketcheck provides 60M+ API calls/month with comprehensive
  dealer inventory and auction data.
  """
  def fetch_marketcheck_data(vehicle) do
    with {:ok, api_key} <- get_api_key(:marketcheck),
         {:ok, response} <- make_marketcheck_request(vehicle, api_key) do

      market_data = %{
        source: "marketcheck",
        data_type: "listing",
        price_value: parse_price(response, "average_price"),
        price_range_low: parse_price(response, "min_price"),
        price_range_high: parse_price(response, "max_price"),
        confidence_score: parse_confidence(response),
        raw_data: response,
        location: "national",
        days_on_market: parse_days_on_market(response),
        mileage_at_time: vehicle.mileage
      }

      {:ok, market_data}
    else
      {:error, reason} ->
        Logger.warning("Marketcheck API failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Fetch data from VinAudit API.

  VinAudit provides real-time market value estimation with
  statistical modeling and multiple pricing levels.
  """
  def fetch_vinaudit_data(vehicle) do
    with {:ok, api_key} <- get_api_key(:vinaudit),
         {:ok, response} <- make_vinaudit_request(vehicle, api_key) do

      market_data = %{
        source: "vinaudit",
        data_type: "valuation",
        price_value: parse_price(response, "average_value"),
        price_range_low: parse_price(response, "low_value"),
        price_range_high: parse_price(response, "high_value"),
        confidence_score: parse_confidence(response),
        raw_data: response,
        location: "national",
        mileage_at_time: vehicle.mileage
      }

      {:ok, market_data}
    else
      {:error, reason} ->
        Logger.warning("VinAudit API failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Fetch data from NADA Guides API.

  NADA provides 12 years of pricing data with current market values,
  trade-in values, and private party values.
  """
  def fetch_nada_data(vehicle) do
    with {:ok, api_key} <- get_api_key(:nada),
         {:ok, response} <- make_nada_request(vehicle, api_key) do

      market_data = %{
        source: "nada",
        data_type: "valuation",
        price_value: parse_price(response, "retail_value"),
        price_range_low: parse_price(response, "trade_value"),
        price_range_high: parse_price(response, "private_party_value"),
        confidence_score: parse_confidence(response),
        raw_data: response,
        location: "national",
        mileage_at_time: vehicle.mileage
      }

      {:ok, market_data}
    else
      {:error, reason} ->
        Logger.warning("NADA API failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Fetch data from Black Book API.

  Black Book provides wholesale auction data with Custom Trade Value API
  and condition-based adjustments.
  """
  def fetch_blackbook_data(vehicle) do
    with {:ok, api_key} <- get_api_key(:blackbook),
         {:ok, response} <- make_blackbook_request(vehicle, api_key) do

      market_data = %{
        source: "blackbook",
        data_type: "valuation",
        price_value: parse_price(response, "trade_value"),
        price_range_low: parse_price(response, "rough_trade"),
        price_range_high: parse_price(response, "clean_trade"),
        confidence_score: parse_confidence(response),
        raw_data: response,
        location: "national",
        condition_rating: parse_condition(response),
        mileage_at_time: vehicle.mileage
      }

      {:ok, market_data}
    else
      {:error, reason} ->
        Logger.warning("Black Book API failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  # Private helper functions

  defp get_api_key(source) do
    case Application.get_env(:nuke_api, :market_apis)[source] do
      nil -> {:error, :missing_api_key}
      key -> {:ok, key}
    end
  end

  defp make_vehicle_databases_request(vehicle, api_key) do
    url = "https://api.vehicledatabase.com/market-value"
    headers = [
      {"Authorization", "Bearer #{api_key}"},
      {"Content-Type", "application/json"}
    ]

    body = Jason.encode!(%{
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim,
      mileage: vehicle.mileage
    })

    case HTTPoison.post(url, body, headers) do
      {:ok, %HTTPoison.Response{status_code: 200, body: body}} ->
        {:ok, Jason.decode!(body)}
      {:ok, %HTTPoison.Response{status_code: status, body: body}} ->
        {:error, "API returned #{status}: #{body}"}
      {:error, reason} ->
        {:error, reason}
    end
  end

  defp make_marketcheck_request(vehicle, api_key) do
    query_params = URI.encode_query([
      {"api_key", api_key},
      {"year", vehicle.year},
      {"make", vehicle.make},
      {"model", vehicle.model},
      {"trim", vehicle.trim || ""},
      {"mileage", vehicle.mileage}
    ])

    url = "https://api.marketcheck.com/v2/search/car?" <> query_params

    case HTTPoison.get(url) do
      {:ok, %HTTPoison.Response{status_code: 200, body: body}} ->
        {:ok, Jason.decode!(body)}
      {:ok, %HTTPoison.Response{status_code: status, body: body}} ->
        {:error, "API returned #{status}: #{body}"}
      {:error, reason} ->
        {:error, reason}
    end
  end

  defp make_vinaudit_request(vehicle, api_key) do
    url = "https://api.vinaudit.com/market-value"
    headers = [
      {"X-API-Key", api_key},
      {"Content-Type", "application/json"}
    ]

    body = Jason.encode!(%{
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim,
      mileage: vehicle.mileage
    })

    case HTTPoison.post(url, body, headers) do
      {:ok, %HTTPoison.Response{status_code: 200, body: body}} ->
        {:ok, Jason.decode!(body)}
      {:ok, %HTTPoison.Response{status_code: status, body: body}} ->
        {:error, "API returned #{status}: #{body}"}
      {:error, reason} ->
        {:error, reason}
    end
  end

  defp make_nada_request(vehicle, api_key) do
    query_params = URI.encode_query([
      {"key", api_key},
      {"year", vehicle.year},
      {"make", vehicle.make},
      {"model", vehicle.model},
      {"trim", vehicle.trim || ""}
    ])

    url = "https://api.nadaguides.com/v1/vehicles/values?" <> query_params

    case HTTPoison.get(url) do
      {:ok, %HTTPoison.Response{status_code: 200, body: body}} ->
        {:ok, Jason.decode!(body)}
      {:ok, %HTTPoison.Response{status_code: status, body: body}} ->
        {:error, "API returned #{status}: #{body}"}
      {:error, reason} ->
        {:error, reason}
    end
  end

  defp make_blackbook_request(vehicle, api_key) do
    url = "https://api.blackbook.com/vehicle-value"
    headers = [
      {"Authorization", "Bearer #{api_key}"},
      {"Content-Type", "application/json"}
    ]

    body = Jason.encode!(%{
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim,
      mileage: vehicle.mileage
    })

    case HTTPoison.post(url, body, headers) do
      {:ok, %HTTPoison.Response{status_code: 200, body: body}} ->
        {:ok, Jason.decode!(body)}
      {:ok, %HTTPoison.Response{status_code: status, body: body}} ->
        {:error, "API returned #{status}: #{body}"}
      {:error, reason} ->
        {:error, reason}
    end
  end

  defp parse_price(response, field) do
    case get_in(response, String.split(field, ".")) do
      price when is_number(price) -> Decimal.new(to_string(price))
      price when is_binary(price) -> Decimal.new(price)
      _ -> nil
    end
  end

  defp parse_confidence(response) do
    case get_in(response, ["confidence"]) || get_in(response, ["confidence_score"]) do
      confidence when is_number(confidence) -> confidence
      _ -> 50.0  # Default moderate confidence
    end
  end

  defp parse_condition(response) do
    get_in(response, ["condition"]) || "average"
  end

  defp parse_days_on_market(response) do
    case get_in(response, ["days_on_market"]) || get_in(response, ["average_dom"]) do
      days when is_number(days) -> days
      _ -> nil
    end
  end

  defp store_market_data(market_data, vehicle_id) do
    market_data = Map.put(market_data, :vehicle_id, vehicle_id)

    changeset = MarketData.changeset(%MarketData{}, market_data)

    case Repo.insert(changeset) do
      {:ok, _} -> :ok
      {:error, changeset} ->
        Logger.error("Failed to store market data: #{inspect(changeset.errors)}")
        :error
    end
  end

  defp calculate_weighted_average(market_data_list) when is_list(market_data_list) do
    if Enum.empty?(market_data_list) do
      Decimal.new("0")
    else
      # Weight sources by confidence score
      total_weighted_value = market_data_list
      |> Enum.filter(& &1.price_value)
      |> Enum.reduce(Decimal.new("0"), fn data, acc ->
        weight = data.confidence_score / 100.0
        weighted_value = Decimal.mult(data.price_value, Decimal.from_float(weight))
        Decimal.add(acc, weighted_value)
      end)

      total_weight = market_data_list
      |> Enum.filter(& &1.price_value)
      |> Enum.map(& &1.confidence_score)
      |> Enum.sum()
      |> Kernel./(100.0)

      if total_weight > 0 do
        Decimal.div(total_weighted_value, Decimal.from_float(total_weight))
      else
        Decimal.new("0")
      end
    end
  end

  defp calculate_market_confidence(market_data_list) do
    if Enum.empty?(market_data_list) do
      0.0
    else
      # Higher confidence when more sources agree
      source_count = length(market_data_list)
      avg_confidence = market_data_list
      |> Enum.map(& &1.confidence_score)
      |> Enum.sum()
      |> Kernel./(source_count)

      # Bonus for multiple sources
      source_bonus = min(source_count * 5, 20)

      min(avg_confidence + source_bonus, 100.0)
    end
  end
end