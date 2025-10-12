defmodule NukeApi.Pricing.IntegrationExample do
  @moduledoc """
  Example integration showing how to add automated pricing intelligence
  to your existing vehicle workflow.

  This demonstrates the key integration points and best practices
  for empowering users with AI-enhanced pricing without disrupting
  existing functionality.
  """

  alias NukeApi.Vehicles
  alias NukeApi.Pricing.{VehicleCreationHook, HumanOversight}

  @doc """
  Enhanced vehicle creation with automated pricing analysis.

  Add this to your existing vehicle creation process:
  """
  def create_vehicle_with_pricing_analysis(vehicle_attrs, user_id) do
    # Step 1: Create vehicle normally (your existing process)
    case Vehicles.create_vehicle(vehicle_attrs) do
      {:ok, vehicle} ->
        # Step 2: Trigger automated pricing analysis
        enhanced_vehicle = VehicleCreationHook.on_vehicle_created(vehicle, [
          user_id: user_id,
          max_analysis_cost: 3.00, # Limit cost per analysis
          priority: :normal
        ])

        # Step 3: Return success with additional pricing context
        {:ok, enhanced_vehicle, get_pricing_context(enhanced_vehicle)}

      {:error, changeset} ->
        {:error, changeset}
    end
  end

  @doc """
  Enhanced image upload with automatic re-analysis.

  Add this to your image upload workflow:
  """
  def upload_images_with_analysis(vehicle_id, images, user_id) do
    # Step 1: Upload images normally (your existing process)
    case upload_images_to_vehicle(vehicle_id, images) do
      {:ok, uploaded_images} ->
        # Step 2: Get updated vehicle
        vehicle = Vehicles.get_vehicle(vehicle_id)

        # Step 3: Trigger analysis if significant visual changes
        enhanced_vehicle = VehicleCreationHook.on_images_updated(vehicle, uploaded_images, [
          user_id: user_id,
          min_images_for_reanalysis: 3 # Only re-analyze if 3+ new images
        ])

        {:ok, uploaded_images, get_pricing_status(enhanced_vehicle)}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc """
  Enhanced tagging with modification impact analysis.

  Add this to your tagging workflow:
  """
  def add_tags_with_pricing_update(vehicle_id, tags, user_id) do
    # Step 1: Add tags normally (your existing process)
    case add_tags_to_vehicle(vehicle_id, tags) do
      {:ok, added_tags} ->
        # Step 2: Get updated vehicle
        vehicle = Vehicles.get_vehicle_with_images_and_tags(vehicle_id)

        # Step 3: Update pricing if modification tags were added
        enhanced_vehicle = VehicleCreationHook.on_modifications_tagged(vehicle, added_tags, [
          user_id: user_id
        ])

        {:ok, added_tags, get_modification_impact(enhanced_vehicle, added_tags)}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc """
  Admin interface for managing pricing intelligence system.
  """
  def admin_pricing_dashboard(admin_user_id) do
    %{
      system_status: get_system_status(),
      performance_metrics: HumanOversight.get_performance_metrics(),
      human_review_queue: HumanOversight.get_human_review_queue(),
      configuration: HumanOversight.get_pricing_configuration(),
      recent_activity: get_recent_pricing_activity()
    }
  end

  @doc """
  User interface for viewing pricing intelligence.
  """
  def user_pricing_dashboard(user_id) do
    user_vehicles = get_user_vehicles(user_id)

    vehicles_with_pricing = Enum.map(user_vehicles, fn vehicle ->
      analysis_status = VehicleCreationHook.get_analysis_status(vehicle.id)

      %{
        vehicle: vehicle,
        pricing_status: analysis_status,
        last_updated: analysis_status[:last_analyzed],
        estimated_value: analysis_status[:estimated_value],
        confidence: analysis_status[:confidence_score]
      }
    end)

    %{
      vehicles: vehicles_with_pricing,
      total_portfolio_value: calculate_portfolio_value(vehicles_with_pricing),
      ai_insights: get_user_ai_insights(vehicles_with_pricing)
    }
  end

  @doc """
  Example of handling pricing feedback from users.
  """
  def submit_pricing_feedback(vehicle_id, user_feedback, user_id) do
    %{
      accuracy_rating: rating,      # 1-10 scale
      actual_value: actual_value,   # If they have an appraisal/sale
      feedback_notes: notes
    } = user_feedback

    # Submit feedback to improve AI accuracy
    feedback_data = %{
      type: "user_feedback",
      accuracy_rating: rating,
      actual_value: actual_value,
      notes: notes,
      user_id: user_id,
      submitted_at: DateTime.utc_now()
    }

    case NukeApi.Pricing.AutomatedAnalyst.submit_feedback(vehicle_id, feedback_data) do
      :ok ->
        {:ok, "Thank you for your feedback! This helps improve our AI accuracy."}

      {:error, reason} ->
        {:error, "Failed to submit feedback: #{reason}"}
    end
  end

  # Private helper functions to demonstrate integration

  defp get_pricing_context(vehicle) do
    analysis_status = VehicleCreationHook.get_analysis_status(vehicle.id)

    %{
      analysis_queued: true,
      estimated_completion: DateTime.add(DateTime.utc_now(), 300, :second), # ~5 minutes
      status_message: "Automated pricing analysis in progress...",
      current_status: analysis_status
    }
  end

  defp get_pricing_status(vehicle) do
    VehicleCreationHook.get_analysis_status(vehicle.id)
  end

  defp get_modification_impact(vehicle, new_tags) do
    modification_tags = Enum.filter(new_tags, fn tag ->
      tag.tag_type in ["product", "modification"]
    end)

    if length(modification_tags) > 0 do
      %{
        impact_detected: true,
        new_modifications: length(modification_tags),
        reanalysis_triggered: true,
        estimated_value_change: estimate_modification_value_impact(modification_tags)
      }
    else
      %{impact_detected: false}
    end
  end

  defp get_system_status do
    %{
      ai_service_healthy: check_openai_service(),
      scraping_services_healthy: check_scraping_services(),
      analysis_queue_size: get_analysis_queue_size(),
      average_analysis_time: get_average_analysis_time(),
      daily_analyses_completed: get_daily_analysis_count()
    }
  end

  defp get_recent_pricing_activity do
    # Mock recent activity data
    [
      %{
        timestamp: DateTime.utc_now(),
        event: "High-confidence analysis completed",
        vehicle: "2019 BMW M3",
        value: 45000,
        confidence: 92
      },
      %{
        timestamp: DateTime.add(DateTime.utc_now(), -3600, :second),
        event: "Human override applied",
        vehicle: "1977 Porsche 911",
        original_value: 85000,
        override_value: 95000,
        reason: "Rare factory options identified"
      },
      %{
        timestamp: DateTime.add(DateTime.utc_now(), -7200, :second),
        event: "Market data refresh completed",
        source: "AutoTrader",
        new_listings: 247
      }
    ]
  end

  defp get_user_vehicles(user_id) do
    # This would call your existing Vehicles.list_vehicles function
    Vehicles.list_vehicles(user_id: user_id)
  end

  defp calculate_portfolio_value(vehicles_with_pricing) do
    vehicles_with_pricing
    |> Enum.map(fn vehicle_data ->
      vehicle_data[:estimated_value] || 0
    end)
    |> Enum.sum()
  end

  defp get_user_ai_insights(vehicles_with_pricing) do
    high_confidence_count = Enum.count(vehicles_with_pricing, fn v ->
      (v[:confidence] || 0) >= 80
    end)

    total_count = length(vehicles_with_pricing)

    %{
      high_confidence_analyses: high_confidence_count,
      total_vehicles: total_count,
      confidence_rate: if total_count > 0 do
        (high_confidence_count / total_count * 100) |> Float.round(1)
      else
        0.0
      end,
      insights: [
        "Your portfolio shows strong documentation quality",
        "Consider uploading more photos for better accuracy",
        "3 vehicles would benefit from professional appraisal"
      ]
    }
  end

  # Example stubs for existing functions (replace with your actual implementations)

  defp upload_images_to_vehicle(vehicle_id, images) do
    # Your existing image upload logic here
    {:ok, images}
  end

  defp add_tags_to_vehicle(vehicle_id, tags) do
    # Your existing tag creation logic here
    {:ok, tags}
  end

  defp estimate_modification_value_impact(modification_tags) do
    # Rough estimate based on modification types
    modification_tags
    |> Enum.map(fn tag ->
      case String.downcase(tag.text) do
        text when text in ["turbo", "supercharger", "twin turbo"] -> 5000
        text when text in ["exhaust", "intake", "tune"] -> 1500
        text when text in ["wheels", "rims", "tires"] -> 2000
        text when text in ["suspension", "coilovers", "lowering"] -> 2500
        _ -> 500
      end
    end)
    |> Enum.sum()
  end

  # System health check functions

  defp check_openai_service do
    # Check if OpenAI API is responding
    true # Simplified for example
  end

  defp check_scraping_services do
    # Check if web scraping is working
    %{
      autotrader: true,
      cars_com: true,
      cargurus: false # Example: one service down
    }
  end

  defp get_analysis_queue_size, do: 12
  defp get_average_analysis_time, do: 4.7 # minutes
  defp get_daily_analysis_count, do: 89
end