defmodule NukeApi.Vehicles.Vehicle do
  @moduledoc """
  Schema for Vehicle - the central entity in the Nuke platform.
  
  Vehicles are first-class digital entities with persistent identities that
  maintain a complete digital profile regardless of ownership changes.
  """
  
  use Ecto.Schema
  import Ecto.Changeset
  alias NukeApi.Vehicles.{Timeline, Image}

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "vehicles" do
    field :make, :string
    field :model, :string
    field :year, :integer
    field :vin, :string
    field :license_plate, :string
    field :color, :string
    field :mileage, :integer
    field :engine_size, :string  # Updated to match database
    field :transmission, :string
    field :drivetrain, :string
    field :status, :string, default: "active"
    field :uploaded_by, :binary_id
    field :import_source, :string
    field :import_metadata, :map
    field :uploaded_at, :utc_datetime

    # Relationships
    has_many :timeline_events, Timeline
    has_many :images, Image
  end

  @required_fields ~w(make model year)a
  @optional_fields ~w(vin license_plate color mileage engine_size transmission drivetrain status uploaded_by import_source import_metadata uploaded_at)a

  @doc """
  Creates a changeset for a vehicle.
  """
  def changeset(vehicle, attrs) do
    vehicle
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:status, ["active", "inactive", "pending", "archived"])
    |> unique_constraint(:vin)
    |> validate_number(:year, greater_than: 1885, less_than_or_equal_to: current_year() + 1)
  end

  # Helper to get current year for validation
  defp current_year do
    DateTime.utc_now().year
  end
end
