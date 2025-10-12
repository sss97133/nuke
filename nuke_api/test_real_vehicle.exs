#!/usr/bin/env elixir

# Test script to analyze the real GMC vehicle with documentation-based system

# Get real vehicle data from database
vehicle_id = "a90c008a-3379-41d8-9eb2-b4eda365d74c"

IO.puts("Testing Documentation-Based Analysis on Real Vehicle...")
IO.puts("Vehicle ID: #{vehicle_id}")
IO.puts("")

try do
  # Create client
  client = NukeApi.AI.OpenAIClient.new()

  # Get vehicle from database
  case NukeApi.Vehicles.get_vehicle(vehicle_id) do
    nil ->
      IO.puts("❌ Vehicle not found in database")

    vehicle ->
      IO.puts("✅ Found vehicle: #{vehicle.year} #{vehicle.make} #{vehicle.model}")

      # Get timeline events for documentation analysis
      timeline_events = NukeApi.Vehicles.list_timeline_events(vehicle_id)
      IO.puts("Timeline events found: #{length(timeline_events)}")

      # Get images for visual documentation
      images = NukeApi.Vehicles.list_vehicle_images(vehicle_id)
      IO.puts("Images found: #{length(images)}")
      IO.puts("")

      # Run documentation-based analysis
      case NukeApi.AI.OpenAIClient.analyze_vehicle_pricing(client, vehicle, timeline_events, images) do
        {:ok, analysis} ->
          IO.puts("✅ SUCCESS: Documentation-based analysis completed!")
          IO.puts("Documentation Score: #{analysis.documentation_analysis["documentation_score"] || "N/A"}")
          IO.puts("Verification Level: #{analysis.documentation_analysis["verification_level"] || "N/A"}")
          IO.puts("Estimated Investment: $#{analysis.estimated_value}")
          IO.puts("Confidence: #{analysis.confidence_score}%")
          IO.puts("Market Position: #{analysis.market_position}")
          IO.puts("")
          IO.puts("Key Documentation Points:")
          Enum.each(analysis.key_points, fn point ->
            IO.puts("  • #{point}")
          end)

          if analysis.documentation_analysis["red_flags"] do
            IO.puts("")
            IO.puts("Red Flags:")
            Enum.each(analysis.documentation_analysis["red_flags"], fn flag ->
              IO.puts("  ⚠️  #{flag}")
            end)
          end

        {:error, reason} ->
          IO.puts("❌ FAILED: #{reason}")
      end
  end

rescue
  error ->
    IO.puts("❌ ERROR: #{inspect(error)}")
end

IO.puts("")
IO.puts("Real Vehicle Analysis Complete!")