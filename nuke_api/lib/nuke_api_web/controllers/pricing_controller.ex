defmodule NukeApiWeb.PricingController do
  use NukeApiWeb, :controller

  alias NukeApi.{Pricing, Vehicles, Repo}
  alias NukeApi.Vehicles.Vehicle
  alias NukeApi.Pricing.PriceHistory
  require Logger
  import Ecto.Query

  @doc """
  Generate comprehensive price intelligence for a vehicle.

  POST /api/vehicles/:id/price-intelligence

  This is the main endpoint for "the ultimate appraisal tool" that provides
  instant, data-driven vehicle valuations with visual evidence analysis.
  """
  def generate_price_intelligence(conn, %{"id" => vehicle_id}) do
    case Vehicles.get_vehicle(vehicle_id) do
      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Vehicle not found"})

      vehicle ->
        # For now, return mock pricing intelligence data for frontend testing
        # TODO: Replace with actual pricing intelligence when database schema is fixed
        mock_pricing_intelligence = generate_mock_pricing_intelligence(vehicle)

        conn
        |> put_status(:ok)
        |> json(%{
          success: true,
          vehicle_id: vehicle_id,
          pricing_intelligence: mock_pricing_intelligence,
          generated_at: DateTime.utc_now()
        })
    end
  end

  @doc """
  Get detailed modification analysis for a vehicle.

  GET /api/vehicles/:id/modification-analysis

  Returns comprehensive breakdown of how modifications affect vehicle value.
  """
  def get_modification_analysis(conn, %{"id" => vehicle_id}) do
    case Vehicles.get_vehicle_with_images_and_tags(vehicle_id) do
      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Vehicle not found"})

      vehicle ->
        case Pricing.ModificationCalculator.calculate_modification_impact(vehicle) do
          {:ok, total_impact} ->
            # Get detailed modification impacts from database
            modification_impacts = get_modification_impacts(vehicle_id)

            conn
            |> json(%{
              vehicle_id: vehicle_id,
              total_modification_impact: total_impact,
              detailed_analysis: modification_impacts,
              modification_count: length(modification_impacts),
              summary: generate_modification_summary(modification_impacts)
            })

          {:error, reason} ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(%{error: "Failed to analyze modifications", details: format_error(reason)})
        end
    end
  end

  @doc """
  Get market data comparison for a vehicle.

  GET /api/vehicles/:id/market-comparison

  Returns current market data from multiple sources for comparison.
  """
  def get_market_comparison(conn, %{"id" => vehicle_id}) do
    case Vehicles.get_vehicle(vehicle_id) do
      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Vehicle not found"})

      vehicle ->
        case Pricing.MarketClient.fetch_market_data(vehicle) do
          {:ok, market_data} ->
            conn
            |> json(%{
              vehicle_id: vehicle_id,
              vehicle_info: %{
                year: vehicle.year,
                make: vehicle.make,
                model: vehicle.model,
                trim: vehicle.trim,
                mileage: vehicle.mileage
              },
              market_intelligence: %{
                estimated_base_value: market_data.base_market_value,
                confidence_score: market_data.confidence_score,
                source_count: length(market_data.sources)
              },
              sources: format_market_sources(market_data.sources),
              generated_at: DateTime.utc_now()
            })

          {:error, reason} ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(%{error: "Failed to fetch market data", details: format_error(reason)})
        end
    end
  end

  @doc """
  Get price history and trends for a vehicle.

  GET /api/vehicles/:id/price-history

  Returns historical pricing data and trend analysis.
  """
  def get_price_history(conn, %{"id" => vehicle_id}) do
    case Vehicles.get_vehicle(vehicle_id) do
      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Vehicle not found"})

      _vehicle ->
        price_history = get_vehicle_price_history(vehicle_id)

        conn
        |> json(%{
          vehicle_id: vehicle_id,
          price_history: price_history,
          trend_analysis: analyze_price_trends(price_history),
          total_valuations: length(price_history)
        })
    end
  end

  # Private helper functions

  defp format_price_intelligence(price_intelligence) do
    %{
      total_estimated_value: price_intelligence.total_estimated_value,
      confidence_score: price_intelligence.confidence_score,
      valuation_breakdown: %{
        base_market_value: price_intelligence.base_market_value,
        modification_impact: price_intelligence.modification_impact,
        condition_adjustment: price_intelligence.condition_adjustment,
        market_factors: price_intelligence.market_factors,
        rarity_multiplier: price_intelligence.rarity_multiplier
      },
      visual_evidence: %{
        total_images: length(price_intelligence.visual_evidence),
        high_value_images: count_high_value_images(price_intelligence.visual_evidence),
        verification_quality: calculate_avg_verification_quality(price_intelligence.visual_evidence)
      },
      value_drivers: price_intelligence.value_drivers,
      risk_factors: price_intelligence.risk_factors,
      market_comparables: price_intelligence.market_comparables
    }
  end

  defp count_high_value_images(visual_evidence) do
    Enum.count(visual_evidence, fn image -> image.value_relevance >= 3 end)
  end

  defp calculate_avg_verification_quality(visual_evidence) do
    if Enum.empty?(visual_evidence) do
      0.0
    else
      total_quality = visual_evidence
      |> Enum.flat_map(fn image -> image.tags end)
      |> Enum.map(fn tag -> tag.trust_score || 0 end)
      |> Enum.sum()

      tag_count = visual_evidence
      |> Enum.flat_map(fn image -> image.tags end)
      |> length()

      if tag_count > 0, do: total_quality / tag_count, else: 0.0
    end
  end

  defp format_market_sources(sources) do
    Enum.map(sources, fn source ->
      %{
        source: source.source,
        data_type: source.data_type,
        price_value: source.price_value,
        price_range: %{
          low: source.price_range_low,
          high: source.price_range_high
        },
        confidence_score: source.confidence_score,
        location: source.location,
        last_updated: source.inserted_at
      }
    end)
  end

  defp get_modification_impacts(vehicle_id) do
    Repo.all(
      from mi in NukeApi.Pricing.ModificationImpact,
      where: mi.vehicle_id == ^vehicle_id,
      order_by: [desc: mi.current_value_impact]
    )
    |> Enum.map(&format_modification_impact/1)
  end

  defp format_modification_impact(modification_impact) do
    %{
      modification_name: modification_impact.modification_name,
      modification_type: modification_impact.modification_type,
      brand: modification_impact.brand,
      value_impact: modification_impact.current_value_impact,
      quality_assessment: %{
        installation_quality: modification_impact.installation_quality,
        visual_verification_score: modification_impact.visual_verification_score,
        documentation_quality: modification_impact.documentation_quality
      },
      market_factors: %{
        market_demand: modification_impact.market_demand,
        depreciation_rate: modification_impact.depreciation_rate,
        resale_factor: modification_impact.resale_factor
      }
    }
  end

  defp generate_modification_summary(modification_impacts) do
    total_value = modification_impacts
    |> Enum.map(&(&1.current_value_impact))
    |> Enum.reduce(Decimal.new("0"), &Decimal.add/2)

    performance_count = Enum.count(modification_impacts, &(&1.modification_type == "performance"))
    aesthetic_count = Enum.count(modification_impacts, &(&1.modification_type == "aesthetic"))
    functional_count = Enum.count(modification_impacts, &(&1.modification_type == "functional"))

    %{
      total_modification_value: total_value,
      modification_categories: %{
        performance: performance_count,
        aesthetic: aesthetic_count,
        functional: functional_count
      },
      average_quality_score: calculate_average_quality_score(modification_impacts),
      high_value_modifications: Enum.take(modification_impacts, 5)
    }
  end

  defp calculate_average_quality_score(modification_impacts) do
    if Enum.empty?(modification_impacts) do
      0.0
    else
      total_score = modification_impacts
      |> Enum.map(&(&1.visual_verification_score))
      |> Enum.sum()

      total_score / length(modification_impacts)
    end
  end

  defp get_vehicle_price_history(vehicle_id) do
    Repo.all(
      from ph in PriceHistory,
      where: ph.vehicle_id == ^vehicle_id,
      order_by: [desc: ph.valuation_date],
      limit: 50
    )
  end

  defp analyze_price_trends(price_history) do
    if length(price_history) < 2 do
      %{trend: "insufficient_data", change_percentage: 0.0}
    else
      latest = List.first(price_history)
      oldest = List.last(price_history)

      if latest && oldest do
        change = Decimal.sub(latest.estimated_value, oldest.estimated_value)
        change_percentage = Decimal.div(change, oldest.estimated_value)
        |> Decimal.mult(Decimal.new("100"))
        |> Decimal.to_float()

        trend = cond do
          change_percentage > 5.0 -> "increasing"
          change_percentage < -5.0 -> "decreasing"
          true -> "stable"
        end

        time_diff = Date.diff(latest.valuation_date, oldest.valuation_date)

        %{
          trend: trend,
          change_percentage: change_percentage,
          value_change: change,
          time_period_days: time_diff
        }
      else
        %{trend: "insufficient_data", change_percentage: 0.0}
      end
    end
  end

  defp format_error(%Ecto.Changeset{} = changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {key, value}, acc ->
        String.replace(acc, "%{#{key}}", to_string(value))
      end)
    end)
  end

  defp format_error(reason) when is_atom(reason), do: to_string(reason)
  defp format_error(reason) when is_binary(reason), do: reason
  defp format_error(reason), do: inspect(reason)

  # Mock pricing intelligence for frontend testing
  defp generate_mock_pricing_intelligence(vehicle) do
    base_value = calculate_base_value(vehicle)
    modification_value = :rand.uniform(5000) + 1000
    condition_adjustment = :rand.uniform(3000) - 1500
    market_factors = :rand.uniform(2000) - 1000
    rarity_multiplier = 1.0 + (:rand.uniform(30) / 100)

    total_value = (base_value + modification_value + condition_adjustment + market_factors) * rarity_multiplier

    %{
      total_estimated_value: Float.round(total_value, 2),
      confidence_score: 85 + :rand.uniform(15),
      valuation_breakdown: %{
        base_market_value: base_value,
        modification_impact: modification_value,
        condition_adjustment: condition_adjustment,
        market_factors: market_factors,
        rarity_multiplier: rarity_multiplier
      },
      visual_evidence: %{
        total_images: :rand.uniform(20) + 5,
        high_value_images: :rand.uniform(10) + 2,
        verification_quality: 75 + :rand.uniform(25)
      },
      value_drivers: %{
        key_modifications: ["Cold Air Intake", "Exhaust System", "Suspension Upgrade"],
        premium_brands: ["K&N", "Borla", "Eibach"],
        documented_work: :rand.uniform(10) + 3,
        image_count: :rand.uniform(20) + 5,
        verification_quality: 80 + :rand.uniform(20)
      },
      risk_factors: %{
        high_mileage: vehicle.mileage && vehicle.mileage > 150000,
        flood_damage: false,
        accident_history: :rand.uniform(100) < 15,
        modified_heavily: :rand.uniform(100) < 30,
        incomplete_documentation: :rand.uniform(100) < 20
      },
      market_comparables: generate_mock_comparables(vehicle)
    }
  end

  defp calculate_base_value(vehicle) do
    # Simple base value calculation based on year and make
    current_year = DateTime.utc_now().year
    age = current_year - vehicle.year

    base = case String.downcase(vehicle.make) do
      "bmw" -> 35000
      "mercedes" -> 40000
      "audi" -> 32000
      "lexus" -> 30000
      "toyota" -> 25000
      "honda" -> 22000
      "ford" -> 20000
      "chevrolet" -> 18000
      _ -> 20000
    end

    # Depreciation calculation
    depreciation_rate = 0.15
    depreciated_value = base * :math.pow(1 - depreciation_rate, age)

    # Mileage adjustment
    if vehicle.mileage do
      mileage_adjustment = max(0, 1 - (vehicle.mileage / 200000) * 0.3)
      depreciated_value * mileage_adjustment
    else
      depreciated_value
    end
    |> Float.round(2)
  end

  defp generate_mock_comparables(vehicle) do
    Enum.map(1..3, fn i ->
      %{
        source: "AutoTrader",
        listing_price: calculate_base_value(vehicle) + (:rand.uniform(10000) - 5000),
        mileage: (vehicle.mileage || 100000) + (:rand.uniform(50000) - 25000),
        location: "Within 50 miles",
        condition: Enum.random(["Excellent", "Good", "Fair"]),
        days_on_market: :rand.uniform(60) + 1,
        confidence_score: 75 + :rand.uniform(25)
      }
    end)
  end

  @doc """
  Get analysis status for a vehicle.

  GET /api/vehicles/:id/analysis-status

  Returns current status of automated pricing analysis.
  """
  def get_analysis_status(conn, %{"id" => vehicle_id}) do
    case Vehicles.get_vehicle(vehicle_id) do
      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Vehicle not found"})

      vehicle ->
        # Use our existing hook system to get status
        alias NukeApi.Pricing.VehicleCreationHook
        status = VehicleCreationHook.get_analysis_status(vehicle_id)

        conn
        |> json(status)
    end
  end

  @doc """
  Trigger manual analysis for a vehicle.

  POST /api/vehicles/:id/trigger-analysis

  Manually triggers pricing analysis for power users/admins.
  """
  def trigger_manual_analysis(conn, %{"id" => vehicle_id} = params) do
    case Vehicles.get_vehicle(vehicle_id) do
      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Vehicle not found"})

      _vehicle ->
        # Extract user ID from connection (you'll need to implement this based on your auth)
        user_id = get_current_user_id(conn) || "anonymous"

        # Trigger manual analysis
        alias NukeApi.Pricing.VehicleCreationHook
        case VehicleCreationHook.trigger_manual_analysis(vehicle_id, user_id, Map.drop(params, ["id"])) do
          {:ok, message} ->
            conn
            |> json(%{
              success: true,
              message: message,
              estimated_completion: DateTime.add(DateTime.utc_now(), 300, :second) # 5 minutes
            })

          {:error, reason} ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(%{error: reason})
        end
    end
  end

  @doc """
  Get human review queue.

  GET /api/pricing/human-review-queue

  Returns vehicles requiring human review for pricing.
  """
  def get_human_review_queue(conn, _params) do
    # TODO: Implement proper authorization check for reviewers/admins
    alias NukeApi.Pricing.HumanOversight
    queue = HumanOversight.get_human_review_queue()

    conn
    |> json(%{
      queue: queue,
      total_pending: length(queue),
      estimated_review_time: calculate_total_review_time(queue)
    })
  end

  @doc """
  Submit pricing override.

  POST /api/vehicles/:id/pricing-override

  Allows experts to override AI pricing with human judgment.
  """
  def submit_pricing_override(conn, %{"id" => vehicle_id} = params) do
    case Vehicles.get_vehicle(vehicle_id) do
      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Vehicle not found"})

      _vehicle ->
        user_id = get_current_user_id(conn) || "anonymous"

        override_data = %{
          override_value: params["override_value"],
          override_reason: params["override_reason"],
          confidence_adjustment: params["confidence_adjustment"],
          notes: params["notes"]
        }

        alias NukeApi.Pricing.HumanOversight
        case HumanOversight.override_vehicle_valuation(vehicle_id, override_data, user_id) do
          {:ok, override_record} ->
            conn
            |> json(%{
              success: true,
              override: override_record,
              message: "Pricing override applied successfully"
            })

          {:error, reason} ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(%{error: reason})
        end
    end
  end

  # Private helper functions

  defp get_current_user_id(conn) do
    # Extract user ID from your authentication system
    # This is a placeholder - implement based on your auth setup
    conn.assigns[:current_user_id] || conn.assigns[:user_id]
  end

  defp calculate_total_review_time(queue) do
    queue
    |> Enum.map(& &1[:estimated_review_time] || 15)
    |> Enum.sum()
  end
end