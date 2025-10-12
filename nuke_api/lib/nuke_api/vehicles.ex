defmodule NukeApi.Vehicles do
  @moduledoc """
  The Vehicles context.
  
  This module handles the core business logic for the vehicle-centric architecture
  of the Nuke platform, providing functions to work with vehicles, their timeline
  events, and images.
  """

  import Ecto.Query, warn: false
  alias NukeApi.Repo
  alias NukeApi.Vehicles.{Vehicle, Timeline, Image, Document, DuplicateChecker}

  # Vehicle operations

  @doc """
  Returns the list of vehicles.
  """
  def list_vehicles(opts \\ []) do
    limit = Keyword.get(opts, :limit, 100)
    offset = Keyword.get(opts, :offset, 0)
    uploaded_by = Keyword.get(opts, :uploaded_by)

    query = from v in Vehicle,
      order_by: [desc: v.id],
      limit: ^limit,
      offset: ^offset

    query = if uploaded_by do
      from v in query, where: v.uploaded_by == ^uploaded_by
    else
      query
    end
    
    Repo.all(query)
  end

  @doc """
  Gets a single vehicle.
  
  Returns nil if the Vehicle does not exist.
  """
  def get_vehicle(id), do: Repo.get(Vehicle, id)

  @doc """
  Gets a single vehicle with preloaded timeline events.
  """
  def get_vehicle_with_timeline(id) do
    Vehicle
    |> Repo.get(id)
    |> Repo.preload([timeline_events: timeline_query()])
  end

  @doc """
  Gets a single vehicle with preloaded images.
  """
  def get_vehicle_with_images(id) do
    Vehicle
    |> Repo.get(id)
    |> Repo.preload([images: images_query()])
  end

  @doc """
  Gets a single vehicle with all associations preloaded.
  """
  def get_vehicle_full(id) do
    Vehicle
    |> Repo.get(id)
    |> Repo.preload([
      timeline_events: timeline_query(),
      images: images_query()
    ])
  end

  @doc """
  Creates a vehicle.
  """
  def create_vehicle(attrs \\ %{}) do
    %Vehicle{}
    |> Vehicle.changeset(attrs)
    |> Repo.insert()
    |> maybe_create_initial_timeline_event()
  end

  @doc """
  Updates a vehicle.
  """
  def update_vehicle(%Vehicle{} = vehicle, attrs) do
    vehicle
    |> Vehicle.changeset(attrs)
    |> Repo.update()
    |> maybe_create_update_timeline_event(attrs)
  end

  @doc """
  Deletes a vehicle.
  
  Note: In a vehicle-centric architecture, vehicles should rarely be fully deleted.
  Consider using the 'archived' status instead.
  """
  def delete_vehicle(%Vehicle{} = vehicle) do
    Repo.delete(vehicle)
  end

  @doc """
  Archives a vehicle instead of deleting it.
  """
  def archive_vehicle(%Vehicle{} = vehicle) do
    update_vehicle(vehicle, %{status: "archived"})
  end

  # Timeline operations

  @doc """
  Returns timeline events for a specific vehicle.
  """
  def list_timeline_events(vehicle_id, opts \\ []) do
    limit = Keyword.get(opts, :limit, 50)
    offset = Keyword.get(opts, :offset, 0)
    event_type = Keyword.get(opts, :event_type)
    
    query = timeline_query()
      |> where([t], t.vehicle_id == ^vehicle_id)
      |> limit(^limit)
      |> offset(^offset)
      
    query = if event_type do
      where(query, [t], t.event_type == ^event_type)
    else
      query
    end
    
    Repo.all(query)
  end

  @doc """
  Creates a timeline event.
  """
  def create_timeline_event(attrs \\ %{}) do
    %Timeline{}
    |> Timeline.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Verifies a timeline event.
  """
  def verify_timeline_event(%Timeline{} = timeline, verifier_id) do
    timeline
    |> Timeline.changeset(%{verified: true, verifier_id: verifier_id})
    |> Repo.update()
  end

  # Image operations

  @doc """
  Returns images for a specific vehicle.
  """
  def list_vehicle_images(vehicle_id, opts \\ []) do
    category = Keyword.get(opts, :category)
    is_primary = Keyword.get(opts, :is_primary)
    
    query = images_query()
      |> where([i], i.vehicle_id == ^vehicle_id)
      
    query = if category do
      where(query, [i], i.category == ^category)
    else
      query
    end
    
    query = if is_primary != nil do
      where(query, [i], i.is_primary == ^is_primary)
    else
      query
    end
    
    Repo.all(query)
  end

  @doc """
  Creates a vehicle image.
  """
  def create_vehicle_image(attrs \\ %{}) do
    vehicle_id = Map.get(attrs, "vehicle_id") || Map.get(attrs, :vehicle_id)

    # Check for duplicates before inserting
    case DuplicateChecker.duplicate_exists?(vehicle_id, attrs) do
      {:duplicate, reason} ->
        {:error, "Duplicate image detected: #{reason}"}

      {:ok, _} ->
        %Image{}
        |> Image.changeset(attrs)
        |> Repo.insert()
        |> maybe_update_primary_images(attrs)
    end
  end

  @doc """
  Sets an image as the primary image for a vehicle.
  """
  def set_primary_image(image_id, vehicle_id) do
    # First unset any existing primary images
    from(i in Image, where: i.vehicle_id == ^vehicle_id and i.is_primary == true)
    |> Repo.update_all(set: [is_primary: false])
    
    # Then set the new primary image
    get_image(image_id)
    |> Image.changeset(%{is_primary: true, position: 0})
    |> Repo.update()
  end

  @doc """
  Gets a single image.
  """
  def get_image(id), do: Repo.get(Image, id)
  
  @doc """
  Updates a vehicle image.
  """
  def update_image(%Image{} = image, attrs) do
    image
    |> Image.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Deletes a vehicle image.
  
  Note: In a production system, this would also handle removal of the image
  from storage and cleanup of any associated records.
  """
  def delete_image(%Image{} = image) do
    Repo.delete(image)
  end
  
  @doc """
  Gets a timeline event by ID.
  """
  def get_timeline_event(id), do: Repo.get(Timeline, id)

  @doc """
  Gets a vehicle with full associations needed for pricing intelligence.
  """
  def get_vehicle_with_full_associations(id) do
    from(v in Vehicle,
      where: v.id == ^id,
      preload: [
        images: [:tags],
        timeline_events: []
      ]
    )
    |> Repo.one()
  end

  @doc """
  Gets a vehicle with images and their tags.
  """
  def get_vehicle_with_images_and_tags(id) do
    from(v in Vehicle,
      where: v.id == ^id,
      preload: [images: [:tags]]
    )
    |> Repo.one()
  end

  # Private helper functions

  defp timeline_query do
    from t in Timeline,
      order_by: [desc: t.event_date]
  end

  defp images_query do
    from i in Image,
      order_by: [asc: i.position, desc: i.id]
  end

  defp maybe_create_initial_timeline_event({:ok, vehicle} = result) do
    attrs = %{
      vehicle_id: vehicle.id,
      event_type: "custom",
      event_date: DateTime.utc_now(),
      title: "Vehicle Created",
      description: "Vehicle profile created in the system",
      creator_id: vehicle.user_id,
      metadata: %{
        vehicle_info: %{
          make: vehicle.make,
          model: vehicle.model,
          year: vehicle.year
        }
      }
    }
    
    create_timeline_event(attrs)
    
    result
  end

  defp maybe_create_initial_timeline_event(error), do: error

  defp maybe_create_update_timeline_event({:ok, vehicle} = result, attrs) do
    # Only create timeline event for significant changes
    significant_keys = ["make", "model", "year", "vin", "engine_type", "color", "user_id"]
    
    significant_changes = Map.take(attrs, significant_keys)
    
    if map_size(significant_changes) > 0 do
      timeline_attrs = %{
        vehicle_id: vehicle.id,
        event_type: "custom",
        event_date: DateTime.utc_now(),
        title: "Vehicle Updated",
        description: "Vehicle information updated",
        creator_id: Map.get(attrs, "updated_by", nil),
        metadata: %{
          changes: significant_changes
        }
      }
      
      create_timeline_event(timeline_attrs)
    end
    
    result
  end

  defp maybe_create_update_timeline_event(error, _), do: error

  defp maybe_update_primary_images({:ok, image} = result, attrs) do
    if Map.get(attrs, "is_primary", false) do
      # If this new image is primary, unset any existing primary images for this vehicle
      from(i in Image, 
        where: i.vehicle_id == ^image.vehicle_id and 
               i.id != ^image.id and 
               i.is_primary == true)
      |> Repo.update_all(set: [is_primary: false])
    end
    
    result
  end

  defp maybe_update_primary_images(error, _), do: error

  # Document operations

  @doc """
  Gets documents for a vehicle.
  """
  def list_vehicle_documents(vehicle_id, opts \\ []) do
    document_type = Keyword.get(opts, :document_type)

    query = from d in Document,
      where: d.vehicle_id == ^vehicle_id,
      order_by: [desc: d.document_date, desc: d.inserted_at]

    query = if document_type do
      from d in query, where: d.document_type == ^document_type
    else
      query
    end

    Repo.all(query)
  end

  @doc """
  Creates a vehicle document.
  """
  def create_vehicle_document(attrs \\ %{}) do
    %Document{}
    |> Document.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Gets a single document.
  """
  def get_document(id), do: Repo.get(Document, id)

  @doc """
  Updates a vehicle document.
  """
  def update_document(%Document{} = document, attrs) do
    document
    |> Document.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Deletes a document.
  """
  def delete_document(%Document{} = document) do
    Repo.delete(document)
  end
end
