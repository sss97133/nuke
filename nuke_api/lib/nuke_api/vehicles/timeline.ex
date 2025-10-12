defmodule NukeApi.Vehicles.Timeline do
  @moduledoc """
  Schema for Vehicle Timeline events - maintains an immutable history of all 
  significant events in a vehicle's lifecycle.
  
  This is a key component of the vehicle-centric architecture, ensuring that
  information accumulates over time and builds a comprehensive vehicle history.
  """
  
  use Ecto.Schema
  import Ecto.Changeset
  alias NukeApi.Vehicles.Vehicle

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "vehicle_timeline" do
    # Reference to the vehicle
    belongs_to :vehicle, Vehicle
    
    # Event details
    field :event_type, :string
    field :event_date, :utc_datetime
    field :source, :string
    field :confidence_score, :float, default: 1.0
    
    # Event data
    field :title, :string
    field :description, :string
    field :location, :string
    
    # Ownership and verification
    field :creator_id, :binary_id
    field :verified, :boolean, default: false
    field :verifier_id, :binary_id
    
    # Additional data
    field :metadata, :map, default: %{}
    
    timestamps()
  end

  @required_fields ~w(vehicle_id event_type event_date title)a
  @optional_fields ~w(source confidence_score description location creator_id verified verifier_id metadata)a

  @event_types [
    "purchase", "sale", "service", "repair", "restoration",
    "inspection", "modification", "registration", "accident",
    "milestone", "image_upload", "custom", "maintenance",
    "transport", "fuel_stop", "route_documentation",
    "pickup_delivery", "general"
  ]

  @doc """
  Creates a changeset for a timeline event.
  """
  def changeset(timeline, attrs) do
    timeline
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:event_type, @event_types)
    |> validate_number(:confidence_score, greater_than: 0.0, less_than_or_equal_to: 1.0)
    |> foreign_key_constraint(:vehicle_id)
  end
end
