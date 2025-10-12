defmodule NukeApiWeb.VehicleAnalysisJSON do
  @doc """
  Renders a vehicle analysis result.
  """
  def show(%{analysis: analysis}) do
    %{
      content: [%{
        type: "text",
        text: analysis.ai_response
      }],
      analysis_type: analysis.analysis_type,
      confidence_score: analysis.confidence_score,
      analysis_summary: analysis.analysis_summary,
      recommendations: analysis.recommendations,
      created_at: analysis.created_at
    }
  end

  @doc """
  Renders analysis creation result.
  """
  def create(%{result: result}) do
    result
  end

  @doc """
  Renders errors.
  """
  def error(%{error: error, details: details}) do
    %{
      error: error,
      details: details
    }
  end
end
