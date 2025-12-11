defmodule NukeApi.Mailbox.DuplicateDetection do
  use Ecto.Schema
  import Ecto.Changeset

  alias NukeApi.Vehicles.Vehicle
  alias NukeApi.Accounts.User

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @detection_methods [
    "exif_gps",
    "image_hash",
    "ai_visual",
    "temporal_clustering",
    "manual_report"
  ]

  @statuses ["pending", "confirmed", "rejected", "merged"]

  schema "duplicate_detections" do
    field :detection_method, :string
    field :confidence_score, :decimal
    field :evidence, :map
    field :status, :string, default: "pending"
    field :reviewed_at, :utc_datetime

    belongs_to :original_vehicle, Vehicle, foreign_key: :original_vehicle_id
    belongs_to :duplicate_vehicle, Vehicle, foreign_key: :duplicate_vehicle_id
    belongs_to :reviewed_by, User

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(duplicate_detection, attrs) do
    duplicate_detection
    |> cast(attrs, [
      :original_vehicle_id,
      :duplicate_vehicle_id,
      :detection_method,
      :confidence_score,
      :evidence,
      :status,
      :reviewed_by,
      :reviewed_at
    ])
    |> validate_required([
      :original_vehicle_id,
      :duplicate_vehicle_id,
      :detection_method,
      :confidence_score
    ])
    |> validate_inclusion(:detection_method, @detection_methods)
    |> validate_inclusion(:status, @statuses)
    |> validate_number(:confidence_score, greater_than_or_equal_to: 0.0, less_than_or_equal_to: 1.0)
    |> validate_different_vehicles()
    |> unique_constraint([:original_vehicle_id, :duplicate_vehicle_id],
      name: :unique_duplicate_pair
    )
    |> foreign_key_constraint(:original_vehicle_id)
    |> foreign_key_constraint(:duplicate_vehicle_id)
    |> foreign_key_constraint(:reviewed_by)
  end

  defp validate_different_vehicles(changeset) do
    original_id = get_field(changeset, :original_vehicle_id)
    duplicate_id = get_field(changeset, :duplicate_vehicle_id)

    if original_id == duplicate_id do
      add_error(changeset, :duplicate_vehicle_id, "cannot be the same as original vehicle")
    else
      changeset
    end
  end

  def detection_methods, do: @detection_methods
  def statuses, do: @statuses
end