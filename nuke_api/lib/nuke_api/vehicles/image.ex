defmodule NukeApi.Vehicles.Image do
  @moduledoc """
  Schema for Vehicle Images - links images to vehicles with appropriate categorization.

  Part of the vehicle-centric architecture, allowing for comprehensive visual documentation
  of vehicles throughout their lifecycle.
  """

  use Ecto.Schema
  import Ecto.Changeset
  alias NukeApi.Vehicles.Vehicle
  alias NukeApi.Vehicles.ImageTag

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "vehicle_images" do
    # Reference to the vehicle
    belongs_to :vehicle, Vehicle
    field :user_id, :binary_id

    # Tags relationship
    has_many :tags, ImageTag, foreign_key: :image_id

    # Image details
    field :url, :string, source: :image_url
    field :thumbnail_url, :string
    field :medium_url, :string
    field :large_url, :string
    field :optimization_status, :string, default: "pending"
    field :optimized_at, :utc_datetime
    field :variants, :map, default: %{}
    field :category, :string, default: "general"
    field :position, :integer, default: 0
    field :is_primary, :boolean, default: false

    # File metadata that exists in database
    field :file_size, :integer
    field :mime_type, :string
    field :filename, :string
    field :file_hash, :string
    field :storage_path, :string

    # Location data
    field :latitude, :decimal
    field :longitude, :decimal
    field :location_name, :string

    # Additional metadata
    field :caption, :string
    field :exif_data, :map
    field :taken_at, :utc_datetime
    field :source, :string, default: "user_upload"
    field :source_url, :string
    field :is_external, :boolean, default: false
    field :is_sensitive, :boolean, default: false
    field :sensitive_type, :string
    field :safe_preview_url, :string

    # Workflow fields
    field :process_stage, :string
    field :workflow_role, :string
    field :area, :string
    field :part, :string
    field :damage_type, :string
    field :operation, :string
    field :materials, {:array, :string}
    field :labels, {:array, :string}
    field :spatial_tags, {:array, :map}, default: []
    field :angle, :string
    field :perspective, :string

    # References
    field :timeline_event_id, :binary_id
    field :task_id, :binary_id
    field :event_id, :binary_id

    # Legacy fields
    field :image_type, :string
    field :image_category, :string
    field :image_context, :string
    field :file_name, :string

    timestamps(inserted_at: :created_at, updated_at: :updated_at)
  end

  @required_fields ~w(vehicle_id url user_id)a
  @optional_fields ~w(
    thumbnail_url medium_url large_url optimization_status optimized_at variants
    category position is_primary file_size mime_type filename file_hash storage_path
    latitude longitude location_name caption exif_data taken_at source source_url
    is_external is_sensitive sensitive_type safe_preview_url process_stage workflow_role
    area part damage_type operation materials labels spatial_tags angle perspective timeline_event_id
    task_id event_id image_type image_category image_context file_name
  )a

  @categories [
    "exterior", "interior", "engine", "damage", "repair", 
    "restoration", "document", "general"
  ]

  @doc """
  Creates a changeset for a vehicle image.
  """
  def changeset(image, attrs) do
    image
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:category, @categories)
    |> validate_number(:position, greater_than_or_equal_to: 0)
    |> foreign_key_constraint(:vehicle_id)
    |> maybe_set_primary()
  end

  defp maybe_set_primary(changeset) do
    case get_change(changeset, :is_primary) do
      true ->
        # If setting this as primary, we should ensure a proper position
        put_change(changeset, :position, 0)
      _ ->
        changeset
    end
  end

  @doc """
  Validates spatial tags structure and content.
  """
  def validate_spatial_tags(changeset) do
    case get_change(changeset, :spatial_tags) do
      nil -> changeset
      tags when is_list(tags) ->
        if Enum.all?(tags, &valid_spatial_tag?/1) do
          changeset
        else
          add_error(changeset, :spatial_tags, "contains invalid spatial tag structure")
        end
      _ ->
        add_error(changeset, :spatial_tags, "must be a list of spatial tag objects")
    end
  end

  @doc """
  Adds a spatial tag to an image.
  """
  def add_spatial_tag(image, tag_params) do
    tag = %{
      "id" => Ecto.UUID.generate(),
      "x" => tag_params["x"],
      "y" => tag_params["y"],
      "type" => tag_params["type"],
      "text" => tag_params["text"],
      "data" => tag_params["data"] || %{},
      "verification_status" => "pending",
      "trust_score" => 10,
      "created_by" => tag_params["created_by"],
      "created_at" => DateTime.utc_now() |> DateTime.to_iso8601(),
      "verified_by" => [],
      "disputed_by" => []
    }

    current_tags = image.spatial_tags || []
    updated_tags = current_tags ++ [tag]

    image
    |> changeset(%{"spatial_tags" => updated_tags})
  end

  @doc """
  Updates a spatial tag by ID.
  """
  def update_spatial_tag(image, tag_id, updates) do
    current_tags = image.spatial_tags || []

    updated_tags = Enum.map(current_tags, fn tag ->
      if tag["id"] == tag_id do
        Map.merge(tag, updates)
      else
        tag
      end
    end)

    image
    |> changeset(%{"spatial_tags" => updated_tags})
  end

  @doc """
  Removes a spatial tag by ID.
  """
  def remove_spatial_tag(image, tag_id) do
    current_tags = image.spatial_tags || []
    updated_tags = Enum.reject(current_tags, &(&1["id"] == tag_id))

    image
    |> changeset(%{"spatial_tags" => updated_tags})
  end

  @doc """
  Gets a spatial tag by ID.
  """
  def get_spatial_tag(image, tag_id) do
    current_tags = image.spatial_tags || []
    Enum.find(current_tags, &(&1["id"] == tag_id))
  end

  # Private helper to validate spatial tag structure
  defp valid_spatial_tag?(%{} = tag) when is_map(tag) do
    required_keys = ["id", "x", "y", "type", "text", "verification_status", "created_by", "created_at"]
    has_required = Enum.all?(required_keys, &Map.has_key?(tag, &1))

    valid_coordinates = is_number(tag["x"]) and is_number(tag["y"]) and
                       tag["x"] >= 0 and tag["x"] <= 100 and
                       tag["y"] >= 0 and tag["y"] <= 100

    valid_type = tag["type"] in ["person", "location", "product", "damage", "modification"]

    has_required and valid_coordinates and valid_type
  end
  defp valid_spatial_tag?(_), do: false
end
