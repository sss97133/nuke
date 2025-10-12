defmodule NukeApi.Vehicles.ImageTag do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  @derive {Jason.Encoder, except: [:__meta__, :image]}

  @tag_types ["product", "damage", "location", "modification", "brand", "part", "tool", "fluid"]
  @verification_statuses ["pending", "verified", "peer_verified", "disputed", "rejected"]

  schema "image_tags" do
    field :x_position, :float
    field :y_position, :float
    field :tag_type, :string
    field :text, :string
    field :verification_status, :string, default: "pending"
    field :trust_score, :integer, default: 10
    field :created_by, :string
    field :verified_by, :string
    field :verified_at, :utc_datetime
    field :metadata, :map, default: %{}

    belongs_to :image, NukeApi.Vehicles.Image

    timestamps(type: :utc_datetime)
  end

  def changeset(image_tag, attrs) do
    image_tag
    |> cast(attrs, [:image_id, :x_position, :y_position, :tag_type, :text, :verification_status, :trust_score, :created_by, :verified_by, :verified_at, :metadata])
    |> validate_required([:image_id, :x_position, :y_position, :tag_type, :text])
    |> validate_inclusion(:tag_type, @tag_types)
    |> validate_inclusion(:verification_status, @verification_statuses)
    |> validate_number(:x_position, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> validate_number(:y_position, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> validate_number(:trust_score, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> validate_length(:text, min: 1, max: 500)
    |> foreign_key_constraint(:image_id)
  end

  def tag_types, do: @tag_types
  def verification_statuses, do: @verification_statuses
end