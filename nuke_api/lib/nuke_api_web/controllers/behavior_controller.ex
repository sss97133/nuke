defmodule NukeApiWeb.BehaviorController do
  use NukeApiWeb, :controller

  @moduledoc """
  Ingestion endpoint for high-signal user browsing events.
  Normalizes events and records them into Supabase tables using the user's JWT
  so Row Level Security (RLS) applies correctly.

  Expected payload:
  {
    "events": [
      {
        "type": "listing_view" | "vin_detected" | "click_through" | "image_view",
        "url": "https://...",
        "title": "Optional title",
        "vehicle_id": "uuid-optional",
        "dwell_ms": 1234,
        "metadata": {"any": "json"}
      }
    ]
  }
  """

  alias NukeApi.Supabase.Client, as: SupabaseClient
  require Logger

  def track(conn, %{"events" => events}) when is_list(events) do
    case conn.assigns[:authenticated] do
      true -> :ok
      _ ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "Authentication required"})
        |> halt()
    end

    user_id = conn.assigns.current_user_id

    # Forward the original JWT to Supabase REST so user-level RLS applies
    auth_header = get_req_header(conn, "authorization") |> List.first() || ""

    rows = Enum.map(events, &to_user_activity_row(&1, user_id))

    headers = [
      {"Prefer", "return=representation"},
      {"Authorization", auth_header}
    ]

    with {:ok, inserted} <- SupabaseClient.post("/rest/v1/user_activities", rows, headers) do
      # Also mirror a lightweight activity feed item for UI (profile_activity)
      profile_rows = Enum.map(events, fn ev ->
        %{
          user_id: user_id,
          activity_type: map_profile_activity_type(ev),
          activity_title: build_title("vehicle_contribution", ev),
          activity_description: Map.get(ev, "title") || Map.get(ev, "url"),
          related_vehicle_id: Map.get(ev, "vehicle_id"),
          metadata: Map.get(ev, "metadata") || %{}
        }
      end)

      _ = SupabaseClient.post("/rest/v1/profile_activity", profile_rows, headers)

      conn
      |> put_status(:created)
      |> json(%{inserted: length(inserted), activities: inserted})
    else
      {:error, reason} ->
        Logger.error("Behavior track failed: #{inspect(reason)}")
        conn
        |> put_status(:bad_request)
        |> json(%{error: reason})
    end
  end

  def track(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: "Missing or invalid 'events' array"})
  end

  # --- helpers ---

  defp to_user_activity_row(event, user_id) do
    type = normalize_type(Map.get(event, "type"))

    base = %{
      user_id: user_id,
      activity_type: type,
      title: build_title(type, event),
      description: Map.get(event, "title") || Map.get(event, "url"),
      points_earned: score_for(type, event),
      difficulty_level: "basic",
      verification_status: "pending",
      evidence_urls: evidence_urls(event),
      metadata: Map.get(event, "metadata") || %{}
    }

    case Map.get(event, "vehicle_id") do
      nil -> base
      vid -> Map.put(base, :vehicle_id, vid)
    end
  end

  defp normalize_type("listing_view"), do: "vehicle_contribution"
  defp normalize_type("vin_detected"), do: "vehicle_contribution"
  defp normalize_type("click_through"), do: "vehicle_contribution"
  defp normalize_type("image_view"), do: "vehicle_contribution"
  defp normalize_type(other) when is_binary(other), do: other
  defp normalize_type(_), do: "vehicle_contribution"

  defp build_title("vehicle_contribution", %{"type" => "listing_view", "url" => url}) do
    "Viewed listing: #{truncate(url)}"
  end

  defp build_title("vehicle_contribution", %{"type" => "vin_detected", "url" => url}) do
    "Detected VIN on page: #{truncate(url)}"
  end

  defp build_title("vehicle_contribution", %{"type" => "click_through", "url" => url}) do
    "Clicked through to details: #{truncate(url)}"
  end

  defp build_title(_type, event) do
    Map.get(event, "title") || "Activity"
  end

  defp map_profile_activity_type(%{"type" => "listing_view"}), do: "contribution_made"
  defp map_profile_activity_type(%{"type" => "vin_detected"}), do: "contribution_made"
  defp map_profile_activity_type(%{"type" => "click_through"}), do: "contribution_made"
  defp map_profile_activity_type(_), do: "contribution_made"

  defp score_for(_type, %{"dwell_ms" => ms}) when is_integer(ms) do
    # simple heuristic: >10s = +3, >3s = +1, else 0
    cond do
      ms >= 10_000 -> 3
      ms >= 3_000 -> 1
      true -> 0
    end
  end

  defp score_for(_type, _event), do: 0

  defp evidence_urls(event) do
    case Map.get(event, "url") do
      nil -> nil
      url -> [url]
    end
  end

  defp truncate(nil), do: ""
  defp truncate(url) when is_binary(url) do
    if String.length(url) > 80, do: String.slice(url, 0, 77) <> "...", else: url
  end
end
