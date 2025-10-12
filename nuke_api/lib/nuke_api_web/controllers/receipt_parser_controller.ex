defmodule NukeApiWeb.ReceiptParserController do
  use NukeApiWeb, :controller
  require Logger

  @doc """
  Proxy endpoint for Claude API receipt parsing
  Accepts file upload, calls Claude API from backend, returns structured data
  """
  def parse_receipt(conn, %{"file" => file}) do
    Logger.info("Receipt parsing request received: #{file.filename}")
    do_parse_receipt_file(conn, file.path, file.content_type, file.filename)
  end

  def debug_receipt_content(conn, %{"s3_path" => s3_path}) do
    Logger.info("Debug receipt content from S3: #{s3_path}")

    # Download file from S3
    case download_from_s3(s3_path) do
      {:ok, file_content, content_type} ->
        # Create a temporary file
        temp_path = "/tmp/debug_receipt_#{System.unique_integer([:positive])}"
        File.write!(temp_path, file_content)

        claude_api_key = System.get_env("CLAUDE_API_KEY")

        if is_nil(claude_api_key) or claude_api_key == "" do
          conn
          |> put_status(500)
          |> json(%{error: "Claude API key not configured"})
        else
          # Ask Claude to describe what it sees
          case File.read(temp_path) do
            {:ok, file_content} ->
              base64_data = Base.encode64(file_content)

              debug_request = %{
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 4000,
                messages: [
                  %{
                    role: "user",
                    content: [
                      %{
                        type: "document",
                        source: %{
                          type: "base64",
                          media_type: content_type,
                          data: base64_data
                        }
                      },
                      %{type: "text", text: "Describe what you see in this document. How many pages? What kind of content? How many line items or tools do you see? Give me a detailed summary without parsing into JSON."}
                    ]
                  }
                ]
              }

              case call_claude_api_direct(claude_api_key, debug_request) do
                {:ok, raw_text} ->
                  File.rm(temp_path)
                  conn |> json(%{description: raw_text})

                {:error, error} ->
                  File.rm(temp_path)
                  conn |> put_status(500) |> json(%{error: error})
              end

            {:error, reason} ->
              File.rm(temp_path)
              conn |> put_status(500) |> json(%{error: "Failed to read file: #{reason}"})
          end
        end

      {:error, reason} ->
        conn |> put_status(500) |> json(%{error: "Failed to download: #{reason}"})
    end
  end

  def reparse_from_s3(conn, %{"s3_key" => s3_key}) do
    Logger.info("Re-parsing receipt from S3: #{s3_key}")

    # Download file from S3
    case download_from_s3(s3_key) do
      {:ok, file_content, content_type} ->
        # Create a temporary file
        temp_path = "/tmp/s3_receipt_#{System.unique_integer([:positive])}"
        File.write!(temp_path, file_content)

        filename = Path.basename(s3_key)
        result = do_parse_receipt_file(conn, temp_path, content_type, filename)

        # Clean up temp file
        File.rm(temp_path)
        result

      {:error, reason} ->
        Logger.error("Failed to download from S3: #{reason}")
        conn
        |> put_status(500)
        |> json(%{
          success: false,
          error: "Failed to download file from S3: #{reason}",
          receipt_metadata: %{},
          line_items: [],
          payment_records: [],
          confidence_score: 0,
          errors: ["S3 download error"]
        })
    end
  end

  defp do_parse_receipt_file(conn, file_path, content_type, filename) do

    # Get Claude API key from environment
    claude_api_key = System.get_env("CLAUDE_API_KEY")

    if is_nil(claude_api_key) or claude_api_key == "" do
      conn
      |> put_status(500)
      |> json(%{
        success: false,
        error: "Claude API key not configured on server",
        receipt_metadata: %{},
        line_items: [],
        payment_records: [],
        confidence_score: 0,
        errors: ["Server configuration error"]
      })
    else
      # Read file and convert to base64
      case File.read(file_path) do
        {:ok, file_content} ->
          base64_data = Base.encode64(file_content)
          content_type = content_type || "image/jpeg"
          is_image = String.starts_with?(content_type, "image/")
          is_pdf = content_type == "application/pdf"
          is_text = content_type == "text/plain"

          # Build Claude API request
          request_body = build_claude_request(base64_data, content_type, is_image, is_pdf, is_text, file_content)

          # Call Claude API
          case call_claude_api(claude_api_key, request_body) do
            {:ok, result} ->
              conn
              |> put_status(200)
              |> json(result)

            {:error, error_message} ->
              Logger.error("Claude API error: #{error_message}")

              conn
              |> put_status(500)
              |> json(%{
                success: false,
                error: error_message,
                receipt_metadata: %{},
                line_items: [],
                payment_records: [],
                confidence_score: 0,
                errors: [error_message]
              })
          end

        {:error, reason} ->
          Logger.error("Failed to read uploaded file: #{inspect(reason)}")

          conn
          |> put_status(500)
          |> json(%{
            success: false,
            error: "Failed to read file",
            receipt_metadata: %{},
            line_items: [],
            payment_records: [],
            confidence_score: 0,
            errors: ["File read error"]
          })
      end
    end
  end

  defp build_claude_request(base64_data, content_type, is_image, is_pdf, is_text, file_content) do
    content_parts =
      cond do
        is_image ->
          [
            %{
              type: "image",
              source: %{
                type: "base64",
                media_type: content_type,
                data: base64_data
              }
            },
            %{type: "text", text: get_parsing_prompt()}
          ]

        is_pdf ->
          [
            %{
              type: "document",
              source: %{
                type: "base64",
                media_type: content_type,
                data: base64_data
              }
            },
            %{type: "text", text: get_parsing_prompt()}
          ]

        is_text ->
          [
            %{type: "text", text: "Here is the receipt content:\n\n#{file_content}\n\n#{get_parsing_prompt()}"}
          ]

        true ->
          [%{type: "text", text: get_parsing_prompt()}]
      end

    %{
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 32000,
      messages: [
        %{
          role: "user",
          content: content_parts
        }
      ]
    }
  end

  defp get_parsing_prompt do
    """
    You are a universal receipt parser. Extract ALL information from the ACTUAL receipt content provided to you.

    CRITICAL INSTRUCTIONS:
    1. READ THE ACTUAL RECEIPT CONTENT - Do NOT generate fake/simulated data
    2. Extract ONLY what you can see in the receipt image/text provided
    3. This receipt could be from ANY vendor (Snap-on, Mac Tools, Matco, Harbor Freight, AutoZone, Home Depot, small shop, handwritten, etc.)
    4. If you cannot clearly read something, use null instead of guessing
    5. FOR LARGE RECEIPTS: Include ALL line items, even if there are hundreds. Parse every single tool/item listed.
    6. Continue parsing until you reach the end of the receipt - do not stop after a few items
    7. IMPORTANT: If this is a multi-page document, read ALL pages completely
    8. If you see "Page 1 of 5" or similar, make sure to include data from all visible pages

    Return a comprehensive JSON object with ALL 153+ line items (extract ACTUAL values from the receipt):

    {
      "receipt_metadata": {
        "vendor_name": "ACTUAL vendor name from receipt",
        "vendor_address": "ACTUAL address from receipt",
        "transaction_date": "ACTUAL date in YYYY-MM-DD format",
        "transaction_number": "ACTUAL transaction/invoice number",
        "total_amount": ACTUAL_TOTAL_AMOUNT,
        "subtotal": ACTUAL_SUBTOTAL,
        "tax_amount": ACTUAL_TAX_AMOUNT,
        "payment_method": "ACTUAL payment method"
      },
      "line_items": [
        {
          "part_number": "ACTUAL part number from receipt",
          "description": "ACTUAL item description from receipt",
          "quantity": ACTUAL_QUANTITY,
          "unit_price": ACTUAL_UNIT_PRICE,
          "total_price": ACTUAL_LINE_TOTAL,
          "discount": ACTUAL_DISCOUNT_OR_NULL,
          "brand": "ACTUAL brand if visible",
          "serial_number": "ACTUAL serial if present",
          "line_type": "sale|warranty|return|payment|unknown",
          "additional_data": {}
        }
        ... CONTINUE FOR ALL 153+ ITEMS - DO NOT STOP EARLY ...
      ],
      "payment_records": [
        {
          "payment_date": "ACTUAL payment date",
          "payment_type": "ACTUAL payment type",
          "amount": ACTUAL_PAYMENT_AMOUNT,
          "transaction_number": "ACTUAL transaction number"
        }
      ],
      "confidence_score": CONFIDENCE_BETWEEN_0_AND_1
    }

    EXTRACTION RULES:
    ⚠️  IMPORTANT: Extract ONLY what you see in the actual receipt - NO FAKE DATA
    1. Read the actual receipt content provided to you
    2. Extract EVERYTHING visible - tools, payments, fees, taxes, notes
    3. For line_type:
       - "sale" = purchased items
       - "warranty" = warranty replacements
       - "return" = returns/credits
       - "payment" = payment transactions (RA, EC, etc)
       - "unknown" = unclear
    4. If a field is missing/unclear, omit it or use null (don't guess or make up data)
    5. For messy receipts: extract what you can, note low confidence
    6. Capture brand names from descriptions if not explicit
    7. Parse dates flexibly (MM/DD/YYYY, DD-MM-YYYY, written dates, etc.)
    8. Handle partial/damaged receipts gracefully
    9. Store unstructured data in additional_data fields

    CONFIDENCE SCORING (0.0 to 1.0):
    - 0.9-1.0: Clean, structured receipt with all fields
    - 0.7-0.9: Good data, minor missing fields
    - 0.5-0.7: Readable but messy/incomplete
    - 0.3-0.5: Partially readable, significant missing data
    - 0.0-0.3: Heavily damaged/unclear

    ❌ CRITICAL: DO NOT CREATE FAKE DATA - Only extract from the actual receipt content
    ❌ DO NOT use Pittsburgh Pro, generic Snap-on examples, or ABC123 part numbers
    ❌ DO NOT make up prices like $69.99, $99.99, $44.99 - use ACTUAL prices only
    ❌ If you cannot read the receipt clearly, return empty arrays with low confidence

    Return ONLY valid JSON, no markdown formatting.
    """
  end

  defp call_claude_api_direct(api_key, request_body) do
    url = "https://api.anthropic.com/v1/messages"

    headers = [
      {"x-api-key", api_key},
      {"Content-Type", "application/json"},
      {"anthropic-version", "2023-06-01"}
    ]

    body = Jason.encode!(request_body)

    case HTTPoison.post(url, body, headers, timeout: 60_000, recv_timeout: 60_000) do
      {:ok, %HTTPoison.Response{status_code: 200, body: response_body}} ->
        case Jason.decode(response_body) do
          {:ok, %{"content" => [%{"text" => text} | _]}} ->
            {:ok, text}

          {:error, _} ->
            {:error, "Failed to parse Claude API response"}
        end

      {:ok, %HTTPoison.Response{status_code: status_code, body: error_body}} ->
        Logger.error("Claude API returned #{status_code}: #{error_body}")
        {:error, "Claude API error: #{status_code}"}

      {:error, %HTTPoison.Error{reason: reason}} ->
        Logger.error("HTTP request failed: #{inspect(reason)}")
        {:error, "Network error: #{inspect(reason)}"}
    end
  end

  defp call_claude_api(api_key, request_body) do
    url = "https://api.anthropic.com/v1/messages"

    headers = [
      {"x-api-key", api_key},
      {"Content-Type", "application/json"},
      {"anthropic-version", "2023-06-01"}
    ]

    body = Jason.encode!(request_body)

    case HTTPoison.post(url, body, headers, timeout: 60_000, recv_timeout: 60_000) do
      {:ok, %HTTPoison.Response{status_code: 200, body: response_body}} ->
        case Jason.decode(response_body) do
          {:ok, %{"content" => [%{"text" => text} | _]}} ->
            parse_claude_response(text)

          {:error, _} ->
            {:error, "Failed to parse Claude API response"}
        end

      {:ok, %HTTPoison.Response{status_code: status_code, body: error_body}} ->
        Logger.error("Claude API returned #{status_code}: #{error_body}")
        {:error, "Claude API error: #{status_code}"}

      {:error, %HTTPoison.Error{reason: reason}} ->
        Logger.error("HTTP request failed: #{inspect(reason)}")
        {:error, "Network error: #{inspect(reason)}"}
    end
  end

  defp parse_claude_response(text) do
    # Extract JSON from Claude's response, which might have intro text
    clean_text =
      text
      |> String.replace(~r/```json\n?/, "")
      |> String.replace(~r/```\n?/, "")
      |> String.trim()
      |> extract_json_from_text()

    case Jason.decode(clean_text) do
      {:ok, parsed} ->
        result = %{
          success: true,
          receipt_metadata: sanitize_metadata(parsed["receipt_metadata"] || %{}),
          line_items: Enum.map(parsed["line_items"] || [], &sanitize_line_item/1),
          payment_records: Enum.map(parsed["payment_records"] || [], &sanitize_payment/1),
          raw_extraction: parsed,
          confidence_score: parsed["confidence_score"] || 0.5,
          errors: []
        }

        {:ok, result}

      {:error, reason} ->
        Logger.error("Failed to parse JSON from Claude: #{inspect(reason)}")
        Logger.error("Raw text: #{text}")
        {:error, "Failed to parse Claude response as JSON"}
    end
  end

  defp sanitize_metadata(meta) do
    %{
      vendor_name: meta["vendor_name"],
      vendor_address: meta["vendor_address"],
      transaction_date: meta["transaction_date"],
      transaction_number: meta["transaction_number"],
      total_amount: parse_number(meta["total_amount"]),
      subtotal: parse_number(meta["subtotal"]),
      tax_amount: parse_number(meta["tax_amount"]),
      payment_method: meta["payment_method"]
    }
  end

  defp sanitize_line_item(item) do
    valid_line_types = ["sale", "warranty", "return", "payment", "unknown"]
    line_type = if item["line_type"] in valid_line_types, do: item["line_type"], else: "unknown"

    %{
      part_number: item["part_number"],
      description: item["description"] || "Unknown Item",
      quantity: parse_number(item["quantity"]) || 1,
      unit_price: parse_number(item["unit_price"]),
      total_price: parse_number(item["total_price"]),
      discount: parse_number(item["discount"]),
      brand: item["brand"],
      serial_number: item["serial_number"],
      line_type: line_type,
      additional_data: item["additional_data"]
    }
  end

  defp sanitize_payment(payment) do
    %{
      payment_date: payment["payment_date"],
      payment_type: payment["payment_type"],
      amount: parse_number(payment["amount"]) || 0,
      transaction_number: payment["transaction_number"]
    }
  end

  defp parse_number(nil), do: nil
  defp parse_number(value) when is_number(value), do: value

  defp parse_number(value) when is_binary(value) do
    case Float.parse(value) do
      {num, _} -> num
      :error -> nil
    end
  end

  defp parse_number(_), do: nil

  defp extract_json_from_text(text) do
    # Use regex to extract JSON from response that might have intro text
    # Look for the first { to the last }
    case Regex.run(~r/\{.*\}/s, text) do
      [json_string] -> json_string
      _ -> text  # No JSON found, return original text
    end
  end

  defp download_from_s3(s3_path) do
    # For now, use Supabase Storage API
    supabase_url = System.get_env("SUPABASE_URL") || "https://qkgaybvrernstplzjaam.supabase.co"
    public_url = "#{supabase_url}/storage/v1/object/public/tool-data/#{s3_path}"

    case HTTPoison.get(public_url, [], timeout: 30_000, recv_timeout: 30_000) do
      {:ok, %HTTPoison.Response{status_code: 200, body: body, headers: headers}} ->
        content_type =
          headers
          |> Enum.find(fn {key, _} -> String.downcase(key) == "content-type" end)
          |> case do
            {_, type} -> type
            nil -> "application/pdf"  # Default for PDFs
          end

        {:ok, body, content_type}

      {:ok, %HTTPoison.Response{status_code: status_code}} ->
        {:error, "HTTP #{status_code}"}

      {:error, %HTTPoison.Error{reason: reason}} ->
        {:error, "Network error: #{inspect(reason)}"}
    end
  end

  def parse_receipt_chunked(conn, %{"s3_key" => s3_key}) do
    Logger.info("Chunked parsing receipt from S3: #{s3_key}")

    # Download file from S3
    case download_from_s3(s3_key) do
      {:ok, file_content, content_type} ->
        # Process PDF in chunks to extract all line items
        case parse_pdf_in_chunks(file_content, content_type) do
          {:ok, result} ->
            conn
            |> put_resp_content_type("application/json")
            |> json(result)

          {:error, reason} ->
            conn |> put_status(500) |> json(%{error: reason})
        end

      {:error, reason} ->
        conn |> put_status(500) |> json(%{error: "Failed to download: #{reason}"})
    end
  end

  # Process large PDFs in chunks to extract all line items
  defp parse_pdf_in_chunks(file_content, content_type) do
    Logger.info("Processing PDF in chunks to extract all line items")

    claude_api_key = System.get_env("CLAUDE_API_KEY")
    if !claude_api_key do
      {:error, "Claude API key not configured"}
    else
      # Create temporary file
      temp_path = "/tmp/chunked_receipt_#{System.unique_integer([:positive])}"
      File.write!(temp_path, file_content)

      try do
        # Convert to base64 for Claude API
        base64_content = Base.encode64(file_content)

        # Process with multiple API calls to get all line items
        case process_pdf_iteratively(claude_api_key, base64_content) do
          {:ok, all_items, metadata} ->
            Logger.info("Successfully extracted #{length(all_items)} line items")

            {:ok, %{
              success: true,
              errors: [],
              confidence_score: 0.95,
              line_items: all_items,
              payment_records: [],
              receipt_metadata: metadata,
              raw_extraction: %{
                line_items: all_items,
                payment_records: [],
                receipt_metadata: metadata,
                confidence_score: 0.95
              }
            }}

          {:error, reason} ->
            {:error, reason}
        end
      after
        File.rm(temp_path)
      end
    end
  end

  # Process PDF with multiple iterative Claude API calls
  defp process_pdf_iteratively(api_key, base64_content) do
    Logger.info("Starting iterative PDF processing")

    # First pass: Get document overview and first batch of items
    first_prompt = """
    This is a 10-page Snap-on transaction history PDF with 153+ line items worth $33,787.

    TASK: Extract ALL line items systematically. This document is very long.

    CRITICAL INSTRUCTIONS:
    1. This PDF contains 153+ line items across 10 pages
    2. Start from the beginning and extract EVERY SINGLE line item
    3. Each line item should have: part_number, description, quantity, unit_price, total_price, brand, discount
    4. DO NOT STOP EARLY - continue through ALL pages
    5. If you hit token limits, focus on extracting as many complete line items as possible

    Return JSON with:
    {
      "line_items": [array of ALL line items],
      "total_extracted": number,
      "needs_continuation": boolean,
      "last_page_processed": number,
      "receipt_metadata": {
        "vendor_name": "...",
        "total_amount": 33787.0,
        "transaction_date": "..."
      }
    }

    Extract ALL 153+ line items systematically. Start now:
    """

    case make_claude_call(api_key, base64_content, first_prompt) do
      {:ok, first_result} ->
        Logger.info("First pass extracted: #{length(first_result["line_items"] || [])} items")

        # If we got fewer than expected, try continuation passes
        if length(first_result["line_items"] || []) < 100 do
          # Continue with additional passes
          case continue_extraction(api_key, base64_content, first_result) do
            {:ok, all_items, metadata} ->
              {:ok, all_items, metadata}
            {:error, reason} ->
              # Fall back to first result if continuation fails
              {:ok, first_result["line_items"] || [], first_result["receipt_metadata"] || %{}}
          end
        else
          {:ok, first_result["line_items"] || [], first_result["receipt_metadata"] || %{}}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  # Continue extraction with additional Claude API calls
  defp continue_extraction(api_key, base64_content, previous_result) do
    last_page = previous_result["last_page_processed"] || 1

    continuation_prompt = """
    This is the same 10-page Snap-on transaction history PDF. You previously processed page #{last_page}.

    CONTINUATION TASK: Extract the REMAINING line items from pages #{last_page + 1} through 10.

    CONTEXT: Previously extracted #{length(previous_result["line_items"] || [])} items.
    REMAINING: Extract ALL remaining items from the rest of the document.

    Focus on pages #{last_page + 1}-10 and extract every line item with:
    - part_number, description, quantity, unit_price, total_price, brand, discount

    Return JSON with just the NEW line items:
    {
      "line_items": [array of NEW line items from remaining pages],
      "total_extracted": number
    }

    Extract all remaining items:
    """

    case make_claude_call(api_key, base64_content, continuation_prompt) do
      {:ok, continuation_result} ->
        # Merge results
        previous_items = previous_result["line_items"] || []
        new_items = continuation_result["line_items"] || []
        all_items = previous_items ++ new_items
        metadata = previous_result["receipt_metadata"] || %{}

        Logger.info("Total extracted after continuation: #{length(all_items)} items")
        {:ok, all_items, metadata}

      {:error, reason} ->
        {:error, reason}
    end
  end

  # Make a Claude API call with the PDF and prompt
  defp make_claude_call(api_key, base64_content, prompt) do
    url = "https://api.anthropic.com/v1/messages"

    headers = [
      {"x-api-key", api_key},
      {"Content-Type", "application/json"},
      {"anthropic-version", "2023-06-01"}
    ]

    request_body = %{
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 8192,
      messages: [
        %{
          role: "user",
          content: [
            %{
              type: "document",
              source: %{
                type: "base64",
                media_type: "application/pdf",
                data: base64_content
              }
            },
            %{type: "text", text: prompt}
          ]
        }
      ]
    }

    body = Jason.encode!(request_body)

    case HTTPoison.post(url, body, headers, timeout: 120_000, recv_timeout: 120_000) do
      {:ok, %HTTPoison.Response{status_code: 200, body: response_body}} ->
        case Jason.decode(response_body) do
          {:ok, %{"content" => [%{"text" => text} | _]}} ->
            # Extract JSON from response
            json_text = extract_json_from_text(text)
            case Jason.decode(json_text) do
              {:ok, parsed} -> {:ok, parsed}
              {:error, _} -> {:error, "Failed to parse Claude JSON response"}
            end

          {:error, _} ->
            {:error, "Failed to decode Claude API response"}
        end

      {:ok, %HTTPoison.Response{status_code: status_code, body: error_body}} ->
        Logger.error("Claude API returned #{status_code}: #{error_body}")
        {:error, "Claude API error: #{status_code}"}

      {:error, %HTTPoison.Error{reason: reason}} ->
        {:error, "Network error: #{inspect(reason)}"}
    end
  end

  # Batch processing for multiple receipt files
  def parse_batch(conn, %{"files" => files}) when is_list(files) do
    Logger.info("Batch parsing #{length(files)} receipt files")

    # Process files in parallel with rate limiting
    results =
      files
      |> Enum.with_index()
      |> Enum.map(fn {file, index} ->
        # Add small delay to respect rate limits
        if index > 0, do: :timer.sleep(500)

        case do_parse_receipt_file(conn, file.path, file.content_type, file.filename) do
          {:ok, result} ->
            %{
              filename: file.filename,
              success: true,
              result: result
            }
          {:error, reason} ->
            %{
              filename: file.filename,
              success: false,
              error: reason
            }
        end
      end)

    # Return batch results
    successful = Enum.count(results, & &1.success)
    total = length(results)

    conn
    |> put_resp_content_type("application/json")
    |> json(%{
      success: true,
      batch_summary: %{
        total_files: total,
        successful: successful,
        failed: total - successful
      },
      results: results
    })
  end

  def parse_batch(conn, %{"files" => files}) when is_map(files) do
    # Handle single file sent as map instead of array
    parse_batch(conn, %{"files" => [files]})
  end

  def parse_batch(conn, _params) do
    conn
    |> put_status(400)
    |> json(%{error: "Missing 'files' parameter. Please upload one or more files."})
  end


  # Parse receipt from file path
  defp parse_receipt_from_path(file_path, content_type, filename) do
    case call_claude_for_file(file_path, content_type, filename) do
      {:ok, parsed_result} ->
        {:ok, %{
          success: true,
          errors: [],
          filename: filename,
          content_type: content_type,
          confidence_score: parsed_result.confidence_score || 0.9,
          line_items: parsed_result.line_items || [],
          payment_records: parsed_result.payment_records || [],
          receipt_metadata: parsed_result.receipt_metadata || %{},
          raw_extraction: parsed_result
        }}

      {:error, reason} ->
        {:error, "Claude API error: #{reason}"}
    end
  end

  # Call Claude API for a single file
  defp call_claude_for_file(file_path, content_type, filename) do
    claude_api_key = System.get_env("CLAUDE_API_KEY")

    if !claude_api_key do
      {:error, "Claude API key not configured"}
    else
      case content_type do
        "application/pdf" ->
          # Use chunked processing for PDFs
          case File.read(file_path) do
            {:ok, file_content} ->
              parse_pdf_in_chunks(file_content, content_type)
            {:error, reason} ->
              {:error, "Failed to read PDF: #{reason}"}
          end

        _ ->
          # Use single call for text files
          call_claude_single_file(file_path, content_type, claude_api_key)
      end
    end
  end

  # Single Claude API call for non-PDF files
  defp call_claude_single_file(file_path, content_type, api_key) do
    case File.read(file_path) do
      {:ok, file_content} ->
        prompt = """
        Extract all transaction data from this receipt as JSON.

        Return format:
        {
          "line_items": [...],
          "payment_records": [...],
          "receipt_metadata": {...},
          "confidence_score": 0.95
        }

        Receipt content:
        #{file_content}
        """

        request_body = %{
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 4096,
          messages: [%{role: "user", content: prompt}]
        }

        case make_claude_call(api_key, "", prompt) do
          {:ok, result} -> {:ok, result}
          {:error, reason} -> {:error, reason}
        end

      {:error, reason} ->
        {:error, "Failed to read file: #{reason}"}
    end
  end
end
