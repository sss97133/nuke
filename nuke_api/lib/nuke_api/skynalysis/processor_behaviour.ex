defmodule NukeApi.Skynalysis.ProcessorBehaviour do
  @moduledoc """
  Behaviour for AI analysis processors in the Skynalysis system.

  Each processor must implement the analyze/1 function that takes an analysis
  record and returns processing results with spatial tags and analysis data.
  """

  @doc """
  Analyzes the given analysis input and returns processing results.

  ## Parameters
    - analysis: Analysis struct containing input_images, input_parameters, and other metadata

  ## Returns
    - {:ok, result_map} with processing results including:
      - raw_response: The raw response from the AI service
      - summary: Human-readable summary of findings
      - confidence_score: Overall confidence (0.0 to 1.0)
      - key_findings: List of important discoveries
      - recommendations: List of recommended actions
      - spatial_tags: List of spatial tags to create (optional)
      - processing_time_ms: Time taken for processing
      - cost_cents: Cost of the analysis in cents
    - {:error, reason} if processing fails
  """
  @callback analyze(analysis :: map()) :: {:ok, map()} | {:error, any()}
end