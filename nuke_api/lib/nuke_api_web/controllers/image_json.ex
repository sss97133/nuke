defmodule NukeApiWeb.ImageJSON do
  @moduledoc """
  JSON view for Vehicle Images in the Nuke platform's vehicle-centric architecture.
  
  Images provide comprehensive visual documentation of vehicles throughout their lifecycle.
  """
  
  alias NukeApi.Vehicles.Image

  @doc """
  Renders a list of vehicle images.
  """
  def index(%{images: images}) do
    %{data: for(image <- images, do: data(image))}
  end

  @doc """
  Renders a single vehicle image.
  """
  def show(%{image: image}) do
    %{data: data(image)}
  end

  @doc """
  Converts an image struct to a map of attributes.
  """
  def data(%Image{} = image) do
    %{
      id: image.id,
      vehicle_id: image.vehicle_id,
      user_id: image.user_id,
      url: image.url,
      thumbnail_url: image.thumbnail_url,
      medium_url: image.medium_url,
      large_url: image.large_url,
      optimization_status: image.optimization_status,
      optimized_at: image.optimized_at,
      variants: image.variants,
      category: image.category,
      position: image.position,
      is_primary: image.is_primary,
      file_size: image.file_size,
      mime_type: image.mime_type,
      filename: image.filename,
      file_hash: image.file_hash,
      storage_path: image.storage_path,
      latitude: image.latitude,
      longitude: image.longitude,
      location_name: image.location_name,
      caption: image.caption,
      exif_data: image.exif_data,
      taken_at: image.taken_at,
      source: image.source,
      source_url: image.source_url,
      is_external: image.is_external,
      is_sensitive: image.is_sensitive,
      sensitive_type: image.sensitive_type,
      safe_preview_url: image.safe_preview_url,
      process_stage: image.process_stage,
      workflow_role: image.workflow_role,
      area: image.area,
      part: image.part,
      damage_type: image.damage_type,
      operation: image.operation,
      materials: image.materials,
      labels: image.labels,
      angle: image.angle,
      perspective: image.perspective,
      timeline_event_id: image.timeline_event_id,
      task_id: image.task_id,
      event_id: image.event_id,
      image_type: image.image_type,
      image_category: image.image_category,
      image_context: image.image_context,
      file_name: image.file_name,
      created_at: image.created_at,
      updated_at: image.updated_at
    }
  end
end
