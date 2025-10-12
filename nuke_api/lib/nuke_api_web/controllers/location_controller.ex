defmodule NukeApiWeb.LocationController do
  use NukeApiWeb, :controller

  alias NukeApi.Locations
  alias NukeApi.Locations.{WorkLocation, LocationSession}
  alias NukeApi.Vehicles.ImageTags
  alias NukeApi.Repo

  @doc """
  List all work locations for the current user
  """
  def index(conn, _params) do
    user_id = get_current_user_id(conn)
    locations = Locations.list_user_work_locations(user_id)

    json(conn, %{
      status: "success",
      data: locations
    })
  end

  @doc """
  Get a specific work location with intelligence analysis
  """
  def show(conn, %{"id" => id}) do
    case Locations.get_work_location(id) do
      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Work location not found"})

      location ->
        intelligence = Locations.get_location_intelligence(id)

        json(conn, %{
          status: "success",
          data: %{
            location: location,
            intelligence: intelligence
          }
        })
    end
  end

  @doc """
  Create a new work location
  """
  def create(conn, %{"location" => location_params}) do
    user_id = get_current_user_id(conn)
    location_params = Map.put(location_params, "user_id", user_id)

    case Locations.create_work_location(location_params) do
      {:ok, location} ->
        conn
        |> put_status(:created)
        |> json(%{
          status: "success",
          data: location
        })

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{
          status: "error",
          errors: translate_errors(changeset)
        })
    end
  end

  @doc """
  Update a work location
  """
  def update(conn, %{"id" => id, "location" => location_params}) do
    with {:ok, location} <- get_user_location(conn, id),
         {:ok, updated_location} <- Locations.update_work_location(location, location_params) do
      json(conn, %{
        status: "success",
        data: updated_location
      })
    else
      {:error, :not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Work location not found"})

      {:error, :unauthorized} ->
        conn
        |> put_status(:forbidden)
        |> json(%{error: "You can only update your own work locations"})

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{
          status: "error",
          errors: translate_errors(changeset)
        })
    end
  end

  @doc """
  Delete a work location
  """
  def delete(conn, %{"id" => id}) do
    with {:ok, location} <- get_user_location(conn, id),
         {:ok, _} <- Locations.delete_work_location(location) do
      json(conn, %{status: "success"})
    else
      {:error, :not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Work location not found"})

      {:error, :unauthorized} ->
        conn
        |> put_status(:forbidden)
        |> json(%{error: "You can only delete your own work locations"})
    end
  end

  @doc """
  Analyze work context from image tags and suggest location classification
  """
  def analyze_context(conn, %{"image_ids" => image_ids}) do
    user_id = get_current_user_id(conn)

    # Get tags from the provided images
    image_tags = get_tags_for_images(image_ids)

    # Analyze session data (could be enhanced with actual session tracking)
    session_data = %{
      weekly_sessions: 2, # Default values, would be calculated from actual data
      avg_duration_hours: 3,
      schedule_consistency: 0.7
    }

    case Locations.analyze_work_context(user_id, image_tags, session_data) do
      {:suggest_new, location_attrs} ->
        json(conn, %{
          status: "success",
          suggestion: "create_new_location",
          data: location_attrs
        })

      {:update_existing, location, updated_attrs} ->
        json(conn, %{
          status: "success",
          suggestion: "update_existing_location",
          data: %{
            existing_location: location,
            suggested_updates: updated_attrs
          }
        })
    end
  end

  @doc """
  Start a new work session at a location
  """
  def start_session(conn, %{"location_id" => location_id, "session" => session_params}) do
    user_id = get_current_user_id(conn)

    session_attrs = session_params
    |> Map.put("work_location_id", location_id)
    |> Map.put("user_id", user_id)
    |> Map.put("start_time", DateTime.utc_now())

    case Locations.create_location_session(session_attrs) do
      {:ok, session} ->
        conn
        |> put_status(:created)
        |> json(%{
          status: "success",
          data: session
        })

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{
          status: "error",
          errors: translate_errors(changeset)
        })
    end
  end

  @doc """
  End a work session and update with results
  """
  def end_session(conn, %{"session_id" => session_id, "session" => update_params}) do
    # Get the session and verify ownership
    session = Repo.get(LocationSession, session_id)

    if session && session.user_id == get_current_user_id(conn) do
      update_attrs = update_params
      |> Map.put("end_time", DateTime.utc_now())

      case Locations.update_location_session(session, update_attrs) do
        {:ok, updated_session} ->
          # Calculate quality score
          quality_score = LocationSession.calculate_session_quality(updated_session)
          final_session = %{updated_session | quality_score: quality_score}

          # Trigger pattern analysis for the location
          {_location, _new_patterns} = Locations.analyze_and_update_location_patterns(session.work_location_id)

          json(conn, %{
            status: "success",
            data: final_session
          })

        {:error, changeset} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{
            status: "error",
            errors: translate_errors(changeset)
          })
      end
    else
      conn
      |> put_status(:not_found)
      |> json(%{error: "Session not found"})
    end
  end

  @doc """
  Get location sessions with analysis
  """
  def sessions(conn, %{"location_id" => location_id}) do
    sessions = Locations.list_location_sessions(location_id)
    session_analysis = LocationSession.analyze_work_context(sessions)
    schedule_analysis = LocationSession.detect_schedule_patterns(sessions)

    json(conn, %{
      status: "success",
      data: %{
        sessions: sessions,
        analysis: %{
          work_context: session_analysis,
          schedule_pattern: schedule_analysis,
          total_sessions: length(sessions),
          avg_session_time: if(Enum.empty?(sessions), do: 0, else:
            sessions |> Enum.map(&(&1.duration_minutes || 0)) |> Enum.sum() |> div(length(sessions)))
        }
      }
    })
  end

  @doc """
  Get detected patterns for a location
  """
  def patterns(conn, %{"location_id" => location_id}) do
    patterns = Locations.list_location_patterns(location_id)

    # Group patterns by type for easier analysis
    grouped_patterns = Enum.group_by(patterns, & &1.pattern_type)

    json(conn, %{
      status: "success",
      data: %{
        patterns: patterns,
        grouped_patterns: grouped_patterns,
        pattern_summary: %{
          total_patterns: length(patterns),
          pattern_types: Map.keys(grouped_patterns),
          avg_confidence: if(Enum.empty?(patterns), do: 0, else:
            patterns |> Enum.map(&(&1.confidence * 100)) |> Enum.sum() |> div(length(patterns)))
        }
      }
    })
  end

  @doc """
  Force re-analysis of location patterns
  """
  def reanalyze(conn, %{"location_id" => location_id}) do
    with {:ok, _location} <- get_user_location(conn, location_id) do
      {updated_location, new_patterns} = Locations.analyze_and_update_location_patterns(location_id)

      json(conn, %{
        status: "success",
        data: %{
          location: updated_location,
          new_patterns_detected: length(new_patterns),
          patterns: new_patterns
        }
      })
    else
      {:error, :not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Work location not found"})

      {:error, :unauthorized} ->
        conn
        |> put_status(:forbidden)
        |> json(%{error: "You can only analyze your own work locations"})
    end
  end

  @doc """
  Get comprehensive location analytics dashboard
  """
  def analytics(conn, _params) do
    user_id = get_current_user_id(conn)
    locations = Locations.list_user_work_locations(user_id)

    analytics = generate_location_analytics(locations)

    json(conn, %{
      status: "success",
      data: analytics
    })
  end

  @doc """
  Get location intelligence summary for corporate harvesting
  """
  def corporate_intelligence(conn, _params) do
    user_id = get_current_user_id(conn)
    locations = Locations.list_user_work_locations(user_id)

    intelligence = generate_corporate_intelligence(locations)

    json(conn, %{
      status: "success",
      data: intelligence
    })
  end

  @doc """
  Export location data for corporate clients
  """
  def export_corporate_data(conn, params) do
    user_id = get_current_user_id(conn)
    format = Map.get(params, "format", "json")

    locations = Locations.list_user_work_locations(user_id)
    export_data = generate_corporate_export(locations, format)

    case format do
      "csv" ->
        conn
        |> put_resp_content_type("text/csv")
        |> put_resp_header("content-disposition", "attachment; filename=\"location_data.csv\"")
        |> send_resp(200, export_data)

      _ ->
        json(conn, %{
          status: "success",
          data: export_data
        })
    end
  end

  ## Private Helper Functions

  defp get_current_user_id(conn) do
    # Extract user ID from JWT token or session
    # For now, return a placeholder
    case get_req_header(conn, "authorization") do
      ["Bearer " <> _token] ->
        # Would decode JWT to get actual user_id
        "0b9f107a-d124-49de-9ded-94698f63c1c4"
      _ ->
        "0b9f107a-d124-49de-9ded-94698f63c1c4"
    end
  end

  defp get_user_location(conn, location_id) do
    user_id = get_current_user_id(conn)

    case Locations.get_work_location(location_id) do
      nil ->
        {:error, :not_found}

      location ->
        if location.user_id == user_id do
          {:ok, location}
        else
          {:error, :unauthorized}
        end
    end
  end

  defp get_tags_for_images(image_ids) do
    # Get all tags for the provided image IDs
    # This would query the image_tags table
    image_ids
    |> Enum.flat_map(fn image_id ->
      ImageTags.list_image_tags(image_id)
    end)
  end

  defp translate_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {key, value}, acc ->
        String.replace(acc, "%{#{key}}", to_string(value))
      end)
    end)
  end

  defp generate_location_analytics(locations) do
    if Enum.empty?(locations) do
      %{
        summary: %{
          total_locations: 0,
          professional_locations: 0,
          avg_confidence: 0
        },
        distribution: %{},
        professional_scores: %{},
        trends: %{}
      }
    else
      # Calculate summary statistics
      professional_locations = Enum.count(locations, &(&1.work_context == "professional"))
      avg_confidence = locations
        |> Enum.map(& &1.confidence_score)
        |> Enum.sum()
        |> div(length(locations))

      avg_tool_quality = locations
        |> Enum.map(& &1.tool_quality_score)
        |> Enum.sum()
        |> div(length(locations))

      # Analyze distribution by type and context
      type_distribution = Enum.frequencies_by(locations, & &1.location_type)
      context_distribution = Enum.frequencies_by(locations, & &1.work_context)

      # Professional level analysis
      professional_levels = locations
        |> Enum.map(&{&1.id, WorkLocation.calculate_professional_level(&1)})
        |> Enum.into(%{})

      level_distribution = professional_levels
        |> Enum.map(&elem(&1, 1))
        |> Enum.frequencies()

      %{
        summary: %{
          total_locations: length(locations),
          professional_locations: professional_locations,
          professional_ratio: professional_locations / length(locations),
          avg_confidence: avg_confidence,
          avg_tool_quality: avg_tool_quality,
          highest_confidence: Enum.max_by(locations, & &1.confidence_score).confidence_score
        },
        distribution: %{
          by_type: type_distribution,
          by_context: context_distribution,
          by_professional_level: level_distribution
        },
        professional_scores: %{
          levels: professional_levels,
          equipment_analysis: analyze_equipment_distribution(locations),
          pattern_richness: analyze_pattern_richness(locations)
        },
        trends: %{
          confidence_trend: calculate_confidence_trend(locations),
          activity_patterns: analyze_activity_patterns(locations)
        }
      }
    end
  end

  defp generate_corporate_intelligence(locations) do
    total_sessions = locations
      |> Enum.flat_map(& &1.sessions)
      |> length()

    total_patterns = locations
      |> Enum.flat_map(& &1.patterns)
      |> length()

    # Calculate aggregate intelligence value
    corporate_values = Enum.map(locations, &Locations.get_location_intelligence(&1.id))

    total_value = corporate_values
      |> Enum.map(&(&1.corporate_value.overall_score))
      |> Enum.sum()

    avg_professional_score = corporate_values
      |> Enum.map(& &1.professional_score)
      |> case do
        [] -> 0
        scores -> Enum.sum(scores) |> div(length(scores))
      end

    high_value_locations = corporate_values
      |> Enum.filter(&(&1.corporate_value.overall_score >= 70))
      |> length()

    %{
      intelligence_summary: %{
        total_locations: length(locations),
        high_value_locations: high_value_locations,
        total_data_points: total_sessions + total_patterns,
        avg_professional_score: avg_professional_score,
        total_corporate_value: total_value,
        data_richness_score: calculate_data_richness(corporate_values)
      },
      professional_distribution: analyze_professional_distribution(corporate_values),
      value_segments: segment_by_corporate_value(corporate_values),
      harvesting_opportunities: identify_harvesting_opportunities(corporate_values),
      competitive_intelligence: %{
        tool_brand_analysis: analyze_tool_brands(locations),
        professional_equipment_penetration: calculate_equipment_penetration(locations),
        market_segments: identify_market_segments(locations)
      }
    }
  end

  defp generate_corporate_export(locations, format) do
    export_data = locations
      |> Enum.map(&location_to_export_record/1)

    case format do
      "csv" ->
        headers = "id,location_type,work_context,professional_level,tool_quality_score,confidence_score,equipment_value,session_count,pattern_count\n"
        csv_rows = Enum.map(export_data, fn record ->
          "#{record.id},#{record.location_type},#{record.work_context},#{record.professional_level},#{record.tool_quality_score},#{record.confidence_score},#{record.equipment_value},#{record.session_count},#{record.pattern_count}"
        end)
        headers <> Enum.join(csv_rows, "\n")

      _ ->
        %{
          export_timestamp: DateTime.utc_now(),
          record_count: length(export_data),
          records: export_data
        }
    end
  end

  defp location_to_export_record(location) do
    intelligence = Locations.get_location_intelligence(location.id)

    %{
      id: location.id,
      location_type: location.location_type,
      work_context: location.work_context,
      professional_level: WorkLocation.calculate_professional_level(location),
      tool_quality_score: location.tool_quality_score,
      confidence_score: location.confidence_score,
      equipment_value: intelligence.confidence_indicators.equipment_score,
      session_count: intelligence.session_count,
      pattern_count: intelligence.pattern_count,
      corporate_value: intelligence.corporate_value.overall_score,
      data_richness: intelligence.corporate_value.data_richness
    }
  end

  defp analyze_equipment_distribution(locations) do
    equipment_counts = %{
      has_lift: Enum.count(locations, & &1.has_lift),
      has_compressor: Enum.count(locations, & &1.has_compressor),
      has_welding: Enum.count(locations, & &1.has_welding),
      has_specialty_tools: Enum.count(locations, & &1.has_specialty_tools)
    }

    total = length(locations)

    %{
      counts: equipment_counts,
      penetration_rates: %{
        lift: if(total > 0, do: equipment_counts.has_lift / total * 100, else: 0),
        compressor: if(total > 0, do: equipment_counts.has_compressor / total * 100, else: 0),
        welding: if(total > 0, do: equipment_counts.has_welding / total * 100, else: 0),
        specialty_tools: if(total > 0, do: equipment_counts.has_specialty_tools / total * 100, else: 0)
      }
    }
  end

  defp analyze_pattern_richness(locations) do
    pattern_counts = Enum.map(locations, &length(&1.patterns))

    %{
      total_patterns: Enum.sum(pattern_counts),
      avg_patterns_per_location: if(Enum.empty?(pattern_counts), do: 0, else: Enum.sum(pattern_counts) / length(pattern_counts)),
      max_patterns: if(Enum.empty?(pattern_counts), do: 0, else: Enum.max(pattern_counts)),
      locations_with_patterns: Enum.count(pattern_counts, &(&1 > 0))
    }
  end

  defp calculate_confidence_trend(locations) do
    if length(locations) < 2 do
      "insufficient_data"
    else
      sorted_locations = Enum.sort_by(locations, & &1.inserted_at, DateTime)
      recent_avg = sorted_locations
        |> Enum.take(-3)
        |> Enum.map(& &1.confidence_score)
        |> Enum.sum()
        |> div(min(3, length(sorted_locations)))

      older_avg = sorted_locations
        |> Enum.take(3)
        |> Enum.map(& &1.confidence_score)
        |> Enum.sum()
        |> div(min(3, length(sorted_locations)))

      cond do
        recent_avg > older_avg + 10 -> "improving"
        recent_avg < older_avg - 10 -> "declining"
        true -> "stable"
      end
    end
  end

  defp analyze_activity_patterns(locations) do
    session_counts = Enum.map(locations, &length(&1.sessions))

    %{
      total_sessions: Enum.sum(session_counts),
      active_locations: Enum.count(session_counts, &(&1 > 0)),
      highly_active: Enum.count(session_counts, &(&1 >= 10)),
      avg_sessions_per_location: if(Enum.empty?(session_counts), do: 0, else: Enum.sum(session_counts) / length(session_counts))
    }
  end

  defp analyze_professional_distribution(corporate_values) do
    levels = Enum.map(corporate_values, & &1.professional_level)

    %{
      distribution: Enum.frequencies(levels),
      professional_percentage: Enum.count(levels, &(&1 == "professional")) / max(length(levels), 1) * 100,
      high_value_percentage: Enum.count(corporate_values, &(&1.corporate_value.overall_score >= 70)) / max(length(corporate_values), 1) * 100
    }
  end

  defp segment_by_corporate_value(corporate_values) do
    segments = Enum.group_by(corporate_values, fn cv ->
      cond do
        cv.corporate_value.overall_score >= 80 -> "premium"
        cv.corporate_value.overall_score >= 60 -> "standard"
        cv.corporate_value.overall_score >= 40 -> "developing"
        true -> "basic"
      end
    end)

    Enum.map(segments, fn {segment, values} ->
      {segment, %{
        count: length(values),
        avg_score: Enum.sum(Enum.map(values, & &1.corporate_value.overall_score)) / length(values),
        avg_professional_score: Enum.sum(Enum.map(values, & &1.professional_score)) / length(values)
      }}
    end)
    |> Enum.into(%{})
  end

  defp identify_harvesting_opportunities(corporate_values) do
    high_activity = Enum.filter(corporate_values, &(&1.corporate_value.activity_level >= 60))
    high_data_richness = Enum.filter(corporate_values, &(&1.corporate_value.data_richness >= 70))
    professional_level = Enum.filter(corporate_values, &(&1.professional_level == "professional"))

    %{
      high_activity_locations: length(high_activity),
      rich_data_sources: length(high_data_richness),
      professional_targets: length(professional_level),
      prime_harvest_candidates: length(Enum.filter(corporate_values, fn cv ->
        cv.corporate_value.overall_score >= 75 &&
        cv.professional_level in ["professional", "experienced"] &&
        cv.corporate_value.data_richness >= 60
      end))
    }
  end

  defp analyze_tool_brands(locations) do
    # Extract tool brand information from detected patterns
    all_patterns = Enum.flat_map(locations, & &1.detected_patterns["tools_detected"] || [])

    brand_analysis = %{
      premium_brand_penetration: calculate_premium_brand_percentage(all_patterns),
      total_unique_tools: length(Enum.uniq(all_patterns)),
      specialization_indicators: identify_specialization_tools(all_patterns)
    }

    brand_analysis
  end

  defp calculate_equipment_penetration(locations) do
    if Enum.empty?(locations) do
      %{}
    else
      total = length(locations)
      %{
        professional_lift: Enum.count(locations, & &1.has_lift) / total * 100,
        air_compressor: Enum.count(locations, & &1.has_compressor) / total * 100,
        welding_equipment: Enum.count(locations, & &1.has_welding) / total * 100,
        specialty_tooling: Enum.count(locations, & &1.has_specialty_tools) / total * 100
      }
    end
  end

  defp identify_market_segments(locations) do
    professional_locations = Enum.filter(locations, &(&1.work_context == "professional"))
    personal_locations = Enum.filter(locations, &(&1.work_context == "personal"))

    %{
      professional_market: %{
        count: length(professional_locations),
        avg_tool_quality: if(Enum.empty?(professional_locations), do: 0, else: Enum.sum(Enum.map(professional_locations, & &1.tool_quality_score)) / length(professional_locations)),
        equipment_investment: analyze_equipment_investment(professional_locations)
      },
      enthusiast_market: %{
        count: length(personal_locations),
        avg_tool_quality: if(Enum.empty?(personal_locations), do: 0, else: Enum.sum(Enum.map(personal_locations, & &1.tool_quality_score)) / length(personal_locations)),
        equipment_investment: analyze_equipment_investment(personal_locations)
      }
    }
  end

  defp calculate_premium_brand_percentage(tool_list) do
    if Enum.empty?(tool_list) do
      0
    else
      premium_brands = ["snap-on", "matco", "mac", "cornwell", "milwaukee", "dewalt"]
      premium_count = Enum.count(tool_list, fn tool ->
        Enum.any?(premium_brands, &String.contains?(String.downcase(tool), &1))
      end)

      premium_count / length(tool_list) * 100
    end
  end

  defp identify_specialization_tools(tool_list) do
    specialization_keywords = %{
      "diagnostic" => ["scanner", "diagnostic", "obd", "multimeter"],
      "fabrication" => ["welder", "plasma", "grinder", "fabricat"],
      "restoration" => ["sandblast", "media", "restore", "refinish"],
      "precision" => ["torque", "precision", "calibrat", "measur"]
    }

    Enum.map(specialization_keywords, fn {category, keywords} ->
      count = Enum.count(tool_list, fn tool ->
        Enum.any?(keywords, &String.contains?(String.downcase(tool), &1))
      end)
      {category, count}
    end)
    |> Enum.into(%{})
  end

  defp analyze_equipment_investment(locations) do
    if Enum.empty?(locations) do
      %{avg_investment_level: 0, high_investment_percentage: 0}
    else
      investment_scores = Enum.map(locations, fn location ->
        score = 0
        score = if location.has_lift, do: score + 40, else: score
        score = if location.has_welding, do: score + 25, else: score
        score = if location.has_compressor, do: score + 20, else: score
        score = if location.has_specialty_tools, do: score + 15, else: score
        score
      end)

      avg_investment = Enum.sum(investment_scores) / length(investment_scores)
      high_investment = Enum.count(investment_scores, &(&1 >= 60))

      %{
        avg_investment_level: round(avg_investment),
        high_investment_percentage: high_investment / length(locations) * 100
      }
    end
  end

  defp calculate_data_richness(corporate_values) do
    if Enum.empty?(corporate_values) do
      0
    else
      avg_richness = corporate_values
        |> Enum.map(& &1.corporate_value.data_richness)
        |> Enum.sum()
        |> div(length(corporate_values))

      round(avg_richness)
    end
  end
end