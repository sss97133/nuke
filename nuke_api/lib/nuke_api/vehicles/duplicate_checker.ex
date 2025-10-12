defmodule NukeApi.Vehicles.DuplicateChecker do
  @moduledoc """
  Utility module for detecting duplicate images before upload.
  Prevents the bulk upload glitch that creates duplicate images.
  """

  import Ecto.Query
  alias NukeApi.Repo
  alias NukeApi.Vehicles.Image

  @doc """
  Checks if an image with similar characteristics already exists for a vehicle.
  Uses file size, name patterns, and upload timing to detect duplicates.
  """
  def duplicate_exists?(vehicle_id, attrs) do
    file_size = Map.get(attrs, "file_size") || Map.get(attrs, :file_size)
    url = Map.get(attrs, "url") || Map.get(attrs, :url)

    if file_size && url do
      # Check for exact URL match first
      exact_match = from(i in Image,
        where: i.vehicle_id == ^vehicle_id and i.url == ^url
      ) |> Repo.exists?()

      if exact_match do
        {:duplicate, :exact_url_match}
      else
        # Check for similar file size uploaded recently (within last 5 minutes)
        five_minutes_ago = DateTime.utc_now() |> DateTime.add(-5 * 60, :second)

        similar_recent = from(i in Image,
          where: i.vehicle_id == ^vehicle_id
            and i.file_size == ^file_size
            and i.inserted_at > ^five_minutes_ago
        ) |> Repo.exists?()

        if similar_recent do
          {:duplicate, :similar_recent_upload}
        else
          {:ok, :no_duplicate}
        end
      end
    else
      {:ok, :insufficient_data}
    end
  end

  @doc """
  Extracts a file fingerprint from the upload parameters to help identify duplicates.
  """
  def generate_file_fingerprint(attrs) do
    file_size = Map.get(attrs, "file_size") || Map.get(attrs, :file_size) || 0
    url = Map.get(attrs, "url") || Map.get(attrs, :url) || ""

    # Create a simple fingerprint from available data
    :crypto.hash(:sha256, "#{url}_#{file_size}")
    |> Base.encode16()
    |> String.slice(0, 16)
  end
end