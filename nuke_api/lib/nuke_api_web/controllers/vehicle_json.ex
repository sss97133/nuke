defmodule NukeApiWeb.VehicleJSON do
  @moduledoc """
  JSON view for Vehicle entities in the Nuke platform's vehicle-centric architecture.
  """
  
  alias NukeApi.Vehicles.Vehicle

  @doc """
  Renders a list of vehicles.
  """
  def index(%{vehicles: vehicles}) do
    %{data: for(vehicle <- vehicles, do: data(vehicle))}
  end

  @doc """
  Renders a single vehicle.
  """
  def show(%{vehicle: vehicle}) do
    %{data: data(vehicle)}
  end

  @doc """
  Converts a vehicle struct to a map of attributes.
  """
  def data(%Vehicle{} = vehicle) do
    %{
      id: vehicle.id,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      vin: vehicle.vin,
      license_plate: vehicle.license_plate,
      color: vehicle.color,
      mileage: vehicle.mileage,
      engine_size: vehicle.engine_size,
      transmission: vehicle.transmission,
      drivetrain: vehicle.drivetrain,
      status: vehicle.status,
      uploaded_by: vehicle.uploaded_by,
      import_source: vehicle.import_source,
      uploaded_at: vehicle.uploaded_at
    }
    |> maybe_add_associations(vehicle)
  end

  # Add associated timeline events and images if they are preloaded
  defp maybe_add_associations(data, %{timeline_events: timeline_events} = _vehicle) when is_list(timeline_events) do
    Map.put(data, :timeline_events, Enum.map(timeline_events, &NukeApiWeb.TimelineJSON.data/1))
  end
  
  defp maybe_add_associations(data, %{images: images} = _vehicle) when is_list(images) do
    Map.put(data, :images, Enum.map(images, &NukeApiWeb.ImageJSON.data/1))
  end
  
  # If both are preloaded
  defp maybe_add_associations(data, %{timeline_events: timeline_events, images: images}) 
       when is_list(timeline_events) and is_list(images) do
    data
    |> Map.put(:timeline_events, Enum.map(timeline_events, &NukeApiWeb.TimelineJSON.data/1))
    |> Map.put(:images, Enum.map(images, &NukeApiWeb.ImageJSON.data/1))
  end
  
  defp maybe_add_associations(data, _), do: data
end
