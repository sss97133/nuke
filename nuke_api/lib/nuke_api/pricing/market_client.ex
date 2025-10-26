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
  Fetch comprehensive data from Marketcheck API.

  Marketcheck provides 60M+ API calls/month with comprehensive
  dealer inventory, auction data, and vehicle history.
  
  This function combines multiple MarketCheck endpoints:
  - Vehicle search for current market listings
  - Vehicle history by VIN for validation data
  - Market trends and analytics
  """
  def fetch_marketcheck_data(vehicle) do
    with {:ok, api_key} <- get_api_key(:marketcheck),
         {:ok, api_secret} <- get_api_secret(:marketcheck) do

      # Fetch multiple data sources in parallel
      tasks = [
        Task.async(fn -> fetch_marketcheck_listings(vehicle, api_key) end),
        Task.async(fn -> fetch_marketcheck_history(vehicle, api_key, api_secret) end),
        Task.async(fn -> fetch_marketcheck_trends(vehicle, api_key) end)
      ]

      results = Task.await_many(tasks, 15_000)
      
      # Combine all MarketCheck data sources
      combined_data = combine_marketcheck_results(results, vehicle)
      
      {:ok, combined_data}
    else
      {:error, reason} ->
        Logger.warning("Marketcheck API failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Fetch vehicle history by VIN from MarketCheck API.
  
  This provides crucial validation data including:
  - Previous listings and price history
  - Ownership changes
  - Market exposure duration
  - Regional price variations
  """
  def fetch_marketcheck_history(vehicle, api_key, api_secret) do
    if vehicle.vin do
      case make_marketcheck_history_request(vehicle.vin, api_key, api_secret) do
        {:ok, response} ->
          history_data = %{
            source: "marketcheck_history",
            data_type: "historical_sale",
            price_history: parse_price_history(response),
            ownership_changes: parse_ownership_changes(response),
            market_exposure: parse_market_exposure(response),
            regional_data: parse_regional_data(response),
            confidence_score: calculate_history_confidence(response),
            raw_data: response
          }
          {:ok, history_data}
        
        {:error, reason} ->
          Logger.info("MarketCheck history unavailable for VIN #{vehicle.vin}: #{inspect(reason)}")
          {:ok, nil}
      end
    else
      Logger.info("No VIN available for MarketCheck history lookup")
      {:ok, nil}
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

  defp get_api_secret(source) do
    case Application.get_env(:nuke_api, :market_apis)[:"#{source}_secret"] do
      nil -> {:error, :missing_api_secret}
      secret -> {:ok, secret}
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

  # MarketCheck API request functions

  defp fetch_marketcheck_listings(vehicle, api_key) do
    case make_marketcheck_search_request(vehicle, api_key) do
      {:ok, response} ->
        %{
          source: "marketcheck",
          data_type: "listing",
          price_value: parse_price(response, "average_price"),
          price_range_low: parse_price(response, "min_price"),
          price_range_high: parse_price(response, "max_price"),
          confidence_score: parse_confidence(response),
          raw_data: response,
          location: "national",
          days_on_market: parse_days_on_market(response),
          mileage_at_time: vehicle.mileage,
          listing_count: get_in(response, ["num_found"]) || 0
        }
      {:error, reason} ->
        Logger.warning("MarketCheck listings failed: #{inspect(reason)}")
        nil
    end
  end

  defp fetch_marketcheck_trends(vehicle, api_key) do
    case make_marketcheck_trends_request(vehicle, api_key) do
      {:ok, response} ->
        %{
          source: "marketcheck_trends",
          data_type: "market_analysis",
          price_trend: get_in(response, ["price_trend"]),
          inventory_trend: get_in(response, ["inventory_trend"]),
          demand_score: get_in(response, ["demand_score"]),
          market_velocity: get_in(response, ["market_velocity"]),
          confidence_score: 75,
          raw_data: response
        }
      {:error, reason} ->
        Logger.info("MarketCheck trends unavailable: #{inspect(reason)}")
        nil
    end
  end

  defp make_marketcheck_search_request(vehicle, api_key) do
    query_params = URI.encode_query([
      {"api_key", api_key},
      {"year", vehicle.year},
      {"make", vehicle.make},
      {"model", vehicle.model},
      {"trim", vehicle.trim || ""},
      {"mileage", vehicle.mileage},
      {"radius", 500},  # National search
      {"rows", 50}      # More results for better analysis
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

  defp make_marketcheck_history_request(vin, api_key, api_secret) do
    url = "https://api.marketcheck.com/v2/history/car/#{vin}"
    
    headers = [
      {"X-Api-Key", api_key},
      {"X-Api-Secret", api_secret},
      {"Content-Type", "application/json"}
    ]

    case HTTPoison.get(url, headers) do
      {:ok, %HTTPoison.Response{status_code: 200, body: body}} ->
        {:ok, Jason.decode!(body)}
      {:ok, %HTTPoison.Response{status_code: 404}} ->
        {:error, "Vehicle history not found"}
      {:ok, %HTTPoison.Response{status_code: status, body: body}} ->
        {:error, "API returned #{status}: #{body}"}
      {:error, reason} ->
        {:error, reason}
    end
  end

  defp make_marketcheck_trends_request(vehicle, api_key) do
    query_params = URI.encode_query([
      {"api_key", api_key},
      {"year", vehicle.year},
      {"make", vehicle.make},
      {"model", vehicle.model}
    ])

    url = "https://api.marketcheck.com/v2/stats/car?" <> query_params

    case HTTPoison.get(url) do
      {:ok, %HTTPoison.Response{status_code: 200, body: body}} ->
        {:ok, Jason.decode!(body)}
      {:ok, %HTTPoison.Response{status_code: status, body: body}} ->
        {:error, "API returned #{status}: #{body}"}
      {:error, reason} ->
        {:error, reason}
    end
  end

  # Combine MarketCheck results from multiple endpoints
  defp combine_marketcheck_results(results, vehicle) do
    [listings_result, history_result, trends_result] = results
    
    base_data = listings_result || %{
      source: "marketcheck",
      data_type: "listing",
      price_value: nil,
      confidence_score: 0,
      mileage_at_time: vehicle.mileage
    }

    # Enhance with history data if available
    enhanced_data = if history_result do
      Map.merge(base_data, %{
        historical_data: history_result,
        confidence_score: min(base_data.confidence_score + 20, 95)
      })
    else
      base_data
    end

    # Add trends data if available
    if trends_result do
      Map.merge(enhanced_data, %{
        market_trends: trends_result,
        confidence_score: min(enhanced_data.confidence_score + 10, 95)
      })
    else
      enhanced_data
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

  # MarketCheck-specific parsing functions
  
  defp parse_price_history(response) do
    case get_in(response, ["price_history"]) do
      history when is_list(history) ->
        Enum.map(history, fn entry ->
          %{
            date: entry["date"],
            price: entry["price"],
            source: entry["source"] || "marketcheck",
            listing_type: entry["listing_type"] || "dealer"
          }
        end)
      _ -> []
    end
  end

  defp parse_ownership_changes(response) do
    case get_in(response, ["ownership_history"]) do
      ownership when is_list(ownership) ->
        Enum.map(ownership, fn entry ->
          %{
            date: entry["date"],
            owner_type: entry["owner_type"],
            location: entry["location"],
            duration_days: entry["duration_days"]
          }
        end)
      _ -> []
    end
  end

  defp parse_market_exposure(response) do
    %{
      total_days_listed: get_in(response, ["total_days_listed"]) || 0,
      listing_count: get_in(response, ["listing_count"]) || 0,
      average_days_per_listing: get_in(response, ["average_days_per_listing"]) || 0,
      first_listed_date: get_in(response, ["first_listed_date"]),
      last_listed_date: get_in(response, ["last_listed_date"])
    }
  end

  defp parse_regional_data(response) do
    case get_in(response, ["regional_data"]) do
      regional when is_list(regional) ->
        Enum.map(regional, fn entry ->
          %{
            region: entry["region"],
            average_price: entry["average_price"],
            listing_count: entry["listing_count"],
            days_on_market: entry["days_on_market"]
          }
        end)
      _ -> []
    end
  end

  defp calculate_history_confidence(response) do
    base_confidence = 60
    
    # Increase confidence based on data richness
    confidence = if get_in(response, ["price_history"]) && length(get_in(response, ["price_history"]) || []) > 0 do
      base_confidence + 20
    else
      base_confidence
    end
    
    confidence = if get_in(response, ["ownership_history"]) && length(get_in(response, ["ownership_history"]) || []) > 0 do
      confidence + 15
    else
      confidence
    end
    
    confidence = if get_in(response, ["total_days_listed"]) && get_in(response, ["total_days_listed"]) > 0 do
      confidence + 10
    else
      confidence
    end
    
    min(95, confidence)
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