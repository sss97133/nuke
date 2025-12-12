defmodule NukeApi.Mailbox.VehicleMailbox do
  use Ecto.Schema
  import Ecto.Changeset

  alias NukeApi.Vehicles.Vehicle
  alias NukeApi.Mailbox.{MailboxMessage, MailboxAccessKey}

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "vehicle_mailboxes" do
    field :vin, :string

    belongs_to :vehicle, Vehicle
    has_many :messages, MailboxMessage, foreign_key: :mailbox_id
    has_many :access_keys, MailboxAccessKey, foreign_key: :mailbox_id

    # Virtual fields for API responses
    field :user_access_level, :string, virtual: true
    field :unread_count, :integer, virtual: true
    # Legacy field name used by some UI components (kept as an alias for unread_count for now)
    field :message_count, :integer, virtual: true

    # Supabase SQL migrations use created_at/updated_at column names.
    timestamps(inserted_at: :created_at, updated_at: :updated_at, type: :utc_datetime)
  end

  @doc false
  def changeset(vehicle_mailbox, attrs) do
    vehicle_mailbox
    |> cast(attrs, [:vehicle_id, :vin])
    |> validate_required([:vehicle_id])
    # VIN is optional during onboarding; enforce length only when present.
    |> validate_length(:vin, is: 17)
    |> unique_constraint(:vehicle_id)
    # VIN uniqueness is enforced by a partial unique index (vin IS NOT NULL)
    |> unique_constraint(:vin, name: :idx_vehicle_mailboxes_vin_unique)
    |> foreign_key_constraint(:vehicle_id)
  end
end