defmodule NukeApi.Skynalysis.Processor do
  @moduledoc """
  Skynalysis AI Processor System
  
  Handles multiple AI backends for vehicle analysis:
  - Claude (Anthropic)
  - AWS Rekognition
  - GPT-4 Vision (OpenAI)
  - Custom processors
  """

  import Ecto.Query, warn: false
  alias NukeApi.Skynalysis.Processors.{Claude, AWSRekognition, GPTVision}
  alias NukeApi.Repo
  alias NukeApi.Skynalysis.{Analysis, AIProcessor}

  @doc """
  Process a vehicle analysis using the specified processor
  """
  def process_analysis(analysis_id) do
    with {:ok, analysis} <- get_analysis_with_processor(analysis_id),
         {:ok, processor_module} <- get_processor_module(analysis.ai_processor.name),
         {:ok, _} <- update_analysis_status(analysis_id, "processing"),
         {:ok, result} <- processor_module.analyze(analysis),
         {:ok, _} <- save_analysis_result(analysis_id, result) do
      {:ok, result}
    else
      {:error, reason} ->
        update_analysis_status(analysis_id, "failed", reason)
        {:error, reason}
    end
  end

  @doc """
  Get available processors for a given analysis type
  """
  def get_available_processors(analysis_type) do
    AIProcessor
    |> where([p], p.is_active == true)
    |> where([p], fragment("? @> ?", p.capabilities, ^[analysis_type]))
    |> Repo.all()
  end

  @doc """
  Create a new analysis request
  """
  def create_analysis(vehicle_id, processor_name, analysis_type, images, params \\ %{}) do
    with {:ok, processor} <- get_processor_by_name(processor_name),
         {:ok, analysis} <- create_analysis_record(vehicle_id, processor.id, analysis_type, images, params) do
      # Process asynchronously
      Task.start(fn -> process_analysis(analysis.id) end)
      {:ok, analysis}
    end
  end

  # Private functions

  defp get_analysis_with_processor(analysis_id) do
    case Repo.get(Analysis, analysis_id) |> Repo.preload(:ai_processor) do
      nil -> {:error, "Analysis not found"}
      analysis -> {:ok, analysis}
    end
  end

  defp get_processor_module(processor_name) do
    case processor_name do
      "claude-vision" -> {:ok, Claude}
      "aws-rekognition" -> {:ok, AWSRekognition}
      "gpt-vision" -> {:ok, GPTVision}
      _ -> {:error, "Unknown processor: #{processor_name}"}
    end
  end

  defp get_processor_by_name(name) do
    case Repo.get_by(AIProcessor, name: name, is_active: true) do
      nil -> {:error, "Processor not found: #{name}"}
      processor -> {:ok, processor}
    end
  end

  defp create_analysis_record(vehicle_id, processor_id, analysis_type, images, params) do
    %Analysis{}
    |> Analysis.changeset(%{
      vehicle_id: vehicle_id,
      processor_id: processor_id,
      analysis_type: analysis_type,
      input_images: prepare_images_metadata(images),
      input_parameters: params,
      status: "pending"
    })
    |> Repo.insert()
  end

  defp prepare_images_metadata(images) do
    Enum.map(images, fn image ->
      %{
        file_name: image.file_name,
        file_size: image.file_size,
        mime_type: image.mime_type,
        image_type: image.image_type || "exterior",
        width: image.width,
        height: image.height
      }
    end)
  end

  defp update_analysis_status(analysis_id, status, error_message \\ nil) do
    analysis = Repo.get!(Analysis, analysis_id)
    
    changeset_params = %{
      status: status,
      started_at: (if status == "processing", do: DateTime.utc_now(), else: analysis.started_at),
      completed_at: (if status in ["completed", "failed"], do: DateTime.utc_now(), else: nil)
    }
    
    changeset_params = if error_message do
      Map.put(changeset_params, :error_message, error_message)
    else
      changeset_params
    end

    analysis
    |> Analysis.changeset(changeset_params)
    |> Repo.update()
  end

  defp save_analysis_result(analysis_id, result) do
    analysis = Repo.get!(Analysis, analysis_id)
    
    analysis
    |> Analysis.changeset(%{
      status: "completed",
      raw_response: result.raw_response,
      analysis_summary: result.summary,
      confidence_score: result.confidence_score,
      key_findings: result.key_findings,
      recommendations: result.recommendations,
      processing_time_ms: result.processing_time_ms,
      cost_cents: result.cost_cents,
      completed_at: DateTime.utc_now()
    })
    |> Repo.update()
  end
end
