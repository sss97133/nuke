defmodule NukeApi.Brands.BrandTag do
  @moduledoc """
  Schema for BrandTag - links brands to specific spatial tags in images.

  This is the core table for corporate data harvesting - tracks which spatial tags
  contain references to specific brands for analytics and claiming purposes.
  """

  use Ecto.Schema
  import Ecto.Changeset
  alias NukeApi.Brands.Brand
  alias NukeApi.Vehicles.Image

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "brand_tags" do
    field :spatial_tag_id, :string
    field :tag_type, :string
    field :confidence_score, :integer, default: 0

    # Auto-tagging information
    field :detected_method, :string
    field :detection_confidence, :integer, default: 0
    field :detection_metadata, :map, default: %{}

    # Verification
    field :verification_status, :string, default: "pending"
    field :verified_at, :utc_datetime
    field :verified_by, :binary_id

    belongs_to :brand, Brand
    belongs_to :image, Image, foreign_key: :image_id

    timestamps()
  end

  @required_fields ~w(brand_id image_id spatial_tag_id tag_type)a
  @optional_fields ~w(
    confidence_score detected_method detection_confidence detection_metadata
    verification_status verified_at verified_by
  )a

  @tag_types [
    "product", "service", "location", "sponsorship", "damage", "modification"
  ]

  @verification_statuses [
    "pending", "verified", "disputed", "rejected"
  ]

  @detected_methods [
    "user_input", "ai_recognition", "serial_lookup", "gps_location", "manual_linking"
  ]

  @doc """
  Creates a changeset for a brand tag.
  """
  def changeset(brand_tag, attrs) do
    brand_tag
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:tag_type, @tag_types)
    |> validate_inclusion(:verification_status, @verification_statuses)
    |> validate_inclusion(:detected_method, @detected_methods)
    |> validate_number(:confidence_score, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> validate_number(:detection_confidence, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> foreign_key_constraint(:brand_id)
    |> foreign_key_constraint(:image_id)
    |> unique_constraint([:image_id, :spatial_tag_id, :brand_id])
  end

  @doc """
  Creates a changeset for verifying a brand tag.
  """
  def verify_changeset(brand_tag, verifier_user_id, verification_status) do
    brand_tag
    |> change(%{
      verification_status: verification_status,
      verified_at: DateTime.utc_now(),
      verified_by: verifier_user_id
    })
    |> validate_inclusion(:verification_status, @verification_statuses)
  end

  @doc """
  Finds brand tags for a specific image.
  """
  def for_image(query \\ __MODULE__, image_id) do
    import Ecto.Query

    query
    |> where([bt], bt.image_id == ^image_id)
    |> preload([:brand, :image])
  end

  @doc """
  Finds brand tags for a specific brand.
  """
  def for_brand(query \\ __MODULE__, brand_id) do
    import Ecto.Query

    query
    |> where([bt], bt.brand_id == ^brand_id)
    |> preload([:brand, :image])
  end

  @doc """
  Finds high-confidence brand tags for analytics.
  """
  def high_confidence(query \\ __MODULE__, min_confidence \\ 70) do
    import Ecto.Query

    query
    |> where([bt], bt.confidence_score >= ^min_confidence)
    |> where([bt], bt.verification_status in ["verified", "pending"])
  end
end