# Location System API Test Script
# Run with: SUPABASE_DB_PASSWORD=<your_db_password> mix run scripts/test_location_api.exs

alias NukeApi.Locations
alias NukeApi.Locations.{WorkLocation, LocationSession}

IO.puts("🚀 Testing Location Classification System API...")

# Test 1: Create a professional shop location
IO.puts("\n1. Creating professional shop location...")

location_attrs = %{
  user_id: "0b9f107a-d124-49de-9ded-94698f63c1c4",
  location_type: "shop",
  work_context: "professional",
  has_lift: true,
  has_compressor: true,
  has_welding: false,
  has_specialty_tools: true,
  power_available: "220_available",
  primary_use: "restoration",
  tool_quality_score: 75,
  organization_score: 80,
  confidence_score: 65
}

case Locations.create_work_location(location_attrs) do
  {:ok, location} ->
    IO.puts("✅ Created location: #{location.id}")
    IO.puts("   Type: #{location.location_type}, Context: #{location.work_context}")
    IO.puts("   Professional Level: #{WorkLocation.calculate_professional_level(location)}")

    # Test 2: Create a work session
    IO.puts("\n2. Creating work session...")

    session_attrs = %{
      work_location_id: location.id,
      user_id: location.user_id,
      start_time: DateTime.utc_now(),
      work_type: "diagnostic",
      tools_used: ["obd_scanner", "multimeter", "snap-on_ratchet"],
      weather_conditions: "clear",
      photo_count: 8,
      tag_count: 5
    }

    case Locations.create_location_session(session_attrs) do
      {:ok, session} ->
        IO.puts("✅ Created session: #{session.id}")
        IO.puts("   Work type: #{session.work_type}")
        IO.puts("   Tools: #{inspect(session.tools_used)}")

        # Test 3: End the session
        IO.puts("\n3. Ending work session...")

        end_attrs = %{
          end_time: DateTime.utc_now(),
          duration_minutes: 120,
          completion_status: "completed",
          quality_score: 85,
          notes: "Successfully diagnosed electrical issue"
        }

        case Locations.update_location_session(session, end_attrs) do
          {:ok, completed_session} ->
            IO.puts("✅ Session completed with quality score: #{completed_session.quality_score}")

            # Test 4: Analyze location patterns
            IO.puts("\n4. Analyzing location patterns...")

            {updated_location, new_patterns} = Locations.analyze_and_update_location_patterns(location.id)

            IO.puts("✅ Pattern analysis complete:")
            IO.puts("   New patterns detected: #{length(new_patterns)}")
            IO.puts("   Updated confidence: #{updated_location.confidence_score}")

            # Test 5: Get location intelligence
            IO.puts("\n5. Getting location intelligence...")

            intelligence = Locations.get_location_intelligence(location.id)

            IO.puts("✅ Intelligence report:")
            IO.puts("   Professional Level: #{intelligence.professional_level}")
            IO.puts("   Professional Score: #{intelligence.professional_score}")
            IO.puts("   Corporate Value: #{intelligence.corporate_value.overall_score}")
            IO.puts("   Data Richness: #{intelligence.corporate_value.data_richness}")

            # Test 6: Context analysis simulation
            IO.puts("\n6. Testing context analysis...")

            # Simulate image tags for context analysis
            mock_image_tags = [
              %{tag_type: "tool", text: "Snap-on ratchet", trust_score: 85},
              %{tag_type: "tool", text: "Milwaukee impact", trust_score: 90},
              %{tag_type: "location", text: "epoxy floor", trust_score: 75},
              %{tag_type: "tool", text: "Matco wrench set", trust_score: 88}
            ]

            mock_session_data = %{
              weekly_sessions: 3,
              avg_duration_hours: 4,
              schedule_consistency: 0.8
            }

            case Locations.analyze_work_context(location.user_id, mock_image_tags, mock_session_data) do
              {:suggest_new, suggested_attrs} ->
                IO.puts("✅ Context analysis suggests new location:")
                IO.puts("   Type: #{suggested_attrs.location_type}")
                IO.puts("   Context: #{suggested_attrs.work_context}")
                IO.puts("   Tool Quality Score: #{suggested_attrs.tool_quality_score}")

              {:update_existing, existing_location, updates} ->
                IO.puts("✅ Context analysis suggests updating existing location:")
                IO.puts("   Location ID: #{existing_location.id}")
                IO.puts("   New tool quality score: #{updates.tool_quality_score}")
            end

            IO.puts("\n🎉 All tests passed! Location system is working correctly.")

          {:error, changeset} ->
            IO.puts("❌ Failed to end session: #{inspect(changeset.errors)}")
        end

      {:error, changeset} ->
        IO.puts("❌ Failed to create session: #{inspect(changeset.errors)}")
    end

  {:error, changeset} ->
    IO.puts("❌ Failed to create location: #{inspect(changeset.errors)}")
end

# Test 7: List all locations for the user
IO.puts("\n7. Listing all user locations...")

user_locations = Locations.list_user_work_locations("0b9f107a-d124-49de-9ded-94698f63c1c4")

IO.puts("✅ Found #{length(user_locations)} locations for user:")
Enum.each(user_locations, fn loc ->
  IO.puts("   - #{loc.location_type}/#{loc.work_context} (Confidence: #{loc.confidence_score})")
end)

IO.puts("\n🏁 Location system test complete!")