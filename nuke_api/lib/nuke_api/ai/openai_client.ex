defmodule NukeApi.AI.OpenAIClient do
  @moduledoc """
  OpenAI API client for automated vehicle analysis and pricing intelligence.

  This module handles intelligent prompts for:
  - Vehicle valuation analysis
  - Modification impact assessment
  - Market trend analysis
  - Risk factor identification
  """

  require Logger

  @base_url "https://api.openai.com/v1"
  @default_model "gpt-4o"

  defstruct [:api_key, :model, :temperature, :max_tokens]

  def new(opts \\ []) do
    %__MODULE__{
      api_key: get_api_key(),
      model: Keyword.get(opts, :model, @default_model),
      temperature: Keyword.get(opts, :temperature, 0.3),
      max_tokens: Keyword.get(opts, :max_tokens, 1500)
    }
  end

  @doc """
  Analyze vehicle using documentation-based valuation system.

  This function focuses on timeline events, image progression, and
  work verification rather than basic vehicle specs.
  """
  def analyze_vehicle_pricing(client, vehicle, timeline_events \\ [], images \\ []) do
    # Use configurable prompt system
    prompt = NukeApi.Valuation.PromptConfiguration.build_valuation_prompt(
      vehicle,
      timeline_events,
      images
    )

    case chat_completion(client, prompt) do
      {:ok, response} ->
        parse_documentation_response(response)
      {:error, reason} ->
        Logger.error("Documentation analysis failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Analyze vehicle modifications and their impact on value.
  """
  def analyze_modifications(client, vehicle, modifications, images \\ []) do
    prompt = build_modification_analysis_prompt(vehicle, modifications, images)

    case chat_completion(client, prompt) do
      {:ok, response} ->
        parse_modification_response(response)
      {:error, reason} ->
        Logger.error("OpenAI modification analysis failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Analyze market trends and provide pricing recommendations.
  """
  def analyze_market_trends(client, vehicle, comparable_data) do
    prompt = build_market_analysis_prompt(vehicle, comparable_data)

    case chat_completion(client, prompt) do
      {:ok, response} ->
        parse_market_response(response)
      {:error, reason} ->
        Logger.error("OpenAI market analysis failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Generate risk assessment for vehicle pricing.
  """
  def assess_pricing_risks(client, vehicle, condition_data, history_data) do
    prompt = build_risk_assessment_prompt(vehicle, condition_data, history_data)

    case chat_completion(client, prompt) do
      {:ok, response} ->
        parse_risk_response(response)
      {:error, reason} ->
        Logger.error("OpenAI risk assessment failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  # Private functions

  defp chat_completion(client, prompt) do
    headers = [
      {"Authorization", "Bearer #{client.api_key}"},
      {"Content-Type", "application/json"}
    ]

    body = %{
      model: client.model,
      messages: [
        %{
          role: "system",
          content: get_system_prompt()
        },
        %{
          role: "user",
          content: prompt
        }
      ],
      temperature: client.temperature,
      max_tokens: client.max_tokens,
      response_format: %{type: "json_object"}
    }

    case HTTPoison.post("#{@base_url}/chat/completions", Jason.encode!(body), headers) do
      {:ok, %HTTPoison.Response{status_code: 200, body: response_body}} ->
        case Jason.decode(response_body) do
          {:ok, %{"choices" => [%{"message" => %{"content" => content}} | _]}} ->
            {:ok, content}
          error ->
            {:error, "Failed to parse OpenAI response: #{inspect(error)}"}
        end
      {:ok, %HTTPoison.Response{status_code: status_code, body: body}} ->
        {:error, "OpenAI API error #{status_code}: #{body}"}
      {:error, %HTTPoison.Error{reason: reason}} ->
        {:error, "HTTP request failed: #{inspect(reason)}"}
    end
  end

  defp get_system_prompt do
    # Use configurable system prompt
    config = NukeApi.Valuation.PromptConfiguration.get_valuation_prompt_config()
    config.system_prompt
  end

  defp parse_documentation_response(response) do
    case Jason.decode(response) do
      {:ok, parsed} ->
        # Convert documentation analysis to expected pricing intelligence format
        documentation_to_pricing_format(parsed)
      {:error, reason} ->
        Logger.error("Failed to parse documentation response: #{inspect(reason)}")
        {:error, "Invalid response format"}
    end
  end

  defp documentation_to_pricing_format(doc_analysis) do
    # Convert documentation analysis to pricing intelligence format
    # This maintains compatibility with existing frontend
    {:ok, %{
      estimated_value: doc_analysis["estimated_restoration_investment"] || 0,
      confidence_score: doc_analysis["verification_confidence"] || 0,
      market_position: determine_market_position(doc_analysis["documentation_score"]),
      key_points: build_key_points(doc_analysis),
      documentation_analysis: doc_analysis  # Include full analysis
    }}
  end

  defp determine_market_position(doc_score) when doc_score >= 80, do: "Premium - Well Documented"
  defp determine_market_position(doc_score) when doc_score >= 60, do: "Above Average - Documented"
  defp determine_market_position(doc_score) when doc_score >= 40, do: "Average - Partially Documented"
  defp determine_market_position(_), do: "Below Average - Undocumented"

  defp build_key_points(analysis) do
    points = []

    # Add documentation level
    points = ["Documentation level: #{analysis["verification_level"] || "Unknown"}" | points]

    # Add verification strengths
    if analysis["verification_strengths"] do
      points = analysis["verification_strengths"] ++ points
    end

    # Add any red flags
    if analysis["red_flags"] && length(analysis["red_flags"]) > 0 do
      points = ["⚠️ Issues: #{Enum.join(analysis["red_flags"], ", ")}" | points]
    end

    points
  end

  defp build_pricing_analysis_prompt(vehicle, market_data, modifications) do
    """
    Analyze the following vehicle for comprehensive pricing intelligence:

    VEHICLE DETAILS:
    - Year: #{vehicle.year}
    - Make: #{vehicle.make}
    - Model: #{vehicle.model}
    - Trim: #{vehicle.trim || "Standard"}
    - Mileage: #{vehicle.mileage || "Unknown"} miles
    - Color: #{vehicle.color || "Unknown"}
    - VIN: #{vehicle.vin || "Not provided"}

    MARKET DATA:
    #{format_market_data(market_data)}

    MODIFICATIONS:
    #{format_modifications(modifications)}

    Please provide a comprehensive pricing analysis in the following JSON format:
    {
      "estimated_value": 0,
      "confidence_score": 0,
      "valuation_breakdown": {
        "base_market_value": 0,
        "modification_impact": 0,
        "condition_adjustment": 0,
        "market_factors": 0,
        "rarity_multiplier": 1.0
      },
      "value_drivers": [
        "List key factors increasing value"
      ],
      "risk_factors": [
        "List factors that may decrease value or create risk"
      ],
      "market_position": "excellent|good|fair|poor",
      "recommendations": [
        "Actionable recommendations for maximizing value"
      ],
      "comparable_analysis": {
        "similar_vehicles_found": 0,
        "price_range_low": 0,
        "price_range_high": 0,
        "market_trend": "increasing|stable|decreasing"
      }
    }
    """
  end

  defp build_modification_analysis_prompt(vehicle, modifications, images) do
    """
    Analyze the modifications on this vehicle and their impact on value:

    VEHICLE: #{vehicle.year} #{vehicle.make} #{vehicle.model}
    MILEAGE: #{vehicle.mileage || "Unknown"} miles

    MODIFICATIONS:
    #{format_modifications(modifications)}

    IMAGES: #{length(images)} images available for analysis

    Provide detailed modification analysis in JSON format:
    {
      "total_modification_impact": 0,
      "modification_analysis": [
        {
          "modification": "name",
          "category": "performance|aesthetic|functional",
          "brand": "brand name",
          "estimated_cost": 0,
          "value_impact": 0,
          "quality_assessment": "professional|good|poor",
          "market_demand": "high|medium|low",
          "installation_quality": "excellent|good|fair|poor",
          "documentation_score": 0
        }
      ],
      "synergy_bonus": 0,
      "overall_quality_score": 0,
      "recommendations": []
    }
    """
  end

  defp build_market_analysis_prompt(vehicle, comparable_data) do
    """
    Analyze current market conditions for this vehicle:

    VEHICLE: #{vehicle.year} #{vehicle.make} #{vehicle.model}

    COMPARABLE SALES DATA:
    #{format_comparable_data(comparable_data)}

    Provide market analysis in JSON format:
    {
      "market_strength": "strong|moderate|weak",
      "trend_direction": "increasing|stable|decreasing",
      "price_momentum": 0,
      "seasonal_factors": [],
      "supply_demand_balance": "high_demand|balanced|oversupply",
      "recommended_pricing_strategy": "premium|market|aggressive",
      "optimal_selling_timeframe": "immediate|1-3_months|3-6_months|hold",
      "market_risks": [],
      "market_opportunities": []
    }
    """
  end

  defp build_risk_assessment_prompt(vehicle, condition_data, history_data) do
    """
    Assess pricing risks for this vehicle:

    VEHICLE: #{vehicle.year} #{vehicle.make} #{vehicle.model}
    MILEAGE: #{vehicle.mileage || "Unknown"}

    CONDITION DATA:
    #{format_condition_data(condition_data)}

    HISTORY DATA:
    #{format_history_data(history_data)}

    Provide risk assessment in JSON format:
    {
      "overall_risk_level": "low|moderate|high",
      "risk_factors": [
        {
          "factor": "name",
          "severity": "low|medium|high",
          "impact_on_value": 0,
          "mitigation_strategies": []
        }
      ],
      "red_flags": [],
      "positive_indicators": [],
      "insurance_considerations": [],
      "financing_impact": "positive|neutral|negative"
    }
    """
  end

  # Response parsing functions

  defp parse_pricing_response(content) do
    case Jason.decode(content) do
      {:ok, data} -> {:ok, data}
      {:error, _} -> {:error, "Failed to parse pricing analysis response"}
    end
  end

  defp parse_modification_response(content) do
    case Jason.decode(content) do
      {:ok, data} -> {:ok, data}
      {:error, _} -> {:error, "Failed to parse modification analysis response"}
    end
  end

  defp parse_market_response(content) do
    case Jason.decode(content) do
      {:ok, data} -> {:ok, data}
      {:error, _} -> {:error, "Failed to parse market analysis response"}
    end
  end

  defp parse_risk_response(content) do
    case Jason.decode(content) do
      {:ok, data} -> {:ok, data}
      {:error, _} -> {:error, "Failed to parse risk assessment response"}
    end
  end

  # Helper formatting functions

  defp format_market_data(market_data) when is_list(market_data) do
    market_data
    |> Enum.map_join("\n", fn data ->
      "- #{data.source}: $#{data.price} (#{data.mileage} miles, #{data.condition})"
    end)
  end
  defp format_market_data(_), do: "No market data available"

  defp format_modifications(modifications) when is_list(modifications) do
    modifications
    |> Enum.map_join("\n", fn mod ->
      "- #{mod.name} (#{mod.category}): #{mod.brand || "Unknown brand"}"
    end)
  end
  defp format_modifications(_), do: "No modifications listed"

  defp format_comparable_data(comparable_data) when is_list(comparable_data) do
    comparable_data
    |> Enum.map_join("\n", fn comp ->
      "- $#{comp.price} - #{comp.mileage} miles - #{comp.location} - #{comp.condition}"
    end)
  end
  defp format_comparable_data(_), do: "No comparable data available"

  defp format_condition_data(condition_data) when is_map(condition_data) do
    condition_data
    |> Enum.map_join("\n", fn {key, value} ->
      "- #{key}: #{value}"
    end)
  end
  defp format_condition_data(_), do: "No condition data available"

  defp format_history_data(history_data) when is_map(history_data) do
    history_data
    |> Enum.map_join("\n", fn {key, value} ->
      "- #{key}: #{value}"
    end)
  end
  defp format_history_data(_), do: "No history data available"

  defp get_api_key do
    System.get_env("OPENAI_API_KEY") ||
      Application.get_env(:nuke_api, :openai_api_key) ||
      raise "OpenAI API key not configured. Set OPENAI_API_KEY environment variable."
  end
end