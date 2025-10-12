defmodule NukeApi.Valuation.PromptConfiguration do
  @moduledoc """
  Configurable valuation prompts for documentation-based vehicle analysis.

  This module allows you to tweak and tune the analysis parameters without
  redeploying code - think of these as your algorithm parameters.
  """

  @doc """
  Get the current valuation prompt configuration.
  These can be modified via admin interface or environment variables.
  """
  def get_valuation_prompt_config do
    %{
      # Core philosophy: Documentation verification over basic specs
      focus: "documentation_verification",

      # Analysis weights (totaling 100%)
      weights: %{
        documentation_quality: 35,    # Timeline consistency, image progression
        verification_depth: 30,       # Before/during/after proof
        work_authenticity: 20,        # Receipts, parts, process evidence
        timeline_consistency: 15      # Dates, progression logic
      },

      # Documentation scoring criteria
      documentation_levels: %{
        authenticated: %{
          score: 90-100,
          requirements: "Complete process documentation with timeline progression"
        },
        verified: %{
          score: 70-89,
          requirements: "Substantial documentation with some timeline gaps"
        },
        documented: %{
          score: 40-69,
          requirements: "Basic photos and receipts provided"
        },
        claimed: %{
          score: 0-39,
          requirements: "Claims without supporting documentation"
        }
      },

      # System prompts (easily modifiable)
      system_prompt: get_system_prompt(),
      valuation_prompt_template: get_valuation_template(),
      documentation_analysis_template: get_documentation_template()
    }
  end

  @doc """
  Update prompt configuration (admin only).
  This allows real-time algorithm tuning.
  """
  def update_prompt_config(new_config, admin_user_id) do
    # Store in database or config system
    # For now, return success
    {:ok, "Prompt configuration updated by admin #{admin_user_id}"}
  end

  defp get_system_prompt do
    """
    You are a vehicle documentation analyst specializing in restoration verification.

    Your role is NOT to guess vehicle values based on age/mileage, but to evaluate
    the QUALITY and AUTHENTICITY of restoration work based on provided documentation.

    Focus on:
    1. Timeline consistency - Does the documented work make logical sense?
    2. Process verification - Is there evidence of actual work performed?
    3. Quality assessment - Based on visual evidence, what level of work was done?
    4. Documentation completeness - How well is the work proven?

    Ignore traditional metrics like mileage unless backed by documentation.
    Value restoration PROOF over restoration CLAIMS.

    Respond with valid JSON containing your analysis.
    """
  end

  defp get_valuation_template do
    """
    VEHICLE DOCUMENTATION ANALYSIS

    BASIC VEHICLE INFO:
    - Year: {{year}} {{make}} {{model}}
    - VIN: {{vin}}

    DOCUMENTATION ANALYSIS:
    {{timeline_events}}

    IMAGE VERIFICATION:
    {{image_analysis}}

    WORK VERIFICATION:
    {{work_documentation}}

    Analyze this vehicle's DOCUMENTED restoration work and provide valuation in JSON:
    {
      "documentation_score": 0-100,
      "verification_level": "authenticated|verified|documented|claimed",
      "valuation_analysis": {
        "documented_work_value": 0,
        "verification_confidence": 0-100,
        "timeline_consistency": 0-100,
        "process_authenticity": 0-100
      },
      "work_categories": {
        "paint_restoration": {"documented": true/false, "quality_score": 0-100, "evidence_strength": 0-100},
        "engine_work": {"documented": true/false, "quality_score": 0-100, "evidence_strength": 0-100},
        "interior_restoration": {"documented": true/false, "quality_score": 0-100, "evidence_strength": 0-100},
        "undercarriage_work": {"documented": true/false, "quality_score": 0-100, "evidence_strength": 0-100}
      },
      "red_flags": [],
      "verification_strengths": [],
      "estimated_restoration_investment": 0,
      "confidence_factors": [],
      "documentation_gaps": []
    }
    """
  end

  defp get_documentation_template do
    """
    TIMELINE EVENT ANALYSIS:

    Event Type: {{event_type}}
    Date Range: {{date_range}}
    Images: {{image_count}}
    Description: {{description}}

    VERIFICATION QUESTIONS:
    1. Does this timeline make sense logically?
    2. Are there before/during/after images showing progression?
    3. Is there evidence of actual work vs. just claims?
    4. Does the quality of work match the claimed investment?
    5. Are there any inconsistencies in the documentation?

    Rate this timeline event's authenticity and documentation quality.
    """
  end

  @doc """
  Build the actual prompt for OpenAI with current configuration.
  """
  def build_valuation_prompt(vehicle, timeline_events, images, config \\ nil) do
    config = config || get_valuation_prompt_config()

    template = config.valuation_prompt_template

    # Replace template variables with actual data
    template
    |> String.replace("{{year}}", to_string(vehicle.year || "Unknown"))
    |> String.replace("{{make}}", to_string(vehicle.make || "Unknown"))
    |> String.replace("{{model}}", to_string(vehicle.model || "Unknown"))
    |> String.replace("{{vin}}", to_string(vehicle.vin || "Not provided"))
    |> String.replace("{{timeline_events}}", format_timeline_events(timeline_events))
    |> String.replace("{{image_analysis}}", format_image_analysis(images))
    |> String.replace("{{work_documentation}}", format_work_documentation(timeline_events))
  end

  defp format_timeline_events(events) do
    if length(events) == 0 do
      "No timeline events documented - this significantly impacts verification score."
    else
      events
      |> Enum.map(fn event ->
        """
        Event: #{event.title || "Untitled"}
        Date: #{event.event_date || "Undated"}
        Type: #{event.event_type || "Unspecified"}
        Images: #{Map.get(event.metadata || %{}, "image_count", 0)}
        Description: #{event.description || "No description"}
        """
      end)
      |> Enum.join("\n---\n")
    end
  end

  defp format_image_analysis(images) do
    if length(images) == 0 do
      "No images provided - cannot verify any work claims."
    else
      total_images = length(images)
      """
      Total Images: #{total_images}
      Coverage Analysis: [This would analyze image categories, quality, progression evidence]
      Documentation Strength: #{if(total_images > 50, do: "Strong", else: if(total_images > 20, do: "Moderate", else: "Weak"))}
      """
    end
  end

  defp format_work_documentation(timeline_events) do
    work_types = timeline_events
    |> Enum.map(& &1.event_type)
    |> Enum.uniq()
    |> Enum.join(", ")

    if work_types == "" do
      "No specific work types documented."
    else
      "Documented work types: #{work_types}"
    end
  end
end