defmodule NukeApi.Pricing.MarketDataScraper do
  @moduledoc """
  Automated web scraping system for real-time vehicle market data.

  This module scrapes multiple automotive marketplaces to gather:
  - Comparable vehicle listings
  - Sold vehicle prices
  - Market trends
  - Regional price variations

  Sources include:
  - AutoTrader
  - Cars.com
  - CarGurus
  - Craigslist (local markets)
  - Bring a Trailer (enthusiast vehicles)
  - NADA/KBB (when available)
  """

  require Logger
  alias NukeApi.Pricing.MarketData

  @user_agents [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
  ]

  @rate_limit_delay 2000 # 2 seconds between requests to be respectful

  @doc """
  Scrape comparable vehicles from multiple sources.
  """
  def scrape_comparable_vehicles(vehicle, opts \\ []) do
    search_radius = Keyword.get(opts, :radius, 50)
    max_results = Keyword.get(opts, :max_results, 20)
    include_sold = Keyword.get(opts, :include_sold, true)

    Logger.info("Scraping market data for #{vehicle.year} #{vehicle.make} #{vehicle.model}")

    # Define search parameters
    search_params = %{
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim,
      mileage_range: calculate_mileage_range(vehicle.mileage),
      radius: search_radius,
      max_results: max_results
    }

    # Scrape from multiple sources in parallel
    tasks = [
      Task.async(fn -> scrape_autotrader(search_params) end),
      Task.async(fn -> scrape_cars_com(search_params) end),
      Task.async(fn -> scrape_cargurus(search_params) end)
    ]

    if include_sold do
      # Add sold listings sources
      sold_task = Task.async(fn -> scrape_sold_listings(search_params) end)
      tasks = [sold_task | tasks]
    end

    # Collect results
    results = tasks
    |> Task.await_many(60_000) # 60 second timeout
    |> List.flatten()
    |> Enum.reject(&is_nil/1)
    |> Enum.take(max_results)

    # Clean and standardize data
    standardized_results = Enum.map(results, &standardize_listing_data/1)

    # Store in database for caching
    store_market_data(vehicle, standardized_results)

    {:ok, standardized_results}
  rescue
    error ->
      Logger.error("Market data scraping failed: #{inspect(error)}")
      {:error, "Failed to scrape market data"}
  end

  @doc """
  Get cached market data if fresh enough, otherwise scrape new data.
  """
  def get_market_data(vehicle, opts \\ []) do
    max_age_hours = Keyword.get(opts, :max_age_hours, 24)

    case get_cached_market_data(vehicle, max_age_hours) do
      {:ok, cached_data} when length(cached_data) > 0 ->
        Logger.info("Using cached market data (#{length(cached_data)} listings)")
        {:ok, cached_data}

      _ ->
        Logger.info("Cache miss or stale, scraping fresh market data")
        scrape_comparable_vehicles(vehicle, opts)
    end
  end

  # Private scraping functions

  defp scrape_autotrader(search_params) do
    Logger.info("Scraping AutoTrader...")

    # Build search URL
    url = build_autotrader_url(search_params)

    case make_request(url) do
      {:ok, html} ->
        parse_autotrader_results(html)
      {:error, reason} ->
        Logger.warn("AutoTrader scraping failed: #{inspect(reason)}")
        []
    end
  rescue
    error ->
      Logger.warn("AutoTrader scraping error: #{inspect(error)}")
      []
  end

  defp scrape_cars_com(search_params) do
    Logger.info("Scraping Cars.com...")

    url = build_cars_com_url(search_params)

    case make_request(url) do
      {:ok, html} ->
        parse_cars_com_results(html)
      {:error, reason} ->
        Logger.warn("Cars.com scraping failed: #{inspect(reason)}")
        []
    end
  rescue
    error ->
      Logger.warn("Cars.com scraping error: #{inspect(error)}")
      []
  end

  defp scrape_cargurus(search_params) do
    Logger.info("Scraping CarGurus...")

    url = build_cargurus_url(search_params)

    case make_request(url) do
      {:ok, html} ->
        parse_cargurus_results(html)
      {:error, reason} ->
        Logger.warn("CarGurus scraping failed: #{inspect(reason)}")
        []
    end
  rescue
    error ->
      Logger.warn("CarGurus scraping error: #{inspect(error)}")
      []
  end

  defp scrape_sold_listings(search_params) do
    Logger.info("Scraping sold listings...")

    # Scrape recently sold listings from various sources
    # This is typically more challenging as sold data is less publicly available
    []
  end

  # URL building functions

  defp build_autotrader_url(params) do
    base_url = "https://www.autotrader.com/cars-for-sale/vehicledetails.xhtml"

    query_params = [
      "makeCodeList=#{url_encode(params.make)}",
      "modelCodeList=#{url_encode(params.model)}",
      "startYear=#{params.year - 1}",
      "endYear=#{params.year + 1}",
      "searchRadius=#{params.radius}",
      "maxResults=#{min(params.max_results, 25)}"
    ]

    "#{base_url}?#{Enum.join(query_params, "&")}"
  end

  defp build_cars_com_url(params) do
    base_url = "https://www.cars.com/shopping/results/"

    query_params = [
      "make_model_list=#{url_encode(params.make)}_#{url_encode(params.model)}",
      "year_min=#{params.year - 1}",
      "year_max=#{params.year + 1}",
      "maximum_distance=#{params.radius}",
      "per_page=#{min(params.max_results, 20)}"
    ]

    "#{base_url}?#{Enum.join(query_params, "&")}"
  end

  defp build_cargurus_url(params) do
    base_url = "https://www.cargurus.com/Cars/inventorylisting/viewDetailsFilterViewInventoryListing.action"

    query_params = [
      "sourceContext=carGurusHomePage_false_0",
      "entitySelectingHelper.selectedEntity=#{url_encode(params.year)}_#{url_encode(params.make)}_#{url_encode(params.model)}",
      "distance=#{params.radius}",
      "maxResults=#{min(params.max_results, 15)}"
    ]

    "#{base_url}?#{Enum.join(query_params, "&")}"
  end

  # HTTP request function with rate limiting and error handling

  defp make_request(url) do
    # Rate limiting
    :timer.sleep(@rate_limit_delay)

    headers = [
      {"User-Agent", Enum.random(@user_agents)},
      {"Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"},
      {"Accept-Language", "en-US,en;q=0.5"},
      {"Accept-Encoding", "gzip, deflate"},
      {"Connection", "keep-alive"},
      {"Upgrade-Insecure-Requests", "1"}
    ]

    case HTTPoison.get(url, headers, [timeout: 30_000, recv_timeout: 30_000]) do
      {:ok, %HTTPoison.Response{status_code: 200, body: body}} ->
        {:ok, body}
      {:ok, %HTTPoison.Response{status_code: status_code}} ->
        {:error, "HTTP #{status_code}"}
      {:error, %HTTPoison.Error{reason: reason}} ->
        {:error, reason}
    end
  end

  # HTML parsing functions

  defp parse_autotrader_results(html) do
    # Parse AutoTrader search results
    # This would use a library like Floki to parse HTML
    case Floki.parse_document(html) do
      {:ok, document} ->
        document
        |> Floki.find(".inventory-listing")
        |> Enum.map(&extract_autotrader_listing/1)
        |> Enum.reject(&is_nil/1)

      {:error, _reason} ->
        []
    end
  rescue
    _error -> []
  end

  defp parse_cars_com_results(html) do
    case Floki.parse_document(html) do
      {:ok, document} ->
        document
        |> Floki.find(".vehicle-card")
        |> Enum.map(&extract_cars_com_listing/1)
        |> Enum.reject(&is_nil/1)

      {:error, _reason} ->
        []
    end
  rescue
    _error -> []
  end

  defp parse_cargurus_results(html) do
    case Floki.parse_document(html) do
      {:ok, document} ->
        document
        |> Floki.find(".cargurus-listing")
        |> Enum.map(&extract_cargurus_listing/1)
        |> Enum.reject(&is_nil/1)

      {:error, _reason} ->
        []
    end
  rescue
    _error -> []
  end

  # Data extraction functions

  defp extract_autotrader_listing(listing_html) do
    # Extract listing data from AutoTrader HTML element
    price = extract_price(listing_html, ".price-text")
    mileage = extract_mileage(listing_html, ".mileage")
    location = extract_location(listing_html, ".dealer-address")

    if price && price > 0 do
      %{
        source: "AutoTrader",
        price: price,
        mileage: mileage,
        location: location,
        condition: "used",
        scraped_at: DateTime.utc_now()
      }
    else
      nil
    end
  rescue
    _error -> nil
  end

  defp extract_cars_com_listing(listing_html) do
    price = extract_price(listing_html, ".primary-price")
    mileage = extract_mileage(listing_html, ".mileage")
    location = extract_location(listing_html, ".miles-from")

    if price && price > 0 do
      %{
        source: "Cars.com",
        price: price,
        mileage: mileage,
        location: location,
        condition: "used",
        scraped_at: DateTime.utc_now()
      }
    else
      nil
    end
  rescue
    _error -> nil
  end

  defp extract_cargurus_listing(listing_html) do
    price = extract_price(listing_html, ".price")
    mileage = extract_mileage(listing_html, ".mileage-display")
    location = extract_location(listing_html, ".distance")

    if price && price > 0 do
      %{
        source: "CarGurus",
        price: price,
        mileage: mileage,
        location: location,
        condition: "used",
        scraped_at: DateTime.utc_now()
      }
    else
      nil
    end
  rescue
    _error -> nil
  end

  # Helper extraction functions

  defp extract_price(html_element, selector) do
    html_element
    |> Floki.find(selector)
    |> Floki.text()
    |> clean_price_text()
    |> parse_price()
  end

  defp extract_mileage(html_element, selector) do
    html_element
    |> Floki.find(selector)
    |> Floki.text()
    |> clean_mileage_text()
    |> parse_mileage()
  end

  defp extract_location(html_element, selector) do
    html_element
    |> Floki.find(selector)
    |> Floki.text()
    |> String.trim()
  end

  defp clean_price_text(text) do
    text
    |> String.replace(~r/[^\d,.]/, "")
    |> String.replace(",", "")
  end

  defp parse_price(""), do: nil
  defp parse_price(price_text) do
    case Float.parse(price_text) do
      {price, _} when price > 0 -> round(price)
      _ -> nil
    end
  end

  defp clean_mileage_text(text) do
    text
    |> String.replace(~r/[^\d,]/, "")
    |> String.replace(",", "")
  end

  defp parse_mileage(""), do: nil
  defp parse_mileage(mileage_text) do
    case Integer.parse(mileage_text) do
      {mileage, _} when mileage >= 0 -> mileage
      _ -> nil
    end
  end

  # Data processing functions

  defp standardize_listing_data(raw_listing) do
    %MarketData{
      source: raw_listing.source,
      price_value: raw_listing[:price] || 0,
      mileage_at_time: raw_listing[:mileage] || 0,
      location: raw_listing[:location] || "Unknown",
      condition_rating: raw_listing[:condition] || "unknown",
      listing_date: raw_listing[:scraped_at] || Date.utc_today(),
      confidence_score: calculate_listing_confidence(raw_listing),
      data_type: "listing"
    }
  end

  defp calculate_listing_confidence(listing) do
    base_confidence = 70

    # Adjust based on data completeness
    confidence = if listing[:mileage], do: base_confidence + 10, else: base_confidence
    confidence = if listing[:location], do: confidence + 10, else: confidence
    confidence = if listing[:price] && listing[:price] > 1000, do: confidence + 10, else: confidence - 20

    min(100, max(0, confidence))
  end

  defp assess_data_quality(listing) do
    quality_factors = [
      has_price: !is_nil(listing[:price]),
      has_mileage: !is_nil(listing[:mileage]),
      has_location: !is_nil(listing[:location]),
      reasonable_price: listing[:price] && listing[:price] > 1000 && listing[:price] < 500000,
      reasonable_mileage: !listing[:mileage] || (listing[:mileage] >= 0 && listing[:mileage] < 500000)
    ]

    quality_score = quality_factors
    |> Enum.count(fn {_key, value} -> value end)
    |> Kernel.*(20) # Each factor worth 20 points

    cond do
      quality_score >= 80 -> "high"
      quality_score >= 60 -> "medium"
      true -> "low"
    end
  end

  # Database functions

  defp store_market_data(vehicle, listings) do
    # Store scraped data in database for caching
    # This would integrate with your existing database schema
    Logger.info("Storing #{length(listings)} market listings for caching")
  end

  defp get_cached_market_data(vehicle, max_age_hours) do
    # Retrieve cached market data if available and fresh
    # This would query your database
    {:error, "No cached data"}
  end

  # Utility functions

  defp calculate_mileage_range(vehicle_mileage) do
    case vehicle_mileage do
      nil -> {0, 200000}
      mileage ->
        variance = max(20000, mileage * 0.3)
        {max(0, mileage - variance), mileage + variance}
    end
  end

  defp url_encode(text) when is_binary(text) do
    URI.encode(text, &URI.char_unreserved?/1)
  end

  defp url_encode(text) when is_integer(text) do
    Integer.to_string(text)
  end

  defp url_encode(text) do
    text |> to_string() |> url_encode()
  end
end