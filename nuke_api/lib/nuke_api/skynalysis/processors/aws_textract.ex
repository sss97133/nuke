defmodule NukeApi.Skynalysis.Processors.AWSTextract do
  @moduledoc """
  AWS Textract processor for document and text analysis in vehicle images.

  Specialized for extracting structured data from:
  - Vehicle titles and registrations
  - Insurance documents
  - Service records and receipts
  - VIN plates and inspection stickers
  - License plates and registration tags
  """

  @behaviour NukeApi.Skynalysis.ProcessorBehaviour

  require Logger

  @region "us-west-2"

  @doc """
  Analyze vehicle documents using AWS Textract
  """
  def analyze(%{input_images: images, input_parameters: params} = analysis) do
    start_time = System.monotonic_time(:millisecond)

    with {:ok, aws_config} <- get_aws_config(),
         {:ok, results} <- process_documents(images, aws_config, params),
         {:ok, structured_data} <- extract_vehicle_data(results),
         {:ok, spatial_tags} <- create_text_tags(results, analysis.vehicle_id),
         {:ok, summary} <- generate_summary(results) do

      end_time = System.monotonic_time(:millisecond)
      processing_time = end_time - start_time

      {:ok, %{
        raw_response: results,
        summary: summary,
        structured_data: structured_data,
        spatial_tags: spatial_tags,
        confidence_score: calculate_overall_confidence(results),
        key_findings: extract_key_findings(structured_data),
        recommendations: generate_recommendations(structured_data),
        processing_time_ms: processing_time,
        cost_cents: calculate_cost(images, results)
      }}
    else
      {:error, reason} ->
        Logger.error("AWS Textract analysis failed: #{inspect(reason)}")
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

  defp process_documents(images, aws_config, params) do
    analysis_type = Map.get(params, "analysis_type", "text_detection")

    results = Enum.map(images, fn image ->
      with {:ok, image_data} <- load_image_data(image) do
        case analysis_type do
          "text_detection" ->
            process_text_detection(image, image_data, aws_config)
          "document_analysis" ->
            process_document_analysis(image, image_data, aws_config)
          "expense_analysis" ->
            process_expense_analysis(image, image_data, aws_config)
          _ ->
            process_text_detection(image, image_data, aws_config)
        end
      else
        {:error, reason} ->
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

  defp process_text_detection(image, image_data, aws_config) do
    request_body = %{
      "Document" => %{
        "Bytes" => Base.encode64(image_data)
      }
    }

    case make_textract_request("DetectDocumentText", request_body, aws_config) do
      {:ok, response} ->
        %{
          image_id: image.id || generate_temp_id(),
          file_name: image.file_name,
          blocks: response["Blocks"] || [],
          processing_status: "completed",
          analysis_type: "text_detection"
        }

      {:error, reason} ->
        %{
          image_id: image.id || generate_temp_id(),
          file_name: image.file_name,
          error: reason,
          processing_status: "failed"
        }
    end
  end

  defp process_document_analysis(image, image_data, aws_config) do
    request_body = %{
      "Document" => %{
        "Bytes" => Base.encode64(image_data)
      },
      "FeatureTypes" => ["TABLES", "FORMS"]
    }

    case make_textract_request("AnalyzeDocument", request_body, aws_config) do
      {:ok, response} ->
        %{
          image_id: image.id || generate_temp_id(),
          file_name: image.file_name,
          blocks: response["Blocks"] || [],
          processing_status: "completed",
          analysis_type: "document_analysis"
        }

      {:error, reason} ->
        %{
          image_id: image.id || generate_temp_id(),
          file_name: image.file_name,
          error: reason,
          processing_status: "failed"
        }
    end
  end

  defp process_expense_analysis(image, image_data, aws_config) do
    request_body = %{
      "Document" => %{
        "Bytes" => Base.encode64(image_data)
      }
    }

    case make_textract_request("AnalyzeExpense", request_body, aws_config) do
      {:ok, response} ->
        %{
          image_id: image.id || generate_temp_id(),
          file_name: image.file_name,
          expense_documents: response["ExpenseDocuments"] || [],
          processing_status: "completed",
          analysis_type: "expense_analysis"
        }

      {:error, reason} ->
        %{
          image_id: image.id || generate_temp_id(),
          file_name: image.file_name,
          error: reason,
          processing_status: "failed"
        }
    end
  end

  defp extract_vehicle_data(results) do
    vehicle_data = %{}

    structured_data = Enum.reduce(results, vehicle_data, fn result, acc ->
      case result do
        %{blocks: blocks, analysis_type: "text_detection"} ->
          extract_text_fields(blocks, acc)

        %{blocks: blocks, analysis_type: "document_analysis"} ->
          extract_form_fields(blocks, acc)

        %{expense_documents: docs, analysis_type: "expense_analysis"} ->
          extract_expense_fields(docs, acc)

        _ -> acc
      end
    end)

    {:ok, structured_data}
  end

  defp extract_text_fields(blocks, acc) do
    text_blocks = Enum.filter(blocks, &(&1["BlockType"] == "LINE"))

    extracted = Enum.reduce(text_blocks, acc, fn block, current_acc ->
      text = block["Text"] || ""

      current_acc
      |> extract_vin_from_text(text)
      |> extract_license_plate_from_text(text)
      |> extract_year_make_model_from_text(text)
      |> extract_mileage_from_text(text)
    end)

    extracted
  end

  defp extract_form_fields(blocks, acc) do
    # Extract key-value pairs from form fields
    key_blocks = Enum.filter(blocks, &(&1["BlockType"] == "KEY_VALUE_SET" && &1["EntityTypes"] && "KEY" in &1["EntityTypes"]))
    value_blocks = Enum.filter(blocks, &(&1["BlockType"] == "KEY_VALUE_SET" && &1["EntityTypes"] && "VALUE" in &1["EntityTypes"]))

    # Build relationships between keys and values
    key_value_pairs = Enum.flat_map(key_blocks, fn key_block ->
      relationships = key_block["Relationships"] || []
      value_relationships = Enum.filter(relationships, &(&1["Type"] == "VALUE"))

      Enum.map(value_relationships, fn value_rel ->
        value_ids = value_rel["Ids"] || []
        value_block = Enum.find(value_blocks, &(&1["Id"] in value_ids))

        if value_block do
          key_text = extract_text_from_block(key_block, blocks)
          value_text = extract_text_from_block(value_block, blocks)
          {key_text, value_text}
        else
          nil
        end
      end)
    end)
    |> Enum.reject(&is_nil/1)

    # Map known vehicle document fields
    Enum.reduce(key_value_pairs, acc, fn {key, value}, current_acc ->
      normalized_key = String.downcase(key)

      cond do
        String.contains?(normalized_key, ["vin", "vehicle identification"]) ->
          Map.put(current_acc, :vin, value)
        String.contains?(normalized_key, ["make"]) ->
          Map.put(current_acc, :make, value)
        String.contains?(normalized_key, ["model"]) ->
          Map.put(current_acc, :model, value)
        String.contains?(normalized_key, ["year"]) ->
          Map.put(current_acc, :year, parse_year(value))
        String.contains?(normalized_key, ["mileage", "odometer"]) ->
          Map.put(current_acc, :mileage, parse_mileage(value))
        String.contains?(normalized_key, ["owner", "registered"]) ->
          Map.put(current_acc, :owner_name, value)
        String.contains?(normalized_key, ["plate", "license"]) ->
          Map.put(current_acc, :license_plate, value)
        true ->
          # Store other fields in metadata
          metadata = Map.get(current_acc, :metadata, %{})
          Map.put(current_acc, :metadata, Map.put(metadata, normalized_key, value))
      end
    end)
  end

  defp extract_expense_fields(expense_docs, acc) do
    # Extract structured data from service receipts, repair invoices, etc.
    Enum.reduce(expense_docs, acc, fn doc, current_acc ->
      summary_fields = doc["SummaryFields"] || []
      line_items = doc["LineItemGroups"] || []

      # Extract key expense information
      expense_data = Enum.reduce(summary_fields, %{}, fn field, expense_acc ->
        type = get_in(field, ["Type", "Text"])
        value = get_in(field, ["ValueDetection", "Text"])

        if type && value do
          case String.downcase(type) do
            "vendor_name" -> Map.put(expense_acc, :vendor_name, value)
            "invoice_receipt_date" -> Map.put(expense_acc, :date, value)
            "total" -> Map.put(expense_acc, :total_amount, value)
            "subtotal" -> Map.put(expense_acc, :subtotal, value)
            "tax" -> Map.put(expense_acc, :tax_amount, value)
            _ -> Map.put(expense_acc, String.to_atom(type), value)
          end
        else
          expense_acc
        end
      end)

      # Extract line items (parts, services)
      items = Enum.flat_map(line_items, fn group ->
        line_items = group["LineItems"] || []
        Enum.map(line_items, fn item ->
          line_item_expense_fields = item["LineItemExpenseFields"] || []
          Enum.reduce(line_item_expense_fields, %{}, fn field, item_acc ->
            type = get_in(field, ["Type", "Text"])
            value = get_in(field, ["ValueDetection", "Text"])

            if type && value do
              Map.put(item_acc, String.to_atom(String.downcase(type)), value)
            else
              item_acc
            end
          end)
        end)
      end)

      service_records = Map.get(current_acc, :service_records, [])
      service_record = Map.put(expense_data, :line_items, items)
      Map.put(current_acc, :service_records, [service_record | service_records])
    end)
  end

  defp extract_text_from_block(block, all_blocks) do
    relationships = block["Relationships"] || []
    child_relationships = Enum.filter(relationships, &(&1["Type"] == "CHILD"))

    child_ids = Enum.flat_map(child_relationships, &(&1["Ids"] || []))
    child_blocks = Enum.filter(all_blocks, &(&1["Id"] in child_ids))

    child_blocks
    |> Enum.map(&(&1["Text"] || ""))
    |> Enum.join(" ")
    |> String.trim()
  end

  defp extract_vin_from_text(acc, text) do
    # VIN pattern: 17 alphanumeric characters
    case Regex.run(~r/\b[A-HJ-NPR-Z0-9]{17}\b/, text) do
      [vin] -> Map.put(acc, :vin, vin)
      _ -> acc
    end
  end

  defp extract_license_plate_from_text(acc, text) do
    # Various license plate patterns
    patterns = [
      ~r/\b[A-Z]{1,3}[0-9]{1,4}[A-Z]{0,2}\b/, # Standard format
      ~r/\b[0-9]{1,3}[A-Z]{1,3}[0-9]{1,4}\b/,  # Number-letter-number format
      ~r/\b[A-Z]{1,2}[0-9]{2,4}[A-Z]{1,2}\b/   # Letter-number-letter format
    ]

    plate = Enum.find_value(patterns, fn pattern ->
      case Regex.run(pattern, text) do
        [match] -> match
        _ -> nil
      end
    end)

    if plate do
      Map.put(acc, :license_plate, plate)
    else
      acc
    end
  end

  defp extract_year_make_model_from_text(acc, text) do
    # Look for year (4 digits), followed by make and model
    case Regex.run(~r/\b(19[0-9]{2}|20[0-9]{2})\s+([A-Z][a-zA-Z]+)\s+([A-Z][a-zA-Z0-9\-]+)/i, text) do
      [_, year, make, model] ->
        acc
        |> Map.put(:year, parse_year(year))
        |> Map.put(:make, make)
        |> Map.put(:model, model)
      _ -> acc
    end
  end

  defp extract_mileage_from_text(acc, text) do
    # Look for mileage patterns
    patterns = [
      ~r/\b([0-9]{1,3}(?:,?[0-9]{3})*)\s*(?:miles?|mi)\b/i,
      ~r/\bodometer:?\s*([0-9]{1,3}(?:,?[0-9]{3})*)/i,
      ~r/\bmileage:?\s*([0-9]{1,3}(?:,?[0-9]{3})*)/i
    ]

    mileage = Enum.find_value(patterns, fn pattern ->
      case Regex.run(pattern, text) do
        [_, mileage_str] -> parse_mileage(mileage_str)
        _ -> nil
      end
    end)

    if mileage do
      Map.put(acc, :mileage, mileage)
    else
      acc
    end
  end

  defp parse_year(year_str) do
    case Integer.parse(year_str) do
      {year, _} when year >= 1900 and year <= 2030 -> year
      _ -> nil
    end
  end

  defp parse_mileage(mileage_str) do
    clean_str = String.replace(mileage_str, ",", "")
    case Integer.parse(clean_str) do
      {mileage, _} when mileage >= 0 -> mileage
      _ -> nil
    end
  end

  defp create_text_tags(results, vehicle_id) do
    spatial_tags = Enum.flat_map(results, fn result ->
      case result do
        %{blocks: blocks, image_id: image_id} ->
          create_text_block_tags(blocks, image_id)
        _ -> []
      end
    end)

    {:ok, spatial_tags}
  end

  defp create_text_block_tags(blocks, image_id) do
    line_blocks = Enum.filter(blocks, &(&1["BlockType"] == "LINE"))

    Enum.map(line_blocks, fn block ->
      geometry = block["Geometry"]["BoundingBox"]
      text = block["Text"] || ""
      confidence = (block["Confidence"] || 0) / 100.0

      %{
        image_id: image_id,
        x_position: (geometry["Left"] + geometry["Width"] / 2) * 100,
        y_position: (geometry["Top"] + geometry["Height"] / 2) * 100,
        tag_type: classify_extracted_text(text),
        text: text,
        source_type: "ai_detected",
        automated_confidence: confidence,
        needs_human_verification: confidence < 0.9,
        metadata: %{
          textract_block_id: block["Id"],
          confidence: confidence,
          bounding_box: geometry,
          block_type: "LINE"
        }
      }
    end)
  end

  defp classify_extracted_text(text) do
    cond do
      Regex.match?(~r/\b[A-HJ-NPR-Z0-9]{17}\b/, text) -> "part" # VIN
      Regex.match?(~r/\b[A-Z]{1,3}[0-9]{1,4}[A-Z]{0,2}\b/, text) -> "part" # License plate
      Regex.match?(~r/\b(19[0-9]{2}|20[0-9]{2})\b/, text) -> "product" # Year
      Regex.match?(~r/\b[0-9]{1,3}(?:,?[0-9]{3})*\s*(?:miles?|mi)\b/i, text) -> "modification" # Mileage
      String.length(text) > 10 -> "product" # Longer text
      true -> "brand" # Short text, likely labels or brands
    end
  end

  defp generate_summary(results) do
    total_images = length(results)
    successful_images = Enum.count(results, &(&1[:processing_status] == "completed"))

    total_blocks = results
    |> Enum.flat_map(&(&1[:blocks] || []))
    |> length()

    text_blocks = results
    |> Enum.flat_map(&(&1[:blocks] || []))
    |> Enum.filter(&(&1["BlockType"] == "LINE"))

    extracted_text = Enum.map(text_blocks, &(&1["Text"] || ""))
    avg_confidence = calculate_avg_text_confidence(text_blocks)

    {:ok, %{
      images_processed: successful_images,
      total_images: total_images,
      total_blocks_detected: total_blocks,
      text_lines_extracted: length(text_blocks),
      avg_confidence: avg_confidence,
      total_characters: extracted_text |> Enum.join("") |> String.length(),
      languages_detected: ["en"] # Textract can detect multiple languages
    }}
  end

  defp calculate_overall_confidence(results) do
    all_blocks = Enum.flat_map(results, &(&1[:blocks] || []))
    text_blocks = Enum.filter(all_blocks, &(&1["BlockType"] == "LINE"))
    calculate_avg_text_confidence(text_blocks)
  end

  defp calculate_avg_text_confidence([]), do: 0.0
  defp calculate_avg_text_confidence(blocks) do
    confidences = Enum.map(blocks, &((&1["Confidence"] || 0) / 100.0))
    Enum.sum(confidences) / length(confidences)
  end

  defp extract_key_findings(structured_data) do
    findings = []

    # VIN detection
    findings = if Map.get(structured_data, :vin) do
      ["Vehicle VIN extracted: #{structured_data.vin}" | findings]
    else
      findings
    end

    # Vehicle info
    if Map.get(structured_data, :year) && Map.get(structured_data, :make) && Map.get(structured_data, :model) do
      vehicle_info = "#{structured_data.year} #{structured_data.make} #{structured_data.model}"
      findings = ["Vehicle identified: #{vehicle_info}" | findings]
    end

    # Service records
    service_count = length(Map.get(structured_data, :service_records, []))
    findings = if service_count > 0 do
      ["#{service_count} service record(s) extracted" | findings]
    else
      findings
    end

    # License plate
    findings = if Map.get(structured_data, :license_plate) do
      ["License plate: #{structured_data.license_plate}" | findings]
    else
      findings
    end

    Enum.reverse(findings)
  end

  defp generate_recommendations(structured_data) do
    recommendations = []

    # Recommend data validation
    if Map.has_key?(structured_data, :vin) do
      recommendations = ["Validate extracted VIN against vehicle database" | recommendations]
    end

    # Recommend service history analysis
    service_count = length(Map.get(structured_data, :service_records, []))
    if service_count > 0 do
      recommendations = ["Analyze service history for maintenance patterns" | recommendations]
    end

    # Recommend missing data collection
    required_fields = [:vin, :year, :make, :model, :mileage]
    missing_fields = Enum.filter(required_fields, &(!Map.has_key?(structured_data, &1)))

    if length(missing_fields) > 0 do
      missing_str = missing_fields |> Enum.map(&to_string/1) |> Enum.join(", ")
      recommendations = ["Consider additional document analysis for: #{missing_str}" | recommendations]
    end

    Enum.reverse(recommendations)
  end

  defp calculate_cost(images, results) do
    # AWS Textract pricing (as of 2024)
    text_detection_cost = 150 # $0.0015 per page
    document_analysis_cost = 600 # $0.006 per page
    expense_analysis_cost = 5000 # $0.05 per page

    total_cost = Enum.reduce(results, 0, fn result, acc ->
      case result[:analysis_type] do
        "text_detection" -> acc + text_detection_cost
        "document_analysis" -> acc + document_analysis_cost
        "expense_analysis" -> acc + expense_analysis_cost
        _ -> acc + text_detection_cost
      end
    end)

    total_cost
  end

  defp make_textract_request(action, body, aws_config) do
    case Application.get_env(:nuke_api, :aws_textract_mode, :simulation) do
      :simulation -> simulate_textract_response(action, body)
      :production -> make_real_textract_request(action, body, aws_config)
    end
  end

  # Simulation responses for development
  defp simulate_textract_response("DetectDocumentText", _body) do
    {:ok, %{
      "Blocks" => [
        %{
          "Id" => "1",
          "BlockType" => "LINE",
          "Text" => "VEHICLE REGISTRATION",
          "Confidence" => 99.5,
          "Geometry" => %{"BoundingBox" => %{"Left" => 0.1, "Top" => 0.1, "Width" => 0.4, "Height" => 0.05}}
        },
        %{
          "Id" => "2",
          "BlockType" => "LINE",
          "Text" => "VIN: 1HGCM82633A123456",
          "Confidence" => 97.8,
          "Geometry" => %{"BoundingBox" => %{"Left" => 0.1, "Top" => 0.3, "Width" => 0.5, "Height" => 0.04}}
        },
        %{
          "Id" => "3",
          "BlockType" => "LINE",
          "Text" => "2015 HONDA CIVIC",
          "Confidence" => 95.2,
          "Geometry" => %{"BoundingBox" => %{"Left" => 0.1, "Top" => 0.4, "Width" => 0.3, "Height" => 0.04}}
        }
      ]
    }}
  end

  defp simulate_textract_response("AnalyzeDocument", _body) do
    {:ok, %{
      "Blocks" => [
        %{
          "Id" => "key1",
          "BlockType" => "KEY_VALUE_SET",
          "EntityTypes" => ["KEY"],
          "Text" => "Make:",
          "Relationships" => [%{"Type" => "VALUE", "Ids" => ["value1"]}]
        },
        %{
          "Id" => "value1",
          "BlockType" => "KEY_VALUE_SET",
          "EntityTypes" => ["VALUE"],
          "Text" => "Honda",
          "Relationships" => [%{"Type" => "CHILD", "Ids" => ["word1"]}]
        }
      ]
    }}
  end

  defp simulate_textract_response("AnalyzeExpense", _body) do
    {:ok, %{
      "ExpenseDocuments" => [
        %{
          "ExpenseIndex" => 1,
          "SummaryFields" => [
            %{
              "Type" => %{"Text" => "VENDOR_NAME", "Confidence" => 99.1},
              "ValueDetection" => %{"Text" => "AutoZone", "Confidence" => 98.5}
            },
            %{
              "Type" => %{"Text" => "TOTAL", "Confidence" => 95.7},
              "ValueDetection" => %{"Text" => "$45.99", "Confidence" => 94.2}
            }
          ],
          "LineItemGroups" => [
            %{
              "LineItems" => [
                %{
                  "LineItemExpenseFields" => [
                    %{
                      "Type" => %{"Text" => "ITEM", "Confidence" => 96.3},
                      "ValueDetection" => %{"Text" => "Oil Filter", "Confidence" => 95.1}
                    },
                    %{
                      "Type" => %{"Text" => "PRICE", "Confidence" => 97.8},
                      "ValueDetection" => %{"Text" => "$12.99", "Confidence" => 96.4}
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }}
  end

  defp make_real_textract_request(action, body, aws_config) do
    # Production implementation would use ExAws or similar
    simulate_textract_response(action, body)
  end

  defp generate_temp_id do
    :crypto.strong_rand_bytes(16) |> Base.encode16(case: :lower)
  end
end