defmodule NukeApi.Pricing.AutomatedAnalyst do
  @moduledoc """
  Automated vehicle analysis system that triggers intelligent pricing
  when vehicle profiles are created or updated.

  This system:
  1. Automatically analyzes new vehicles using AI + market data
  2. Provides human-reviewable pricing estimates
  3. Flags vehicles needing human attention
  4. Tracks accuracy and improves over time
  5. Empowers humans with AI-enhanced insights
  """

  use GenServer
  require Logger

  alias NukeApi.AI.OpenAIClient
  alias NukeApi.Pricing.{EquationEngine, MarketDataScraper}
  alias NukeApi.Vehicles
  alias NukeApi.Repo

  # GenServer for background processing
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc """
  Trigger automated analysis for a vehicle (called when vehicle is created/updated).
  """
  def analyze_vehicle(vehicle_id, opts \\ []) do
    GenServer.cast(__MODULE__, {:analyze_vehicle, vehicle_id, opts})
  end

  @doc """
  Get analysis results for a vehicle.
  """
  def get_analysis(vehicle_id) do
    GenServer.call(__MODULE__, {:get_analysis, vehicle_id})
  end

  @doc """
  Update human feedback on analysis accuracy.
  """
  def submit_feedback(vehicle_id, feedback) do
    GenServer.cast(__MODULE__, {:feedback, vehicle_id, feedback})
  end

  # GenServer callbacks

  def init(opts) do
    # Initialize pricing equation engine with default configuration
    equation_config = Keyword.get(opts, :equation_config, [])
    equation_engine = EquationEngine.new(equation_config)

    state = %{
      equation_engine: equation_engine,
      analysis_cache: %{},
      feedback_history: []
    }

    Logger.info("Automated Analyst started with configuration: #{inspect(equation_config)}")
    {:ok, state}
  end

  def handle_cast({:analyze_vehicle, vehicle_id, opts}, state) do
    # Process analysis in background to avoid blocking
    Task.start(fn -> perform_vehicle_analysis(vehicle_id, opts, state.equation_engine) end)
    {:noreply, state}
  end

  def handle_cast({:feedback, vehicle_id, feedback}, state) do
    # Record human feedback for machine learning
    feedback_entry = %{
      vehicle_id: vehicle_id,
      feedback: feedback,
      timestamp: DateTime.utc_now()
    }

    new_feedback_history = [feedback_entry | state.feedback_history]

    # Update equation engine based on feedback
    {:ok, updated_engine, _suggestions} = EquationEngine.update_configuration(
      state.equation_engine,
      new_feedback_history
    )

    {:noreply, %{state |
      equation_engine: updated_engine,
      feedback_history: new_feedback_history
    }}
  end

  def handle_call({:get_analysis, vehicle_id}, _from, state) do
    analysis = Map.get(state.analysis_cache, vehicle_id)
    {:reply, analysis, state}
  end

  # Core analysis functions

  defp perform_vehicle_analysis(vehicle_id, opts, equation_engine) do
    Logger.info("Starting automated analysis for vehicle #{vehicle_id}")

    case Vehicles.get_vehicle_with_images_and_tags(vehicle_id) do
      nil ->
        Logger.error("Vehicle #{vehicle_id} not found for analysis")

      vehicle ->
        try do
          analysis_result = run_comprehensive_analysis(vehicle, opts, equation_engine)
          store_analysis_result(vehicle_id, analysis_result)
          maybe_notify_humans(vehicle, analysis_result)

          Logger.info("Completed automated analysis for #{vehicle.year} #{vehicle.make} #{vehicle.model}")
        rescue
          error ->
            Logger.error("Analysis failed for vehicle #{vehicle_id}: #{inspect(error)}")
            store_analysis_error(vehicle_id, error)
        end
    end
  end

  defp run_comprehensive_analysis(vehicle, opts, equation_engine) do
    Logger.info("Running comprehensive analysis for #{vehicle.year} #{vehicle.make} #{vehicle.model}")

    # Step 1: Gather market data
    Logger.info("Step 1: Gathering market data...")
    market_data_task = Task.async(fn ->
      case MarketDataScraper.get_market_data(vehicle, opts) do
        {:ok, data} -> data
        {:error, reason} ->
          Logger.warn("Market data failed: #{inspect(reason)}")
          []
      end
    end)

    # Step 2: Analyze images and modifications
    Logger.info("Step 2: Analyzing vehicle images and modifications...")
    image_analysis_task = Task.async(fn -> analyze_vehicle_images(vehicle) end)

    # Step 3: Run AI analysis
    Logger.info("Step 3: Running OpenAI analysis...")
    ai_analysis_task = Task.async(fn -> run_ai_analysis(vehicle, opts) end)

    # Wait for all parallel tasks
    market_data = Task.await(market_data_task, 60_000)
    image_analysis = Task.await(image_analysis_task, 30_000)
    ai_analysis = Task.await(ai_analysis_task, 45_000)

    # Step 4: Calculate valuation using equation engine
    Logger.info("Step 4: Calculating comprehensive valuation...")
    valuation_opts = Keyword.merge(opts, [
      market_data: market_data,
      image_analysis: image_analysis,
      ai_analysis: ai_analysis
    ])

    valuation_result = EquationEngine.calculate_valuation(equation_engine, vehicle, valuation_opts)

    # Step 5: Generate human-readable report
    Logger.info("Step 5: Generating analysis report...")
    comprehensive_report = generate_comprehensive_report(vehicle, %{
      valuation: valuation_result,
      market_data: market_data,
      image_analysis: image_analysis,
      ai_analysis: ai_analysis
    })

    comprehensive_report
  end

  defp analyze_vehicle_images(vehicle) do
    images = vehicle.images || []

    analysis = %{
      total_images: length(images),
      high_quality_images: count_high_quality_images(images),
      modification_evidence: extract_modification_evidence(images),
      condition_indicators: extract_condition_indicators(images),
      documentation_score: calculate_documentation_score(images)
    }

    Logger.info("Image analysis complete: #{analysis.total_images} images, quality score: #{analysis.documentation_score}")
    analysis
  end

  defp run_ai_analysis(vehicle, opts) do
    client = OpenAIClient.new()

    # Gather comprehensive data for AI analysis
    market_data = Keyword.get(opts, :market_data, [])
    modifications = extract_modifications_from_vehicle(vehicle)

    Logger.info("Running AI analysis with #{length(market_data)} market data points and #{length(modifications)} modifications")

    case OpenAIClient.analyze_vehicle_pricing(client, vehicle, market_data, modifications) do
      {:ok, ai_result} ->
        Logger.info("AI analysis complete with #{ai_result["confidence_score"]}% confidence")
        ai_result

      {:error, reason} ->
        Logger.warn("AI analysis failed: #{inspect(reason)}")
        %{
          "error" => reason,
          "confidence_score" => 0,
          "estimated_value" => 0,
          "recommendations" => ["AI analysis unavailable"]
        }
    end
  end

  defp generate_comprehensive_report(vehicle, analysis_data) do
    %{
      vehicle_id: vehicle.id,
      vehicle_info: %{
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        trim: vehicle.trim,
        mileage: vehicle.mileage
      },

      # Core valuation results
      valuation_summary: %{
        estimated_value: analysis_data.valuation.final_value,
        confidence_score: analysis_data.valuation.confidence_score,
        valuation_range: calculate_valuation_range(analysis_data.valuation),
        last_updated: DateTime.utc_now()
      },

      # Detailed breakdown
      valuation_breakdown: analysis_data.valuation.valuation_breakdown,

      # Data sources and quality
      data_sources: %{
        market_data_points: length(analysis_data.market_data),
        ai_analysis_confidence: analysis_data.ai_analysis["confidence_score"] || 0,
        image_documentation_score: analysis_data.image_analysis.documentation_score,
        total_data_quality: calculate_overall_data_quality(analysis_data)
      },

      # Key insights
      key_insights: %{
        value_drivers: analysis_data.ai_analysis["value_drivers"] || [],
        risk_factors: analysis_data.ai_analysis["risk_factors"] || [],
        market_position: analysis_data.ai_analysis["market_position"] || "unknown",
        modification_impact: calculate_modification_impact(analysis_data.image_analysis)
      },

      # Human action items
      human_review_needed: determine_human_review_needed(analysis_data),
      confidence_flags: generate_confidence_flags(analysis_data),
      recommended_actions: generate_recommended_actions(analysis_data),

      # Analysis metadata
      analysis_metadata: %{
        analysis_version: "1.0",
        processing_time_ms: 0, # TODO: Track processing time
        data_freshness: calculate_data_freshness(analysis_data),
        generated_at: DateTime.utc_now()
      }
    }
  end

  # Helper functions for image analysis

  defp count_high_quality_images(images) do
    Enum.count(images, fn image ->
      # Determine image quality based on available metadata
      has_good_resolution = image.file_size && image.file_size > 100_000
      has_tags = image.tags && length(image.tags) > 0
      is_primary = image.is_primary

      has_good_resolution || has_tags || is_primary
    end)
  end

  defp extract_modification_evidence(images) do
    # Extract evidence of modifications from image tags and metadata
    modifications = images
    |> Enum.flat_map(fn image -> image.tags || [] end)
    |> Enum.filter(fn tag -> tag.tag_type in ["product", "service", "modification"] end)
    |> Enum.group_by(fn tag -> tag.text end)

    Enum.map(modifications, fn {mod_name, tags} ->
      %{
        name: mod_name,
        evidence_count: length(tags),
        confidence: calculate_modification_confidence(tags),
        category: determine_modification_category(mod_name)
      }
    end)
  end

  defp extract_condition_indicators(images) do
    # Extract condition indicators from image analysis
    %{
      damage_indicators: extract_damage_indicators(images),
      maintenance_indicators: extract_maintenance_indicators(images),
      wear_indicators: extract_wear_indicators(images)
    }
  end

  defp calculate_documentation_score(images) do
    if Enum.empty?(images) do
      0
    else
      base_score = min(length(images) * 10, 50) # Up to 50 points for quantity

      quality_bonuses = images
      |> Enum.map(fn image ->
        bonus = 0
        bonus = if image.is_primary, do: bonus + 10, else: bonus
        bonus = if image.tags && length(image.tags) > 0, do: bonus + 5, else: bonus
        bonus = if image.file_size && image.file_size > 200_000, do: bonus + 5, else: bonus
        bonus
      end)
      |> Enum.sum()

      min(base_score + quality_bonuses, 100)
    end
  end

  # Helper functions for analysis

  defp extract_modifications_from_vehicle(vehicle) do
    # Extract modifications from vehicle tags and images
    images = vehicle.images || []

    images
    |> Enum.flat_map(fn image -> image.tags || [] end)
    |> Enum.filter(fn tag -> tag.tag_type in ["product", "modification"] end)
    |> Enum.map(fn tag ->
      %{
        name: tag.text,
        category: determine_modification_category(tag.text),
        confidence: tag.trust_score || 50
      }
    end)
    |> Enum.uniq_by(& &1.name)
  end

  defp calculate_valuation_range(valuation) do
    base_value = valuation.final_value
    confidence = valuation.confidence_score

    # Range gets wider as confidence decreases
    variance_percent = (100 - confidence) * 0.005 # 0.5% per confidence point below 100

    range_amount = base_value * variance_percent

    %{
      low: max(0, base_value - range_amount),
      high: base_value + range_amount
    }
  end

  defp calculate_overall_data_quality(analysis_data) do
    market_quality = if length(analysis_data.market_data) >= 5, do: 25, else: length(analysis_data.market_data) * 5
    ai_quality = (analysis_data.ai_analysis["confidence_score"] || 0) * 0.25
    image_quality = analysis_data.image_analysis.documentation_score * 0.25

    trunc(market_quality + ai_quality + image_quality)
  end

  defp calculate_modification_impact(image_analysis) do
    modifications = image_analysis.modification_evidence

    total_impact = modifications
    |> Enum.map(fn mod ->
      base_value = case mod.category do
        "performance" -> 2000
        "aesthetic" -> 800
        "functional" -> 1200
        _ -> 500
      end

      base_value * (mod.confidence / 100)
    end)
    |> Enum.sum()

    %{
      estimated_value: total_impact,
      modification_count: length(modifications),
      categories: Enum.group_by(modifications, & &1.category)
    }
  end

  defp determine_human_review_needed(analysis_data) do
    flags = []

    # Low confidence
    flags = if analysis_data.valuation.confidence_score < 70 do
      ["Low overall confidence score" | flags]
    else
      flags
    end

    # High value vehicle
    flags = if analysis_data.valuation.final_value > 50000 do
      ["High value vehicle requires human review" | flags]
    else
      flags
    end

    # Limited market data
    flags = if length(analysis_data.market_data) < 3 do
      ["Insufficient market data for comparison" | flags]
    else
      flags
    end

    # AI analysis failed
    flags = if Map.has_key?(analysis_data.ai_analysis, "error") do
      ["AI analysis unavailable" | flags]
    else
      flags
    end

    length(flags) > 0
  end

  defp generate_confidence_flags(analysis_data) do
    flags = []

    if analysis_data.valuation.confidence_score < 80 do
      flags = ["Medium confidence - additional verification recommended" | flags]
    end

    if length(analysis_data.market_data) < 5 do
      flags = ["Limited market data - expand search radius or date range" | flags]
    end

    if analysis_data.image_analysis.total_images < 5 do
      flags = ["Limited photo documentation - more images would improve accuracy" | flags]
    end

    flags
  end

  defp generate_recommended_actions(analysis_data) do
    actions = []

    if analysis_data.image_analysis.total_images < 10 do
      actions = ["Upload additional high-quality photos of the vehicle" | actions]
    end

    if length(analysis_data.market_data) < 8 do
      actions = ["Expand search radius to gather more comparable sales data" | actions]
    end

    modification_count = length(analysis_data.image_analysis.modification_evidence)
    if modification_count > 0 do
      actions = ["Document modifications with receipts and installation details for maximum value recognition" | actions]
    end

    if analysis_data.valuation.confidence_score < 85 do
      actions = ["Consider professional appraisal for high-stakes transactions" | actions]
    end

    actions
  end

  # Utility functions

  defp determine_modification_category(mod_name) do
    performance_keywords = ["turbo", "supercharger", "exhaust", "intake", "tune", "chip", "ecu"]
    aesthetic_keywords = ["wheels", "paint", "wrap", "kit", "spoiler", "interior"]
    functional_keywords = ["suspension", "brakes", "tires", "lights", "audio"]

    mod_lower = String.downcase(mod_name)

    cond do
      Enum.any?(performance_keywords, &String.contains?(mod_lower, &1)) -> "performance"
      Enum.any?(aesthetic_keywords, &String.contains?(mod_lower, &1)) -> "aesthetic"
      Enum.any?(functional_keywords, &String.contains?(mod_lower, &1)) -> "functional"
      true -> "other"
    end
  end

  defp calculate_modification_confidence(tags) do
    # Calculate confidence based on tag consensus and trust scores
    if Enum.empty?(tags) do
      0
    else
      avg_trust = tags
      |> Enum.map(fn tag -> tag.trust_score || 50 end)
      |> Enum.sum()
      |> Kernel./(length(tags))

      # Bonus for multiple confirmations
      consensus_bonus = min(length(tags) * 10, 30)

      min(avg_trust + consensus_bonus, 100)
    end
  end

  defp extract_damage_indicators(_images), do: []
  defp extract_maintenance_indicators(_images), do: []
  defp extract_wear_indicators(_images), do: []

  defp calculate_data_freshness(analysis_data) do
    market_age = if Enum.empty?(analysis_data.market_data) do
      999 # Very old if no data
    else
      # Calculate average age of market data
      now = DateTime.utc_now()
      ages = Enum.map(analysis_data.market_data, fn data ->
        DateTime.diff(now, data.scraped_at, :hour)
      end)
      Enum.sum(ages) / length(ages)
    end

    cond do
      market_age <= 24 -> "fresh"
      market_age <= 72 -> "good"
      market_age <= 168 -> "acceptable"
      true -> "stale"
    end
  end

  # Database operations

  defp store_analysis_result(vehicle_id, analysis_result) do
    # Store the analysis result in the database
    Logger.info("Storing analysis result for vehicle #{vehicle_id}")

    # TODO: Implement database storage
    # This would save the analysis_result to a pricing_analyses table
  end

  defp store_analysis_error(vehicle_id, error) do
    Logger.error("Storing analysis error for vehicle #{vehicle_id}: #{inspect(error)}")

    # TODO: Implement error storage for debugging
  end

  defp maybe_notify_humans(vehicle, analysis_result) do
    if analysis_result.human_review_needed do
      Logger.info("Human review needed for #{vehicle.year} #{vehicle.make} #{vehicle.model}")

      # TODO: Implement notification system
      # Could send email, create task, or flag in UI
    end
  end
end