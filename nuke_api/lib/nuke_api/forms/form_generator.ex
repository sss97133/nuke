defmodule NukeApi.Forms.FormGenerator do
  @moduledoc """
  Intelligent form generation based on detected vehicle work.

  Analyzes spatial tags, timeline events, and images to suggest
  appropriate data collection forms for manual input.
  """

  alias NukeApi.Vehicles
  alias NukeApi.Forms.PaintSystemForm

  @doc """
  Generate all applicable forms for a vehicle based on detected work.
  Returns list of forms with completion percentages and priority levels.
  """
  def generate_forms_for_vehicle(vehicle_id) do
    vehicle = Vehicles.get_vehicle!(vehicle_id)
    timeline_events = Vehicles.list_timeline_events(vehicle_id)
    images = Vehicles.list_vehicle_images(vehicle_id)

    detected_work = analyze_detected_work(timeline_events, images)

    generate_forms_from_detected_work(vehicle_id, detected_work)
  end

  @doc """
  Analyze timeline events and images to detect restoration work categories.
  """
  def analyze_detected_work(timeline_events, images) do
    work_categories = %{}

    # Analyze spatial tags in images
    work_categories =
      images
      |> extract_spatial_tag_patterns()
      |> merge_work_categories(work_categories)

    # Analyze timeline event descriptions
    work_categories =
      timeline_events
      |> extract_timeline_patterns()
      |> merge_work_categories(work_categories)

    work_categories
  end

  defp extract_spatial_tag_patterns(images) do
    work_patterns = %{
      # Paint & Body Work
      "paint_system" => ~r/(paint|primer|clear_coat|color|finish|spray)/i,
      "body_panels" => ~r/(fender|door|hood|trunk|quarter_panel|grill)/i,
      "trim_work" => ~r/(trim|molding|chrome|badge|emblem)/i,

      # Lighting Systems
      "lighting_upgrade" => ~r/(headlight|led|halogen|turn_signal|brake_light)/i,
      "wiring_work" => ~r/(wire|wiring|electrical|harness|connector)/i,

      # Hardware & Fasteners
      "fastener_upgrade" => ~r/(bolt|screw|nut|stud|fastener|hardware)/i,
      "suspension_work" => ~r/(shock|spring|strut|bushing|ball_joint)/i,

      # Drivetrain
      "engine_work" => ~r/(engine|motor|cylinder|piston|cam|crank)/i,
      "transmission_work" => ~r/(transmission|clutch|gear|shift)/i,

      # Interior
      "interior_restore" => ~r/(seat|dashboard|carpet|headliner|door_panel)/i,
      "mirror_upgrade" => ~r/(mirror|side_mirror|rearview)/i
    }

    detected_categories = %{}

    Enum.reduce(images, detected_categories, fn image, acc ->
      tags = extract_tags_from_image(image)

      Enum.reduce(work_patterns, acc, fn {category, pattern}, category_acc ->
        if Enum.any?(tags, &Regex.match?(pattern, &1)) do
          evidence = %{
            "images" => [image.id],
            "confidence" => calculate_tag_confidence(tags, pattern),
            "detected_elements" => Enum.filter(tags, &Regex.match?(pattern, &1))
          }

          Map.update(category_acc, category, evidence, fn existing ->
            %{
              "images" => existing["images"] ++ [image.id],
              "confidence" => max(existing["confidence"], evidence["confidence"]),
              "detected_elements" => existing["detected_elements"] ++ evidence["detected_elements"]
            }
          end)
        else
          category_acc
        end
      end)
    end)
  end

  defp extract_timeline_patterns(timeline_events) do
    work_indicators = %{
      "paint_system" => ~r/(painted|paint job|primer|clear coat|color match|spray)/i,
      "body_panels" => ~r/(replaced.*fender|new grill|body work|dent repair)/i,
      "lighting_upgrade" => ~r/(led upgrade|headlight|new lights|wiring)/i,
      "fastener_upgrade" => ~r/(new bolts|upgraded hardware|replaced screws)/i,
      "trim_work" => ~r/(trim work|molding|chrome|cut.*trim)/i,
      "mirror_upgrade" => ~r/(mirror|side mirror|replaced mirror)/i
    }

    detected_work = %{}

    Enum.reduce(timeline_events, detected_work, fn event, acc ->
      description = "#{event.title || ""} #{event.description || ""}"

      Enum.reduce(work_indicators, acc, fn {category, pattern}, category_acc ->
        if Regex.match?(pattern, description) do
          evidence = %{
            "timeline_events" => [event.id],
            "confidence" => 0.8,  # Timeline events are pretty reliable
            "descriptions" => [description]
          }

          Map.update(category_acc, category, evidence, fn existing ->
            %{
              "timeline_events" => existing["timeline_events"] ++ [event.id],
              "confidence" => max(existing["confidence"], evidence["confidence"]),
              "descriptions" => existing["descriptions"] ++ [description]
            }
          end)
        else
          category_acc
        end
      end)
    end)
  end

  defp extract_tags_from_image(image) do
    # Extract from various tag sources
    spatial_tags = image.spatial_tags || []
    labels = image.labels || []
    caption_words = if image.caption, do: String.split(image.caption, ~r/\s+/), else: []

    spatial_tags ++ labels ++ caption_words
  end

  defp calculate_tag_confidence(tags, pattern) do
    matching_tags = Enum.count(tags, &Regex.match?(pattern, &1))
    total_tags = length(tags)

    if total_tags > 0 do
      min(matching_tags / total_tags * 2, 1.0)  # Cap at 1.0
    else
      0.0
    end
  end

  defp merge_work_categories(new_categories, existing_categories) do
    Map.merge(existing_categories, new_categories, fn _key, existing, new ->
      %{
        "images" => (existing["images"] || []) ++ (new["images"] || []),
        "timeline_events" => (existing["timeline_events"] || []) ++ (new["timeline_events"] || []),
        "confidence" => max(existing["confidence"] || 0, new["confidence"] || 0),
        "detected_elements" => (existing["detected_elements"] || []) ++ (new["detected_elements"] || []),
        "descriptions" => (existing["descriptions"] || []) ++ (new["descriptions"] || [])
      }
    end)
  end

  defp generate_forms_from_detected_work(vehicle_id, detected_work) do
    detected_work
    |> Enum.map(fn {category, evidence} ->
      generate_form_for_category(vehicle_id, category, evidence)
    end)
    |> Enum.reject(&is_nil/1)
    |> Enum.sort_by(& &1.priority, :desc)  # Highest priority first
  end

  defp generate_form_for_category(vehicle_id, "paint_system", evidence) do
    form_template = PaintSystemForm.generate_template(vehicle_id, evidence)

    %{
      category: "paint_system",
      title: "Paint System Documentation",
      description: "Document your paint job materials, process, and labor",
      form_template: form_template,
      completion_percentage: 0.0,  # New form
      priority: calculate_priority("paint_system", evidence),
      evidence_summary: summarize_evidence(evidence),
      estimated_time_minutes: 15,  # Time to fill out form
      value_impact: "High - Paint quality significantly affects vehicle value"
    }
  end

  defp generate_form_for_category(vehicle_id, "lighting_upgrade", evidence) do
    %{
      category: "lighting_upgrade",
      title: "LED Headlight Conversion",
      description: "Document LED upgrade including wiring, parts, and installation",
      form_template: %{
        vehicle_id: vehicle_id,
        component_category: "lighting",
        component_type: "led_headlight_conversion",
        # Pre-populate from evidence
        brand: extract_likely_brand(evidence),
        installation_type: "diy_wiring"  # Based on your description
      },
      completion_percentage: 0.0,
      priority: calculate_priority("lighting_upgrade", evidence),
      evidence_summary: summarize_evidence(evidence),
      estimated_time_minutes: 8,
      value_impact: "Medium - Safety and appearance improvement"
    }
  end

  defp generate_form_for_category(vehicle_id, "fastener_upgrade", evidence) do
    %{
      category: "fastener_upgrade",
      title: "Fastener & Hardware Documentation",
      description: "Track fastener quality - identify upgrade opportunities",
      form_template: %{
        vehicle_id: vehicle_id,
        component_category: "fasteners",
        current_quality: "economy",  # You mentioned "Chinese" bolts
        upgrade_opportunity: true
      },
      completion_percentage: 0.0,
      priority: calculate_priority("fastener_upgrade", evidence),
      evidence_summary: summarize_evidence(evidence),
      estimated_time_minutes: 10,
      value_impact: "Medium - Quality fasteners improve reliability and value"
    }
  end

  defp generate_form_for_category(_vehicle_id, _category, _evidence) do
    # Default handler for unimplemented categories
    nil
  end

  defp calculate_priority(category, evidence) do
    base_priority = case category do
      "paint_system" -> 90        # Highest visual impact
      "engine_work" -> 85         # Highest mechanical impact
      "lighting_upgrade" -> 70    # Safety critical
      "body_panels" -> 65         # High visual impact
      "fastener_upgrade" -> 60    # Quality/reliability
      "trim_work" -> 50           # Appearance
      _ -> 30
    end

    # Boost priority based on evidence strength
    confidence_boost = (evidence["confidence"] || 0) * 20
    image_boost = min(length(evidence["images"] || []) * 5, 15)

    min(base_priority + confidence_boost + image_boost, 100)
  end

  defp summarize_evidence(evidence) do
    image_count = length(evidence["images"] || [])
    timeline_count = length(evidence["timeline_events"] || [])
    detected_elements = evidence["detected_elements"] || []

    summary_parts = []

    if image_count > 0 do
      summary_parts = ["#{image_count} images" | summary_parts]
    end

    if timeline_count > 0 do
      summary_parts = ["#{timeline_count} timeline events" | summary_parts]
    end

    if length(detected_elements) > 0 do
      top_elements = detected_elements |> Enum.take(3) |> Enum.join(", ")
      summary_parts = ["Found: #{top_elements}" | summary_parts]
    end

    if length(summary_parts) > 0 do
      Enum.join(summary_parts, " • ")
    else
      "Work detected - ready for documentation"
    end
  end

  defp extract_likely_brand(evidence) do
    # Simple brand extraction from detected elements
    brand_patterns = %{
      "led" => ["Philips", "OSRAM", "Sylvania"],
      "headlight" => ["Hella", "Bosch", "OEM"],
      "wire" => ["Marine Grade", "OFC", "Standard"]
    }

    detected = evidence["detected_elements"] || []

    Enum.find_value(brand_patterns, fn {pattern, brands} ->
      if Enum.any?(detected, &String.contains?(String.downcase(&1), pattern)) do
        List.first(brands)  # Default to first brand
      end
    end) || "Unknown"
  end
end