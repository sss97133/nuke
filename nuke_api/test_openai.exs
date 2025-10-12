#!/usr/bin/env elixir

# Simple test script to verify OpenAI integration is working

# Create a mock vehicle data structure
mock_vehicle = %{
  year: 2015,
  make: "BMW",
  model: "M3",
  trim: "Base",
  mileage: 75000,
  condition: "Good",
  color: "Alpine White",
  vin: "WBS3S9C59FP123456"
}

# Mock market data
mock_market_data = [
  %{source: "AutoTrader", price: 32500, mileage: 68000, location: "Los Angeles, CA"},
  %{source: "Cars.com", price: 34000, mileage: 72000, location: "San Francisco, CA"},
  %{source: "CarGurus", price: 31200, mileage: 78000, location: "San Diego, CA"}
]

IO.puts("Testing OpenAI Vehicle Pricing Analysis...")
IO.puts("Vehicle: #{mock_vehicle.year} #{mock_vehicle.make} #{mock_vehicle.model}")
IO.puts("Mileage: #{mock_vehicle.mileage}")
IO.puts("")

# Test the OpenAI client directly
try do
  IO.puts("Calling OpenAI Vehicle Pricing Analysis...")

  # Create a client instance first
  client = NukeApi.AI.OpenAIClient.new()

  case NukeApi.AI.OpenAIClient.analyze_vehicle_pricing(client, mock_vehicle, [], []) do
    {:ok, analysis} ->
      IO.puts("✅ SUCCESS: OpenAI analysis completed!")
      IO.puts("Estimated Value: #{analysis.estimated_value}")
      IO.puts("Confidence: #{analysis.confidence_score}%")
      IO.puts("Market Position: #{analysis.market_position}")
      IO.puts("Key Points:")
      Enum.each(analysis.key_points, fn point ->
        IO.puts("  - #{point}")
      end)

    {:error, reason} ->
      IO.puts("❌ FAILED: #{reason}")
  end
rescue
  error ->
    IO.puts("❌ ERROR: #{inspect(error)}")
end

IO.puts("")
IO.puts("Testing AutomatedAnalyst GenServer...")

# Test if the AutomatedAnalyst is running
try do
  case NukeApi.Pricing.AutomatedAnalyst.get_analysis("test-vehicle-id") do
    nil ->
      IO.puts("✅ AutomatedAnalyst GenServer is running (no analysis found for test ID)")
    analysis ->
      IO.puts("✅ AutomatedAnalyst GenServer is running (found analysis: #{inspect(analysis)})")
  end
rescue
  error ->
    IO.puts("❌ AutomatedAnalyst GenServer error: #{inspect(error)}")
end

IO.puts("")
IO.puts("OpenAI Integration Test Complete!")