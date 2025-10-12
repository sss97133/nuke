defmodule NukeApiWeb.TimelineController do
  use NukeApiWeb, :controller
  
  alias NukeApi.Vehicles
  alias NukeApi.Vehicles.Timeline
  alias NukeApi.Vehicles.Vehicle

  action_fallback NukeApiWeb.FallbackController

  @doc """
  Lists timeline events for a specific vehicle.
  """
  def index(conn, %{"vehicle_id" => vehicle_id} = params) do
    limit = Map.get(params, "limit", "50") |> String.to_integer()
    offset = Map.get(params, "offset", "0") |> String.to_integer()
    event_type = Map.get(params, "event_type")
    
    # Get the timeline events with filters
    opts = [limit: limit, offset: offset]
    opts = if event_type, do: Keyword.put(opts, :event_type, event_type), else: opts
    
    timeline_events = Vehicles.list_timeline_events(vehicle_id, opts)
    render(conn, :index, timeline_events: timeline_events)
  end

  @doc """
  Creates a new timeline event for a vehicle.
  """
  def create(conn, %{"vehicle_id" => vehicle_id, "timeline" => timeline_params}) do
    # Check if the user is authorized to add events to this vehicle
    vehicle = Vehicles.get_vehicle(vehicle_id)
    
    with true <- authorized?(conn, vehicle),
         # Set the creator_id to the current authenticated user
         timeline_params = Map.put(timeline_params, "creator_id", conn.assigns.current_user_id),
         # Ensure vehicle_id is set
         timeline_params = Map.put(timeline_params, "vehicle_id", vehicle_id),
         # Set event_date if not provided
         timeline_params = ensure_event_date(timeline_params),
         {:ok, %Timeline{} = timeline} <- Vehicles.create_timeline_event(timeline_params) do
      
      conn
      |> put_status(:created)
      |> render(:show, timeline: timeline)
    else
      false ->
        conn
        |> put_status(:forbidden)
        |> json(%{error: "You are not authorized to add events to this vehicle"})
      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
  end

  @doc """
  Shows a specific timeline event.
  """
  def show(conn, %{"id" => id}) do
    timeline = Vehicles.get_timeline_event(id)
    
    if timeline do
      render(conn, :show, timeline: timeline)
    else
      conn
      |> put_status(:not_found)
      |> json(%{error: "Timeline event not found"})
    end
  end

  @doc """
  Verifies a timeline event, which is an important trust mechanism in the Nuke platform.
  """
  def verify(conn, %{"id" => id}) do
    # Only authenticated users with verification privileges can verify events
    # For now, we'll use a simple check that the user is authenticated
    unless conn.assigns.authenticated do
      conn
      |> put_status(:unauthorized)
      |> json(%{error: "Authentication required to verify timeline events"})
      |> halt()
    end
    
    timeline = Vehicles.get_timeline_event(id)
    
    if timeline do
      with {:ok, timeline} <- Vehicles.verify_timeline_event(timeline, conn.assigns.current_user_id) do
        render(conn, :show, timeline: timeline)
      end
    else
      conn
      |> put_status(:not_found)
      |> json(%{error: "Timeline event not found"})
    end
  end

  # Private helper functions
  
  defp authorized?(conn, %Vehicle{} = vehicle) do
    # Determine who can add timeline events
    # For now, we'll use a simple check that the user owns the vehicle
    # or is a verified professional
    owner_access = conn.assigns.authenticated && conn.assigns.current_user_id == vehicle.user_id
    
    # In a production system, you would check for professional verification status
    # professional_access = conn.assigns.authenticated && is_professional?(conn.assigns.current_user_id)
    
    owner_access # || professional_access
  end
  
  defp ensure_event_date(params) do
    if Map.has_key?(params, "event_date") do
      params
    else
      Map.put(params, "event_date", DateTime.utc_now())
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
