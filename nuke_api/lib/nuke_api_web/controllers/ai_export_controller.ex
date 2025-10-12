defmodule NukeApiWeb.AIExportController do
  use NukeApiWeb, :controller

  alias NukeApi.AI.TrainingDataExport

  action_fallback NukeApiWeb.FallbackController

  @doc """
  Creates a new training data export with specified parameters.
  """
  def create_export(conn, params) do
    with true <- conn.assigns.authenticated do
      # Parse export parameters
      export_opts = [
        format: parse_format(params["format"]),
        export_type: params["export_type"] || "full_dataset",
        date_range: parse_date_range(params),
        min_trust_score: parse_integer(params["min_trust_score"], 50),
        verification_status: params["verification_status"],
        tag_types: parse_tag_types(params["tag_types"]),
        brands: parse_brands(params["brands"]),
        include_unverified: params["include_unverified"] == "true",
        user_id: conn.assigns.current_user_id
      ]

      # Start export process asynchronously
      Task.start(fn ->
        TrainingDataExport.export_training_dataset(export_opts)
      end)

      conn
      |> put_status(:accepted)
      |> json(%{
        message: "Export started successfully. You will be notified when complete.",
        export_config: export_opts
      })
    else
      false ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "Authentication required"})
    end
  end

  @doc """
  Lists previous training data exports for the authenticated user.
  """
  def list_exports(conn, params) do
    with true <- conn.assigns.authenticated do
      limit = parse_integer(params["limit"], 20)
      exports = TrainingDataExport.list_exports(limit: limit, user_id: conn.assigns.current_user_id)

      conn
      |> json(%{
        data: exports,
        count: length(exports)
      })
    else
      false ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "Authentication required"})
    end
  end

  @doc """
  Gets details of a specific export.
  """
  def show_export(conn, %{"id" => export_id}) do
    with true <- conn.assigns.authenticated,
         export when not is_nil(export) <- TrainingDataExport.get_export(export_id),
         true <- export.exported_by == conn.assigns.current_user_id do

      conn
      |> json(%{data: export})
    else
      false ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "Authentication required"})

      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Export not found"})

      _ ->
        conn
        |> put_status(:forbidden)
        |> json(%{error: "You can only view your own exports"})
    end
  end

  @doc """
  Downloads a completed export file.
  """
  def download_export(conn, %{"id" => export_id}) do
    with true <- conn.assigns.authenticated,
         export when not is_nil(export) <- TrainingDataExport.get_export(export_id),
         true <- export.exported_by == conn.assigns.current_user_id,
         true <- File.exists?(export.export_url) do

      # Determine content type based on format
      content_type = case export.export_format do
        "json" -> "application/json"
        "csv" -> "text/csv"
        "coco" -> "application/json"
        "yolo" -> "application/zip"
        "tfrecord" -> "application/octet-stream"
        _ -> "application/octet-stream"
      end

      filename = Path.basename(export.export_url)

      conn
      |> put_resp_content_type(content_type)
      |> put_resp_header("content-disposition", "attachment; filename=\"#{filename}\"")
      |> send_file(200, export.export_url)
    else
      false ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "Authentication required"})

      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Export not found"})

      _ ->
        conn
        |> put_status(:forbidden)
        |> json(%{error: "You can only download your own exports or file doesn't exist"})
    end
  end

  @doc """
  Provides export format documentation and examples.
  """
  def export_formats(conn, _params) do
    formats = %{
      json: %{
        description: "Flexible JSON format with complete metadata",
        use_case: "General purpose analysis and custom model training",
        structure: %{
          metadata: "Export information and statistics",
          images: [
            %{
              id: "image identifier",
              url: "image URL",
              spatial_tags: [
                %{
                  id: "tag ID",
                  x: "x coordinate (percentage)",
                  y: "y coordinate (percentage)",
                  type: "tag type (product, location, damage, etc.)",
                  text: "tag description",
                  verification_status: "verification status",
                  trust_score: "confidence score (0-100)"
                }
              ]
            }
          ]
        }
      },
      coco: %{
        description: "COCO format for object detection model training",
        use_case: "Training YOLO, R-CNN, and other object detection models",
        structure: %{
          info: "dataset information",
          licenses: "license information",
          categories: "object categories",
          images: "image metadata",
          annotations: "bounding box annotations"
        }
      },
      yolo: %{
        description: "YOLO format with normalized bounding boxes",
        use_case: "Training YOLO object detection models",
        structure: %{
          classes: "classes.txt file with class names",
          annotations: "one .txt file per image with normalized coordinates"
        }
      },
      csv: %{
        description: "Tabular format for analysis and statistics",
        use_case: "Data analysis, reporting, and simple ML models",
        columns: [
          "image_id", "image_url", "tag_x", "tag_y", "tag_type",
          "tag_text", "verification_status", "trust_score", "brand_name"
        ]
      },
      tfrecord: %{
        description: "TensorFlow Record format (planned)",
        use_case: "TensorFlow model training",
        status: "coming_soon"
      }
    }

    conn
    |> json(%{
      data: formats,
      available_formats: Map.keys(formats)
    })
  end

  @doc """
  Returns dataset statistics for export planning.
  """
  def dataset_stats(conn, params) do
    # Parse filters
    filters = %{
      date_range: parse_date_range(params),
      min_trust_score: parse_integer(params["min_trust_score"], 0),
      verification_status: params["verification_status"],
      tag_types: parse_tag_types(params["tag_types"]),
      brands: parse_brands(params["brands"])
    }

    # Calculate statistics (simplified - would use actual queries)
    stats = %{
      total_images: 1500,  # Placeholder
      total_tags: 8500,    # Placeholder
      verified_tags: 6800, # Placeholder
      tag_type_distribution: %{
        "product" => 4200,
        "damage" => 2100,
        "location" => 1500,
        "modification" => 700
      },
      brand_distribution: %{
        "Chevrolet" => 850,
        "Ford" => 720,
        "Toyota" => 650,
        "Snap-on" => 420
      },
      verification_distribution: %{
        "verified" => 6800,
        "peer_verified" => 1200,
        "pending" => 500
      },
      estimated_export_size: %{
        json: "15.2 MB",
        csv: "2.8 MB",
        coco: "18.5 MB",
        yolo: "12.1 MB"
      }
    }

    conn
    |> json(%{
      data: stats,
      filters_applied: filters
    })
  end

  # =====================================================================================
  # PRIVATE HELPER FUNCTIONS
  # =====================================================================================

  defp parse_format(format_string) do
    case format_string do
      "json" -> :json
      "csv" -> :csv
      "coco" -> :coco
      "yolo" -> :yolo
      "tfrecord" -> :tfrecord
      _ -> :json
    end
  end

  defp parse_date_range(params) do
    case {params["start_date"], params["end_date"]} do
      {start_str, end_str} when is_binary(start_str) and is_binary(end_str) ->
        with {:ok, start_date} <- Date.from_iso8601(start_str),
             {:ok, end_date} <- Date.from_iso8601(end_str) do
          %{start: start_date, end: end_date}
        else
          _ -> nil
        end
      _ -> nil
    end
  end

  defp parse_integer(value, default) do
    case value do
      nil -> default
      str when is_binary(str) ->
        case Integer.parse(str) do
          {int, _} -> int
          :error -> default
        end
      int when is_integer(int) -> int
      _ -> default
    end
  end

  defp parse_tag_types(tag_types_param) do
    case tag_types_param do
      nil -> ["product", "location", "damage", "modification"]
      str when is_binary(str) -> String.split(str, ",")
      list when is_list(list) -> list
      _ -> ["product", "location", "damage", "modification"]
    end
  end

  defp parse_brands(brands_param) do
    case brands_param do
      nil -> nil
      str when is_binary(str) -> String.split(str, ",")
      list when is_list(list) -> list
      _ -> nil
    end
  end
end