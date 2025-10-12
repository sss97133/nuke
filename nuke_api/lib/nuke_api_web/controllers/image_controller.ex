defmodule NukeApiWeb.ImageController do
  use NukeApiWeb, :controller
  
  alias NukeApi.Vehicles
  alias NukeApi.Vehicles.{Image, ImageTag, ImageTags, Vehicle}
  alias NukeApi.GPS.LocationService
  alias NukeApi.Ownership

  action_fallback NukeApiWeb.FallbackController

  @doc """
  Lists images for a specific vehicle.
  """
  def index(conn, %{"vehicle_id" => vehicle_id} = params) do
    category = Map.get(params, "category")
    is_primary = case Map.get(params, "is_primary") do
      "true" -> true
      "false" -> false
      _ -> nil
    end
    
    opts = []
    opts = if category, do: Keyword.put(opts, :category, category), else: opts
    opts = if is_primary != nil, do: Keyword.put(opts, :is_primary, is_primary), else: opts
    
    images = Vehicles.list_vehicle_images(vehicle_id, opts)
    render(conn, :index, images: images)
  end

  @doc """
  Creates a new image for a vehicle.
  """
  def create(conn, %{"vehicle_id" => vehicle_id, "image" => image_params}) do
    # Check if the user is authorized to add images to this vehicle
    vehicle = Vehicles.get_vehicle(vehicle_id)
    
    with true <- authorized?(conn, vehicle),
         # Set the uploaded_by to the current authenticated user
         image_params = Map.put(image_params, "uploaded_by", conn.assigns.current_user_id),
         # Ensure vehicle_id is set
         image_params = Map.put(image_params, "vehicle_id", vehicle_id),
         {:ok, %Image{} = image} <- Vehicles.create_vehicle_image(image_params) do

      # Process image for automatic GPS-based location tagging
      if image.exif_data do
        Task.start(fn ->
          LocationService.process_image_for_location_tags(
            image.id,
            image.exif_data,
            conn.assigns.current_user_id
          )
        end)
      end

      conn
      |> put_status(:created)
      |> render(:show, image: image)
    else
      false ->
        conn
        |> put_status(:forbidden)
        |> json(%{error: "You are not authorized to add images to this vehicle"})
      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
  end

  @doc """
  Shows a specific image.
  """
  def show(conn, %{"id" => id}) do
    image = Vehicles.get_image(id)
    
    if image do
      render(conn, :show, image: image)
    else
      conn
      |> put_status(:not_found)
      |> json(%{error: "Image not found"})
    end
  end

  @doc """
  Sets an image as the primary image for a vehicle.
  """
  def set_primary(conn, %{"id" => id}) do
    image = Vehicles.get_image(id)
    
    if image do
      # Check if the user is authorized to modify images for this vehicle
      vehicle = Vehicles.get_vehicle(image.vehicle_id)
      
      with true <- authorized?(conn, vehicle),
           {:ok, image} <- Vehicles.set_primary_image(id, image.vehicle_id) do
        render(conn, :show, image: image)
      else
        false ->
          conn
          |> put_status(:forbidden)
          |> json(%{error: "You are not authorized to modify images for this vehicle"})
        {:error, _} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{error: "Could not set image as primary"})
      end
    else
      conn
      |> put_status(:not_found)
      |> json(%{error: "Image not found"})
    end
  end

  @doc """
  Updates image metadata.
  """
  def update(conn, %{"id" => id, "image" => image_params}) do
    image = Vehicles.get_image(id)
    
    if image do
      # Check if the user is authorized to modify images for this vehicle
      vehicle = Vehicles.get_vehicle(image.vehicle_id)
      
      with true <- authorized?(conn, vehicle),
           {:ok, %Image{} = image} <- Vehicles.update_image(image, image_params) do
        render(conn, :show, image: image)
      else
        false ->
          conn
          |> put_status(:forbidden)
          |> json(%{error: "You are not authorized to modify images for this vehicle"})
        {:error, changeset} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{errors: format_errors(changeset)})
      end
    else
      conn
      |> put_status(:not_found)
      |> json(%{error: "Image not found"})
    end
  end

  @doc """
  Deletes an image.
  """
  def delete(conn, %{"id" => id}) do
    image = Vehicles.get_image(id)

    if image do
      # Check if the user is authorized to delete images for this vehicle
      vehicle = Vehicles.get_vehicle(image.vehicle_id)

      with true <- authorized?(conn, vehicle),
           {:ok, _} <- Vehicles.delete_image(image) do
        send_resp(conn, :no_content, "")
      else
        false ->
          conn
          |> put_status(:forbidden)
          |> json(%{error: "You are not authorized to delete images for this vehicle"})
        {:error, _} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{error: "Could not delete image"})
      end
    else
      conn
      |> put_status(:not_found)
      |> json(%{error: "Image not found"})
    end
  end

  # =====================================================================================
  # SPATIAL TAG MANAGEMENT ENDPOINTS
  # =====================================================================================

  @doc """
  Lists all spatial tags for a specific image.
  """
  def list_tags(conn, %{"id" => image_id}) do
    image = Vehicles.get_image(image_id)

    if image do
      tags = image.spatial_tags || []

      conn
      |> json(%{
        data: tags,
        count: length(tags),
        image_id: image_id
      })
    else
      conn
      |> put_status(:not_found)
      |> json(%{error: "Image not found"})
    end
  end

  @doc """
  Creates a new spatial tag for an image.
  """
  def create_tag(conn, %{"id" => image_id, "tag" => tag_params}) do
    image = Vehicles.get_image(image_id)

    if image do
      # Check if the user is authorized to add tags to this image
      vehicle = Vehicles.get_vehicle(image.vehicle_id)

      with true <- authorized?(conn, vehicle),
           # Add the user ID to tag params
           tag_params = Map.put(tag_params, "created_by", conn.assigns.current_user_id),
           changeset = Image.add_spatial_tag(image, tag_params),
           {:ok, %Image{} = updated_image} <- Vehicles.update_image(image, %{"spatial_tags" => changeset.changes.spatial_tags}) do

        # Return the newly created tag
        new_tag = List.last(updated_image.spatial_tags)

        conn
        |> put_status(:created)
        |> json(%{data: new_tag})
      else
        false ->
          conn
          |> put_status(:forbidden)
          |> json(%{error: "You are not authorized to add tags to this image"})
        {:error, changeset} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{errors: format_errors(changeset)})
      end
    else
      conn
      |> put_status(:not_found)
      |> json(%{error: "Image not found"})
    end
  end

  @doc """
  Updates a specific spatial tag.
  """
  def update_tag(conn, %{"id" => image_id, "tag_id" => tag_id, "tag" => tag_updates}) do
    image = Vehicles.get_image(image_id)

    if image do
      # Check if the user is authorized to modify tags on this image
      vehicle = Vehicles.get_vehicle(image.vehicle_id)

      # Find the tag to verify ownership or permission
      tag = Image.get_spatial_tag(image, tag_id)

      with true <- authorized?(conn, vehicle),
           tag when not is_nil(tag) <- tag,
           true <- can_modify_tag?(conn, tag),
           changeset = Image.update_spatial_tag(image, tag_id, tag_updates),
           {:ok, %Image{} = updated_image} <- Vehicles.update_image(image, %{"spatial_tags" => changeset.changes.spatial_tags}) do

        # Return the updated tag
        updated_tag = Image.get_spatial_tag(updated_image, tag_id)

        conn
        |> json(%{data: updated_tag})
      else
        false ->
          conn
          |> put_status(:forbidden)
          |> json(%{error: "You are not authorized to modify this tag"})
        nil ->
          conn
          |> put_status(:not_found)
          |> json(%{error: "Tag not found"})
        {:error, changeset} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{errors: format_errors(changeset)})
      end
    else
      conn
      |> put_status(:not_found)
      |> json(%{error: "Image not found"})
    end
  end

  @doc """
  Deletes a specific spatial tag.
  """
  def delete_tag(conn, %{"id" => image_id, "tag_id" => tag_id}) do
    image = Vehicles.get_image(image_id)

    if image do
      # Check if the user is authorized to delete tags on this image
      vehicle = Vehicles.get_vehicle(image.vehicle_id)

      # Find the tag to verify ownership or permission
      tag = Image.get_spatial_tag(image, tag_id)

      with true <- authorized?(conn, vehicle),
           tag when not is_nil(tag) <- tag,
           true <- can_modify_tag?(conn, tag),
           changeset = Image.remove_spatial_tag(image, tag_id),
           {:ok, _updated_image} <- Vehicles.update_image(image, %{"spatial_tags" => changeset.changes.spatial_tags}) do

        send_resp(conn, :no_content, "")
      else
        false ->
          conn
          |> put_status(:forbidden)
          |> json(%{error: "You are not authorized to delete this tag"})
        nil ->
          conn
          |> put_status(:not_found)
          |> json(%{error: "Tag not found"})
        {:error, changeset} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{errors: format_errors(changeset)})
      end
    else
      conn
      |> put_status(:not_found)
      |> json(%{error: "Image not found"})
    end
  end

  @doc """
  Verifies a spatial tag (adds verification).
  """
  def verify_tag(conn, %{"id" => image_id, "tag_id" => tag_id} = params) do
    image = Vehicles.get_image(image_id)

    if image do
      tag = Image.get_spatial_tag(image, tag_id)
      _verification_type = Map.get(params, "verification_type", "peer")

      with tag when not is_nil(tag) <- tag,
           true <- conn.assigns.authenticated do

        # Add user to verified_by array if not already there
        verified_by = tag["verified_by"] || []
        user_id = conn.assigns.current_user_id

        updated_verified_by = if user_id in verified_by do
          verified_by
        else
          verified_by ++ [user_id]
        end

        # Calculate new trust score (simplified for now)
        trust_score = min(100, (tag["trust_score"] || 10) + 10)

        tag_updates = %{
          "verified_by" => updated_verified_by,
          "trust_score" => trust_score,
          "verification_status" => if(trust_score >= 50, do: "verified", else: "pending")
        }

        changeset = Image.update_spatial_tag(image, tag_id, tag_updates)

        with {:ok, %Image{} = updated_image} <- Vehicles.update_image(image, %{"spatial_tags" => changeset.changes.spatial_tags}) do
          updated_tag = Image.get_spatial_tag(updated_image, tag_id)

          conn
          |> json(%{data: updated_tag, message: "Tag verified successfully"})
        else
          {:error, changeset} ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(%{errors: format_errors(changeset)})
        end
      else
        nil ->
          conn
          |> put_status(:not_found)
          |> json(%{error: "Tag not found"})
        false ->
          conn
          |> put_status(:unauthorized)
          |> json(%{error: "Authentication required"})
      end
    else
      conn
      |> put_status(:not_found)
      |> json(%{error: "Image not found"})
    end
  end

  @doc """
  Disputes a spatial tag (adds dispute).
  """
  def dispute_tag(conn, %{"id" => image_id, "tag_id" => tag_id} = params) do
    image = Vehicles.get_image(image_id)

    if image do
      tag = Image.get_spatial_tag(image, tag_id)
      _dispute_reason = Map.get(params, "reason", "")

      with tag when not is_nil(tag) <- tag,
           true <- conn.assigns.authenticated do

        # Add user to disputed_by array if not already there
        disputed_by = tag["disputed_by"] || []
        user_id = conn.assigns.current_user_id

        updated_disputed_by = if user_id in disputed_by do
          disputed_by
        else
          disputed_by ++ [user_id]
        end

        # Decrease trust score
        trust_score = max(0, (tag["trust_score"] || 10) - 15)

        tag_updates = %{
          "disputed_by" => updated_disputed_by,
          "trust_score" => trust_score,
          "verification_status" => if(length(updated_disputed_by) > 1, do: "disputed", else: "pending")
        }

        changeset = Image.update_spatial_tag(image, tag_id, tag_updates)

        with {:ok, %Image{} = updated_image} <- Vehicles.update_image(image, %{"spatial_tags" => changeset.changes.spatial_tags}) do
          updated_tag = Image.get_spatial_tag(updated_image, tag_id)

          conn
          |> json(%{data: updated_tag, message: "Tag disputed successfully"})
        else
          {:error, changeset} ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(%{errors: format_errors(changeset)})
        end
      else
        nil ->
          conn
          |> put_status(:not_found)
          |> json(%{error: "Tag not found"})
        false ->
          conn
          |> put_status(:unauthorized)
          |> json(%{error: "Authentication required"})
      end
    else
      conn
      |> put_status(:not_found)
      |> json(%{error: "Image not found"})
    end
  end

  # =====================================================================================
  # DATABASE-BASED TAG ENDPOINTS (NEW)
  # =====================================================================================

  @doc """
  Lists all database-stored tags for an image.
  """
  def list_db_tags(conn, %{"id" => image_id}) do
    image = Vehicles.get_image(image_id)

    if image do
      # Check if the user is authorized to view tags on this image
      vehicle = Vehicles.get_vehicle(image.vehicle_id)

      with true <- authorized?(conn, vehicle) do
        tags = ImageTags.list_image_tags(image_id)

        conn
        |> json(%{
          data: tags,
          count: length(tags)
        })
      else
        false ->
          conn
          |> put_status(:forbidden)
          |> json(%{error: "You are not authorized to view tags for this image"})
      end
    else
      conn
      |> put_status(:not_found)
      |> json(%{error: "Image not found"})
    end
  end

  @doc """
  Creates a database-stored tag for an image.
  """
  def create_db_tag(conn, %{"id" => image_id, "tag" => tag_params}) do
    image = Vehicles.get_image(image_id)

    if image do
      vehicle = Vehicles.get_vehicle(image.vehicle_id)

      with true <- authorized?(conn, vehicle) do
        # Add required fields
        attrs = tag_params
        |> Map.put("image_id", image_id)
        |> Map.put("created_by", get_user_id_safe(conn))

        case ImageTags.create_image_tag(attrs) do
          {:ok, tag} ->
            conn
            |> put_status(:created)
            |> json(%{data: tag})

          {:error, changeset} ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(%{errors: format_errors(changeset)})
        end
      else
        false ->
          conn
          |> put_status(:forbidden)
          |> json(%{error: "You are not authorized to add tags to this image"})
      end
    else
      conn
      |> put_status(:not_found)
      |> json(%{error: "Image not found"})
    end
  end

  @doc """
  Updates a database-stored tag.
  """
  def update_db_tag(conn, %{"id" => image_id, "tag_id" => tag_id, "tag" => tag_params}) do
    image = Vehicles.get_image(image_id)

    if image do
      case ImageTags.get_image_tag(tag_id) do
        %ImageTag{} = tag ->
          vehicle = Vehicles.get_vehicle(image.vehicle_id)

          with true <- authorized?(conn, vehicle),
               true <- can_modify_db_tag?(conn, tag) do

            case ImageTags.update_image_tag(tag, tag_params) do
              {:ok, updated_tag} ->
                conn
                |> json(%{data: updated_tag})

              {:error, changeset} ->
                conn
                |> put_status(:unprocessable_entity)
                |> json(%{errors: format_errors(changeset)})
            end
          else
            false ->
              conn
              |> put_status(:forbidden)
              |> json(%{error: "You are not authorized to modify this tag"})
          end

        nil ->
          conn
          |> put_status(:not_found)
          |> json(%{error: "Tag not found"})
      end
    else
      conn
      |> put_status(:not_found)
      |> json(%{error: "Image not found"})
    end
  end

  @doc """
  Deletes a database-stored tag.
  """
  def delete_db_tag(conn, %{"id" => image_id, "tag_id" => tag_id}) do
    image = Vehicles.get_image(image_id)

    if image do
      case ImageTags.get_image_tag(tag_id) do
        %ImageTag{} = tag ->
          vehicle = Vehicles.get_vehicle(image.vehicle_id)

          with true <- authorized?(conn, vehicle),
               true <- can_modify_db_tag?(conn, tag) do

            case ImageTags.delete_image_tag(tag) do
              {:ok, _} ->
                send_resp(conn, :no_content, "")

              {:error, _} ->
                conn
                |> put_status(:internal_server_error)
                |> json(%{error: "Failed to delete tag"})
            end
          else
            false ->
              conn
              |> put_status(:forbidden)
              |> json(%{error: "You are not authorized to delete this tag"})
          end

        nil ->
          conn
          |> put_status(:not_found)
          |> json(%{error: "Tag not found"})
      end
    else
      conn
      |> put_status(:not_found)
      |> json(%{error: "Image not found"})
    end
  end

  @doc """
  Verifies a database-stored tag.
  """
  def verify_db_tag(conn, %{"id" => image_id, "tag_id" => tag_id} = params) do
    image = Vehicles.get_image(image_id)

    if image do
      case ImageTags.get_image_tag(tag_id) do
        %ImageTag{} = tag ->
          verification_type = Map.get(params, "verification_type", "peer")
          verifier_id = conn.assigns.current_user_id || "anonymous"

          case ImageTags.verify_tag(tag, verifier_id, verification_type) do
            {:ok, updated_tag} ->
              conn
              |> json(%{data: updated_tag})

            {:error, changeset} ->
              conn
              |> put_status(:unprocessable_entity)
              |> json(%{errors: format_errors(changeset)})
          end

        nil ->
          conn
          |> put_status(:not_found)
          |> json(%{error: "Tag not found"})
      end
    else
      conn
      |> put_status(:not_found)
      |> json(%{error: "Image not found"})
    end
  end

  @doc """
  Disputes a database-stored tag.
  """
  def dispute_db_tag(conn, %{"id" => image_id, "tag_id" => tag_id}) do
    image = Vehicles.get_image(image_id)

    if image do
      case ImageTags.get_image_tag(tag_id) do
        %ImageTag{} = tag ->
          disputer_id = conn.assigns.current_user_id || "anonymous"

          case ImageTags.dispute_tag(tag, disputer_id) do
            {:ok, updated_tag} ->
              conn
              |> json(%{data: updated_tag})

            {:error, changeset} ->
              conn
              |> put_status(:unprocessable_entity)
              |> json(%{errors: format_errors(changeset)})
          end

        nil ->
          conn
          |> put_status(:not_found)
          |> json(%{error: "Tag not found"})
      end
    else
      conn
      |> put_status(:not_found)
      |> json(%{error: "Image not found"})
    end
  end

  # =====================================================================================
  # PRIVATE HELPER FUNCTIONS
  # =====================================================================================

  defp authorized?(conn, %Vehicle{} = vehicle) do
    # Use comprehensive ownership system to determine permissions
    if conn.assigns[:authenticated] == true do
      user_id = conn.assigns.current_user_id
      # Check if user has edit permissions for the vehicle through the ownership system
      case Ownership.get_ownership_status(vehicle.id, user_id) do
        {:ok, %{status: status}} when status in [:legal_owner, :contributor_owner, :uploader] -> true
        _ -> false
      end
    else
      # Allow anonymous access when authentication is not working (development mode)
      true
    end
  end

  defp get_user_id_safe(conn) do
    case conn.assigns do
      %{current_user_id: user_id} when not is_nil(user_id) -> user_id
      %{authenticated: true} -> "authenticated_user"
      _ -> "anonymous"
    end
  end

  defp can_modify_tag?(conn, tag) do
    # Users can modify tags they created, OR users with proper vehicle permissions can modify any tag
    current_user_id = conn.assigns.current_user_id
    tag_creator = tag["created_by"]

    # Allow tag creator to modify their own tags
    if current_user_id == tag_creator do
      true
    else
      # For spatial tags, we'd need to check the vehicle ownership through the image
      # For now, only allow tag creators to modify spatial tags
      false
    end
  end

  defp can_modify_db_tag?(conn, %ImageTag{} = tag) do
    # Users can modify tags they created, OR users with proper vehicle permissions can modify any tag
    current_user_id = conn.assigns.current_user_id
    tag_creator = tag.created_by

    # Allow tag creator to modify their own tags
    if current_user_id == tag_creator do
      true
    else
      # Check if user has vehicle edit permissions through ownership system
      with image when not is_nil(image) <- Vehicles.get_image(tag.image_id),
           vehicle when not is_nil(vehicle) <- Vehicles.get_vehicle(image.vehicle_id) do
        case Ownership.get_ownership_status(vehicle.id, current_user_id) do
          {:ok, %{status: status}} when status in [:legal_owner, :contributor_owner, :uploader] -> true
          _ -> false
        end
      else
        _ -> false
      end
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
