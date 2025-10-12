defmodule NukeApi.GPS.LocationService do
  @moduledoc """
  Service for GPS-based location tagging and reverse geocoding.

  Handles extracting GPS coordinates from EXIF data, reverse geocoding to addresses,
  and auto-tagging locations in images.
  """

  alias NukeApi.Brands
  alias NukeApi.Vehicles.Image

  @doc """
  Extracts GPS coordinates from EXIF data.
  """
  def extract_gps_from_exif(exif_data) when is_map(exif_data) do
    with %{"GPS" => gps_data} <- exif_data,
         {:ok, lat} <- parse_gps_coordinate(gps_data["GPSLatitude"], gps_data["GPSLatitudeRef"]),
         {:ok, lng} <- parse_gps_coordinate(gps_data["GPSLongitude"], gps_data["GPSLongitudeRef"]) do
      {:ok, %{latitude: lat, longitude: lng}}
    else
      _ -> {:error, :no_gps_data}
    end
  end
  def extract_gps_from_exif(_), do: {:error, :no_gps_data}

  @doc """
  Reverse geocodes GPS coordinates to an address using a geocoding service.
  """
  def reverse_geocode(latitude, longitude) do
    # Using a simple HTTP geocoding service (you'd want to use a proper service like Google Maps API)
    url = "https://api.opencagedata.com/geocode/v1/json"
    api_key = System.get_env("OPENCAGE_API_KEY") || ""

    query_params = %{
      "q" => "#{latitude},#{longitude}",
      "key" => api_key,
      "limit" => 1,
      "no_annotations" => 1
    }

    case make_geocoding_request(url, query_params) do
      {:ok, response} ->
        case response["results"] do
          [first_result | _] ->
            {:ok, %{
              formatted_address: first_result["formatted"],
              components: first_result["components"],
              confidence: first_result["confidence"]
            }}
          [] ->
            {:error, :no_results}
        end
      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc """
  Auto-creates location tags for an image based on GPS coordinates.
  """
  def auto_tag_location(image_id, latitude, longitude, user_id) do
    case reverse_geocode(latitude, longitude) do
      {:ok, location_data} ->
        # Create location tag
        tag_data = %{
          "x" => 50.0,  # Center position for auto-generated tags
          "y" => 10.0,  # Top-left area for location tags
          "type" => "location",
          "text" => format_location_text(location_data),
          "data" => %{
            "lat" => latitude,
            "lng" => longitude,
            "formatted_address" => location_data.formatted_address,
            "components" => location_data.components,
            "confidence" => location_data.confidence,
            "auto_generated" => true
          },
          "created_by" => user_id
        }

        # Add spatial tag to image
        case NukeApi.Vehicles.get_image(image_id) do
          %Image{} = image ->
            changeset = Image.add_spatial_tag(image, tag_data)
            case NukeApi.Vehicles.update_image(image, %{"spatial_tags" => changeset.changes.spatial_tags}) do
              {:ok, updated_image} ->
                new_tag = List.last(updated_image.spatial_tags)
                {:ok, new_tag}
              error -> error
            end
          nil ->
            {:error, :image_not_found}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc """
  Finds nearby businesses and creates business location tags.
  """
  def auto_tag_nearby_businesses(image_id, latitude, longitude, user_id, opts \\ []) do
    radius = opts[:radius] || 100 # meters
    business_types = opts[:business_types] || ["automotive_repair", "car_dealer", "gas_station"]

    case find_nearby_businesses(latitude, longitude, radius, business_types) do
      {:ok, businesses} ->
        # Create tags for each relevant business
        results = Enum.map(businesses, fn business ->
          create_business_tag(image_id, business, user_id)
        end)

        successful_tags = Enum.filter(results, fn
          {:ok, _} -> true
          _ -> false
        end) |> Enum.map(fn {:ok, tag} -> tag end)

        {:ok, successful_tags}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc """
  Processes an uploaded image for automatic GPS-based tagging.
  """
  def process_image_for_location_tags(image_id, exif_data, user_id) do
    case extract_gps_from_exif(exif_data) do
      {:ok, %{latitude: lat, longitude: lng}} ->
        results = %{}

        # Auto-tag general location
        location_result = auto_tag_location(image_id, lat, lng, user_id)
        results = Map.put(results, :location_tag, location_result)

        # Auto-tag nearby businesses (if relevant)
        business_result = auto_tag_nearby_businesses(image_id, lat, lng, user_id)
        results = Map.put(results, :business_tags, business_result)

        {:ok, results}

      {:error, reason} ->
        {:error, reason}
    end
  end

  # =====================================================================================
  # PRIVATE HELPER FUNCTIONS
  # =====================================================================================

  defp parse_gps_coordinate(coordinate_data, ref) when is_list(coordinate_data) and is_binary(ref) do
    try do
      [degrees, minutes, seconds] = coordinate_data

      # Convert to decimal degrees
      decimal = degrees + (minutes / 60) + (seconds / 3600)

      # Apply direction (N/E are positive, S/W are negative)
      decimal = if ref in ["S", "W"], do: -decimal, else: decimal

      {:ok, decimal}
    rescue
      _ -> {:error, :invalid_coordinate}
    end
  end
  defp parse_gps_coordinate(_, _), do: {:error, :invalid_coordinate}

  defp make_geocoding_request(url, params) do
    case HTTPoison.get(url, [], params: params) do
      {:ok, %HTTPoison.Response{status_code: 200, body: body}} ->
        case Jason.decode(body) do
          {:ok, data} -> {:ok, data}
          {:error, _} -> {:error, :invalid_json}
        end
      {:ok, %HTTPoison.Response{status_code: status_code}} ->
        {:error, {:http_error, status_code}}
      {:error, reason} ->
        {:error, reason}
    end
  end

  defp format_location_text(location_data) do
    components = location_data.components

    # Try to create a meaningful location description
    parts = []

    # Add business name if present
    parts = if components["_type"] == "building" and components["building"] do
      [components["building"] | parts]
    else
      parts
    end

    # Add street address
    parts = if components["house_number"] and components["road"] do
      ["#{components["house_number"]} #{components["road"]}" | parts]
    else
      parts
    end

    # Add city
    parts = if components["city"] || components["town"] || components["village"] do
      [components["city"] || components["town"] || components["village"] | parts]
    else
      parts
    end

    # Add state/province
    parts = if components["state"] do
      [components["state"] | parts]
    else
      parts
    end

    case parts do
      [] -> location_data.formatted_address
      _ -> Enum.reverse(parts) |> Enum.join(", ")
    end
  end

  defp find_nearby_businesses(latitude, longitude, radius, business_types) do
    # This would integrate with Google Places API or similar service
    # For now, returning a mock implementation

    # Mock business data
    mock_businesses = [
      %{
        name: "AutoZone",
        type: "automotive_repair",
        address: "123 Main St",
        latitude: latitude + 0.001,
        longitude: longitude + 0.001,
        place_id: "mock_place_id_1"
      }
    ]

    {:ok, mock_businesses}
  end

  defp create_business_tag(image_id, business, user_id) do
    tag_data = %{
      "x" => 75.0,  # Right side for business tags
      "y" => 15.0,
      "type" => "location",
      "text" => "Near #{business.name}",
      "data" => %{
        "business_name" => business.name,
        "business_type" => business.type,
        "address" => business.address,
        "lat" => business.latitude,
        "lng" => business.longitude,
        "place_id" => business.place_id,
        "auto_generated" => true,
        "nearby" => true
      },
      "created_by" => user_id
    }

    case NukeApi.Vehicles.get_image(image_id) do
      %Image{} = image ->
        changeset = Image.add_spatial_tag(image, tag_data)
        case NukeApi.Vehicles.update_image(image, %{"spatial_tags" => changeset.changes.spatial_tags}) do
          {:ok, updated_image} ->
            new_tag = List.last(updated_image.spatial_tags)

            # Try to link to existing brand if available
            if business.name do
              case Brands.find_brand_by_name_or_alias(business.name) do
                %Brands.Brand{} = brand ->
                  Brands.link_brand_to_spatial_tag(
                    brand.id,
                    image_id,
                    new_tag["id"],
                    tag_type: "location",
                    confidence_score: 80,
                    detected_method: "gps_location"
                  )
                _ -> :ok
              end
            end

            {:ok, new_tag}
          error -> error
        end
      nil ->
        {:error, :image_not_found}
    end
  end
end