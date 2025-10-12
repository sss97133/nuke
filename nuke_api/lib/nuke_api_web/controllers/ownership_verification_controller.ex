defmodule NukeApiWeb.OwnershipVerificationController do
  use NukeApiWeb, :controller

  alias NukeApi.Ownership
  alias NukeApi.Ownership.OwnershipVerification
  alias NukeApi.Vehicles

  action_fallback NukeApiWeb.FallbackController

  @doc """
  Creates a new ownership verification request.
  """
  def create(conn, params) do
    vehicle_id = Map.get(params, "vehicle_id") || Map.get(params, "vehicleId")

    # Check if vehicle exists
    vehicle = Vehicles.get_vehicle(vehicle_id)

    if vehicle do
      verification_params = %{
        "user_id" => conn.assigns.current_user_id,
        "vehicle_id" => vehicle_id,
        "verification_type" => Map.get(params, "verification_type", "title"),
        "status" => "pending",
        "submitted_at" => NaiveDateTime.utc_now()
      }

      case Ownership.create_ownership_verification(verification_params) do
        {:ok, %OwnershipVerification{} = verification} ->
          conn
          |> put_status(:created)
          |> render(:show, ownership_verification: verification)

        {:error, changeset} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{errors: format_errors(changeset)})
      end
    else
      conn
      |> put_status(:not_found)
      |> json(%{error: "Vehicle not found"})
    end
  end

  @doc """
  Gets ownership verifications for a vehicle.
  """
  def index(conn, %{"vehicle_id" => vehicle_id}) do
    verifications = Ownership.list_vehicle_ownership_verifications(vehicle_id)
    render(conn, :index, ownership_verifications: verifications)
  end

  @doc """
  Gets a specific ownership verification.
  """
  def show(conn, %{"id" => id}) do
    case Ownership.get_ownership_verification(id) do
      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Verification not found"})

      verification ->
        render(conn, :show, ownership_verification: verification)
    end
  end

  @doc """
  Updates ownership verification with document URLs.
  """
  def update_documents(conn, %{"id" => id} = params) do
    case Ownership.get_ownership_verification(id) do
      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Verification not found"})

      verification ->
        # Only allow the verification owner to update
        if verification.user_id == conn.assigns.current_user_id do
          update_params = %{
            "title_document_url" => Map.get(params, "title_document_url"),
            "drivers_license_url" => Map.get(params, "drivers_license_url"),
            "face_scan_url" => Map.get(params, "face_scan_url"),
            "insurance_document_url" => Map.get(params, "insurance_document_url"),
            "status" => "documents_uploaded"
          }
          |> Enum.reject(fn {_, v} -> is_nil(v) end)
          |> Enum.into(%{})

          case Ownership.update_ownership_verification(verification, update_params) do
            {:ok, updated_verification} ->
              render(conn, :show, ownership_verification: updated_verification)

            {:error, changeset} ->
              conn
              |> put_status(:unprocessable_entity)
              |> json(%{errors: format_errors(changeset)})
          end
        else
          conn
          |> put_status(:forbidden)
          |> json(%{error: "You can only update your own verification requests"})
        end
    end
  end

  @doc """
  Uploads a document for ownership verification.
  """
  def upload_document(conn, params) do
    verification_id = Map.get(params, "verification_id")
    document_type = Map.get(params, "document_type", "title")

    case Ownership.get_ownership_verification(verification_id) do
      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Verification not found"})

      verification ->
        if verification.user_id == conn.assigns.current_user_id do
          with {:ok, upload_result} <- handle_file_upload(params),
               {:ok, updated_verification} <- update_verification_with_document(verification, document_type, upload_result) do

            render(conn, :show, ownership_verification: updated_verification)
          else
            {:error, :no_file} ->
              conn
              |> put_status(:bad_request)
              |> json(%{error: "No file uploaded"})

            {:error, changeset} ->
              conn
              |> put_status(:unprocessable_entity)
              |> json(%{errors: format_errors(changeset)})
          end
        else
          conn
          |> put_status(:forbidden)
          |> json(%{error: "You can only upload documents for your own verification requests"})
        end
    end
  end

  # Private helper functions

  defp handle_file_upload(params) do
    file_upload = params["file"] || params["document"]

    if file_upload && file_upload != "" do
      # For now, return mock data - in production you'd upload to S3/Supabase Storage
      {:ok, %{
        file_url: "https://placeholder-storage.com/#{file_upload.filename}",
        file_name: file_upload.filename,
        file_type: file_upload.content_type || "application/octet-stream",
        file_size: File.stat!(file_upload.path).size
      }}
    else
      {:error, :no_file}
    end
  end

  defp update_verification_with_document(verification, document_type, upload_result) do
    field_name = case document_type do
      "title" -> "title_document_url"
      "drivers_license" -> "drivers_license_url"
      "insurance" -> "insurance_document_url"
      "face_scan" -> "face_scan_url"
      _ -> "title_document_url"
    end

    update_params = %{
      field_name => upload_result.file_url,
      "status" => "documents_uploaded"
    }

    Ownership.update_ownership_verification(verification, update_params)
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {key, value}, acc ->
        String.replace(acc, "%{#{key}}", to_string(value))
      end)
    end)
  end
end