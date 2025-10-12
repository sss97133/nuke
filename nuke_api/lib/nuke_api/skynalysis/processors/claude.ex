defmodule NukeApi.Skynalysis.Processors.Claude do
  @moduledoc """
  Claude (Anthropic) processor for Skynalysis vehicle analysis
  
  Provides professional automotive expertise using Claude's vision capabilities
  """

  @behaviour NukeApi.Skynalysis.ProcessorBehaviour

  @doc """
  Analyze vehicle using Claude's vision capabilities
  """
  def analyze(analysis) do
    start_time = System.monotonic_time(:millisecond)
    
    with {:ok, prompt} <- build_analysis_prompt(analysis),
         {:ok, images} <- prepare_images(analysis),
         {:ok, response} <- call_claude_api(prompt, images, analysis.ai_processor.config),
         {:ok, structured_result} <- parse_claude_response(response, analysis.analysis_type) do
      
      end_time = System.monotonic_time(:millisecond)
      processing_time = end_time - start_time
      
      {:ok, %{
        raw_response: response,
        summary: structured_result.summary,
        confidence_score: structured_result.confidence_score,
        key_findings: structured_result.key_findings,
        recommendations: structured_result.recommendations,
        processing_time_ms: processing_time,
        cost_cents: calculate_cost(response, images)
      }}
    else
      {:error, reason} -> {:error, reason}
    end
  end

  # Private functions

  defp build_analysis_prompt(analysis) do
    vehicle_info = get_vehicle_info(analysis.vehicle_id)
    
    base_prompt = """
    You are Skynalysis, an expert AI vehicle analysis system. You provide professional automotive assessments with the precision of a certified appraiser.
    
    Vehicle Information:
    - Make: #{vehicle_info.make}
    - Model: #{vehicle_info.model}
    - Year: #{vehicle_info.year}
    - VIN: #{vehicle_info.vin || "Not provided"}
    - Color: #{vehicle_info.color || "Not specified"}
    - Mileage: #{if vehicle_info.mileage, do: "#{vehicle_info.mileage} miles", else: "Not specified"}
    
    Analysis Type: #{format_analysis_type(analysis.analysis_type)}
    """
    
    specific_prompt = case analysis.analysis_type do
      "complete" -> complete_analysis_prompt()
      "condition" -> condition_analysis_prompt()
      "damage" -> damage_analysis_prompt()
      "value" -> value_analysis_prompt()
      "authenticity" -> authenticity_analysis_prompt()
      _ -> complete_analysis_prompt()
    end
    
    {:ok, base_prompt <> "\n\n" <> specific_prompt}
  end

  defp complete_analysis_prompt do
    """
    Provide a comprehensive vehicle analysis covering:
    
    1. CONDITION ASSESSMENT
    - Overall condition rating (1-10)
    - Paint and body condition
    - Interior condition
    - Mechanical components visible
    
    2. DAMAGE DETECTION
    - Any visible damage or wear
    - Severity assessment
    - Repair recommendations
    
    3. AUTHENTICITY & MODIFICATIONS
    - Original vs modified components
    - Period-correct details
    - Signs of restoration
    
    4. MARKET VALUE INSIGHTS
    - Condition-based value assessment
    - Market positioning
    - Factors affecting value
    
    5. KEY FINDINGS & RECOMMENDATIONS
    - Most important observations
    - Actionable recommendations
    - Areas needing attention
    
    Format your response as structured JSON with clear sections and confidence scores for each assessment.
    """
  end

  defp condition_analysis_prompt do
    """
    Focus on detailed condition assessment:
    
    - Rate overall condition (1-10 scale)
    - Assess paint quality, scratches, dents
    - Evaluate interior wear and tear
    - Check visible mechanical components
    - Note any maintenance indicators
    - Provide condition-based recommendations
    
    Be specific about what you observe and provide confidence levels for your assessments.
    """
  end

  defp damage_analysis_prompt do
    """
    Conduct thorough damage assessment:
    
    - Identify all visible damage
    - Categorize damage severity (minor/moderate/major)
    - Estimate repair complexity
    - Note safety-related issues
    - Provide repair prioritization
    - Suggest professional inspection needs
    
    Focus on accuracy and detail in damage identification.
    """
  end

  defp value_analysis_prompt do
    """
    Provide market value analysis based on visual condition:
    
    - Assess condition impact on value
    - Compare to market standards
    - Note value-affecting modifications
    - Identify value-enhancing features
    - Consider rarity and desirability
    - Provide value range estimates
    
    Base analysis on observable condition and market knowledge.
    """
  end

  defp authenticity_analysis_prompt do
    """
    Analyze vehicle authenticity and originality:
    
    - Verify period-correct components
    - Identify original vs replacement parts
    - Check for matching numbers (if visible)
    - Note restoration quality
    - Spot non-original modifications
    - Assess historical accuracy
    
    Focus on details that indicate authenticity and originality.
    """
  end

  defp prepare_images(analysis) do
    # Get images from analysis.input_images and convert to Claude format
    images = Enum.map(analysis.input_images, fn image_meta ->
      # Load image data (from storage or base64)
      image_data = load_image_data(image_meta)
      
      %{
        type: "image",
        source: %{
          type: "base64",
          media_type: image_meta["mime_type"],
          data: image_data
        }
      }
    end)
    
    {:ok, images}
  end

  defp call_claude_api(prompt, images, config) do
    api_key = System.get_env("ANTHROPIC_API_KEY")
    
    if !api_key do
      {:error, "ANTHROPIC_API_KEY not configured"}
    else
      # Build message content with images and text
      content = images ++ [%{type: "text", text: prompt}]
      
      request_body = %{
        model: config["model_name"] || "claude-3-5-sonnet-20241022",
        max_tokens: config["max_tokens"] || 2048,
        temperature: config["temperature"] || 0.3,
        messages: [%{role: "user", content: content}]
      }
      
      headers = [
        {"Content-Type", "application/json"},
        {"Authorization", "Bearer #{api_key}"},
        {"anthropic-version", "2023-06-01"}
      ]
      
      case HTTPoison.post("https://api.anthropic.com/v1/messages", 
                         Jason.encode!(request_body), 
                         headers) do
        {:ok, %{status_code: 200, body: body}} ->
          case Jason.decode(body) do
            {:ok, response} -> {:ok, response}
            {:error, _} -> {:error, "Failed to parse Claude response"}
          end
        
        {:ok, %{status_code: status, body: body}} ->
          {:error, "Claude API error #{status}: #{body}"}
        
        {:error, reason} ->
          {:error, "Claude API request failed: #{inspect(reason)}"}
      end
    end
  end

  defp parse_claude_response(response, analysis_type) do
    content = get_in(response, ["content", Access.at(0), "text"])
    
    if !content do
      {:error, "No content in Claude response"}
    else
      # Try to parse as JSON first, fall back to text parsing
      case Jason.decode(content) do
        {:ok, structured_data} ->
          parse_structured_response(structured_data, analysis_type)
        
        {:error, _} ->
          parse_text_response(content, analysis_type)
      end
    end
  end

  defp parse_structured_response(data, _analysis_type) do
    {:ok, %{
      summary: data["summary"] || data["analysis_summary"] || "Analysis completed",
      confidence_score: parse_confidence(data["confidence_score"] || data["confidence"]),
      key_findings: data["key_findings"] || data["findings"] || [],
      recommendations: data["recommendations"] || []
    }}
  end

  defp parse_text_response(content, _analysis_type) do
    # Extract key information from text response
    summary = extract_summary(content)
    confidence = extract_confidence(content)
    findings = extract_findings(content)
    recommendations = extract_recommendations(content)
    
    {:ok, %{
      summary: summary,
      confidence_score: confidence,
      key_findings: findings,
      recommendations: recommendations
    }}
  end

  defp extract_summary(content) do
    # Take first paragraph or first 200 characters as summary
    content
    |> String.split("\n\n")
    |> List.first()
    |> String.slice(0, 200)
    |> String.trim()
  end

  defp extract_confidence(content) do
    # Look for confidence indicators in text
    cond do
      String.contains?(content, ["excellent", "pristine", "perfect"]) -> 0.95
      String.contains?(content, ["very good", "great", "outstanding"]) -> 0.85
      String.contains?(content, ["good", "solid", "decent"]) -> 0.75
      String.contains?(content, ["fair", "average", "okay"]) -> 0.65
      String.contains?(content, ["poor", "bad", "concerning"]) -> 0.45
      true -> 0.75 # default confidence
    end
  end

  defp extract_findings(content) do
    # Extract bullet points or numbered items as findings
    content
    |> String.split("\n")
    |> Enum.filter(fn line -> 
      String.starts_with?(String.trim(line), ["•", "-", "*", "1.", "2.", "3."]) 
    end)
    |> Enum.map(&String.trim/1)
    |> Enum.take(10) # limit to 10 findings
  end

  defp extract_recommendations(content) do
    # Look for recommendation sections
    if String.contains?(content, "recommend") do
      content
      |> String.split("recommend")
      |> Enum.drop(1)
      |> Enum.map(&String.trim/1)
      |> Enum.take(5)
    else
      []
    end
  end

  defp parse_confidence(nil), do: 0.75
  defp parse_confidence(conf) when is_number(conf), do: conf
  defp parse_confidence(conf) when is_binary(conf) do
    case Float.parse(conf) do
      {float_val, _} -> float_val
      :error -> 0.75
    end
  end

  defp calculate_cost(response, images) do
    # Rough cost calculation based on tokens and images
    # Claude pricing: ~$15/million input tokens, ~$75/million output tokens
    # Images: ~$1.20 per image
    
    input_tokens = estimate_input_tokens(images)
    output_tokens = estimate_output_tokens(response)
    
    input_cost = (input_tokens / 1_000_000) * 15 * 100  # convert to cents
    output_cost = (output_tokens / 1_000_000) * 75 * 100
    image_cost = length(images) * 120  # 120 cents per image
    
    round(input_cost + output_cost + image_cost)
  end

  defp estimate_input_tokens(images) do
    # Rough estimate: 1000 tokens per image + prompt tokens
    length(images) * 1000 + 500
  end

  defp estimate_output_tokens(response) do
    content = get_in(response, ["content", Access.at(0), "text"]) || ""
    # Rough estimate: 4 characters per token
    round(String.length(content) / 4)
  end

  defp load_image_data(image_meta) do
    # This would load the actual image data
    # For now, return placeholder
    "base64_image_data_here"
  end

  defp get_vehicle_info(vehicle_id) do
    # Load vehicle info from database
    # For now, return placeholder
    %{
      make: "Porsche",
      model: "911",
      year: 1973,
      vin: nil,
      color: nil,
      mileage: nil
    }
  end

  defp format_analysis_type(type) do
    case type do
      "complete" -> "Complete Vehicle Analysis"
      "condition" -> "Condition Assessment"
      "damage" -> "Damage Assessment"
      "value" -> "Market Value Analysis"
      "authenticity" -> "Authenticity Verification"
      _ -> "Vehicle Analysis"
    end
  end
end
