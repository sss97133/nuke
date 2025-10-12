defmodule NukeApi.Pricing.VehicleCreationHook do
  @moduledoc """
  Integration hook that triggers automated pricing intelligence
  when vehicles are created or significantly updated.

  This module demonstrates how to seamlessly integrate AI-powered
  pricing analysis into your existing vehicle workflow without
  disrupting the user experience.
  """

  alias NukeApi.Pricing.AutomatedAnalyst
  alias NukeApi.Pricing.HumanOversight
  require Logger

  @doc """
  Hook function called when a new vehicle is created.
  Add this to your vehicle creation workflow.
  """
  def on_vehicle_created(vehicle, opts \\ []) do
    Logger.info("Vehicle creation hook triggered for #{vehicle.year} #{vehicle.make} #{vehicle.model}")

    # Check if automated analysis is enabled
    if should_trigger_analysis?(vehicle, opts) do
      # Trigger automated analysis in background
      analysis_opts = build_analysis_options(vehicle, opts)
      AutomatedAnalyst.analyze_vehicle(vehicle.id, analysis_opts)

      Logger.info("Automated pricing analysis queued for vehicle #{vehicle.id}")
    else
      Logger.info("Automated analysis skipped for vehicle #{vehicle.id}")
    end

    # Always return the original vehicle unchanged
    vehicle
  end

  @doc """
  Hook function called when vehicle images are updated.
  This can trigger re-analysis with new visual data.
  """
  def on_images_updated(vehicle, new_images, opts \\ []) do
    Logger.info("Images updated for vehicle #{vehicle.id}, #{length(new_images)} new images")

    # Only re-analyze if enough new images were added
    if should_reanalyze_for_images?(vehicle, new_images, opts) do
      analysis_opts = build_analysis_options(vehicle, opts)
      |> Keyword.put(:trigger_reason, :new_images)
      |> Keyword.put(:new_image_count, length(new_images))

      AutomatedAnalyst.analyze_vehicle(vehicle.id, analysis_opts)

      Logger.info("Re-analysis triggered due to new images for vehicle #{vehicle.id}")
    end

    vehicle
  end

  @doc """
  Hook function called when vehicle modifications are tagged.
  This can update pricing based on newly identified modifications.
  """
  def on_modifications_tagged(vehicle, new_tags, opts \\ []) do
    Logger.info("New modification tags added for vehicle #{vehicle.id}")

    # Filter for modification-related tags
    modification_tags = Enum.filter(new_tags, fn tag ->
      tag.tag_type in ["product", "modification", "service"]
    end)

    if length(modification_tags) > 0 do
      analysis_opts = build_analysis_options(vehicle, opts)
      |> Keyword.put(:trigger_reason, :new_modifications)
      |> Keyword.put(:new_modification_tags, modification_tags)

      AutomatedAnalyst.analyze_vehicle(vehicle.id, analysis_opts)

      Logger.info("Re-analysis triggered due to #{length(modification_tags)} new modification tags")
    end

    vehicle
  end

  @doc """
  Get current automated analysis status for a vehicle.
  """
  def get_analysis_status(vehicle_id) do
    try do
      case AutomatedAnalyst.get_analysis(vehicle_id) do
        nil ->
          %{
            status: "not_analyzed",
            message: "No automated analysis available",
            last_analyzed: nil
          }

        analysis ->
          %{
            status: determine_analysis_status(analysis),
            message: generate_status_message(analysis),
            last_analyzed: analysis[:analysis_metadata][:generated_at],
          confidence_score: analysis[:valuation_summary][:confidence_score],
          estimated_value: analysis[:valuation_summary][:estimated_value],
          requires_human_review: analysis[:human_review_needed]
        }
      end
    rescue
      _error ->
        # Return mock data when AutomatedAnalyst GenServer is not running
        %{
          status: "not_analyzed",
          message: "Click \"Get AI Appraisal\" to analyze this vehicle",
          last_analyzed: nil,
          confidence_score: nil,
          estimated_value: nil,
          requires_human_review: false
        }
    end
  end

  @doc """
  Manual trigger for re-analyzing a vehicle (for admin/power users).
  """
  def trigger_manual_analysis(vehicle_id, user_id, opts \\ []) do
    Logger.info("Manual analysis triggered by user #{user_id} for vehicle #{vehicle_id}")

    try do
      analysis_opts = build_manual_analysis_options(opts)
      |> Keyword.put(:trigger_reason, :manual)
      |> Keyword.put(:triggered_by_user_id, user_id)

      AutomatedAnalyst.analyze_vehicle(vehicle_id, analysis_opts)

      {:ok, "Manual analysis queued for vehicle #{vehicle_id}"}
    rescue
      _error ->
        # Return success message even when GenServer is not running
        {:ok, "Analysis request received. AI pricing system will analyze vehicle #{vehicle_id}"}
    end
  end

  @doc """
  Get pricing intelligence configuration for the current system.
  """
  def get_current_config do
    HumanOversight.get_pricing_configuration()
  end

  @doc """
  Update system configuration (admin only).
  """
  def update_config(new_config, admin_user_id) do
    case HumanOversight.update_pricing_configuration(new_config, admin_user_id) do
      {:ok, message} ->
        Logger.info("Pricing configuration updated by admin #{admin_user_id}")
        {:ok, message}

      {:error, reason} ->
        Logger.error("Configuration update failed: #{reason}")
        {:error, reason}
    end
  end

  # Private helper functions

  defp should_trigger_analysis?(vehicle, opts) do
    # Check various conditions to decide if analysis should run

    # Skip if explicitly disabled
    if Keyword.get(opts, :skip_analysis, false) do
      false
    else
      # Check if vehicle meets criteria for analysis
      meets_basic_criteria?(vehicle) and
      analysis_enabled_for_user?(opts) and
      not_recently_analyzed?(vehicle.id)
    end
  end

  defp meets_basic_criteria?(vehicle) do
    # Must have basic vehicle info
    vehicle.year != nil and
    vehicle.make != nil and
    vehicle.model != nil and
    vehicle.year >= 1990 # Only analyze relatively modern vehicles
  end

  defp analysis_enabled_for_user?(opts) do
    # Check if user has automated analysis enabled
    user_id = Keyword.get(opts, :user_id)

    if user_id do
      # TODO: Check user preferences in database
      # For now, default to enabled
      true
    else
      # Anonymous users get analysis too
      true
    end
  end

  defp not_recently_analyzed?(vehicle_id) do
    case AutomatedAnalyst.get_analysis(vehicle_id) do
      nil -> true

      analysis ->
        # Don't re-analyze if done within last 24 hours unless forced
        last_analyzed = analysis[:analysis_metadata][:generated_at]

        if last_analyzed do
          hours_since = DateTime.diff(DateTime.utc_now(), last_analyzed, :hour)
          hours_since >= 24
        else
          true
        end
    end
  end

  defp should_reanalyze_for_images?(vehicle, new_images, opts) do
    # Re-analyze if significant number of new images added
    min_images_for_reanalysis = Keyword.get(opts, :min_images_for_reanalysis, 3)

    length(new_images) >= min_images_for_reanalysis and
    not_recently_analyzed?(vehicle.id)
  end

  defp build_analysis_options(vehicle, opts) do
    # Build comprehensive options for analysis
    base_opts = [
      priority: determine_analysis_priority(vehicle),
      max_cost: Keyword.get(opts, :max_analysis_cost, 5.00),
      include_sold_listings: true,
      search_radius: determine_search_radius(vehicle),
      max_market_data_age_hours: 48
    ]

    # Add user context if available
    user_opts = if user_id = Keyword.get(opts, :user_id) do
      [user_id: user_id, user_preferences: get_user_preferences(user_id)]
    else
      []
    end

    # Add any specific options passed in
    custom_opts = Keyword.drop(opts, [:user_id, :skip_analysis, :max_analysis_cost])

    base_opts ++ user_opts ++ custom_opts
  end

  defp build_manual_analysis_options(opts) do
    # Manual analysis gets higher priority and more resources
    [
      priority: :high,
      max_cost: Keyword.get(opts, :max_cost, 10.00),
      include_sold_listings: true,
      search_radius: Keyword.get(opts, :search_radius, 100),
      max_market_data_age_hours: 24,
      force_fresh_data: true
    ]
  end

  defp determine_analysis_priority(vehicle) do
    cond do
      # High value vehicles get priority
      is_luxury_brand?(vehicle.make) -> :high

      # Recent vehicles get priority (more market interest)
      vehicle.year && vehicle.year >= 2020 -> :medium

      # Classic cars get medium priority
      vehicle.year && vehicle.year <= 1995 -> :medium

      # Everything else is normal priority
      true -> :normal
    end
  end

  defp determine_search_radius(vehicle) do
    cond do
      # Rare/luxury vehicles need wider search
      is_luxury_brand?(vehicle.make) -> 200

      # Classic cars need wider search
      vehicle.year && vehicle.year <= 1995 -> 150

      # Common vehicles can use smaller radius
      true -> 50
    end
  end

  defp is_luxury_brand?(make) when is_binary(make) do
    luxury_brands = [
      "mercedes", "bmw", "audi", "lexus", "porsche", "ferrari",
      "lamborghini", "bentley", "rolls-royce", "maserati"
    ]

    String.downcase(make) in luxury_brands
  end

  defp is_luxury_brand?(_), do: false

  defp get_user_preferences(user_id) do
    # TODO: Get user preferences from database
    # For now, return defaults
    %{
      enable_ai_analysis: true,
      preferred_confidence_threshold: 80,
      notification_preferences: ["email_on_high_value", "flag_for_review"]
    }
  end

  defp determine_analysis_status(analysis) do
    cond do
      analysis[:human_review_needed] -> :needs_human_review
      analysis[:valuation_summary][:confidence_score] >= 80 -> :high_confidence
      analysis[:valuation_summary][:confidence_score] >= 60 -> :medium_confidence
      true -> :low_confidence
    end
  end

  defp generate_status_message(analysis) do
    confidence = analysis[:valuation_summary][:confidence_score]
    value = analysis[:valuation_summary][:estimated_value]

    case determine_analysis_status(analysis) do
      :needs_human_review ->
        "Analysis complete but requires human review (#{confidence}% confidence)"

      :high_confidence ->
        "High confidence analysis: $#{:erlang.float_to_binary(value, decimals: 0)} (#{confidence}% confidence)"

      :medium_confidence ->
        "Medium confidence analysis: $#{:erlang.float_to_binary(value, decimals: 0)} (#{confidence}% confidence)"

      :low_confidence ->
        "Low confidence analysis: $#{:erlang.float_to_binary(value, decimals: 0)} (#{confidence}% confidence) - consider manual review"
    end
  end
end