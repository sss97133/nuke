defmodule NukeApi.Pricing.EquationEngine do
  @moduledoc """
  Configurable pricing equation system that combines multiple data sources
  with human-defined rules and AI insights to generate vehicle valuations.

  This system allows humans to:
  1. Define custom pricing equations
  2. Set weight factors for different data sources
  3. Configure AI influence levels
  4. Override specific calculations
  5. Track equation performance over time
  """

  alias NukeApi.AI.OpenAIClient
  alias NukeApi.Pricing.MarketDataScraper
  require Logger

  defstruct [
    :base_equation,
    :market_weight,
    :ai_weight,
    :modification_weight,
    :condition_weight,
    :human_override_weight,
    :confidence_threshold,
    :enabled_factors,
    :custom_multipliers
  ]

  @doc """
  Creates a new pricing equation configuration.
  """
  def new(config \\ []) do
    %__MODULE__{
      base_equation: Keyword.get(config, :base_equation, :standard),
      market_weight: Keyword.get(config, :market_weight, 0.4),
      ai_weight: Keyword.get(config, :ai_weight, 0.3),
      modification_weight: Keyword.get(config, :modification_weight, 0.2),
      condition_weight: Keyword.get(config, :condition_weight, 0.1),
      human_override_weight: Keyword.get(config, :human_override_weight, 1.0),
      confidence_threshold: Keyword.get(config, :confidence_threshold, 75),
      enabled_factors: Keyword.get(config, :enabled_factors, [:market, :ai, :modifications, :condition]),
      custom_multipliers: Keyword.get(config, :custom_multipliers, %{})
    }
  end

  @doc """
  Calculate comprehensive vehicle valuation using configured equation.
  """
  def calculate_valuation(engine, vehicle, opts \\ []) do
    Logger.info("Starting automated valuation for #{vehicle.year} #{vehicle.make} #{vehicle.model}")

    # Gather all data sources in parallel
    data_sources = gather_data_sources(vehicle, opts)

    # Calculate base valuation using selected equation
    base_valuation = calculate_base_valuation(engine, vehicle, data_sources)

    # Apply AI analysis if enabled
    ai_adjustments = if :ai in engine.enabled_factors do
      apply_ai_analysis(engine, vehicle, data_sources)
    else
      %{adjustment: 0, confidence: 100, reasoning: "AI analysis disabled"}
    end

    # Calculate final valuation
    final_valuation = combine_valuations(engine, base_valuation, ai_adjustments, data_sources)

    # Generate comprehensive report
    generate_valuation_report(engine, vehicle, final_valuation, data_sources, ai_adjustments)
  end

  @doc """
  Update equation configuration based on performance feedback.
  """
  def update_configuration(engine, performance_data) do
    # Analyze performance and suggest improvements
    suggestions = analyze_performance(performance_data)

    # Apply automatic adjustments if confidence is low
    adjusted_engine = if should_auto_adjust?(performance_data) do
      apply_auto_adjustments(engine, suggestions)
    else
      engine
    end

    {:ok, adjusted_engine, suggestions}
  end

  @doc """
  Get human-interpretable explanation of valuation calculation.
  """
  def explain_valuation(valuation_result) do
    %{
      total_value: valuation_result.final_value,
      confidence: valuation_result.confidence_score,
      breakdown: %{
        base_market_value: valuation_result.base_value,
        ai_adjustments: valuation_result.ai_adjustment,
        modification_impact: valuation_result.modification_value,
        condition_factors: valuation_result.condition_adjustment,
        human_overrides: valuation_result.human_adjustments
      },
      key_factors: valuation_result.value_drivers,
      risk_assessment: valuation_result.risk_factors,
      data_quality: %{
        market_data_points: length(valuation_result.market_data),
        ai_confidence: valuation_result.ai_confidence,
        image_analysis_quality: valuation_result.visual_evidence_score
      },
      recommendations: valuation_result.recommendations
    }
  end

  # Private functions

  defp gather_data_sources(vehicle, opts) do
    # Start all data gathering in parallel for speed
    tasks = [
      Task.async(fn -> gather_market_data(vehicle, opts) end),
      Task.async(fn -> gather_modification_data(vehicle, opts) end),
      Task.async(fn -> gather_condition_data(vehicle, opts) end),
      Task.async(fn -> gather_historical_data(vehicle, opts) end)
    ]

    [market_data, modification_data, condition_data, historical_data] =
      Task.await_many(tasks, 30_000)

    %{
      market: market_data,
      modifications: modification_data,
      condition: condition_data,
      historical: historical_data,
      timestamp: DateTime.utc_now()
    }
  end

  defp gather_market_data(vehicle, opts) do
    case MarketDataScraper.scrape_comparable_vehicles(vehicle, opts) do
      {:ok, data} ->
        Logger.info("Gathered #{length(data)} market data points")
        data
      {:error, reason} ->
        Logger.warn("Market data gathering failed: #{inspect(reason)}")
        []
    end
  end

  defp gather_modification_data(vehicle, _opts) do
    # Extract modifications from vehicle images and tags
    modifications = extract_modifications_from_vehicle(vehicle)

    # Enhance with market value data for each modification
    Enum.map(modifications, &enhance_modification_data/1)
  end

  defp gather_condition_data(vehicle, _opts) do
    # Analyze vehicle condition from available data
    %{
      mileage_factor: calculate_mileage_factor(vehicle),
      age_factor: calculate_age_factor(vehicle),
      maintenance_indicators: extract_maintenance_indicators(vehicle),
      damage_indicators: extract_damage_indicators(vehicle)
    }
  end

  defp gather_historical_data(vehicle, _opts) do
    # Get price history and trend data
    %{
      price_trends: get_price_trends(vehicle),
      market_cycles: get_market_cycles(vehicle),
      seasonal_patterns: get_seasonal_patterns(vehicle)
    }
  end

  defp calculate_base_valuation(engine, vehicle, data_sources) do
    case engine.base_equation do
      :standard -> standard_equation(vehicle, data_sources)
      :luxury -> luxury_equation(vehicle, data_sources)
      :classic -> classic_equation(vehicle, data_sources)
      :modified -> modified_equation(vehicle, data_sources)
      custom when is_function(custom, 2) -> custom.(vehicle, data_sources)
      _ -> standard_equation(vehicle, data_sources)
    end
  end

  defp standard_equation(vehicle, data_sources) do
    # Base market value from comparable sales
    base_market = calculate_market_base(vehicle, data_sources.market)

    # Apply depreciation
    depreciated_value = apply_depreciation(base_market, vehicle)

    # Mileage adjustment
    mileage_adjusted = apply_mileage_adjustment(depreciated_value, vehicle)

    # Condition adjustment
    condition_adjusted = apply_condition_adjustment(mileage_adjusted, data_sources.condition)

    %{
      base_value: condition_adjusted,
      calculation_method: :standard,
      confidence: calculate_base_confidence(data_sources),
      factors_applied: [:market, :depreciation, :mileage, :condition]
    }
  end

  defp luxury_equation(vehicle, data_sources) do
    # Different equation for luxury vehicles (slower depreciation, brand premium)
    base_result = standard_equation(vehicle, data_sources)
    luxury_multiplier = get_luxury_multiplier(vehicle.make)

    %{base_result |
      base_value: base_result.base_value * luxury_multiplier,
      calculation_method: :luxury,
      factors_applied: base_result.factors_applied ++ [:luxury_premium]
    }
  end

  defp classic_equation(vehicle, data_sources) do
    # Classic/collector car equation (appreciation potential)
    current_year = DateTime.utc_now().year
    age = current_year - vehicle.year

    if age >= 25 do
      # Classic car appreciation model
      base_result = standard_equation(vehicle, data_sources)
      classic_multiplier = calculate_classic_multiplier(vehicle, age)

      %{base_result |
        base_value: base_result.base_value * classic_multiplier,
        calculation_method: :classic,
        factors_applied: base_result.factors_applied ++ [:classic_appreciation]
      }
    else
      standard_equation(vehicle, data_sources)
    end
  end

  defp modified_equation(vehicle, data_sources) do
    # Specialized equation for heavily modified vehicles
    base_result = standard_equation(vehicle, data_sources)

    # Calculate modification synergy bonuses
    synergy_bonus = calculate_modification_synergy(data_sources.modifications)

    # Apply build quality multipliers
    quality_multiplier = calculate_build_quality_multiplier(data_sources.modifications)

    modification_value = data_sources.modifications
    |> Enum.map(&(&1.estimated_value))
    |> Enum.sum()
    |> Kernel.*(0.6) # Modifications typically retain 60% of cost
    |> Kernel.*(quality_multiplier)
    |> Kernel.+(synergy_bonus)

    %{base_result |
      base_value: base_result.base_value + modification_value,
      calculation_method: :modified,
      factors_applied: base_result.factors_applied ++ [:modifications, :synergy, :build_quality]
    }
  end

  defp apply_ai_analysis(engine, vehicle, data_sources) do
    client = OpenAIClient.new()

    case OpenAIClient.analyze_vehicle_pricing(client, vehicle, data_sources.market, data_sources.modifications) do
      {:ok, ai_result} ->
        # Weight AI recommendations based on configuration
        adjustment = (ai_result["estimated_value"] || 0) * engine.ai_weight

        %{
          adjustment: adjustment,
          confidence: ai_result["confidence_score"] || 50,
          reasoning: ai_result["recommendations"] || [],
          value_drivers: ai_result["value_drivers"] || [],
          risk_factors: ai_result["risk_factors"] || []
        }

      {:error, reason} ->
        Logger.warn("AI analysis failed: #{inspect(reason)}")
        %{adjustment: 0, confidence: 0, reasoning: ["AI analysis unavailable"], value_drivers: [], risk_factors: []}
    end
  end

  defp combine_valuations(engine, base_valuation, ai_adjustments, data_sources) do
    # Weighted combination of all valuation sources
    market_component = base_valuation.base_value * engine.market_weight
    ai_component = ai_adjustments.adjustment * engine.ai_weight

    # Apply human overrides if present
    human_overrides = get_human_overrides(data_sources)
    override_component = human_overrides * engine.human_override_weight

    final_value = market_component + ai_component + override_component

    # Calculate overall confidence
    confidence = calculate_overall_confidence([
      {base_valuation.confidence, engine.market_weight},
      {ai_adjustments.confidence, engine.ai_weight},
      {100, engine.human_override_weight} # Human overrides are 100% confident
    ])

    %{
      final_value: final_value,
      confidence_score: confidence,
      components: %{
        market: market_component,
        ai: ai_component,
        human_override: override_component
      },
      calculation_timestamp: DateTime.utc_now()
    }
  end

  defp generate_valuation_report(engine, vehicle, final_valuation, data_sources, ai_adjustments) do
    %{
      vehicle_id: vehicle.id,
      final_value: final_valuation.final_value,
      confidence_score: final_valuation.confidence_score,

      valuation_breakdown: %{
        base_market_value: final_valuation.components.market,
        ai_adjustment: final_valuation.components.ai,
        human_overrides: final_valuation.components.human_override
      },

      data_quality: %{
        market_data_points: length(data_sources.market),
        ai_confidence: ai_adjustments.confidence,
        data_freshness_hours: calculate_data_age(data_sources.timestamp)
      },

      value_drivers: ai_adjustments.value_drivers,
      risk_factors: ai_adjustments.risk_factors,
      recommendations: ai_adjustments.reasoning,

      equation_config: %{
        base_equation: engine.base_equation,
        weights: %{
          market: engine.market_weight,
          ai: engine.ai_weight,
          modifications: engine.modification_weight,
          condition: engine.condition_weight
        }
      },

      generated_at: DateTime.utc_now()
    }
  end

  # Helper functions

  defp extract_modifications_from_vehicle(vehicle) do
    # Extract modifications from vehicle images and tags
    # This would integrate with your existing tagging system
    []
  end

  defp enhance_modification_data(modification) do
    # Add market value data for modifications
    modification
  end

  defp calculate_mileage_factor(vehicle) do
    case vehicle.mileage do
      nil -> 1.0
      mileage when mileage < 50000 -> 1.1
      mileage when mileage < 100000 -> 1.0
      mileage when mileage < 150000 -> 0.9
      _ -> 0.8
    end
  end

  defp calculate_age_factor(vehicle) do
    current_year = DateTime.utc_now().year
    age = current_year - vehicle.year
    max(0.1, 1.0 - (age * 0.05))
  end

  defp extract_maintenance_indicators(_vehicle), do: []
  defp extract_damage_indicators(_vehicle), do: []
  defp get_price_trends(_vehicle), do: []
  defp get_market_cycles(_vehicle), do: []
  defp get_seasonal_patterns(_vehicle), do: []

  defp calculate_market_base(_vehicle, market_data) do
    if Enum.empty?(market_data) do
      20000 # Default fallback
    else
      # Calculate weighted average of comparable vehicles
      market_data
      |> Enum.map(&(&1.price))
      |> Enum.sum()
      |> Kernel./(length(market_data))
    end
  end

  defp apply_depreciation(base_value, vehicle) do
    current_year = DateTime.utc_now().year
    age = current_year - vehicle.year
    depreciation_rate = 0.15

    base_value * :math.pow(1 - depreciation_rate, age)
  end

  defp apply_mileage_adjustment(value, vehicle) do
    value * calculate_mileage_factor(vehicle)
  end

  defp apply_condition_adjustment(value, condition_data) do
    # Apply condition-based adjustments
    value * (condition_data.mileage_factor * condition_data.age_factor)
  end

  defp calculate_base_confidence(data_sources) do
    market_points = length(data_sources.market)

    cond do
      market_points >= 10 -> 95
      market_points >= 5 -> 85
      market_points >= 2 -> 75
      market_points >= 1 -> 60
      true -> 40
    end
  end

  defp get_luxury_multiplier(make) do
    case String.downcase(make) do
      "mercedes" -> 1.2
      "bmw" -> 1.15
      "audi" -> 1.1
      "lexus" -> 1.1
      "porsche" -> 1.3
      "ferrari" -> 2.0
      "lamborghini" -> 2.2
      _ -> 1.0
    end
  end

  defp calculate_classic_multiplier(vehicle, age) do
    # Classic car appreciation model
    base_multiplier = 1.0 + ((age - 25) * 0.02)

    # Brand-specific multipliers for classics
    brand_multiplier = case String.downcase(vehicle.make) do
      "porsche" -> 1.5
      "ferrari" -> 2.0
      "corvette" -> 1.3
      "mustang" -> 1.2
      _ -> 1.0
    end

    base_multiplier * brand_multiplier
  end

  defp calculate_modification_synergy(_modifications) do
    # Calculate bonus for complementary modifications
    0
  end

  defp calculate_build_quality_multiplier(_modifications) do
    # Quality assessment based on installation and parts
    1.0
  end

  defp get_human_overrides(_data_sources) do
    # Get any human-set overrides for this valuation
    0
  end

  defp calculate_overall_confidence(weighted_confidences) do
    total_weight = weighted_confidences |> Enum.map(&elem(&1, 1)) |> Enum.sum()

    if total_weight > 0 do
      weighted_confidences
      |> Enum.map(fn {confidence, weight} -> confidence * weight end)
      |> Enum.sum()
      |> Kernel./(total_weight)
      |> round()
    else
      50
    end
  end

  defp calculate_data_age(timestamp) do
    DateTime.diff(DateTime.utc_now(), timestamp, :second) / 3600
  end

  defp analyze_performance(_performance_data) do
    # Analyze equation performance and suggest improvements
    []
  end

  defp should_auto_adjust?(_performance_data) do
    false
  end

  defp apply_auto_adjustments(engine, _suggestions) do
    engine
  end
end