defmodule NukeApi.Skynalysis.Processors.AWSRekognition do
  @moduledoc """
  AWS Rekognition processor for vehicle image analysis.

  Provides comprehensive image analysis including:
  - Object and scene detection
  - Text extraction (OCR)
  - Label detection with confidence scores
  - Custom model integration for automotive parts
  """

  @behaviour NukeApi.Skynalysis.ProcessorBehaviour

  alias NukeApi.Vehicles.SpatialTag
  require Logger

  # AWS Rekognition configuration
  @region "us-west-2"
  @max_labels 50
  @min_confidence 0.7

  @doc """
  Analyze vehicle images using AWS Rekognition
  """
  def analyze(%{input_images: images, input_parameters: params} = analysis) do
    start_time = System.monotonic_time(:millisecond)

    with {:ok, aws_config} <- get_aws_config(),
         {:ok, results} <- process_images(images, aws_config, params),
         {:ok, spatial_tags} <- extract_spatial_tags(results, analysis.vehicle_id),
         {:ok, summary} <- generate_summary(results) do

      end_time = System.monotonic_time(:millisecond)
      processing_time = end_time - start_time

      {:ok, %{
        raw_response: results,
        summary: summary,
        confidence_score: calculate_overall_confidence(results),
        key_findings: extract_key_findings(results),
        recommendations: generate_recommendations(results),
        spatial_tags: spatial_tags,
        processing_time_ms: processing_time,
        cost_cents: calculate_cost(images, results)
      }}
    else
      {:error, reason} ->
        Logger.error("AWS Rekognition analysis failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  # Private functions

  defp get_aws_config do
    case {System.get_env("AWS_ACCESS_KEY_ID"), System.get_env("AWS_SECRET_ACCESS_KEY")} do
      {nil, _} -> {:error, "AWS_ACCESS_KEY_ID not configured"}
      {_, nil} -> {:error, "AWS_SECRET_ACCESS_KEY not configured"}
      {access_key, secret_key} ->
        {:ok, %{
          access_key_id: access_key,
          secret_access_key: secret_key,
          region: @region
        }}
    end
  end

  defp process_images(images, aws_config, params) do
    results = Enum.map(images, fn image ->
      with {:ok, image_data} <- load_image_data(image),
           {:ok, labels} <- detect_labels(image_data, aws_config),
           {:ok, text_detections} <- detect_text(image_data, aws_config),
           {:ok, objects} <- detect_custom_labels(image_data, aws_config, params) do

        %{
          image_id: image.id || generate_temp_id(),
          file_name: image.file_name,
          labels: labels,
          text_detections: text_detections,
          custom_objects: objects,
          processing_status: "completed"
        }
      else
        {:error, reason} ->
          Logger.warning("Failed to process image #{image.file_name}: #{inspect(reason)}")
          %{
            image_id: image.id || generate_temp_id(),
            file_name: image.file_name,
            error: reason,
            processing_status: "failed"
          }
      end
    end)

    {:ok, results}
  end

  defp load_image_data(image) do
    # In production, this would load from S3 or your storage system
    # For now, simulate with base64 data or file path
    case image do
      %{storage_path: path} when is_binary(path) ->
        case File.read(path) do
          {:ok, data} -> {:ok, data}
          {:error, _} -> {:error, "Could not read image file"}
        end
      %{base64_data: data} when is_binary(data) ->
        case Base.decode64(data) do
          {:ok, binary_data} -> {:ok, binary_data}
          :error -> {:error, "Invalid base64 image data"}
        end
      _ ->
        {:error, "No image data available"}
    end
  end

  defp detect_labels(image_data, aws_config) do
    # AWS Rekognition DetectLabels API call
    request_body = %{
      "Image" => %{
        "Bytes" => Base.encode64(image_data)
      },
      "MaxLabels" => @max_labels,
      "MinConfidence" => @min_confidence * 100
    }

    case make_aws_request("DetectLabels", request_body, aws_config) do
      {:ok, %{"Labels" => labels}} ->
        parsed_labels = Enum.map(labels, fn label ->
          %{
            name: label["Name"],
            confidence: label["Confidence"] / 100.0,
            instances: parse_label_instances(label["Instances"] || []),
            parents: Enum.map(label["Parents"] || [], &(&1["Name"])),
            categories: Enum.map(label["Categories"] || [], &(&1["Name"]))
          }
        end)
        {:ok, parsed_labels}

      {:ok, response} ->
        Logger.warning("Unexpected DetectLabels response: #{inspect(response)}")
        {:ok, []}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp detect_text(image_data, aws_config) do
    # AWS Rekognition DetectText API call
    request_body = %{
      "Image" => %{
        "Bytes" => Base.encode64(image_data)
      }
    }

    case make_aws_request("DetectText", request_body, aws_config) do
      {:ok, %{"TextDetections" => detections}} ->
        parsed_text = Enum.map(detections, fn detection ->
          %{
            text: detection["DetectedText"],
            confidence: detection["Confidence"] / 100.0,
            type: detection["Type"], # "LINE" or "WORD"
            geometry: parse_geometry(detection["Geometry"]),
            id: detection["Id"]
          }
        end)
        {:ok, parsed_text}

      {:ok, response} ->
        Logger.warning("Unexpected DetectText response: #{inspect(response)}")
        {:ok, []}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp detect_custom_labels(image_data, aws_config, params) do
    # Custom model for automotive parts detection (if configured)
    model_arn = Map.get(params, "custom_model_arn")

    if model_arn do
      request_body = %{
        "Image" => %{
          "Bytes" => Base.encode64(image_data)
        },
        "ProjectVersionArn" => model_arn,
        "MinConfidence" => @min_confidence * 100
      }

      case make_aws_request("DetectCustomLabels", request_body, aws_config) do
        {:ok, %{"CustomLabels" => labels}} ->
          parsed_labels = Enum.map(labels, fn label ->
            %{
              name: label["Name"],
              confidence: label["Confidence"] / 100.0,
              geometry: parse_geometry(label["Geometry"])
            }
          end)
          {:ok, parsed_labels}

        {:error, reason} ->
          Logger.warning("Custom labels detection failed: #{inspect(reason)}")
          {:ok, []}
      end
    else
      {:ok, []}
    end
  end

  defp parse_label_instances(instances) do
    Enum.map(instances, fn instance ->
      %{
        confidence: instance["Confidence"] / 100.0,
        bounding_box: parse_geometry(instance["BoundingBox"])
      }
    end)
  end

  defp parse_geometry(nil), do: nil
  defp parse_geometry(geometry) do
    case geometry do
      %{"BoundingBox" => box} ->
        %{
          left: box["Left"],
          top: box["Top"],
          width: box["Width"],
          height: box["Height"]
        }
      %{"Polygon" => polygon} ->
        %{
          polygon: Enum.map(polygon, fn point ->
            %{x: point["X"], y: point["Y"]}
          end)
        }
      box when is_map(box) ->
        %{
          left: box["Left"] || 0,
          top: box["Top"] || 0,
          width: box["Width"] || 0,
          height: box["Height"] || 0
        }
      _ -> nil
    end
  end

  defp extract_spatial_tags(results, vehicle_id) do
    spatial_tags = Enum.flat_map(results, fn result ->
      case result do
        %{labels: labels, text_detections: text_detections, custom_objects: custom_objects, image_id: image_id} ->
          label_tags = create_label_tags(labels, image_id)
          text_tags = create_text_tags(text_detections, image_id)
          custom_tags = create_custom_tags(custom_objects, image_id)

          label_tags ++ text_tags ++ custom_tags

        _ -> []
      end
    end)

    {:ok, spatial_tags}
  end

  defp create_label_tags(labels, image_id) do
    Enum.flat_map(labels, fn label ->
      # Create tags for labels with bounding boxes
      if label.instances && length(label.instances) > 0 do
        Enum.map(label.instances, fn instance ->
          %{
            image_id: image_id,
            x_position: calculate_center_x(instance.bounding_box),
            y_position: calculate_center_y(instance.bounding_box),
            tag_type: classify_label_type(label.name),
            text: label.name,
            source_type: "ai_detected",
            automated_confidence: label.confidence,
            needs_human_verification: label.confidence < 0.9,
            metadata: %{
              aws_label: label.name,
              confidence: label.confidence,
              parents: label.parents,
              categories: label.categories,
              bounding_box: instance.bounding_box
            }
          }
        end)
      else
        # Create single tag for label without specific location
        [%{
          image_id: image_id,
          x_position: 50.0, # Center of image
          y_position: 50.0,
          tag_type: classify_label_type(label.name),
          text: label.name,
          source_type: "ai_detected",
          automated_confidence: label.confidence,
          needs_human_verification: label.confidence < 0.9,
          metadata: %{
            aws_label: label.name,
            confidence: label.confidence,
            parents: label.parents,
            categories: label.categories
          }
        }]
      end
    end)
  end

  defp create_text_tags(text_detections, image_id) do
    # Only create tags for LINE-type text detections to avoid duplication
    text_detections
    |> Enum.filter(&(&1.type == "LINE"))
    |> Enum.map(fn detection ->
      %{
        image_id: image_id,
        x_position: calculate_center_x(detection.geometry),
        y_position: calculate_center_y(detection.geometry),
        tag_type: classify_text_type(detection.text),
        text: detection.text,
        source_type: "ai_detected",
        automated_confidence: detection.confidence,
        needs_human_verification: detection.confidence < 0.9,
        metadata: %{
          aws_text: detection.text,
          confidence: detection.confidence,
          text_type: detection.type,
          geometry: detection.geometry
        }
      }
    end)
  end

  defp create_custom_tags(custom_objects, image_id) do
    Enum.map(custom_objects, fn object ->
      %{
        image_id: image_id,
        x_position: calculate_center_x(object.geometry),
        y_position: calculate_center_y(object.geometry),
        tag_type: "part", # Custom automotive parts
        text: object.name,
        source_type: "ai_detected",
        automated_confidence: object.confidence,
        needs_human_verification: object.confidence < 0.95, # Higher threshold for custom models
        metadata: %{
          custom_label: object.name,
          confidence: object.confidence,
          geometry: object.geometry
        }
      }
    end)
  end

  defp calculate_center_x(nil), do: 50.0
  defp calculate_center_x(%{left: left, width: width}), do: (left + width / 2) * 100
  defp calculate_center_x(_), do: 50.0

  defp calculate_center_y(nil), do: 50.0
  defp calculate_center_y(%{top: top, height: height}), do: (top + height / 2) * 100
  defp calculate_center_y(_), do: 50.0

  defp classify_label_type(label) do
    cond do
      String.contains?(String.downcase(label), ["damage", "dent", "scratch", "rust", "crack"]) -> "damage"
      String.contains?(String.downcase(label), ["wheel", "tire", "engine", "door", "window"]) -> "part"
      String.contains?(String.downcase(label), ["brand", "logo", "badge"]) -> "brand"
      String.contains?(String.downcase(label), ["tool", "wrench", "screwdriver"]) -> "tool"
      true -> "product"
    end
  end

  defp classify_text_type(text) do
    cond do
      Regex.match?(~r/\b[A-Z]{2,}\b/, text) -> "brand" # All caps likely brand names
      Regex.match?(~r/\d+/, text) -> "part" # Text with numbers likely part numbers
      true -> "product"
    end
  end

  defp generate_summary(results) do
    total_images = length(results)
    successful_images = Enum.count(results, &(&1[:processing_status] == "completed"))

    all_labels = Enum.flat_map(results, &(&1[:labels] || []))
    all_text = Enum.flat_map(results, &(&1[:text_detections] || []))
    all_custom = Enum.flat_map(results, &(&1[:custom_objects] || []))

    summary = %{
      images_processed: successful_images,
      total_images: total_images,
      labels_detected: length(all_labels),
      text_detections: length(all_text),
      custom_objects: length(all_custom),
      avg_confidence: calculate_average_confidence(all_labels ++ all_text ++ all_custom),
      top_labels: get_top_labels(all_labels, 5),
      detected_text: Enum.map(all_text, &(&1.text)) |> Enum.take(10)
    }

    {:ok, summary}
  end

  defp calculate_overall_confidence(results) do
    all_detections = Enum.flat_map(results, fn result ->
      (result[:labels] || []) ++ (result[:text_detections] || []) ++ (result[:custom_objects] || [])
    end)

    calculate_average_confidence(all_detections)
  end

  defp calculate_average_confidence([]), do: 0.0
  defp calculate_average_confidence(detections) do
    confidences = Enum.map(detections, &(&1.confidence || &1[:confidence] || 0))
    Enum.sum(confidences) / length(confidences)
  end

  defp get_top_labels(labels, limit) do
    labels
    |> Enum.sort_by(&(&1.confidence), :desc)
    |> Enum.take(limit)
    |> Enum.map(&(&1.name))
  end

  defp extract_key_findings(results) do
    all_labels = Enum.flat_map(results, &(&1[:labels] || []))
    all_text = Enum.flat_map(results, &(&1[:text_detections] || []))

    # Identify key automotive findings
    findings = []

    # High confidence damage indicators
    damage_labels = Enum.filter(all_labels, fn label ->
      String.contains?(String.downcase(label.name), ["damage", "dent", "scratch", "rust"]) &&
      label.confidence > 0.8
    end)

    findings = if length(damage_labels) > 0 do
      ["Potential damage detected: #{Enum.map(damage_labels, &(&1.name)) |> Enum.join(", ")}" | findings]
    else
      findings
    end

    # Brand/model detection from text
    brand_text = Enum.filter(all_text, fn text ->
      String.length(text.text) > 2 && String.match?(text.text, ~r/^[A-Z][a-z]+$/) &&
      text.confidence > 0.9
    end)

    findings = if length(brand_text) > 0 do
      brands = Enum.map(brand_text, &(&1.text)) |> Enum.uniq() |> Enum.take(3)
      ["Identified brands/models: #{Enum.join(brands, ", ")}" | findings]
    else
      findings
    end

    # High-value parts detected
    valuable_parts = Enum.filter(all_labels, fn label ->
      String.contains?(String.downcase(label.name), ["engine", "transmission", "wheel", "exhaust"]) &&
      label.confidence > 0.8
    end)

    findings = if length(valuable_parts) > 0 do
      parts = Enum.map(valuable_parts, &(&1.name)) |> Enum.uniq()
      ["Key components visible: #{Enum.join(parts, ", ")}" | findings]
    else
      findings
    end

    Enum.reverse(findings)
  end

  defp generate_recommendations(results) do
    recommendations = []

    # Check for low confidence detections needing human review
    all_detections = Enum.flat_map(results, fn result ->
      (result[:labels] || []) ++ (result[:text_detections] || []) ++ (result[:custom_objects] || [])
    end)

    low_confidence = Enum.count(all_detections, &(&1.confidence < 0.8))
    total_detections = length(all_detections)

    recommendations = if low_confidence > total_detections * 0.3 do
      ["Consider human verification for #{low_confidence} low-confidence detections" | recommendations]
    else
      recommendations
    end

    # Recommend additional analysis
    has_damage = Enum.any?(all_detections, fn detection ->
      String.contains?(String.downcase(detection.name || detection.text || ""), "damage")
    end)

    recommendations = if has_damage do
      ["Consider detailed damage assessment and cost estimation" | recommendations]
    else
      recommendations
    end

    # Recommend custom model if many generic labels
    generic_count = Enum.count(all_detections, fn detection ->
      name = String.downcase(detection.name || detection.text || "")
      String.contains?(name, ["object", "thing", "item", "part"])
    end)

    recommendations = if generic_count > 5 do
      ["Consider training custom automotive model for better part recognition" | recommendations]
    else
      recommendations
    end

    Enum.reverse(recommendations)
  end

  defp calculate_cost(images, results) do
    # AWS Rekognition pricing (as of 2024)
    base_cost_per_image = 100 # $0.001 per image in cents
    text_detection_cost = 150 # $0.0015 per image for text detection
    custom_model_cost = 400 # $0.004 per image for custom models

    total_images = length(images)
    images_with_text = Enum.count(results, &(length(&1[:text_detections] || []) > 0))
    images_with_custom = Enum.count(results, &(length(&1[:custom_objects] || []) > 0))

    base_cost = total_images * base_cost_per_image
    text_cost = images_with_text * text_detection_cost
    custom_cost = images_with_custom * custom_model_cost

    base_cost + text_cost + custom_cost
  end

  defp make_aws_request(action, body, aws_config) do
    # In production, this would make actual AWS API calls
    # For development, simulate responses or use AWS SDK

    case Application.get_env(:nuke_api, :aws_rekognition_mode, :simulation) do
      :simulation -> simulate_aws_response(action, body)
      :production -> make_real_aws_request(action, body, aws_config)
    end
  end

  # Simulation mode for development
  defp simulate_aws_response("DetectLabels", _body) do
    {:ok, %{
      "Labels" => [
        %{"Name" => "Car", "Confidence" => 95.5},
        %{"Name" => "Vehicle", "Confidence" => 98.2},
        %{"Name" => "Wheel", "Confidence" => 89.3, "Instances" => [
          %{"Confidence" => 89.3, "BoundingBox" => %{"Left" => 0.1, "Top" => 0.6, "Width" => 0.2, "Height" => 0.3}}
        ]},
        %{"Name" => "Sedan", "Confidence" => 87.1}
      ]
    }}
  end

  defp simulate_aws_response("DetectText", _body) do
    {:ok, %{
      "TextDetections" => [
        %{"DetectedText" => "HONDA", "Confidence" => 96.7, "Type" => "LINE", "Id" => 0,
          "Geometry" => %{"BoundingBox" => %{"Left" => 0.3, "Top" => 0.1, "Width" => 0.2, "Height" => 0.05}}},
        %{"DetectedText" => "CIVIC", "Confidence" => 94.2, "Type" => "LINE", "Id" => 1,
          "Geometry" => %{"BoundingBox" => %{"Left" => 0.3, "Top" => 0.2, "Width" => 0.15, "Height" => 0.04}}}
      ]
    }}
  end

  defp simulate_aws_response("DetectCustomLabels", _body) do
    {:ok, %{
      "CustomLabels" => [
        %{"Name" => "Brake_Caliper", "Confidence" => 92.8,
          "Geometry" => %{"BoundingBox" => %{"Left" => 0.2, "Top" => 0.7, "Width" => 0.1, "Height" => 0.1}}},
        %{"Name" => "Air_Filter", "Confidence" => 88.4,
          "Geometry" => %{"BoundingBox" => %{"Left" => 0.5, "Top" => 0.4, "Width" => 0.15, "Height" => 0.1}}}
      ]
    }}
  end

  # Production mode - would use actual AWS SDK calls
  defp make_real_aws_request(action, body, aws_config) do
    # Implementation would use ExAws or similar AWS SDK
    # For now, return simulation
    simulate_aws_response(action, body)
  end

  defp generate_temp_id do
    :crypto.strong_rand_bytes(16) |> Base.encode16(case: :lower)
  end
end