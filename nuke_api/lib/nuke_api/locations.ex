defmodule NukeApi.Locations do
  @moduledoc """
  Context for managing work locations and patterns.

  This module provides functions to manage work locations, detect patterns,
  and analyze the professional context of where vehicle work happens.
  """

  import Ecto.Query, warn: false
  alias NukeApi.Repo
  alias NukeApi.Locations.{WorkLocation, LocationSession, LocationPattern}

  ## Work Locations

  @doc """
  Returns the list of work locations for a user.
  """
  def list_user_work_locations(user_id) do
    from(l in WorkLocation,
      where: l.user_id == ^user_id,
      order_by: [desc: l.confidence_score, desc: l.inserted_at]
    )
    |> Repo.all()
    |> Repo.preload([:sessions, :patterns])
  end

  @doc """
  Gets a single work location.
  """
  def get_work_location!(id), do: Repo.get!(WorkLocation, id) |> Repo.preload([:sessions, :patterns])
  def get_work_location(id), do: Repo.get(WorkLocation, id) |> Repo.preload([:sessions, :patterns])

  @doc """
  Creates a work location.
  """
  def create_work_location(attrs \\ %{}) do
    %WorkLocation{}
    |> WorkLocation.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Updates a work location.
  """
  def update_work_location(%WorkLocation{} = work_location, attrs) do
    work_location
    |> WorkLocation.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Deletes a work location.
  """
  def delete_work_location(%WorkLocation{} = work_location) do
    Repo.delete(work_location)
  end

  ## Location Sessions

  @doc """
  Returns the list of sessions for a work location.
  """
  def list_location_sessions(work_location_id) do
    from(s in LocationSession,
      where: s.work_location_id == ^work_location_id,
      order_by: [desc: s.start_time]
    )
    |> Repo.all()
  end

  @doc """
  Creates a location session.
  """
  def create_location_session(attrs \\ %{}) do
    %LocationSession{}
    |> LocationSession.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Updates a location session.
  """
  def update_location_session(%LocationSession{} = session, attrs) do
    session
    |> LocationSession.changeset(attrs)
    |> Repo.update()
  end

  ## Location Patterns

  @doc """
  Returns patterns for a work location.
  """
  def list_location_patterns(work_location_id) do
    from(p in LocationPattern,
      where: p.work_location_id == ^work_location_id,
      order_by: [desc: p.confidence, desc: p.last_confirmed]
    )
    |> Repo.all()
  end

  @doc """
  Creates a location pattern.
  """
  def create_location_pattern(attrs \\ %{}) do
    %LocationPattern{}
    |> LocationPattern.changeset(attrs)
    |> Repo.insert()
  end

  ## Smart Location Detection

  @doc """
  Analyzes image tags and session data to suggest or update work location classification.
  """
  def analyze_work_context(user_id, image_tags, session_data) do
    # Extract tools and environment from tags
    detected_tools = extract_tools_from_tags(image_tags)
    work_environment = analyze_environment_from_tags(image_tags)

    # Use WorkLocation analysis
    analysis = WorkLocation.analyze_from_patterns(detected_tools, work_environment, session_data)

    # Check if user has existing locations that match
    existing_locations = list_user_work_locations(user_id)
    matching_location = find_matching_location(existing_locations, analysis)

    case matching_location do
      nil ->
        # Create new location suggestion
        suggest_new_location(user_id, analysis, detected_tools, work_environment)

      location ->
        # Update existing location with new patterns
        update_location_patterns(location, analysis, detected_tools, work_environment)
    end
  end

  defp extract_tools_from_tags(image_tags) do
    image_tags
    |> Enum.filter(&(&1.tag_type == "tool"))
    |> Enum.map(&String.downcase(&1.text))
    |> Enum.uniq()
  end

  defp analyze_environment_from_tags(image_tags) do
    location_tags = Enum.filter(image_tags, &(&1.tag_type == "location"))
    _damage_tags = Enum.filter(image_tags, &(&1.tag_type == "damage"))

    # Analyze surface quality from location tags
    surface_quality = cond do
      Enum.any?(location_tags, &String.contains?(String.downcase(&1.text), "epoxy")) -> "epoxy_coated"
      Enum.any?(location_tags, &String.contains?(String.downcase(&1.text), "concrete")) -> "concrete"
      Enum.any?(location_tags, &String.contains?(String.downcase(&1.text), "garage")) -> "garage_floor"
      true -> "unknown"
    end

    # Analyze organization from tag distribution and quality
    organization_score = cond do
      length(image_tags) > 10 && Enum.all?(image_tags, &(&1.trust_score > 60)) -> 80
      length(image_tags) > 5 && Enum.count(image_tags, &(&1.trust_score > 60)) > 3 -> 60
      length(image_tags) > 2 -> 40
      true -> 20
    end

    %{
      surface_quality: surface_quality,
      organization_score: organization_score,
      clean_workspace: organization_score > 60,
      organized_tools: length(extract_tools_from_tags(image_tags)) > 5,
      proper_lighting: true, # Would need image analysis
      professional_surfaces: surface_quality in ["epoxy_coated", "concrete"]
    }
  end

  defp find_matching_location(existing_locations, analysis) do
    Enum.find(existing_locations, fn location ->
      location.location_type == analysis.suggested_location_type &&
      location.work_context == analysis.suggested_work_context
    end)
  end

  defp suggest_new_location(user_id, analysis, detected_tools, work_environment) do
    location_attrs = %{
      user_id: user_id,
      location_type: analysis.suggested_location_type,
      work_context: analysis.suggested_work_context,
      primary_use: guess_primary_use(detected_tools),
      tool_quality_score: analysis.tool_quality_score,
      organization_score: analysis.organization_score,
      confidence_score: analysis.confidence_score,
      surface_type: map_surface_type(work_environment.surface_quality),
      detected_patterns: %{
        tools_detected: detected_tools,
        environment_analysis: work_environment,
        analysis_timestamp: DateTime.utc_now()
      }
    }

    {:suggest_new, location_attrs}
  end

  defp update_location_patterns(location, analysis, detected_tools, work_environment) do
    # Update location scores based on new evidence
    updated_attrs = %{
      tool_quality_score: round((location.tool_quality_score + analysis.tool_quality_score) / 2),
      organization_score: round((location.organization_score + analysis.organization_score) / 2),
      confidence_score: min(location.confidence_score + 10, 100), # Increase confidence
      detected_patterns: Map.merge(location.detected_patterns || %{}, %{
        latest_tools: detected_tools,
        latest_environment: work_environment,
        last_updated: DateTime.utc_now()
      })
    }

    {:update_existing, location, updated_attrs}
  end

  defp guess_primary_use(detected_tools) do
    cond do
      Enum.any?(detected_tools, &String.contains?(&1, "restore")) -> "restoration"
      Enum.any?(detected_tools, &String.contains?(&1, "weld")) -> "fabrication"
      Enum.any?(detected_tools, &String.contains?(&1, "diagnostic")) -> "diagnostic"
      length(detected_tools) > 10 -> "repair"
      true -> "maintenance"
    end
  end

  defp map_surface_type("epoxy_coated"), do: "epoxy_coated"
  defp map_surface_type("concrete"), do: "concrete"
  defp map_surface_type("garage_floor"), do: "concrete"
  defp map_surface_type(_), do: "concrete"

  ## Pattern Analysis

  @doc """
  Analyzes and updates patterns for a work location based on recent sessions.
  """
  def analyze_and_update_location_patterns(work_location_id) do
    work_location = get_work_location!(work_location_id)
    sessions = list_location_sessions(work_location_id)

    # Detect new patterns
    new_patterns = LocationPattern.analyze_and_update_patterns(work_location_id, sessions)

    # Insert new patterns
    inserted_patterns = Enum.map(new_patterns, fn pattern_attrs ->
      case create_location_pattern(pattern_attrs) do
        {:ok, pattern} -> pattern
        {:error, _} -> nil
      end
    end)
    |> Enum.filter(& &1)

    # Update work location confidence and scores
    all_patterns = list_location_patterns(work_location_id) ++ inserted_patterns
    professional_score = LocationPattern.calculate_professional_score(all_patterns)

    updated_attrs = %{
      confidence_score: min(work_location.confidence_score + length(new_patterns), 100),
      tool_quality_score: max(work_location.tool_quality_score, professional_score),
      detected_patterns: Map.put(work_location.detected_patterns || %{},
                                :last_pattern_analysis, DateTime.utc_now())
    }

    update_work_location(work_location, updated_attrs)

    {work_location, inserted_patterns}
  end

  ## Location Intelligence

  @doc """
  Gets location intelligence summary for corporate data harvesting.
  """
  def get_location_intelligence(work_location_id) do
    work_location = get_work_location!(work_location_id)
    sessions = list_location_sessions(work_location_id)
    patterns = list_location_patterns(work_location_id)

    session_analysis = LocationSession.analyze_work_context(sessions)
    schedule_analysis = LocationSession.detect_schedule_patterns(sessions)
    professional_score = LocationPattern.calculate_professional_score(patterns)

    %{
      location: work_location,
      professional_level: WorkLocation.calculate_professional_level(work_location),
      professional_score: professional_score,
      session_context: session_analysis,
      schedule_pattern: schedule_analysis,
      pattern_count: length(patterns),
      session_count: length(sessions),
      confidence_indicators: %{
        equipment_score: calculate_equipment_confidence(work_location),
        pattern_confidence: calculate_pattern_confidence(patterns),
        session_confidence: session_analysis.confidence || 0
      },
      corporate_value: calculate_corporate_value(work_location, sessions, patterns)
    }
  end

  defp calculate_equipment_confidence(work_location) do
    equipment_count = [
      work_location.has_lift,
      work_location.has_compressor,
      work_location.has_welding,
      work_location.has_specialty_tools
    ] |> Enum.count(& &1)

    equipment_count * 25
  end

  defp calculate_pattern_confidence(patterns) do
    if Enum.empty?(patterns) do
      0
    else
      avg_confidence = patterns
        |> Enum.map(&(&1.confidence * 100))
        |> Enum.sum()
        |> div(length(patterns))

      round(avg_confidence)
    end
  end

  defp calculate_corporate_value(work_location, sessions, patterns) do
    # Corporate data harvesting value based on:
    # 1. Professional level (higher = more valuable)
    # 2. Session frequency (more data = more valuable)
    # 3. Pattern richness (more patterns = more insights)
    # 4. Documentation quality (photos/tags = better data)

    professional_multiplier = case WorkLocation.calculate_professional_level(work_location) do
      "professional" -> 1.0
      "experienced" -> 0.8
      "hobbyist" -> 0.6
      "diy" -> 0.4
    end

    session_value = min(length(sessions) * 2, 100)
    pattern_value = min(length(patterns) * 10, 100)

    documentation_value = sessions
      |> Enum.map(&((&1.photo_count || 0) + (&1.tag_count || 0) * 2))
      |> Enum.sum()
      |> min(100)

    base_value = (session_value + pattern_value + documentation_value) / 3
    final_value = round(base_value * professional_multiplier)

    %{
      overall_score: final_value,
      professional_multiplier: professional_multiplier,
      data_richness: documentation_value,
      pattern_richness: pattern_value,
      activity_level: session_value
    }
  end
end