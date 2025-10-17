defmodule NukeApiWeb.ListingMonitorController do
  use NukeApiWeb, :controller

  alias NukeApi.MarketData.ListingMonitorWorker
  alias NukeApi.Repo
  alias NukeApi.MarketData.ListingMonitor

  def trigger_scan(conn, _params) do
    ListingMonitorWorker.trigger_scan_now()
    json(conn, %{success: true, message: "Listing monitor scan triggered"})
  end

  def create(conn, params) do
    attrs = %{
      vehicle_id: Map.get(params, "vehicle_id") || Map.get(params, "vehicleId"),
      source_url: Map.get(params, "source_url") || Map.get(params, "url"),
      source_platform: Map.get(params, "source_platform") || Map.get(params, "platform"),
      created_by: conn.assigns[:current_user_id]
    }

    changeset = ListingMonitor.changeset(%ListingMonitor{}, attrs)
    case Repo.insert(changeset) do
      {:ok, monitor} -> json(conn, %{success: true, data: %{id: monitor.id}})
      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{success: false, errors: changeset_errors(changeset)})
    end
  end

  defp changeset_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {key, value}, acc ->
        String.replace(acc, "%{#{key}}", to_string(value))
      end)
    end)
  end
end
