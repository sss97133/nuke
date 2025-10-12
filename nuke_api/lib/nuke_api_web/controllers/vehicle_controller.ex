defmodule NukeApiWeb.VehicleController do
  use NukeApiWeb, :controller

  alias NukeApi.Vehicles
  alias NukeApi.Vehicles.Vehicle
  alias NukeApi.Ownership

  action_fallback NukeApiWeb.FallbackController

  @doc """
  Lists all vehicles.
  
  Optionally filtered by user_id if authenticated.
  """
  def index(conn, params) do
    limit = Map.get(params, "limit", "100") |> String.to_integer()
    offset = Map.get(params, "offset", "0") |> String.to_integer()
    user_id = Map.get(params, "user_id")
    
    # Ensure owner_id filter is only applied when user is authenticated as that owner
    # or when no owner filter is specified (returns all vehicles)
    opts = [limit: limit, offset: offset]
    
    opts = if user_id && conn.assigns.authenticated && conn.assigns.current_user_id == user_id do
      Keyword.put(opts, :uploaded_by, user_id)
    else
      # If not authenticated as the requested uploader, we only return public vehicles
      # For actual implementation, you would add a 'public' field to vehicles and filter
      opts
    end
    
    vehicles = Vehicles.list_vehicles(opts)
    render(conn, :index, vehicles: vehicles)
  end

  @doc """
  Creates a new vehicle.
  """
  def create(conn, %{"vehicle" => vehicle_params}) do
    # Use authenticated user ID from session
    case conn.assigns do
      %{authenticated: true, current_user_id: user_id} ->
        # CRITICAL FIX: Track uploader, not owner. Ownership must be verified separately.
        vehicle_params = vehicle_params
        |> Map.put("uploaded_by", user_id)
        |> Map.put("import_source", "manual")
        |> Map.put("uploaded_at", DateTime.utc_now())
        # DO NOT assign ownership automatically - this was the root security issue

        with {:ok, %Vehicle{} = vehicle} <- Vehicles.create_vehicle(vehicle_params) do
          conn
          |> put_status(:created)
          |> put_resp_header("location", ~p"/api/vehicles/#{vehicle}")
          |> render(:show, vehicle: vehicle)
        end

      _ ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "Authentication required"})
    end
  end

  @doc """
  Shows a specific vehicle with options for preloading associations.
  """
  def show(conn, %{"id" => id} = params) do
    include = Map.get(params, "include", "")
    includes = String.split(include, ",", trim: true)
    
    vehicle = cond do
      "all" in includes -> Vehicles.get_vehicle_full(id)
      "timeline" in includes -> Vehicles.get_vehicle_with_timeline(id)
      "images" in includes -> Vehicles.get_vehicle_with_images(id)
      true -> Vehicles.get_vehicle(id)
    end
    
    if vehicle do
      render(conn, :show, vehicle: vehicle)
    else
      conn
      |> put_status(:not_found)
      |> json(%{error: "Vehicle not found"})
    end
  end

  @doc """
  Updates a vehicle.
  """
  def update(conn, %{"id" => id, "vehicle" => vehicle_params}) do
    vehicle = Vehicles.get_vehicle(id)
    
    with true <- authorized?(conn, vehicle),
         {:ok, %Vehicle{} = vehicle} <- Vehicles.update_vehicle(vehicle, vehicle_params) do
      render(conn, :show, vehicle: vehicle)
    else
      false ->
        conn
        |> put_status(:forbidden)
        |> json(%{error: "You are not authorized to update this vehicle"})
      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
  end

  @doc """
  Archives a vehicle instead of deleting it.
  
  In a vehicle-centric architecture, we rarely fully delete vehicles.
  """
  def archive(conn, %{"id" => id}) do
    vehicle = Vehicles.get_vehicle(id)
    
    with true <- authorized?(conn, vehicle),
         {:ok, %Vehicle{}} <- Vehicles.archive_vehicle(vehicle) do
      send_resp(conn, :no_content, "")
    else
      false ->
        conn
        |> put_status(:forbidden)
        |> json(%{error: "You are not authorized to archive this vehicle"})
      {:error, _} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "Could not archive vehicle"})
    end
  end

  # Private helper functions
  
  defp authorized?(conn, %Vehicle{} = vehicle) do
    case conn.assigns do
      %{authenticated: true, current_user_id: user_id} ->
        # Use comprehensive ownership system for authorization
        Ownership.has_permission?(vehicle.id, user_id, :edit)

      _ ->
        false
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
