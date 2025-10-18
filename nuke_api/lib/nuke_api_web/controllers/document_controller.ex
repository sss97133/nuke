defmodule NukeApiWeb.DocumentController do
  use NukeApiWeb, :controller

  alias NukeApi.Vehicles
  alias NukeApi.Vehicles.{Document, Vehicle}

  action_fallback NukeApiWeb.FallbackController

  @doc """
  Lists documents for a specific vehicle.
  """
  def index(conn, %{"vehicle_id" => vehicle_id} = params) do
    document_type = Map.get(params, "document_type")

    opts = []
    opts = if document_type, do: Keyword.put(opts, :document_type, document_type), else: opts

    documents = Vehicles.list_vehicle_documents(vehicle_id, opts)
    render(conn, :index, documents: documents)
  end

  @doc """
  Creates a new document for a vehicle via file upload.
  This endpoint handles multipart/form-data uploads.
  """
  def upload(conn, params) do
    # Handle document upload - support both camelCase and snake_case params
    vehicle_id = Map.get(params, "vehicle_id") || Map.get(params, "vehicleId")
    document_type = Map.get(params, "document_type", "other") || Map.get(params, "documentType", "other")
    title = Map.get(params, "title", "Uploaded Document")

    # Check if user is authorized to add documents to this vehicle
    vehicle = Vehicles.get_vehicle(vehicle_id)

    with true <- authorized?(conn, vehicle),
         {:ok, upload_result} <- handle_file_upload(params),
         document_params <- %{
           "vehicle_id" => vehicle_id,
           "document_type" => document_type,
           "title" => title,
           "file_url" => upload_result.file_url,
           "file_name" => upload_result.file_name,
           "file_type" => upload_result.file_type,
           "file_size" => upload_result.file_size,
           "uploaded_by" => conn.assigns.current_user_id
         },
         {:ok, %Document{} = document} <- Vehicles.create_vehicle_document(document_params) do

      conn
      |> put_status(:created)
      |> render(:show, document: document)
    else
      false ->
        conn
        |> put_status(:forbidden)
        |> json(%{error: "You are not authorized to add documents to this vehicle"})
      {:error, :no_file} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "No file uploaded"})
      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
  end

  @doc """
  Shows a specific document.
  """
  def show(conn, %{"id" => id}) do
    document = Vehicles.get_document(id)

    if document do
      render(conn, :show, document: document)
    else
      conn
      |> put_status(:not_found)
      |> json(%{error: "Document not found"})
    end
  end

  @doc """
  Updates document metadata.
  """
  def update(conn, %{"id" => id, "document" => document_params}) do
    document = Vehicles.get_document(id)

    if document do
      # Check if the user is authorized to modify documents for this vehicle
      vehicle = Vehicles.get_vehicle(document.vehicle_id)

      with true <- authorized?(conn, vehicle),
           {:ok, %Document{} = document} <- Vehicles.update_document(document, document_params) do
        render(conn, :show, document: document)
      else
        false ->
          conn
          |> put_status(:forbidden)
          |> json(%{error: "You are not authorized to modify documents for this vehicle"})
        {:error, changeset} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{errors: format_errors(changeset)})
      end
    else
      conn
      |> put_status(:not_found)
      |> json(%{error: "Document not found"})
    end
  end

  @doc """
  Deletes a document.
  """
  def delete(conn, %{"id" => id}) do
    document = Vehicles.get_document(id)

    if document do
      # Check if the user is authorized to delete documents for this vehicle
      vehicle = Vehicles.get_vehicle(document.vehicle_id)

      with true <- authorized?(conn, vehicle),
           {:ok, _} <- Vehicles.delete_document(document) do
        send_resp(conn, :no_content, "")
      else
        false ->
          conn
          |> put_status(:forbidden)
          |> json(%{error: "You are not authorized to delete documents for this vehicle"})
        {:error, _} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{error: "Could not delete document"})
      end
    else
      conn
      |> put_status(:not_found)
      |> json(%{error: "Document not found"})
    end
  end

  # Private helper functions

  defp authorized?(conn, %Vehicle{} = vehicle) do
    # Allow any authenticated user to participate by uploading documents
    # Check if user is authenticated via JWT token
    case conn.assigns do
      %{authenticated: true, current_user_id: user_id} when is_binary(user_id) -> true
      _ -> false
    end
  end

  defp authorized?(conn, nil) do
    # Handle case where vehicle lookup failed
    false
  end

  defp handle_file_upload(params) do
    # Look for uploaded file in various possible parameter names
    file_upload = params["file"] || params["document"] || params["titleDocument"] || params["driversLicense"]

    if file_upload && file_upload != "" do
      # Upload to Supabase Storage
      case upload_to_supabase_storage(file_upload) do
        {:ok, file_url} ->
          {:ok, %{
            file_url: file_url,
            file_name: file_upload.filename,
            file_type: file_upload.content_type || "application/octet-stream",
            file_size: File.stat!(file_upload.path).size
          }}
        {:error, reason} ->
          {:error, reason}
      end
    else
      {:error, :no_file}
    end
  end

  defp upload_to_supabase_storage(file_upload) do
    # Generate unique filename with timestamp
    timestamp = DateTime.utc_now() |> DateTime.to_unix()
    unique_filename = "#{timestamp}_#{file_upload.filename}"
    storage_path = "documents/#{unique_filename}"

    # Read file content
    case File.read(file_upload.path) do
      {:ok, file_content} ->
        # Upload to Supabase using REST API
        supabase_url = System.get_env("SUPABASE_URL") || "https://qkgaybvrernstplzjaam.supabase.co"
        supabase_key = System.get_env("SUPABASE_SERVICE_ROLE_KEY") || System.get_env("SUPABASE_ANON_KEY")

        url = "#{supabase_url}/storage/v1/object/vehicle-images/#{storage_path}"

        headers = [
          {"Authorization", "Bearer #{supabase_key}"},
          {"Content-Type", file_upload.content_type || "application/octet-stream"}
        ]

        case HTTPoison.post(url, file_content, headers) do
          {:ok, %HTTPoison.Response{status_code: 200}} ->
            # Return public URL
            public_url = "#{supabase_url}/storage/v1/object/public/vehicle-images/#{storage_path}"
            {:ok, public_url}
          {:ok, %HTTPoison.Response{status_code: status_code, body: body}} ->
            {:error, "Upload failed with status #{status_code}: #{body}"}
          {:error, %HTTPoison.Error{reason: reason}} ->
            {:error, "Upload failed: #{reason}"}
        end
      {:error, reason} ->
        {:error, "Could not read file: #{reason}"}
    end
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {key, value}, acc ->
        String.replace(acc, "%{#{key}}", to_string(value))
      end)
    end)
  end
end