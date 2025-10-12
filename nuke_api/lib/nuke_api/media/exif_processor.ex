defmodule NukeApi.Media.ExifProcessor do
  @moduledoc """
  EXIF data processing service for automated location tagging and metadata extraction.

  Processes EXIF data from uploaded images to automatically generate location tags,
  timestamp information, camera details, and GPS coordinates for corporate data harvesting.
  """

  alias NukeApi.Vehicles.SpatialTag
  alias NukeApi.Repo

  @doc """
  Processes EXIF data from an uploaded image and creates automated tags.
  """
  def process_image_exif(image_id, exif_data) when is_map(exif_data) do
    tags = []

    # Extract GPS location if available
    tags = if has_gps_data?(exif_data) do
      location_tag = create_location_tag_from_gps(image_id, exif_data)
      [location_tag | tags]
    else
      tags
    end

    # Extract timestamp information
    tags = if has_timestamp_data?(exif_data) do
      timestamp_tag = create_timestamp_tag(image_id, exif_data)
      [timestamp_tag | tags]
    else
      tags
    end

    # Extract camera and technical details
    tags = if has_camera_data?(exif_data) do
      camera_tags = create_camera_tags(image_id, exif_data)
      camera_tags ++ tags
    else
      tags
    end

    # Extract lighting and environmental conditions
    tags = if has_environmental_data?(exif_data) do
      env_tags = create_environmental_tags(image_id, exif_data)
      env_tags ++ tags
    else
      tags
    end

    # Insert all created tags
    results = Enum.map(tags, fn tag_attrs ->
      changeset = SpatialTag.changeset(%SpatialTag{}, tag_attrs)
      Repo.insert(changeset)
    end)

    # Return summary
    successful = Enum.count(results, &match?({:ok, _}, &1))
    failed = Enum.count(results, &match?({:error, _}, &1))

    %{
      total_tags_created: successful,
      failed_tags: failed,
      processing_summary: %{
        gps_location: has_gps_data?(exif_data),
        timestamp: has_timestamp_data?(exif_data),
        camera_info: has_camera_data?(exif_data),
        environmental: has_environmental_data?(exif_data)
      },
      exif_data: exif_data
    }
  end

  @doc """
  Analyzes EXIF data to determine work context and professional indicators.
  """
  def analyze_work_context(exif_data) do
    context_indicators = %{
      professional_camera: is_professional_camera?(exif_data),
      consistent_lighting: has_consistent_lighting?(exif_data),
      technical_metadata: has_technical_metadata?(exif_data),
      time_of_day: analyze_work_hours(exif_data),
      location_context: analyze_location_context(exif_data)
    }

    professional_score = calculate_professional_score(context_indicators)

    %{
      context_indicators: context_indicators,
      professional_score: professional_score,
      work_context: determine_work_context(professional_score),
      confidence: calculate_context_confidence(context_indicators)
    }
  end

  @doc """
  Extracts corporate intelligence from EXIF patterns across multiple images.
  """
  def generate_exif_intelligence(exif_data_list) when is_list(exif_data_list) do
    %{
      total_images: length(exif_data_list),
      camera_analysis: analyze_camera_patterns(exif_data_list),
      location_analysis: analyze_location_patterns(exif_data_list),
      timing_analysis: analyze_timing_patterns(exif_data_list),
      technical_analysis: analyze_technical_patterns(exif_data_list),
      professional_indicators: analyze_professional_indicators(exif_data_list)
    }
  end

  ## Private Functions

  defp has_gps_data?(exif_data) do
    Map.has_key?(exif_data, "GPSLatitude") && Map.has_key?(exif_data, "GPSLongitude")
  end

  defp has_timestamp_data?(exif_data) do
    Map.has_key?(exif_data, "DateTime") || Map.has_key?(exif_data, "DateTimeOriginal")
  end

  defp has_camera_data?(exif_data) do
    Map.has_key?(exif_data, "Make") || Map.has_key?(exif_data, "Model")
  end

  defp has_environmental_data?(exif_data) do
    Map.has_key?(exif_data, "Flash") || Map.has_key?(exif_data, "ISO") ||
    Map.has_key?(exif_data, "ExposureTime")
  end

  defp create_location_tag_from_gps(image_id, exif_data) do
    gps_coords = extract_gps_coordinates(exif_data)
    location_name = reverse_geocode_location(gps_coords)

    %{
      image_id: image_id,
      x_position: 50.0, # Center position since GPS covers whole image
      y_position: 50.0,
      tag_type: "location",
      text: location_name || "GPS Location",
      source_type: "exif",
      exif_data: exif_data,
      gps_coordinates: gps_coords,
      automated_confidence: calculate_gps_confidence(gps_coords),
      needs_human_verification: false,
      trust_score: 85,
      metadata: %{
        "gps_accuracy" => Map.get(gps_coords, "accuracy", 10),
        "location_source" => "gps_exif"
      }
    }
  end

  defp create_timestamp_tag(image_id, exif_data) do
    datetime = Map.get(exif_data, "DateTimeOriginal") || Map.get(exif_data, "DateTime")
    parsed_time = parse_exif_datetime(datetime)

    work_hours_indicator = if parsed_time do
      hour = parsed_time.hour
      cond do
        hour >= 8 && hour <= 17 -> "business_hours"
        hour >= 6 && hour <= 20 -> "extended_hours"
        true -> "after_hours"
      end
    else
      "unknown"
    end

    %{
      image_id: image_id,
      x_position: 95.0, # Top right corner for timestamp
      y_position: 5.0,
      tag_type: "location",
      text: "Taken: #{datetime || "Unknown time"}",
      source_type: "exif",
      exif_data: %{"DateTime" => datetime},
      automated_confidence: if(datetime, do: 1.0, else: 0.0),
      needs_human_verification: false,
      trust_score: if(datetime, do: 95, else: 20),
      metadata: %{
        "timestamp_source" => "exif",
        "work_hours_indicator" => work_hours_indicator,
        "parsed_datetime" => parsed_time && DateTime.to_iso8601(parsed_time)
      }
    }
  end

  defp create_camera_tags(image_id, exif_data) do
    tags = []

    # Camera make/model tag
    if Map.has_key?(exif_data, "Make") || Map.has_key?(exif_data, "Model") do
      camera_name = "#{Map.get(exif_data, "Make", "")} #{Map.get(exif_data, "Model", "")}" |> String.trim()

      camera_tag = %{
        image_id: image_id,
        x_position: 5.0, # Top left corner
        y_position: 5.0,
        tag_type: "tool",
        text: "Camera: #{camera_name}",
        source_type: "exif",
        exif_data: Map.take(exif_data, ["Make", "Model"]),
        automated_confidence: 0.95,
        needs_human_verification: false,
        trust_score: 90,
        metadata: %{
          "camera_make" => Map.get(exif_data, "Make"),
          "camera_model" => Map.get(exif_data, "Model"),
          "professional_indicator" => is_professional_camera?(exif_data)
        }
      }

      tags = [camera_tag | tags]
    end

    # Lens information if available
    if Map.has_key?(exif_data, "LensModel") do
      lens_tag = %{
        image_id: image_id,
        x_position: 5.0,
        y_position: 15.0,
        tag_type: "tool",
        text: "Lens: #{Map.get(exif_data, "LensModel")}",
        source_type: "exif",
        exif_data: Map.take(exif_data, ["LensModel"]),
        automated_confidence: 0.9,
        needs_human_verification: false,
        trust_score: 85,
        metadata: %{
          "lens_model" => Map.get(exif_data, "LensModel")
        }
      }

      tags = [lens_tag | tags]
    end

    tags
  end

  defp create_environmental_tags(image_id, exif_data) do
    tags = []

    # Lighting conditions
    lighting_tag = analyze_lighting_conditions(image_id, exif_data)
    if lighting_tag, do: tags = [lighting_tag | tags]

    # Flash usage
    if Map.has_key?(exif_data, "Flash") do
      flash_used = Map.get(exif_data, "Flash") != "No Flash"

      flash_tag = %{
        image_id: image_id,
        x_position: 85.0,
        y_position: 5.0,
        tag_type: "location",
        text: if(flash_used, do: "Flash Used", else: "Natural Light"),
        source_type: "exif",
        exif_data: Map.take(exif_data, ["Flash"]),
        automated_confidence: 0.9,
        needs_human_verification: false,
        trust_score: 80,
        metadata: %{
          "flash_used" => flash_used,
          "lighting_quality" => if(flash_used, do: "artificial", else: "natural")
        }
      }

      tags = [flash_tag | tags]
    end

    tags
  end

  defp extract_gps_coordinates(exif_data) do
    with {:ok, lat} <- Map.fetch(exif_data, "GPSLatitude"),
         {:ok, lng} <- Map.fetch(exif_data, "GPSLongitude"),
         {:ok, lat_ref} <- Map.fetch(exif_data, "GPSLatitudeRef"),
         {:ok, lng_ref} <- Map.fetch(exif_data, "GPSLongitudeRef") do

      lat_decimal = convert_gps_coordinate(lat, lat_ref)
      lng_decimal = convert_gps_coordinate(lng, lng_ref)

      %{
        "latitude" => lat_decimal,
        "longitude" => lng_decimal,
        "accuracy" => Map.get(exif_data, "GPSAccuracy", 10),
        "altitude" => Map.get(exif_data, "GPSAltitude")
      }
    else
      _ -> %{}
    end
  end

  defp convert_gps_coordinate(coordinate, reference) when is_binary(coordinate) do
    # Handle both DMS format and decimal format
    cond do
      String.contains?(coordinate, "/") ->
        parse_dms_coordinate(coordinate, reference)
      true ->
        decimal = String.to_float(coordinate)
        if reference in ["S", "W"], do: -decimal, else: decimal
    end
  end

  defp convert_gps_coordinate(coordinate, reference) when is_float(coordinate) do
    if reference in ["S", "W"], do: -coordinate, else: coordinate
  end

  defp parse_dms_coordinate(dms_string, reference) do
    # Parse DMS format: "40/1,26/1,46.302/1000"
    parts = String.split(dms_string, ",")

    case parts do
      [degrees, minutes, seconds] ->
        deg = parse_fraction(degrees)
        min = parse_fraction(minutes)
        sec = parse_fraction(seconds)

        decimal = deg + (min / 60) + (sec / 3600)
        if reference in ["S", "W"], do: -decimal, else: decimal

      _ ->
        0.0
    end
  end

  defp parse_fraction(fraction_str) do
    case String.split(fraction_str, "/") do
      [numerator, denominator] ->
        String.to_float(numerator) / String.to_float(denominator)
      [number] ->
        String.to_float(number)
      _ ->
        0.0
    end
  rescue
    _ -> 0.0
  end

  defp reverse_geocode_location(%{"latitude" => lat, "longitude" => lng}) when is_number(lat) and is_number(lng) do
    # Simple location classification based on coordinates
    # In production, this would use a reverse geocoding service

    cond do
      lat > 0 && lng > 0 -> "Workshop Location"
      lat != 0 || lng != 0 -> "Outdoor Location"
      true -> "Unknown Location"
    end
  end

  defp reverse_geocode_location(_), do: "Unknown Location"

  defp calculate_gps_confidence(%{"accuracy" => accuracy}) when is_number(accuracy) do
    # Higher accuracy = higher confidence
    cond do
      accuracy <= 5 -> 0.95
      accuracy <= 10 -> 0.9
      accuracy <= 20 -> 0.8
      true -> 0.7
    end
  end

  defp calculate_gps_confidence(_), do: 0.8

  defp parse_exif_datetime(datetime_string) when is_binary(datetime_string) do
    # Parse EXIF datetime format: "2023:12:25 14:30:45"
    case String.split(datetime_string, " ") do
      [date_part, time_part] ->
        date_components = String.split(date_part, ":")
        time_components = String.split(time_part, ":")

        case {date_components, time_components} do
          {[year, month, day], [hour, minute, second]} ->
            with {:ok, date} <- Date.new(
                   String.to_integer(year),
                   String.to_integer(month),
                   String.to_integer(day)
                 ),
                 {:ok, time} <- Time.new(
                   String.to_integer(hour),
                   String.to_integer(minute),
                   String.to_integer(String.split(second, ".") |> List.first())
                 ),
                 {:ok, datetime} <- DateTime.new(date, time) do
              {:ok, datetime}
            else
              _ -> {:error, :invalid_datetime}
            end
            |> case do
              {:ok, dt} -> dt
              _ -> nil
            end

          _ -> nil
        end

      _ -> nil
    end
  rescue
    _ -> nil
  end

  defp parse_exif_datetime(_), do: nil

  defp analyze_lighting_conditions(image_id, exif_data) do
    iso = Map.get(exif_data, "ISO")
    aperture = Map.get(exif_data, "FNumber")
    exposure = Map.get(exif_data, "ExposureTime")

    lighting_quality = cond do
      # High ISO suggests low light
      iso && String.to_integer(iso) > 800 -> "low_light"
      # Very low ISO suggests bright conditions
      iso && String.to_integer(iso) < 200 -> "bright_light"
      # Flash was used
      Map.get(exif_data, "Flash") && Map.get(exif_data, "Flash") != "No Flash" -> "artificial_light"
      true -> "moderate_light"
    end

    %{
      image_id: image_id,
      x_position: 50.0,
      y_position: 95.0,
      tag_type: "location",
      text: "Lighting: #{String.replace(lighting_quality, "_", " ")}",
      source_type: "exif",
      exif_data: Map.take(exif_data, ["ISO", "FNumber", "ExposureTime", "Flash"]),
      automated_confidence: 0.75,
      needs_human_verification: false,
      trust_score: 70,
      metadata: %{
        "lighting_quality" => lighting_quality,
        "iso" => iso,
        "aperture" => aperture,
        "exposure_time" => exposure
      }
    }
  rescue
    _ -> nil
  end

  defp is_professional_camera?(exif_data) do
    make = Map.get(exif_data, "Make", "") |> String.downcase()
    model = Map.get(exif_data, "Model", "") |> String.downcase()

    professional_brands = ["canon", "nikon", "sony", "fujifilm", "leica", "hasselblad"]
    professional_indicators = ["mark", "pro", "dslr", "mirrorless", "professional"]

    brand_match = Enum.any?(professional_brands, &String.contains?(make, &1))
    model_match = Enum.any?(professional_indicators, &String.contains?(model, &1))

    brand_match || model_match
  end

  defp has_consistent_lighting?(exif_data) do
    # Check if lighting settings suggest controlled environment
    flash_used = Map.get(exif_data, "Flash") && Map.get(exif_data, "Flash") != "No Flash"
    iso = Map.get(exif_data, "ISO")

    # Consistent ISO and controlled flash usage suggests professional setup
    if iso do
      iso_value = String.to_integer(iso)
      # Professional photos often use lower, consistent ISO
      (iso_value <= 400) || flash_used
    else
      false
    end
  rescue
    _ -> false
  end

  defp has_technical_metadata?(exif_data) do
    technical_fields = ["ExposureTime", "FNumber", "ISO", "FocalLength", "WhiteBalance"]
    field_count = Enum.count(technical_fields, &Map.has_key?(exif_data, &1))

    # Professional cameras typically record more technical metadata
    field_count >= 3
  end

  defp analyze_work_hours(exif_data) do
    datetime = Map.get(exif_data, "DateTimeOriginal") || Map.get(exif_data, "DateTime")

    if datetime do
      parsed = parse_exif_datetime(datetime)

      if parsed do
        hour = parsed.hour
        day_of_week = Date.day_of_week(DateTime.to_date(parsed))

        %{
          hour: hour,
          day_of_week: day_of_week,
          is_business_hours: hour >= 8 && hour <= 17,
          is_weekday: day_of_week <= 5,
          work_context: determine_time_context(hour, day_of_week)
        }
      else
        %{work_context: "unknown"}
      end
    else
      %{work_context: "unknown"}
    end
  end

  defp analyze_location_context(exif_data) do
    gps_coords = extract_gps_coordinates(exif_data)

    if Map.has_key?(gps_coords, "latitude") do
      %{
        has_location: true,
        location_type: classify_location_type(gps_coords),
        accuracy: Map.get(gps_coords, "accuracy", 10)
      }
    else
      %{has_location: false, location_type: "unknown"}
    end
  end

  defp calculate_professional_score(indicators) do
    score = 0

    score = score + if indicators.professional_camera, do: 25, else: 0
    score = score + if indicators.consistent_lighting, do: 20, else: 0
    score = score + if indicators.technical_metadata, do: 15, else: 0

    # Time context scoring
    score = score + case indicators.time_of_day.work_context do
      "professional" -> 20
      "extended_professional" -> 15
      "hobby" -> 10
      _ -> 5
    end

    # Location context scoring
    score = score + case indicators.location_context.location_type do
      "workshop" -> 20
      "garage" -> 15
      "outdoor_work" -> 10
      _ -> 0
    end

    min(score, 100)
  end

  defp determine_work_context(professional_score) do
    cond do
      professional_score >= 80 -> "professional"
      professional_score >= 60 -> "experienced_hobbyist"
      professional_score >= 40 -> "hobbyist"
      true -> "casual"
    end
  end

  defp calculate_context_confidence(indicators) do
    confidence_factors = [
      indicators.professional_camera && 0.2 || 0.0,
      indicators.technical_metadata && 0.25 || 0.0,
      indicators.location_context.has_location && 0.3 || 0.0,
      indicators.time_of_day.work_context != "unknown" && 0.25 || 0.0
    ]

    Enum.sum(confidence_factors)
  end

  defp determine_time_context(hour, day_of_week) do
    cond do
      # Business hours on weekdays
      day_of_week <= 5 && hour >= 8 && hour <= 17 -> "professional"
      # Extended business hours on weekdays
      day_of_week <= 5 && hour >= 6 && hour <= 20 -> "extended_professional"
      # Weekend work
      day_of_week > 5 -> "hobby"
      # Late night/early morning
      true -> "after_hours"
    end
  end

  defp classify_location_type(%{"latitude" => lat, "longitude" => lng}) do
    # Simple classification - in production would use geocoding services
    # This is a placeholder for demonstration

    cond do
      # Check if coordinates suggest indoor/controlled environment
      rem(trunc(lat * 1000), 10) == 0 && rem(trunc(lng * 1000), 10) == 0 -> "workshop"
      # Other location type classifications would go here
      true -> "outdoor_work"
    end
  end

  defp classify_location_type(_), do: "unknown"

  # Analysis functions for intelligence generation

  defp analyze_camera_patterns(exif_data_list) do
    cameras = exif_data_list
      |> Enum.map(fn data -> "#{Map.get(data, "Make", "")} #{Map.get(data, "Model", "")}" |> String.trim() end)
      |> Enum.reject(&(&1 == ""))
      |> Enum.frequencies()

    professional_cameras = exif_data_list
      |> Enum.count(&is_professional_camera?/1)

    %{
      camera_frequencies: cameras,
      professional_camera_usage: professional_cameras / max(length(exif_data_list), 1),
      camera_diversity: length(Map.keys(cameras))
    }
  end

  defp analyze_location_patterns(exif_data_list) do
    gps_data = exif_data_list
      |> Enum.map(&extract_gps_coordinates/1)
      |> Enum.reject(&Enum.empty?/1)

    %{
      gps_enabled_percentage: length(gps_data) / max(length(exif_data_list), 1),
      location_diversity: analyze_location_diversity(gps_data),
      common_locations: identify_common_locations(gps_data)
    }
  end

  defp analyze_timing_patterns(exif_data_list) do
    timestamps = exif_data_list
      |> Enum.map(&(Map.get(&1, "DateTimeOriginal") || Map.get(&1, "DateTime")))
      |> Enum.reject(&is_nil/1)
      |> Enum.map(&parse_exif_datetime/1)
      |> Enum.reject(&is_nil/1)

    if Enum.empty?(timestamps) do
      %{work_pattern: "unknown"}
    else
      work_hours = timestamps
        |> Enum.map(fn dt -> {dt.hour, Date.day_of_week(DateTime.to_date(dt))} end)

      business_hours = Enum.count(work_hours, fn {hour, day} ->
        day <= 5 && hour >= 8 && hour <= 17
      end)

      %{
        work_pattern: if(business_hours / length(timestamps) > 0.7, do: "professional", else: "hobbyist"),
        business_hours_percentage: business_hours / length(timestamps),
        most_active_hours: analyze_active_hours(timestamps),
        weekend_activity: analyze_weekend_activity(timestamps)
      }
    end
  end

  defp analyze_technical_patterns(exif_data_list) do
    technical_completeness = exif_data_list
      |> Enum.map(&has_technical_metadata?/1)
      |> Enum.count(& &1)

    %{
      technical_metadata_percentage: technical_completeness / max(length(exif_data_list), 1),
      avg_technical_fields: calculate_avg_technical_fields(exif_data_list),
      consistency_indicators: analyze_setting_consistency(exif_data_list)
    }
  end

  defp analyze_professional_indicators(exif_data_list) do
    professional_indicators = exif_data_list
      |> Enum.map(&analyze_work_context/1)
      |> Enum.map(& &1.professional_score)

    if Enum.empty?(professional_indicators) do
      %{overall_professional_score: 0}
    else
      %{
        overall_professional_score: Enum.sum(professional_indicators) / length(professional_indicators),
        professional_image_percentage: Enum.count(professional_indicators, &(&1 >= 60)) / length(professional_indicators),
        consistency_score: calculate_consistency_score(professional_indicators)
      }
    end
  end

  # Helper functions for analysis

  defp analyze_location_diversity(gps_data) do
    # Simple diversity calculation based on coordinate clustering
    unique_locations = gps_data
      |> Enum.map(fn coords ->
        # Round to approximate location grouping
        lat_rounded = Float.round(coords["latitude"] || 0.0, 3)
        lng_rounded = Float.round(coords["longitude"] || 0.0, 3)
        {lat_rounded, lng_rounded}
      end)
      |> Enum.uniq()

    length(unique_locations)
  end

  defp identify_common_locations(gps_data) do
    gps_data
    |> Enum.map(fn coords ->
      lat_rounded = Float.round(coords["latitude"] || 0.0, 3)
      lng_rounded = Float.round(coords["longitude"] || 0.0, 3)
      {lat_rounded, lng_rounded}
    end)
    |> Enum.frequencies()
    |> Enum.sort_by(&elem(&1, 1), :desc)
    |> Enum.take(5)
  end

  defp analyze_active_hours(timestamps) do
    timestamps
    |> Enum.map(& &1.hour)
    |> Enum.frequencies()
    |> Enum.sort_by(&elem(&1, 1), :desc)
    |> Enum.take(3)
  end

  defp analyze_weekend_activity(timestamps) do
    weekend_count = timestamps
      |> Enum.count(fn dt -> Date.day_of_week(DateTime.to_date(dt)) > 5 end)

    weekend_count / length(timestamps)
  end

  defp calculate_avg_technical_fields(exif_data_list) do
    technical_fields = ["ExposureTime", "FNumber", "ISO", "FocalLength", "WhiteBalance"]

    field_counts = exif_data_list
      |> Enum.map(fn data ->
        Enum.count(technical_fields, &Map.has_key?(data, &1))
      end)

    if Enum.empty?(field_counts) do
      0
    else
      Enum.sum(field_counts) / length(field_counts)
    end
  end

  defp analyze_setting_consistency(exif_data_list) do
    # Analyze consistency of camera settings across images
    iso_values = exif_data_list
      |> Enum.map(&Map.get(&1, "ISO"))
      |> Enum.reject(&is_nil/1)
      |> Enum.frequencies()

    %{
      iso_consistency: if(Enum.empty?(iso_values), do: 0, else: (Enum.max_by(iso_values, &elem(&1, 1)) |> elem(1)) / length(iso_values)),
      settings_variation: calculate_settings_variation(exif_data_list)
    }
  end

  defp calculate_settings_variation(exif_data_list) do
    # Simple variation calculation - lower variation suggests more professional/consistent work
    settings_fields = ["ISO", "FNumber", "ExposureTime"]

    variations = settings_fields
      |> Enum.map(fn field ->
        values = exif_data_list
          |> Enum.map(&Map.get(&1, field))
          |> Enum.reject(&is_nil/1)
          |> Enum.uniq()

        length(values)
      end)
      |> Enum.sum()

    # Lower variation score indicates more consistent (professional) settings
    max_possible_variation = length(settings_fields) * length(exif_data_list)
    1.0 - (variations / max(max_possible_variation, 1))
  end

  defp calculate_consistency_score(professional_scores) do
    if length(professional_scores) < 2 do
      0
    else
      mean = Enum.sum(professional_scores) / length(professional_scores)
      variance = professional_scores
        |> Enum.map(&((&1 - mean) * (&1 - mean)))
        |> Enum.sum()
        |> Kernel./(length(professional_scores))

      # Lower variance = higher consistency
      max(0, 100 - variance)
    end
  end
end